import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RepoRelay } from '../index.js';
import { Client } from 'discord.js';

// Mock discord.js Client
vi.mock('discord.js', async () => {
  const actual = await vi.importActual('discord.js');
  return {
    ...actual,
    Client: vi.fn(),
    REST: vi.fn().mockImplementation(() => ({
      setToken: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        session_start_limit: { total: 1000, remaining: 0, reset_after: 60000 },
      }),
    })),
  };
});

function makeSessionLimitError(resetAt: Date): Error {
  return new Error(
    `Not enough sessions remaining to spawn 1 shards; only 0 remaining; resets at ${resetAt.toISOString()}`
  );
}

let loginImpl: () => Promise<string>;

function makeMockClient() {
  const mockClient = {
    once: vi.fn(),
    login: vi.fn(),
    destroy: vi.fn(),
    user: { tag: 'test-bot#1234' },
    options: { intents: [] },
  };

  mockClient.login.mockImplementation(async () => {
    const result = await loginImpl();
    const readyCall = mockClient.once.mock.calls.find(
      (c: unknown[]) => c[0] === 'ready'
    );
    if (readyCall) readyCall[1]();
    return result;
  });

  return mockClient;
}

describe('session limit retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.REPO_RELAY_LOG_SESSION_BUDGET;
    delete process.env.REPO_RELAY_SESSION_MAX_WAIT;

    // Each time Client is constructed, return a fresh working mock
    (Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => makeMockClient());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries after session limit resets (within max wait)', async () => {
    const resetAt = new Date(Date.now() + 10_000); // 10 seconds from now
    let attempt = 0;

    loginImpl = async () => {
      attempt++;
      if (attempt === 1) throw makeSessionLimitError(resetAt);
      return 'token';
    };

    const relay = new RepoRelay({
      discordToken: 'fake-token',
      channelConfig: { prs: '123' },
    });

    const connectPromise = relay.connect();

    // Advance past the reset time + 1s buffer
    await vi.advanceTimersByTimeAsync(12_000);

    await connectPromise;
    expect(attempt).toBe(2);
  });

  it('throws when reset time exceeds max wait', async () => {
    process.env.REPO_RELAY_SESSION_MAX_WAIT = '5000'; // 5 second max wait
    const resetAt = new Date(Date.now() + 60_000); // 60 seconds from now

    loginImpl = async () => {
      throw makeSessionLimitError(resetAt);
    };

    const relay = new RepoRelay({
      discordToken: 'fake-token',
      channelConfig: { prs: '123' },
    });

    await expect(relay.connect()).rejects.toThrow(/exceeds max wait/);
  });

  it('retries immediately when reset time has already passed', async () => {
    const resetAt = new Date(Date.now() - 5_000); // 5 seconds ago
    let attempt = 0;

    loginImpl = async () => {
      attempt++;
      if (attempt === 1) throw makeSessionLimitError(resetAt);
      return 'token';
    };

    const relay = new RepoRelay({
      discordToken: 'fake-token',
      channelConfig: { prs: '123' },
    });

    await relay.connect();
    expect(attempt).toBe(2);
  });

  it('honors REPO_RELAY_SESSION_MAX_WAIT=0 as no waiting', async () => {
    process.env.REPO_RELAY_SESSION_MAX_WAIT = '0';
    const resetAt = new Date(Date.now() + 1000); // 1 second from now

    loginImpl = async () => {
      throw makeSessionLimitError(resetAt);
    };

    const relay = new RepoRelay({
      discordToken: 'fake-token',
      channelConfig: { prs: '123' },
    });

    await expect(relay.connect()).rejects.toThrow(/exceeds max wait/);
  });

  it('throws after max retries when reset time keeps being in the past', async () => {
    loginImpl = async () => {
      throw makeSessionLimitError(new Date(Date.now() - 1000));
    };

    const relay = new RepoRelay({
      discordToken: 'fake-token',
      channelConfig: { prs: '123' },
    });

    await expect(relay.connect()).rejects.toThrow(/retry exhausted after 3 attempts/);
  });

  it('does not retry non-session-limit errors', async () => {
    loginImpl = async () => {
      throw new Error('Invalid token');
    };

    const relay = new RepoRelay({
      discordToken: 'fake-token',
      channelConfig: { prs: '123' },
    });

    await expect(relay.connect()).rejects.toThrow('Invalid token');
  });
});
