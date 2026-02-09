import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RepoRelay, type RepoRelayConfig } from '../index.js';

// Mock discord.js
vi.mock('discord.js', () => {
  const mockThread = { send: vi.fn() };
  const mockThreads = { fetch: vi.fn(() => Promise.resolve(mockThread)) };
  const mockMessage = { edit: vi.fn() };
  const mockMessages = { fetch: vi.fn(() => Promise.resolve(mockMessage)) };
  const mockChannel = {
    messages: mockMessages,
    threads: mockThreads,
  };

  // Make it pass instanceof TextChannel check
  class TextChannel {
    messages = mockMessages;
    threads = mockThreads;
  }
  Object.setPrototypeOf(mockChannel, TextChannel.prototype);

  const mockClient = {
    login: vi.fn(),
    destroy: vi.fn(),
    user: { tag: 'test-bot#1234' },
    channels: {
      fetch: vi.fn(() => Promise.resolve(mockChannel)),
    },
  };

  return {
    Client: vi.fn(() => mockClient),
    GatewayIntentBits: { Guilds: 1, GuildMessages: 2 },
    TextChannel,
    PermissionsBitField: { Flags: {} },
    GuildChannel: class {},
  };
});

// Mock review checking
const mockCheckForReviews = vi.fn(() => Promise.resolve({
  copilotReviewed: false,
  agentReviewStatus: 'pending' as const,
  changed: false,
}));

vi.mock('../github/reviews.js', () => ({
  checkForReviews: (...args: unknown[]) => mockCheckForReviews(...args),
}));

// Mock handlers to prevent side effects
vi.mock('../handlers/index.js', () => ({
  handlePrEvent: vi.fn(),
  handleCiEvent: vi.fn(),
  handleReviewEvent: vi.fn(),
  handleCommentEvent: vi.fn(),
  handleIssueEvent: vi.fn(),
  handleReleaseEvent: vi.fn(),
  handleDeploymentEvent: vi.fn(),
}));

vi.mock('../handlers/pr.js', () => ({
  buildEmbedWithStatus: vi.fn(),
}));

vi.mock('../embeds/builders.js', () => ({
  buildPrEmbed: vi.fn(),
  buildReviewReply: vi.fn(),
}));

vi.mock('../discord/lookup.js', () => ({
  getExistingPrMessage: vi.fn(),
}));

// Mock StateDb
const mockGetOpenPrNumbers = vi.fn(() => [] as number[]);
const mockGetPrStatus = vi.fn();
const mockClose = vi.fn();

vi.mock('../db/state.js', () => ({
  StateDb: vi.fn(() => ({
    getOpenPrNumbers: mockGetOpenPrNumbers,
    getPrStatus: mockGetPrStatus,
    getPrMessage: vi.fn(),
    updateCopilotStatus: vi.fn(),
    updateAgentReviewStatus: vi.fn(),
    logEvent: vi.fn(),
    close: mockClose,
  })),
}));

function makeConfig(overrides?: Partial<RepoRelayConfig>): RepoRelayConfig {
  return {
    discordToken: 'test-token',
    githubToken: 'gh-token',
    channelConfig: { prs: '123456' },
    ...overrides,
  };
}

function makeSchedulePayload(repo = 'test/repo') {
  return {
    event: 'schedule' as const,
    payload: {
      schedule: '*/5 * * * *',
      repository: { full_name: repo },
    },
  };
}

describe('schedule handler', () => {
  let relay: RepoRelay;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (relay) {
      await relay.disconnect();
    }
  });

  it('polls all open PRs from DB', async () => {
    mockGetOpenPrNumbers.mockReturnValue([1, 2, 3]);
    relay = new RepoRelay(makeConfig());
    await relay.connect();

    await relay.handleEvent(makeSchedulePayload());

    expect(mockGetOpenPrNumbers).toHaveBeenCalledWith('test/repo');
    expect(mockCheckForReviews).toHaveBeenCalledTimes(3);
    expect(mockCheckForReviews).toHaveBeenCalledWith(expect.anything(), 'test/repo', 1, 'gh-token');
    expect(mockCheckForReviews).toHaveBeenCalledWith(expect.anything(), 'test/repo', 2, 'gh-token');
    expect(mockCheckForReviews).toHaveBeenCalledWith(expect.anything(), 'test/repo', 3, 'gh-token');
  });

  it('skips when no githubToken configured', async () => {
    relay = new RepoRelay(makeConfig({ githubToken: undefined }));
    await relay.connect();

    await relay.handleEvent(makeSchedulePayload());

    expect(mockGetOpenPrNumbers).not.toHaveBeenCalled();
    expect(mockCheckForReviews).not.toHaveBeenCalled();
  });

  it('skips when no open PRs exist', async () => {
    mockGetOpenPrNumbers.mockReturnValue([]);
    relay = new RepoRelay(makeConfig());
    await relay.connect();

    await relay.handleEvent(makeSchedulePayload());

    expect(mockGetOpenPrNumbers).toHaveBeenCalledWith('test/repo');
    expect(mockCheckForReviews).not.toHaveBeenCalled();
  });

  it('logs elapsed time after polling', async () => {
    mockGetOpenPrNumbers.mockReturnValue([1]);
    const consoleSpy = vi.spyOn(console, 'log');
    try {
      relay = new RepoRelay(makeConfig());
      await relay.connect();

      await relay.handleEvent(makeSchedulePayload());

      const completionLog = consoleSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('Review polling completed')
      );
      expect(completionLog).toBeDefined();
      expect(completionLog![0]).toMatch(/1 PR\(s\) in \d+\.\d+s/);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('continues polling remaining PRs if one fails', async () => {
    mockGetOpenPrNumbers.mockReturnValue([1, 2, 3]);
    mockCheckForReviews
      .mockResolvedValueOnce({ copilotReviewed: false, agentReviewStatus: 'pending', changed: false })
      .mockRejectedValueOnce(new Error('API rate limit'))
      .mockResolvedValueOnce({ copilotReviewed: false, agentReviewStatus: 'pending', changed: false });

    relay = new RepoRelay(makeConfig());
    await relay.connect();

    // Should not throw despite PR #2 failing
    await relay.handleEvent(makeSchedulePayload());

    expect(mockCheckForReviews).toHaveBeenCalledTimes(3);
  });
});
