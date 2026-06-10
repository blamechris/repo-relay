import { describe, it, expect, vi } from 'vitest';
import { handlePrEvent, type PrEventPayload } from '../pr.js';
import { TextChannel } from 'discord.js';

function makePayload(overrides: Partial<{ action: PrEventPayload['action']; number: number }> = {}): PrEventPayload {
  return {
    action: overrides.action ?? 'opened',
    pull_request: {
      number: overrides.number ?? 7,
      title: 'Add feature',
      html_url: 'https://github.com/test/repo/pull/7',
      user: { login: 'author', html_url: 'https://github.com/author', avatar_url: 'https://avatar.url' },
      head: { ref: 'feat/x', sha: 'abc1234def' },
      base: { ref: 'main' },
      additions: 10,
      deletions: 2,
      changed_files: 3,
      body: 'PR body',
      state: 'open',
      draft: false,
      merged: false,
      merged_at: null,
      created_at: '2024-01-01T00:00:00Z',
    },
    repository: { full_name: 'test/repo' },
    sender: { login: 'author' },
  };
}

function makeMockThread() {
  return { id: 'thread-1', send: vi.fn(), archived: false, setArchived: vi.fn() };
}

function makeMockMessage(thread = makeMockThread()) {
  return {
    id: 'msg-1',
    edit: vi.fn(),
    startThread: vi.fn(() => Promise.resolve(thread)),
  };
}

function makeMockChannel(msg = makeMockMessage(), fetchBehavior?: (arg: unknown) => unknown) {
  const channel = Object.create(TextChannel.prototype);
  const messagesFetch = vi.fn((arg?: string | object) => {
    if (fetchBehavior) return fetchBehavior(arg);
    if (typeof arg === 'string') return Promise.resolve(msg);
    return Promise.resolve(new Map()); // empty channel search
  });
  Object.assign(channel, {
    id: 'channel-1',
    send: vi.fn(() => Promise.resolve(msg)),
    messages: { fetch: messagesFetch },
    threads: { fetch: vi.fn(() => Promise.resolve(makeMockThread())) },
  });
  return channel as TextChannel & { send: ReturnType<typeof vi.fn> };
}

function makeMockDb(existing: object | null = null) {
  return {
    logEvent: vi.fn(),
    getPrMessage: vi.fn(() => existing),
    savePrMessage: vi.fn(),
    deletePrMessage: vi.fn(),
    savePrStatus: vi.fn(),
    savePrData: vi.fn(),
    getPrData: vi.fn(() => null),
    getPrStatus: vi.fn(() => null),
    updatePrMessageTimestamp: vi.fn(),
  };
}

function makeMockClient(channel: TextChannel) {
  return { channels: { fetch: vi.fn(() => Promise.resolve(channel)) } };
}

const channelConfig = { prs: 'channel-1' } as never;

const existingRow = {
  repo: 'test/repo',
  prNumber: 7,
  channelId: 'channel-1',
  messageId: 'msg-1',
  threadId: 'thread-1',
  createdAt: '2024-01-01T00:00:00Z',
  lastUpdated: '2024-01-01T00:00:00Z',
};

describe('handlePrOpened idempotency', () => {
  it('opened with no prior state: creates embed + thread and saves mapping', async () => {
    const channel = makeMockChannel();
    const db = makeMockDb(null);
    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload());

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(db.savePrMessage).toHaveBeenCalledWith('test/repo', 7, 'channel-1', 'msg-1', 'thread-1');
  });

  it('duplicate opened delivery: edits the existing embed, never sends a second one', async () => {
    const msg = makeMockMessage();
    const channel = makeMockChannel(msg);
    const db = makeMockDb(existingRow);
    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload());

    expect(channel.send).not.toHaveBeenCalled();
    expect(msg.edit).toHaveBeenCalledTimes(1);
    expect(db.savePrMessage).not.toHaveBeenCalled();
  });

  it('reopened with existing embed: reuses it instead of duplicating', async () => {
    const msg = makeMockMessage();
    const channel = makeMockChannel(msg);
    const db = makeMockDb(existingRow);
    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload({ action: 'reopened' }));

    expect(channel.send).not.toHaveBeenCalled();
    expect(msg.edit).toHaveBeenCalledTimes(1);
  });

  it('stale DB entry (message deleted on Discord): clears it and creates fresh', async () => {
    const msg = makeMockMessage();
    const channel = makeMockChannel(msg, (arg) => {
      if (typeof arg === 'string') return Promise.reject(new Error('Unknown Message'));
      return Promise.resolve(new Map());
    });
    const db = makeMockDb(existingRow);
    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload());

    expect(db.deletePrMessage).toHaveBeenCalledWith('test/repo', 7);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(db.savePrMessage).toHaveBeenCalled();
  });
});
