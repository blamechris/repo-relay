import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getExistingPrMessage, getExistingIssueMessage } from '../lookup.js';
import { TextChannel } from 'discord.js';

function makeMockMessage(id: string, title: string, url: string, threadId?: string) {
  return {
    id,
    embeds: [{ title, url }],
    thread: threadId ? { id: threadId } : null,
  };
}

function makeMockChannel(messages: ReturnType<typeof makeMockMessage>[]) {
  const map = new Map(messages.map((m) => [m.id, m]));
  const channel = Object.create(TextChannel.prototype);
  Object.assign(channel, {
    id: 'channel-1',
    messages: {
      fetch: vi.fn(() => Promise.resolve(map)),
    },
  });
  return channel as TextChannel;
}

function makeMockDb() {
  return {
    getPrMessage: vi.fn(() => null),
    savePrMessage: vi.fn(),
    savePrStatus: vi.fn(),
    getIssueMessage: vi.fn(() => null),
    saveIssueMessage: vi.fn(),
  };
}

const REPO = 'owner/repo';
const PR_URL = `https://github.com/${REPO}/pull/42`;
const ISSUE_URL = `https://github.com/${REPO}/issues/42`;

describe('getExistingPrMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns DB result without channel search (fast path)', async () => {
    const dbRow = {
      repo: REPO,
      prNumber: 42,
      channelId: 'channel-1',
      messageId: 'msg-1',
      threadId: 'thread-1',
      createdAt: '',
      lastUpdated: '',
    };
    const db = makeMockDb();
    db.getPrMessage.mockReturnValue(dbRow);
    const channel = makeMockChannel([]);

    const result = await getExistingPrMessage(db as any, channel, REPO, 42);

    expect(result).toBe(dbRow);
    expect(channel.messages.fetch).not.toHaveBeenCalled();
  });

  it('finds PR via channel search and caches to DB', async () => {
    const db = makeMockDb();
    const savedRow = { repo: REPO, prNumber: 42, messageId: 'msg-1', threadId: 'thread-1' };
    db.getPrMessage
      .mockReturnValueOnce(null)   // first call: not cached
      .mockReturnValueOnce(savedRow); // second call: after save
    const channel = makeMockChannel([
      makeMockMessage('msg-1', '🔀 PR #42: My PR', PR_URL, 'thread-1'),
    ]);

    const result = await getExistingPrMessage(db as any, channel, REPO, 42);

    expect(result).toEqual(savedRow);
    expect(db.savePrMessage).toHaveBeenCalledWith(REPO, 42, 'channel-1', 'msg-1', 'thread-1');
    expect(db.savePrStatus).toHaveBeenCalledWith(REPO, 42);
  });

  it('returns null when no matching embed found', async () => {
    const db = makeMockDb();
    const channel = makeMockChannel([
      makeMockMessage('msg-1', 'Some other embed', 'https://example.com'),
    ]);

    const result = await getExistingPrMessage(db as any, channel, REPO, 42);

    expect(result).toBeNull();
    expect(db.savePrMessage).not.toHaveBeenCalled();
  });

  it('skips PR embed from different repo', async () => {
    const db = makeMockDb();
    const channel = makeMockChannel([
      makeMockMessage('msg-1', '🔀 PR #42: My PR', 'https://github.com/other/repo/pull/42', 'thread-1'),
    ]);

    const result = await getExistingPrMessage(db as any, channel, REPO, 42);

    expect(result).toBeNull();
    expect(db.savePrMessage).not.toHaveBeenCalled();
  });

  it('returns null on channel search error', async () => {
    const db = makeMockDb();
    const channel = makeMockChannel([]);
    (channel.messages.fetch as any).mockRejectedValueOnce(new Error('Missing Access'));

    const result = await getExistingPrMessage(db as any, channel, REPO, 42);

    expect(result).toBeNull();
    expect(db.savePrMessage).not.toHaveBeenCalled();
  });
});

describe('getExistingIssueMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns DB result without channel search (fast path)', async () => {
    const dbRow = {
      repo: REPO,
      issueNumber: 42,
      channelId: 'channel-1',
      messageId: 'msg-1',
      threadId: 'thread-1',
      createdAt: '',
      lastUpdated: '',
    };
    const db = makeMockDb();
    db.getIssueMessage.mockReturnValue(dbRow);
    const channel = makeMockChannel([]);

    const result = await getExistingIssueMessage(db as any, channel, REPO, 42);

    expect(result).toBe(dbRow);
    expect(channel.messages.fetch).not.toHaveBeenCalled();
  });

  it('finds issue via channel search and caches to DB', async () => {
    const db = makeMockDb();
    const savedRow = { repo: REPO, issueNumber: 42, messageId: 'msg-1', threadId: 'thread-1' };
    db.getIssueMessage
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(savedRow);
    const channel = makeMockChannel([
      makeMockMessage('msg-1', '🟢 Issue #42: Bug report', ISSUE_URL, 'thread-1'),
    ]);

    const result = await getExistingIssueMessage(db as any, channel, REPO, 42);

    expect(result).toEqual(savedRow);
    expect(db.saveIssueMessage).toHaveBeenCalledWith(REPO, 42, 'channel-1', 'msg-1', 'thread-1');
  });

  it('returns null when no matching embed found', async () => {
    const db = makeMockDb();
    const channel = makeMockChannel([]);

    const result = await getExistingIssueMessage(db as any, channel, REPO, 42);

    expect(result).toBeNull();
  });

  it('skips issue embed from different repo', async () => {
    const db = makeMockDb();
    const channel = makeMockChannel([
      makeMockMessage('msg-1', '🟢 Issue #42: Bug', 'https://github.com/other/repo/issues/42'),
    ]);

    const result = await getExistingIssueMessage(db as any, channel, REPO, 42);

    expect(result).toBeNull();
    expect(db.saveIssueMessage).not.toHaveBeenCalled();
  });

  it('returns null on channel search error', async () => {
    const db = makeMockDb();
    const channel = makeMockChannel([]);
    (channel.messages.fetch as any).mockRejectedValueOnce(new Error('Missing Access'));

    const result = await getExistingIssueMessage(db as any, channel, REPO, 42);

    expect(result).toBeNull();
    expect(db.saveIssueMessage).not.toHaveBeenCalled();
  });
});
