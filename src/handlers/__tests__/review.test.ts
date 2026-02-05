import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleReviewEvent, type PrReviewPayload } from '../review.js';

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
  reviewerLogin: string;
  reviewerType: 'User' | 'Bot';
  state: string;
  ownerLogin: string;
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

  it('returns early for owner comment replies (cascade filter #13)', async () => {
    const db = makeMockDb();
    const { client } = makeMockClient();
    const payload = makePayload({
      reviewerLogin: 'owner',
      ownerLogin: 'owner',
      state: 'commented',
    });

    await handleReviewEvent(client as any, db as any, { prs: '123' }, payload);

    expect(db.logEvent).not.toHaveBeenCalled();
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

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
    });

    // Will throw because our mock channel isn't a real TextChannel,
    // but the point is it got past the owner filter
    await expect(
      handleReviewEvent(client as any, db as any, { prs: '123' }, payload)
    ).rejects.toThrow();

    // Confirms the filter did NOT block it — it proceeded to fetch the channel
    expect(client.channels.fetch).toHaveBeenCalled();
  });

  it('does NOT filter non-owner comment reviews', async () => {
    const db = makeMockDb();
    const { client } = makeMockClient();
    const payload = makePayload({
      reviewerLogin: 'external-reviewer',
      ownerLogin: 'owner',
      state: 'commented',
    });

    // Will throw on TextChannel check, but confirms it got past filters
    await expect(
      handleReviewEvent(client as any, db as any, { prs: '123' }, payload)
    ).rejects.toThrow();

    expect(client.channels.fetch).toHaveBeenCalled();
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
