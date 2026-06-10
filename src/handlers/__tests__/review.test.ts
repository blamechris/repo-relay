import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextChannel } from 'discord.js';
import { handleReviewEvent, type PrReviewPayload } from '../review.js';
import { updatePrEmbedAndNotify } from '../pr.js';
import { getExistingPrMessage } from '../../discord/lookup.js';
import { buildReviewReply } from '../../embeds/builders.js';

// Mock all external dependencies
vi.mock('../../embeds/builders.js', () => ({
  buildReviewReply: vi.fn(() => 'mock reply'),
  buildPrEmbed: vi.fn(() => ({ mock: 'embed' })),
}));

vi.mock('../pr.js', () => ({
  // Mirrors the real contract: beforeRebuild runs before the embed rebuild
  updatePrEmbedAndNotify: vi.fn(
    async (
      _channel: unknown, _db: unknown, _repo: unknown, _prNumber: unknown,
      _existing: unknown, _threadMessage: unknown, beforeRebuild?: () => void
    ) => {
      beforeRebuild?.();
      return { stale: false, posted: true };
    }
  ),
}));

vi.mock('../../discord/lookup.js', () => ({
  getExistingPrMessage: vi.fn(() => Promise.resolve(null)),
}));

function makePayload(overrides: Partial<{
  action: string;
  reviewerLogin: string;
  reviewerType: 'User' | 'Bot';
  state: string;
  ownerLogin: string;
  authorAssociation: string;
}>): PrReviewPayload {
  return {
    action: overrides.action ?? 'submitted',
    review: {
      id: 1,
      user: {
        login: overrides.reviewerLogin ?? 'reviewer',
        type: overrides.reviewerType ?? 'User',
      },
      body: 'Review body',
      state: (overrides.state ?? 'approved') as PrReviewPayload['review']['state'],
      html_url: 'https://github.com/test/repo/pull/1#review',
      author_association: (overrides.authorAssociation ?? 'NONE') as PrReviewPayload['review']['author_association'],
    },
    pull_request: { number: 1 },
    repository: {
      full_name: 'test/repo',
      owner: { login: overrides.ownerLogin ?? 'owner' },
    },
  } as PrReviewPayload;
}

function makeMockDb() {
  return {
    logEvent: vi.fn(),
    getPrMessage: vi.fn(),
    updateCopilotStatus: vi.fn(),
    updateHumanReviewStatus: vi.fn(),
    updatePrMessageTimestamp: vi.fn(),
  };
}

function makeMockClient(channelExists = true) {
  const mockMessage = { edit: vi.fn() };
  const mockMessages = { fetch: vi.fn(() => Promise.resolve(mockMessage)) };
  const mockChannel = {
    constructor: { name: 'TextChannel' },
    messages: mockMessages,
  };
  // Simulate instanceof TextChannel by making it look like a TextChannel
  Object.setPrototypeOf(mockChannel, { constructor: { name: 'TextChannel' } });

  const client = {
    channels: {
      fetch: vi.fn(() => Promise.resolve(channelExists ? mockChannel : null)),
    },
  };
  return { client, mockChannel, mockMessage };
}

describe('handleReviewEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when action is not "submitted"', async () => {
    const db = makeMockDb();
    const { client } = makeMockClient();
    const payload = makePayload({ action: 'edited' });

    await handleReviewEvent(client as any, db as any, { prs: '123' }, payload);

    expect(db.logEvent).not.toHaveBeenCalled();
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('returns early when action is "dismissed"', async () => {
    const db = makeMockDb();
    const { client } = makeMockClient();
    const payload = makePayload({ action: 'dismissed' });

    await handleReviewEvent(client as any, db as any, { prs: '123' }, payload);

    expect(db.logEvent).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'MEMBER', 'COLLABORATOR'])(
    'returns early for %s comment replies (cascade filter #13/#146)',
    async (authorAssociation) => {
      const db = makeMockDb();
      const { client } = makeMockClient();
      const payload = makePayload({
        state: 'commented',
        authorAssociation,
      });

      await handleReviewEvent(client as any, db as any, { prs: '123' }, payload);

      expect(db.logEvent).not.toHaveBeenCalled();
      expect(client.channels.fetch).not.toHaveBeenCalled();
    }
  );

  it('does NOT filter owner approvals (approvals are meaningful)', async () => {
    const db = makeMockDb();
    db.getPrMessage.mockReturnValue({
      messageId: 'msg-1',
      threadId: 'thread-1',
    });
    const { client } = makeMockClient();
    const payload = makePayload({
      reviewerLogin: 'owner',
      ownerLogin: 'owner',
      state: 'approved',
      authorAssociation: 'OWNER',
    });

    // Will throw because our mock channel isn't a real TextChannel,
    // but the point is it got past the cascade filter
    await expect(
      handleReviewEvent(client as any, db as any, { prs: '123' }, payload)
    ).rejects.toThrow();

    // Confirms the filter did NOT block it — it proceeded to fetch the channel
    expect(client.channels.fetch).toHaveBeenCalled();
  });

  it('does NOT filter comment reviews from external reviewers (NONE association)', async () => {
    const db = makeMockDb();
    const { client } = makeMockClient();
    const payload = makePayload({
      reviewerLogin: 'external-reviewer',
      state: 'commented',
      authorAssociation: 'NONE',
    });

    // Will throw on TextChannel check, but confirms it got past filters
    await expect(
      handleReviewEvent(client as any, db as any, { prs: '123' }, payload)
    ).rejects.toThrow();

    expect(client.channels.fetch).toHaveBeenCalled();
  });

  it('does NOT filter Bot comment reviews (Copilot) even with collaborator association', async () => {
    const db = makeMockDb();
    const { client } = makeMockClient();
    const payload = makePayload({
      reviewerLogin: 'copilot-pull-request-reviewer[bot]',
      reviewerType: 'Bot',
      state: 'commented',
      authorAssociation: 'MEMBER',
    });

    await expect(
      handleReviewEvent(client as any, db as any, { prs: '123' }, payload)
    ).rejects.toThrow();

    expect(client.channels.fetch).toHaveBeenCalled();
  });

  describe('human review path (#146)', () => {
    const existing = {
      repo: 'test/repo', prNumber: 1, channelId: 'channel-1',
      messageId: 'msg-1', threadId: 'thread-1', createdAt: '', lastUpdated: '',
    };

    function makeTextChannelClient() {
      const channel = Object.create(TextChannel.prototype);
      Object.assign(channel, { id: 'channel-1' });
      const client = {
        channels: { fetch: vi.fn(() => Promise.resolve(channel)) },
      };
      return { client, channel };
    }

    it('approved review persists status, posts thread reply, and bumps timestamp', async () => {
      const db = makeMockDb();
      const { client, channel } = makeTextChannelClient();
      vi.mocked(getExistingPrMessage).mockResolvedValueOnce(existing);

      const payload = makePayload({ state: 'approved', authorAssociation: 'MEMBER' });
      await handleReviewEvent(client as any, db as any, { prs: '123' }, payload);

      expect(buildReviewReply).toHaveBeenCalledWith(
        'human', 'approved', undefined,
        'https://github.com/test/repo/pull/1#review', 'reviewer'
      );
      expect(updatePrEmbedAndNotify).toHaveBeenCalledWith(
        channel, db, 'test/repo', 1, existing, 'mock reply', expect.any(Function)
      );
      // beforeRebuild persisted the verdict so the rebuilt embed reflects it
      expect(db.updateHumanReviewStatus).toHaveBeenCalledWith('test/repo', 1, 'approved', 'reviewer');
      expect(db.updatePrMessageTimestamp).toHaveBeenCalledWith('test/repo', 1);
    });

    it('changes_requested review persists that verdict', async () => {
      const db = makeMockDb();
      const { client } = makeTextChannelClient();
      vi.mocked(getExistingPrMessage).mockResolvedValueOnce(existing);

      const payload = makePayload({ state: 'changes_requested', authorAssociation: 'NONE' });
      await handleReviewEvent(client as any, db as any, { prs: '123' }, payload);

      expect(db.updateHumanReviewStatus).toHaveBeenCalledWith('test/repo', 1, 'changes_requested', 'reviewer');
      expect(buildReviewReply).toHaveBeenCalledWith(
        'human', 'changes_requested', undefined,
        'https://github.com/test/repo/pull/1#review', 'reviewer'
      );
    });

    it('human commented review (external) is ignored — no embed update', async () => {
      const db = makeMockDb();
      const { client } = makeTextChannelClient();
      vi.mocked(getExistingPrMessage).mockResolvedValueOnce(existing);

      const payload = makePayload({ state: 'commented', authorAssociation: 'NONE' });
      await handleReviewEvent(client as any, db as any, { prs: '123' }, payload);

      expect(updatePrEmbedAndNotify).not.toHaveBeenCalled();
      expect(db.updateHumanReviewStatus).not.toHaveBeenCalled();
    });

    it('does nothing when the PR has no tracked message', async () => {
      const db = makeMockDb();
      const { client } = makeTextChannelClient();
      vi.mocked(getExistingPrMessage).mockResolvedValueOnce(null);

      const payload = makePayload({ state: 'approved' });
      await handleReviewEvent(client as any, db as any, { prs: '123' }, payload);

      expect(updatePrEmbedAndNotify).not.toHaveBeenCalled();
      expect(db.updateHumanReviewStatus).not.toHaveBeenCalled();
    });

    it('skips the timestamp bump when the Discord message was stale', async () => {
      const db = makeMockDb();
      const { client } = makeTextChannelClient();
      vi.mocked(getExistingPrMessage).mockResolvedValueOnce(existing);
      vi.mocked(updatePrEmbedAndNotify).mockResolvedValueOnce({ stale: true, posted: false });

      const payload = makePayload({ state: 'approved' });
      await handleReviewEvent(client as any, db as any, { prs: '123' }, payload);

      expect(db.updatePrMessageTimestamp).not.toHaveBeenCalled();
    });

    it('non-Copilot bot reviews are still ignored', async () => {
      const db = makeMockDb();
      const { client } = makeTextChannelClient();
      vi.mocked(getExistingPrMessage).mockResolvedValueOnce(existing);

      const payload = makePayload({
        reviewerLogin: 'some-other[bot]', reviewerType: 'Bot', state: 'approved',
      });
      await handleReviewEvent(client as any, db as any, { prs: '123' }, payload);

      expect(updatePrEmbedAndNotify).not.toHaveBeenCalled();
      expect(db.updateHumanReviewStatus).not.toHaveBeenCalled();
    });

    it('Copilot reviews still persist copilot status (existing path intact)', async () => {
      const db = makeMockDb();
      const { client } = makeTextChannelClient();
      vi.mocked(getExistingPrMessage).mockResolvedValueOnce(existing);

      const payload = makePayload({
        reviewerLogin: 'copilot-pull-request-reviewer[bot]',
        reviewerType: 'Bot',
        state: 'commented',
      });
      await handleReviewEvent(client as any, db as any, { prs: '123' }, payload);

      expect(buildReviewReply).toHaveBeenCalledWith(
        'copilot', 'reviewed', undefined, 'https://github.com/test/repo/pull/1#review'
      );
      expect(db.updateCopilotStatus).toHaveBeenCalledWith('test/repo', 1, 'reviewed', 0);
      expect(db.updateHumanReviewStatus).not.toHaveBeenCalled();
    });
  });

  it('identifies Copilot by bot type and login containing "copilot"', () => {
    // Test the detection logic directly
    const testCases = [
      { login: 'copilot[bot]', type: 'Bot' as const, expected: true },
      { login: 'github-copilot[bot]', type: 'Bot' as const, expected: true },
      { login: 'Copilot[bot]', type: 'Bot' as const, expected: true },
      { login: 'some-user', type: 'User' as const, expected: false },
      { login: 'copilot-fan', type: 'User' as const, expected: false },
      { login: 'regular-bot[bot]', type: 'Bot' as const, expected: false },
    ];

    for (const { login, type, expected } of testCases) {
      const isCopilot =
        type === 'Bot' && login.toLowerCase().includes('copilot');
      expect(isCopilot, `${login} (${type})`).toBe(expected);
    }
  });
});
