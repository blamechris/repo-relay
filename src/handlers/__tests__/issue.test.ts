import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleIssueEvent, type IssueEventPayload } from '../issue.js';
import { TextChannel } from 'discord.js';

vi.mock('../../embeds/builders.js', () => ({
  buildIssueEmbed: vi.fn(() => ({ mock: 'embed' })),
  buildIssueClosedReply: vi.fn((closedBy?: string, stateReason?: string | null) => {
    if (stateReason === 'not_planned') return `🟣 Closed as not planned by @${closedBy}`;
    return `🟣 Closed by @${closedBy}`;
  }),
  buildIssueReopenedReply: vi.fn((reopenedBy?: string) => `🟢 Reopened by @${reopenedBy}`),
}));

function makePayload(overrides: Partial<{
  action: string;
  issueNumber: number;
  state: 'open' | 'closed';
  stateReason: string | null;
  sender: string;
}>): IssueEventPayload {
  return {
    action: (overrides.action ?? 'opened') as IssueEventPayload['action'],
    issue: {
      number: overrides.issueNumber ?? 42,
      title: 'Test issue',
      html_url: 'https://github.com/test/repo/issues/42',
      user: { login: 'author', avatar_url: 'https://avatar.url' },
      state: overrides.state ?? 'open',
      state_reason: overrides.stateReason as IssueEventPayload['issue']['state_reason'],
      labels: [{ name: 'bug' }],
      body: 'Issue body',
      created_at: '2024-01-01T00:00:00Z',
    },
    repository: { full_name: 'test/repo' },
    sender: { login: overrides.sender ?? 'author' },
  };
}

function makeMockThread() {
  return {
    id: 'thread-1',
    send: vi.fn(),
    archived: false,
    setArchived: vi.fn(),
  };
}

function makeMockMessage(thread?: ReturnType<typeof makeMockThread>) {
  return {
    id: 'msg-1',
    edit: vi.fn(),
    startThread: vi.fn(() => Promise.resolve(thread ?? makeMockThread())),
  };
}

function makeMockChannel(message?: ReturnType<typeof makeMockMessage>, thread?: ReturnType<typeof makeMockThread>) {
  const msg = message ?? makeMockMessage(thread);
  const channel = Object.create(TextChannel.prototype);
  // messages.fetch handles both signatures:
  // fetch(id: string) -> single message, fetch({ limit }) -> Collection-like map
  const messagesFetch = vi.fn((arg?: string | object) => {
    if (typeof arg === 'string') return Promise.resolve(msg);
    // Return empty collection for channel search (no embeds to find)
    const emptyMap = new Map();
    return Promise.resolve(emptyMap);
  });
  Object.assign(channel, {
    id: 'channel-1',
    send: vi.fn(() => Promise.resolve(msg)),
    messages: {
      fetch: messagesFetch,
    },
    threads: {
      fetch: vi.fn(() => Promise.resolve(thread ?? makeMockThread())),
    },
  });
  return { channel: channel as TextChannel, message: msg };
}

function makeMockDb() {
  return {
    logEvent: vi.fn(),
    getIssueMessage: vi.fn(() => null),
    saveIssueMessage: vi.fn(),
    deleteIssueMessage: vi.fn(),
    updateIssueThread: vi.fn(),
    updateIssueMessageTimestamp: vi.fn(),
    getIssueData: vi.fn(() => null),
    saveIssueData: vi.fn(),
  };
}

function makeMockClient(channel: TextChannel) {
  return {
    channels: {
      fetch: vi.fn(() => Promise.resolve(channel)),
    },
  };
}

describe('handleIssueEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('opened', () => {
    it('creates embed, thread, and saves to DB', async () => {
      const thread = makeMockThread();
      const { channel } = makeMockChannel(undefined, thread);
      const client = makeMockClient(channel);
      const db = makeMockDb();
      const payload = makePayload({ action: 'opened' });

      await handleIssueEvent(client as any, db as any, { prs: 'channel-1' }, payload);

      // Sends embed to channel
      expect(channel.send).toHaveBeenCalledWith({ embeds: [{ mock: 'embed' }] });

      // Creates thread on the message
      const sentMessage = await (channel.send as any).mock.results[0].value;
      expect(sentMessage.startThread).toHaveBeenCalledWith({
        name: 'Issue #42: Test issue',
        autoArchiveDuration: 1440,
      });

      // Saves message and data to DB
      expect(db.saveIssueMessage).toHaveBeenCalledWith(
        'test/repo', 42, 'channel-1', 'msg-1', 'thread-1'
      );
      expect(db.saveIssueData).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'test/repo',
          issueNumber: 42,
          title: 'Test issue',
          state: 'open',
        })
      );

      // Posts initial message in thread
      expect(thread.send).toHaveBeenCalledWith('📋 Updates for Issue #42 will appear here.');

      // Logs the event
      expect(db.logEvent).toHaveBeenCalledWith('test/repo', 42, 'issue.opened', payload);
    });
  });

  describe('closed', () => {
    it('updates existing embed and posts close reply to thread', async () => {
      const thread = makeMockThread();
      const message = makeMockMessage(thread);
      const { channel } = makeMockChannel(message, thread);
      const client = makeMockClient(channel);
      const db = makeMockDb();

      db.getIssueMessage.mockReturnValue({
        repo: 'test/repo',
        issueNumber: 42,
        channelId: 'channel-1',
        messageId: 'msg-1',
        threadId: 'thread-1',
        createdAt: '',
        lastUpdated: '',
      });

      const payload = makePayload({ action: 'closed', state: 'closed', sender: 'closer' });

      await handleIssueEvent(client as any, db as any, { prs: 'channel-1' }, payload);

      // Fetches existing message
      expect(channel.messages.fetch).toHaveBeenCalledWith('msg-1');

      // Edits the embed
      expect(message.edit).toHaveBeenCalledWith({ embeds: [{ mock: 'embed' }] });

      // Posts close reply to thread
      expect(thread.send).toHaveBeenCalledWith('🟣 Closed by @closer');

      // Updates timestamp
      expect(db.updateIssueMessageTimestamp).toHaveBeenCalledWith('test/repo', 42);

      // Saves updated issue data
      expect(db.saveIssueData).toHaveBeenCalled();
    });

    it('handles stale message by creating new embed', async () => {
      const thread = makeMockThread();
      const message = makeMockMessage(thread);
      const { channel } = makeMockChannel(message, thread);
      const client = makeMockClient(channel);
      const db = makeMockDb();

      db.getIssueMessage.mockReturnValue({
        repo: 'test/repo',
        issueNumber: 42,
        channelId: 'channel-1',
        messageId: 'stale-msg',
        threadId: 'thread-1',
        createdAt: '',
        lastUpdated: '',
      });

      // Make message fetch throw Unknown Message
      (channel.messages.fetch as any).mockRejectedValueOnce(new Error('Unknown Message'));

      const payload = makePayload({ action: 'closed', state: 'closed' });

      await handleIssueEvent(client as any, db as any, { prs: 'channel-1' }, payload);

      // Deletes the stale DB entry
      expect(db.deleteIssueMessage).toHaveBeenCalledWith('test/repo', 42);

      // Creates a new message
      expect(channel.send).toHaveBeenCalledWith({ embeds: [{ mock: 'embed' }] });

      // Saves new DB entries
      expect(db.saveIssueMessage).toHaveBeenCalled();
      expect(db.saveIssueData).toHaveBeenCalled();
    });

    it('creates new embed and posts close reply when no existing message', async () => {
      const thread = makeMockThread();
      const { channel } = makeMockChannel(undefined, thread);
      const client = makeMockClient(channel);
      const db = makeMockDb();

      db.getIssueMessage.mockReturnValue(null);

      const payload = makePayload({ action: 'closed', state: 'closed', sender: 'closer' });

      await handleIssueEvent(client as any, db as any, { prs: 'channel-1' }, payload);

      // Creates new embed
      expect(channel.send).toHaveBeenCalledWith({ embeds: [{ mock: 'embed' }] });
      expect(db.saveIssueMessage).toHaveBeenCalled();

      // Posts close reply to thread
      expect(thread.send).toHaveBeenCalledWith('🟣 Closed by @closer');
    });

    it('shows NOT PLANNED state reason in close reply', async () => {
      const { buildIssueClosedReply } = await import('../../embeds/builders.js');

      const thread = makeMockThread();
      const message = makeMockMessage(thread);
      const { channel } = makeMockChannel(message, thread);
      const client = makeMockClient(channel);
      const db = makeMockDb();

      db.getIssueMessage.mockReturnValue({
        repo: 'test/repo',
        issueNumber: 42,
        channelId: 'channel-1',
        messageId: 'msg-1',
        threadId: 'thread-1',
        createdAt: '',
        lastUpdated: '',
      });

      const payload = makePayload({
        action: 'closed',
        state: 'closed',
        stateReason: 'not_planned',
        sender: 'closer',
      });

      await handleIssueEvent(client as any, db as any, { prs: 'channel-1' }, payload);

      expect(buildIssueClosedReply).toHaveBeenCalledWith('closer', 'not_planned');
    });
  });

  describe('reopened', () => {
    it('updates existing embed and posts reopen reply to thread', async () => {
      const thread = makeMockThread();
      const message = makeMockMessage(thread);
      const { channel } = makeMockChannel(message, thread);
      const client = makeMockClient(channel);
      const db = makeMockDb();

      db.getIssueMessage.mockReturnValue({
        repo: 'test/repo',
        issueNumber: 42,
        channelId: 'channel-1',
        messageId: 'msg-1',
        threadId: 'thread-1',
        createdAt: '',
        lastUpdated: '',
      });

      const payload = makePayload({ action: 'reopened', state: 'open', sender: 'reopener' });

      await handleIssueEvent(client as any, db as any, { prs: 'channel-1' }, payload);

      // Edits the embed
      expect(message.edit).toHaveBeenCalledWith({ embeds: [{ mock: 'embed' }] });

      // Posts reopen reply
      expect(thread.send).toHaveBeenCalledWith('🟢 Reopened by @reopener');

      // Updates timestamp
      expect(db.updateIssueMessageTimestamp).toHaveBeenCalledWith('test/repo', 42);
    });

    it('creates new embed and posts reopen reply when no existing message', async () => {
      const thread = makeMockThread();
      const { channel } = makeMockChannel(undefined, thread);
      const client = makeMockClient(channel);
      const db = makeMockDb();

      db.getIssueMessage.mockReturnValue(null);

      const payload = makePayload({ action: 'reopened', state: 'open', sender: 'reopener' });

      await handleIssueEvent(client as any, db as any, { prs: 'channel-1' }, payload);

      expect(channel.send).toHaveBeenCalledWith({ embeds: [{ mock: 'embed' }] });
      expect(db.saveIssueMessage).toHaveBeenCalled();

      // Posts reopen reply to thread
      expect(thread.send).toHaveBeenCalledWith('🟢 Reopened by @reopener');
    });
  });

  describe('labeled/unlabeled/edited', () => {
    it('returns early for labeled action (Phase 4)', async () => {
      const { channel } = makeMockChannel();
      const client = makeMockClient(channel);
      const db = makeMockDb();
      const payload = makePayload({ action: 'labeled' });

      await handleIssueEvent(client as any, db as any, { prs: 'channel-1' }, payload);

      // Logs the event but does not send a message
      expect(db.logEvent).toHaveBeenCalled();
      expect(channel.send).not.toHaveBeenCalled();
      expect(db.saveIssueMessage).not.toHaveBeenCalled();
    });

    it('returns early for edited action (Phase 4)', async () => {
      const { channel } = makeMockChannel();
      const client = makeMockClient(channel);
      const db = makeMockDb();
      const payload = makePayload({ action: 'edited' });

      await handleIssueEvent(client as any, db as any, { prs: 'channel-1' }, payload);

      expect(db.logEvent).toHaveBeenCalled();
      expect(channel.send).not.toHaveBeenCalled();
    });
  });
});
