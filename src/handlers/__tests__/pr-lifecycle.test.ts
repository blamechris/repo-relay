import { describe, it, expect, vi } from 'vitest';
import { handlePrEvent, type PrEventPayload } from '../pr.js';
import { TextChannel } from 'discord.js';

/**
 * Lifecycle coverage for handlePrClosed / handlePrPush / handlePrUpdated.
 * handlePrOpened idempotency lives in pr-opened.test.ts; thread recovery in
 * thread-recovery.test.ts.
 */

type PayloadOverrides = Partial<Omit<PrEventPayload, 'pull_request'>> & {
  pull_request?: Partial<PrEventPayload['pull_request']>;
};

function makePayload(overrides: PayloadOverrides = {}): PrEventPayload {
  return {
    action: overrides.action ?? 'closed',
    pull_request: {
      number: 7,
      title: 'Add feature',
      html_url: 'https://github.com/test/repo/pull/7',
      user: { login: 'author', html_url: 'https://github.com/author', avatar_url: 'https://avatar.url' },
      head: { ref: 'feat/x', sha: 'abc1234def5678' },
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
      ...overrides.pull_request,
    },
    repository: { full_name: 'test/repo' },
    sender: { login: 'pusher' },
    ...(overrides.before !== undefined ? { before: overrides.before } : {}),
    ...(overrides.after !== undefined ? { after: overrides.after } : {}),
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

function makeMockChannel(opts: {
  msg?: ReturnType<typeof makeMockMessage>;
  thread?: ReturnType<typeof makeMockThread>;
  fetchBehavior?: (arg: unknown) => unknown;
} = {}) {
  const msg = opts.msg ?? makeMockMessage();
  const thread = opts.thread ?? makeMockThread();
  const channel = Object.create(TextChannel.prototype);
  const messagesFetch = vi.fn((arg?: string | object) => {
    if (opts.fetchBehavior) return opts.fetchBehavior(arg);
    if (typeof arg === 'string') return Promise.resolve(msg);
    return Promise.resolve(new Map()); // empty channel search
  });
  Object.assign(channel, {
    id: 'channel-1',
    send: vi.fn(() => Promise.resolve(msg)),
    messages: { fetch: messagesFetch },
    threads: { fetch: vi.fn(() => Promise.resolve(thread)) },
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
    updatePrThread: vi.fn(),
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

describe('handlePrClosed', () => {
  it('merged PR with existing message: edits embed and posts merged reply to thread', async () => {
    const msg = makeMockMessage();
    const thread = makeMockThread();
    const channel = makeMockChannel({ msg, thread });
    const db = makeMockDb(existingRow);

    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload({
      pull_request: { state: 'closed', merged: true, merged_at: '2024-01-02T00:00:00Z', merged_by: { login: 'merger' } },
    }));

    expect(msg.edit).toHaveBeenCalledTimes(1);
    expect(channel.send).not.toHaveBeenCalled();
    expect(thread.send).toHaveBeenCalledTimes(1);
    const reply = thread.send.mock.calls[0][0] as string;
    expect(reply).toContain('Merged to main');
    expect(reply).toContain('@merger');
    expect(db.updatePrMessageTimestamp).toHaveBeenCalledWith('test/repo', 7);
  });

  it('closed-without-merge PR posts the closed reply, not the merged one', async () => {
    const thread = makeMockThread();
    const channel = makeMockChannel({ thread });
    const db = makeMockDb(existingRow);

    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload({
      pull_request: { state: 'closed', merged: false },
    }));

    const reply = thread.send.mock.calls[0][0] as string;
    expect(reply).toContain('Closed without merging');
    expect(reply).not.toContain('Merged');
  });

  it('stale message (deleted on Discord): clears DB entry and falls through to creating a fresh embed', async () => {
    const msg = makeMockMessage();
    const channel = makeMockChannel({
      msg,
      fetchBehavior: (arg) => {
        if (typeof arg === 'string') return Promise.reject(new Error('Unknown Message'));
        return Promise.resolve(new Map());
      },
    });
    const db = makeMockDb(existingRow);

    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload({
      pull_request: { state: 'closed', merged: true },
    }));

    expect(db.deletePrMessage).toHaveBeenCalledWith('test/repo', 7);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(msg.startThread).toHaveBeenCalledTimes(1);
    expect(db.savePrMessage).toHaveBeenCalledWith('test/repo', 7, 'channel-1', 'msg-1', 'thread-1');
  });

  it('non-stale fetch errors propagate instead of silently recreating', async () => {
    const channel = makeMockChannel({
      fetchBehavior: (arg) => {
        if (typeof arg === 'string') return Promise.reject(new Error('Missing Access'));
        return Promise.resolve(new Map());
      },
    });
    const db = makeMockDb(existingRow);

    await expect(
      handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload())
    ).rejects.toThrow('Missing Access');
    expect(db.deletePrMessage).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('no existing message: creates an embed + thread showing the final state', async () => {
    const msg = makeMockMessage();
    const channel = makeMockChannel({ msg });
    const db = makeMockDb(null);

    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload({
      pull_request: { state: 'closed', merged: true },
    }));

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(msg.startThread).toHaveBeenCalledTimes(1);
    expect(db.savePrMessage).toHaveBeenCalledWith('test/repo', 7, 'channel-1', 'msg-1', 'thread-1');
    // merged state is persisted for future embed rebuilds
    expect(db.savePrData).toHaveBeenCalledWith(expect.objectContaining({ state: 'merged' }));
  });
});

describe('handlePrPush (synchronize)', () => {
  it('posts a push reply containing the 7-char sha from payload.after', async () => {
    const thread = makeMockThread();
    const channel = makeMockChannel({ thread });
    const db = makeMockDb(existingRow);

    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload({
      action: 'synchronize',
      before: 'abc1234def5678',
      after: '9876543fedcba0',
    }));

    expect(thread.send).toHaveBeenCalledTimes(1);
    const reply = thread.send.mock.calls[0][0] as string;
    expect(reply).toContain('9876543');
    expect(reply).not.toContain('9876543f'); // exactly 7 chars
    expect(reply).toContain('@pusher');
    expect(db.updatePrMessageTimestamp).toHaveBeenCalledWith('test/repo', 7);
  });

  it('missing payload.after falls back to head.sha', async () => {
    const thread = makeMockThread();
    const channel = makeMockChannel({ thread });
    const db = makeMockDb(existingRow);

    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload({
      action: 'synchronize',
    }));

    const reply = thread.send.mock.calls[0][0] as string;
    expect(reply).toContain('abc1234');
    expect(reply).not.toContain('abc1234d');
  });

  it('no existing message: creates embed + thread, then posts the push reply', async () => {
    const thread = makeMockThread();
    const msg = makeMockMessage(thread);
    const channel = makeMockChannel({ msg, thread });
    const db = makeMockDb(null);

    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload({
      action: 'synchronize',
      after: '9876543fedcba0',
    }));

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(db.savePrMessage).toHaveBeenCalled();
    const sent = thread.send.mock.calls.map((c) => c[0] as string);
    expect(sent.some((s) => s.includes('9876543'))).toBe(true);
  });

  it('stale message: clears DB entry, recreates, and still posts the push reply', async () => {
    const thread = makeMockThread();
    const msg = makeMockMessage(thread);
    const channel = makeMockChannel({
      msg,
      thread,
      fetchBehavior: (arg) => {
        if (typeof arg === 'string') return Promise.reject(new Error('Unknown Message'));
        return Promise.resolve(new Map());
      },
    });
    const db = makeMockDb(existingRow);

    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload({
      action: 'synchronize',
      after: '9876543fedcba0',
    }));

    expect(db.deletePrMessage).toHaveBeenCalledWith('test/repo', 7);
    expect(channel.send).toHaveBeenCalledTimes(1);
    const sent = thread.send.mock.calls.map((c) => c[0] as string);
    expect(sent.some((s) => s.includes('9876543'))).toBe(true);
  });
});

describe('handlePrUpdated (edited / ready_for_review / converted_to_draft)', () => {
  it.each(['edited', 'ready_for_review', 'converted_to_draft'] as const)(
    '%s with existing message: edits the embed, sends nothing new',
    async (action) => {
      const msg = makeMockMessage();
      const thread = makeMockThread();
      const channel = makeMockChannel({ msg, thread });
      const db = makeMockDb(existingRow);

      await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload({ action }));

      expect(msg.edit).toHaveBeenCalledTimes(1);
      expect(channel.send).not.toHaveBeenCalled();
      expect(thread.send).not.toHaveBeenCalled();
      expect(db.savePrData).toHaveBeenCalled();
      expect(db.updatePrMessageTimestamp).toHaveBeenCalledWith('test/repo', 7);
    }
  );

  it('edited with no existing message: creates embed + thread (PR opened before bot setup)', async () => {
    const thread = makeMockThread();
    const msg = makeMockMessage(thread);
    const channel = makeMockChannel({ msg, thread });
    const db = makeMockDb(null);

    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload({ action: 'edited' }));

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(db.savePrMessage).toHaveBeenCalledWith('test/repo', 7, 'channel-1', 'msg-1', 'thread-1');
  });

  it('edited with stale message: clears DB entry and recreates', async () => {
    const msg = makeMockMessage();
    const channel = makeMockChannel({
      msg,
      fetchBehavior: (arg) => {
        if (typeof arg === 'string') return Promise.reject(new Error('Unknown Message'));
        return Promise.resolve(new Map());
      },
    });
    const db = makeMockDb(existingRow);

    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload({ action: 'edited' }));

    expect(db.deletePrMessage).toHaveBeenCalledWith('test/repo', 7);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(db.savePrMessage).toHaveBeenCalled();
  });
});

describe('null PR author (deleted GitHub account)', () => {
  it('falls back to the ghost user without throwing', async () => {
    const channel = makeMockChannel();
    const db = makeMockDb(null);

    await handlePrEvent(makeMockClient(channel) as never, db as never, channelConfig, makePayload({
      action: 'opened',
      pull_request: { user: null },
    }));

    expect(channel.send).toHaveBeenCalledTimes(1);
    const { embeds } = channel.send.mock.calls[0][0] as { embeds: Array<{ data: { author?: { name: string } } }> };
    expect(embeds[0].data.author?.name).toBe('ghost');
    expect(db.savePrData).toHaveBeenCalledWith(expect.objectContaining({ author: 'ghost' }));
  });
});
