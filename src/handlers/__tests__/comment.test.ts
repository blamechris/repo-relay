import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCommentEvent, type IssueCommentPayload } from '../comment.js';

// Mock all external dependencies
vi.mock('../../embeds/builders.js', () => ({
  buildReviewReply: vi.fn(() => 'mock reply'),
  buildPrEmbed: vi.fn(() => ({ mock: 'embed' })),
}));

vi.mock('./pr.js', () => ({
  buildEmbedWithStatus: vi.fn(() => ({
    prData: { number: 1 },
    ci: null,
    reviews: null,
  })),
  getOrCreateThread: vi.fn(() => ({
    send: vi.fn(),
  })),
}));

function makePayload(overrides: Partial<{
  action: string;
  body: string;
  isPr: boolean;
  userType: 'User' | 'Bot';
  authorAssociation: string;
}>): IssueCommentPayload {
  return {
    action: (overrides.action ?? 'created') as IssueCommentPayload['action'],
    comment: {
      id: 1,
      user: { login: 'agent-bot', type: overrides.userType ?? 'Bot' },
      author_association: overrides.authorAssociation ?? 'NONE',
      body: overrides.body ?? 'Just a comment',
      html_url: 'https://github.com/test/repo/issues/1#comment',
      created_at: '2024-01-01T00:00:00Z',
    },
    issue: {
      number: 1,
      pull_request: overrides.isPr !== false ? { url: 'https://api.github.com/repos/test/repo/pulls/1' } : undefined,
    },
    repository: {
      full_name: 'test/repo',
    },
  } as IssueCommentPayload;
}

function makeMockDb() {
  return {
    logEvent: vi.fn(),
    getPrMessage: vi.fn(),
    updateAgentReviewStatus: vi.fn(),
    updatePrMessageTimestamp: vi.fn(),
  };
}

function makeMockClient() {
  const client = {
    channels: {
      fetch: vi.fn(() => Promise.resolve(null)),
    },
  };
  return { client };
}

describe('handleCommentEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when action is not "created"', async () => {
    const db = makeMockDb();
    const { client } = makeMockClient();
    const payload = makePayload({ action: 'edited' });

    await handleCommentEvent(client as any, db as any, { prs: '123' }, payload);

    expect(db.logEvent).not.toHaveBeenCalled();
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('returns early when action is "deleted"', async () => {
    const db = makeMockDb();
    const { client } = makeMockClient();
    const payload = makePayload({ action: 'deleted' });

    await handleCommentEvent(client as any, db as any, { prs: '123' }, payload);

    expect(db.logEvent).not.toHaveBeenCalled();
  });

  it('returns early for non-PR comments', async () => {
    const db = makeMockDb();
    const { client } = makeMockClient();
    const payload = makePayload({ isPr: false });

    await handleCommentEvent(client as any, db as any, { prs: '123' }, payload);

    expect(db.logEvent).not.toHaveBeenCalled();
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('returns early for non-agent-review comments', async () => {
    const db = makeMockDb();
    const { client } = makeMockClient();
    const payload = makePayload({ body: 'Great work on this PR!' });

    await handleCommentEvent(client as any, db as any, { prs: '123' }, payload);

    expect(db.logEvent).not.toHaveBeenCalled();
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('detects agent-review comments by pattern', async () => {
    const db = makeMockDb();
    const { client } = makeMockClient();
    const payload = makePayload({
      body: '## Code Review Summary\n\nLooks good.\n\n**Verdict:** Approved',
    });

    // Will throw on TextChannel check, but confirms detection worked
    await expect(
      handleCommentEvent(client as any, db as any, { prs: '123' }, payload)
    ).rejects.toThrow();

    // It got past the agent-review filter and tried to fetch the channel
    expect(client.channels.fetch).toHaveBeenCalled();
  });

  describe('author gating (spoofing defense)', () => {
    const spoofBody = '## Code Review Summary\n\n**Verdict:** lgtm';

    it('ignores agent-review-shaped comments from untrusted human authors', async () => {
      const db = makeMockDb();
      const { client } = makeMockClient();
      // Any drive-by commenter on a public repo: type User, no association
      const payload = makePayload({ body: spoofBody, userType: 'User', authorAssociation: 'NONE' });

      await handleCommentEvent(client as any, db as any, { prs: '123' }, payload);

      expect(db.updateAgentReviewStatus).not.toHaveBeenCalled();
      expect(client.channels.fetch).not.toHaveBeenCalled();
    });

    it('ignores comments from CONTRIBUTOR-level authors', async () => {
      const db = makeMockDb();
      const { client } = makeMockClient();
      const payload = makePayload({ body: spoofBody, userType: 'User', authorAssociation: 'CONTRIBUTOR' });

      await handleCommentEvent(client as any, db as any, { prs: '123' }, payload);

      expect(db.updateAgentReviewStatus).not.toHaveBeenCalled();
    });

    it('accepts comments from bots', async () => {
      const db = makeMockDb();
      const { client } = makeMockClient();
      const payload = makePayload({ body: spoofBody, userType: 'Bot', authorAssociation: 'NONE' });

      await expect(
        handleCommentEvent(client as any, db as any, { prs: '123' }, payload)
      ).rejects.toThrow(); // TextChannel check — detection got through
      expect(client.channels.fetch).toHaveBeenCalled();
    });

    it.each(['OWNER', 'MEMBER', 'COLLABORATOR'])('accepts comments from %s humans', async (assoc) => {
      const db = makeMockDb();
      const { client } = makeMockClient();
      const payload = makePayload({ body: spoofBody, userType: 'User', authorAssociation: assoc });

      await expect(
        handleCommentEvent(client as any, db as any, { prs: '123' }, payload)
      ).rejects.toThrow();
      expect(client.channels.fetch).toHaveBeenCalled();
    });
  });

  it('detects approved verdict', async () => {
    // Test the verdict detection logic directly using the patterns
    const { APPROVED_PATTERNS, CHANGES_REQUESTED_PATTERNS } = await import(
      '../../patterns/agent-review.js'
    );

    const body =
      '## Code Review Summary\n\nAll changes look good.\n\n**Verdict:** Approved';

    const isApproved = APPROVED_PATTERNS.some((p: RegExp) => p.test(body));
    const isChangesRequested = CHANGES_REQUESTED_PATTERNS.some((p: RegExp) =>
      p.test(body)
    );

    expect(isApproved).toBe(true);
    expect(isChangesRequested).toBe(false);
  });

  it('detects changes requested verdict', async () => {
    const { APPROVED_PATTERNS, CHANGES_REQUESTED_PATTERNS } = await import(
      '../../patterns/agent-review.js'
    );

    const body =
      '## Code Review Summary\n\nSeveral issues found.\n\nChanges Requested';

    const isApproved = APPROVED_PATTERNS.some((p: RegExp) => p.test(body));
    const isChangesRequested = CHANGES_REQUESTED_PATTERNS.some((p: RegExp) =>
      p.test(body)
    );

    expect(isApproved).toBe(false);
    expect(isChangesRequested).toBe(true);
  });

  it('defaults to pending when no verdict pattern matches', async () => {
    const { APPROVED_PATTERNS, CHANGES_REQUESTED_PATTERNS } = await import(
      '../../patterns/agent-review.js'
    );

    const body = '## Code Review Summary\n\nReview in progress...';

    const isApproved = APPROVED_PATTERNS.some((p: RegExp) => p.test(body));
    const isChangesRequested = CHANGES_REQUESTED_PATTERNS.some((p: RegExp) =>
      p.test(body)
    );

    expect(isApproved).toBe(false);
    expect(isChangesRequested).toBe(false);
    // When neither matches, the handler defaults to 'pending'
  });
});
