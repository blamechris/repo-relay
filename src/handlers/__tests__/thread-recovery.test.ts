import { describe, it, expect, vi } from 'vitest';
import { getOrCreateThread } from '../pr.js';
import { isUnknownMessageError, isThreadAlreadyCreatedError } from '../../utils/discord-errors.js';
import { TextChannel, DiscordAPIError } from 'discord.js';
import type { PrData } from '../../embeds/builders.js';

function apiError(code: number, message: string): DiscordAPIError {
  return new DiscordAPIError({ message, code }, code, 404, 'GET', 'https://discord.com/api', {});
}

describe('discord error helpers', () => {
  it('recognizes Unknown Message by API error code 10008', () => {
    expect(isUnknownMessageError(apiError(10008, 'Unknown Message'))).toBe(true);
  });

  it('recognizes Unknown Message from a plain wrapped Error', () => {
    expect(isUnknownMessageError(new Error('Unknown Message'))).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isUnknownMessageError(new Error('Missing Access'))).toBe(false);
    expect(isUnknownMessageError(apiError(50001, 'Missing Access'))).toBe(false);
  });

  it('recognizes ThreadAlreadyCreatedForMessage by code 160004', () => {
    expect(isThreadAlreadyCreatedError(apiError(160004, 'A thread has already been created for this message'))).toBe(true);
    expect(isThreadAlreadyCreatedError(new Error('Unknown Message'))).toBe(false);
  });
});

const pr: PrData = {
  number: 7,
  title: 'Add feature',
  url: 'https://github.com/test/repo/pull/7',
  author: 'author',
  authorUrl: 'https://github.com/author',
  branch: 'feat/x',
  baseBranch: 'main',
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  state: 'open',
  draft: false,
  createdAt: '2024-01-01T00:00:00Z',
};

const existingNoThread = {
  repo: 'test/repo',
  prNumber: 7,
  channelId: 'channel-1',
  messageId: 'msg-1',
  threadId: null,
  createdAt: '',
  lastUpdated: '',
};

function makeThread(archived = false) {
  return { id: 'msg-1', archived, setArchived: vi.fn(), send: vi.fn() };
}

function makeChannel(opts: {
  threadsFetch: (id: string) => Promise<unknown>;
  startThread?: () => Promise<unknown>;
}) {
  const message = {
    id: 'msg-1',
    startThread: vi.fn(opts.startThread ?? (() => Promise.resolve(makeThread()))),
  };
  const channel = Object.create(TextChannel.prototype);
  Object.assign(channel, {
    id: 'channel-1',
    messages: { fetch: vi.fn(() => Promise.resolve(message)) },
    threads: { fetch: vi.fn(opts.threadsFetch) },
  });
  return { channel: channel as TextChannel, message };
}

function makeDb() {
  return { updatePrThread: vi.fn() };
}

describe('getOrCreateThread archived-thread recovery', () => {
  it('threadId null but an archived thread exists: fetches by message ID instead of crashing', async () => {
    // Recovery stores threadId=null because Message#thread is cache-only and
    // archived threads are never cached in a fire-once process. Thread ID ==
    // parent message ID, so the thread is still fetchable.
    const archivedThread = makeThread(true);
    const { channel, message } = makeChannel({
      threadsFetch: (id) => (id === 'msg-1' ? Promise.resolve(archivedThread) : Promise.reject(new Error('Unknown Channel'))),
    });
    const db = makeDb();

    const thread = await getOrCreateThread(channel, db as never, 'test/repo', pr, existingNoThread);

    expect(thread).toBe(archivedThread);
    expect(archivedThread.setArchived).toHaveBeenCalledWith(false);
    expect(message.startThread).not.toHaveBeenCalled();
    // Recovered thread ID is persisted for the fast path next run
    expect(db.updatePrThread).toHaveBeenCalledWith('test/repo', 7, 'msg-1');
  });

  it('startThread hitting 160004 falls back to fetching the existing thread', async () => {
    const existingThread = makeThread(true);
    let fetchCalls = 0;
    const { channel, message } = makeChannel({
      threadsFetch: () => {
        fetchCalls++;
        // First lookup (pre-create probe) misses; post-160004 fetch succeeds
        return fetchCalls === 1
          ? Promise.reject(new Error('Unknown Channel'))
          : Promise.resolve(existingThread);
      },
      startThread: () => Promise.reject(apiError(160004, 'A thread has already been created for this message')),
    });
    const db = makeDb();

    const thread = await getOrCreateThread(channel, db as never, 'test/repo', pr, existingNoThread);

    expect(thread).toBe(existingThread);
    expect(message.startThread).toHaveBeenCalledTimes(1);
    expect(existingThread.setArchived).toHaveBeenCalledWith(false);
  });

  it('no thread anywhere: creates one (existing behavior)', async () => {
    const { channel, message } = makeChannel({
      threadsFetch: () => Promise.reject(new Error('Unknown Channel')),
    });
    const db = makeDb();

    const thread = await getOrCreateThread(channel, db as never, 'test/repo', pr, existingNoThread);

    expect(message.startThread).toHaveBeenCalledTimes(1);
    expect(thread).toBeDefined();
    expect(db.updatePrThread).toHaveBeenCalled();
  });
});
