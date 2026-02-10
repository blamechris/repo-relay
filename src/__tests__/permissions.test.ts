import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionsBitField } from 'discord.js';
import { RepoRelay } from '../index.js';

const ALL_REQUIRED = [
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.CreatePublicThreads,
  PermissionsBitField.Flags.SendMessagesInThreads,
  PermissionsBitField.Flags.ManageThreads,
  PermissionsBitField.Flags.EmbedLinks,
  PermissionsBitField.Flags.ReadMessageHistory,
];

function makePermissions(flags: bigint[]): PermissionsBitField {
  return new PermissionsBitField(flags);
}

function makeMockChannel(channelId: string, permissions: PermissionsBitField) {
  return {
    id: channelId,
    guild: {
      members: {
        me: {
          id: 'bot-user-id',
        },
      },
    },
    permissionsFor: vi.fn(() => permissions),
  };
}

function makeMockClient(channelMap: Record<string, ReturnType<typeof makeMockChannel> | null>) {
  return {
    channels: {
      fetch: vi.fn((id: string) => {
        const ch = channelMap[id];
        if (ch === null) throw new Error('Unknown Channel');
        if (ch === undefined) throw new Error('Unknown Channel');
        return Promise.resolve(ch);
      }),
    },
    user: { id: 'bot-user-id', tag: 'TestBot#0001' },
    login: vi.fn(() => Promise.resolve('token')),
    destroy: vi.fn(),
  };
}

function createRelay(
  client: ReturnType<typeof makeMockClient>,
  channelConfig: { prs: string; issues?: string; releases?: string },
) {
  const relay = new RepoRelay({
    discordToken: 'fake-token',
    channelConfig,
  });
  // Inject the mock client
  (relay as any).client = client;
  return relay;
}

describe('validatePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes when all permissions are present', async () => {
    const perms = makePermissions(ALL_REQUIRED);
    const channel = makeMockChannel('111', perms);
    const client = makeMockClient({ '111': channel });
    const relay = createRelay(client, { prs: '111' });

    await expect(relay.validatePermissions()).resolves.toBeUndefined();
  });

  it('throws when one permission is missing', async () => {
    const withoutSendMessages = ALL_REQUIRED.filter(
      (f) => f !== PermissionsBitField.Flags.SendMessages,
    );
    const perms = makePermissions(withoutSendMessages);
    const channel = makeMockChannel('111', perms);
    const client = makeMockClient({ '111': channel });
    const relay = createRelay(client, { prs: '111' });

    await expect(relay.validatePermissions()).rejects.toThrow('Missing Discord permissions');
  });

  it('error message lists the specific missing permission', async () => {
    const withoutEmbedLinks = ALL_REQUIRED.filter(
      (f) => f !== PermissionsBitField.Flags.EmbedLinks,
    );
    const perms = makePermissions(withoutEmbedLinks);
    const channel = makeMockChannel('111', perms);
    const client = makeMockClient({ '111': channel });
    const relay = createRelay(client, { prs: '111' });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await relay.validatePermissions();
    } catch {
      // expected
    }

    const logged = consoleSpy.mock.calls[0]?.[0] as string;
    expect(logged).toContain('Missing: Embed Links');
    expect(logged).toContain('channel 111');
    consoleSpy.mockRestore();
  });

  it('error message lists multiple missing permissions', async () => {
    const withoutTwo = ALL_REQUIRED.filter(
      (f) =>
        f !== PermissionsBitField.Flags.SendMessages &&
        f !== PermissionsBitField.Flags.CreatePublicThreads,
    );
    const perms = makePermissions(withoutTwo);
    const channel = makeMockChannel('111', perms);
    const client = makeMockClient({ '111': channel });
    const relay = createRelay(client, { prs: '111' });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await relay.validatePermissions();
    } catch {
      // expected
    }

    const logged = consoleSpy.mock.calls[0]?.[0] as string;
    expect(logged).toContain('Send Messages');
    expect(logged).toContain('Create Public Threads');
    consoleSpy.mockRestore();
  });

  it('only reports errors for channels with missing permissions', async () => {
    const goodPerms = makePermissions(ALL_REQUIRED);
    const badPerms = makePermissions(
      ALL_REQUIRED.filter((f) => f !== PermissionsBitField.Flags.SendMessages),
    );
    const goodChannel = makeMockChannel('111', goodPerms);
    const badChannel = makeMockChannel('222', badPerms);
    const client = makeMockClient({ '111': goodChannel, '222': badChannel });
    const relay = createRelay(client, { prs: '111', issues: '222' });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await relay.validatePermissions();
    } catch {
      // expected
    }

    const logged = consoleSpy.mock.calls[0]?.[0] as string;
    expect(logged).toContain('channel 222');
    expect(logged).not.toContain('channel 111');
    consoleSpy.mockRestore();
  });

  it('throws a clear error when a channel cannot be found', async () => {
    const client = makeMockClient({ '999': null });
    const relay = createRelay(client, { prs: '999' });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(relay.validatePermissions()).rejects.toThrow('Missing Discord permissions');

    const logged = consoleSpy.mock.calls[0]?.[0] as string;
    expect(logged).toContain('Could not access channel 999');
    consoleSpy.mockRestore();
  });

  it('deduplicates channels when the same ID is used for multiple event types', async () => {
    const perms = makePermissions(ALL_REQUIRED);
    const channel = makeMockChannel('111', perms);
    const client = makeMockClient({ '111': channel });
    const relay = createRelay(client, { prs: '111', issues: '111', releases: '111' });

    await relay.validatePermissions();

    // Should only fetch the channel once
    expect(client.channels.fetch).toHaveBeenCalledTimes(1);
  });

  it('checks all unique channels across prs, issues, and releases', async () => {
    const perms = makePermissions(ALL_REQUIRED);
    const ch1 = makeMockChannel('111', perms);
    const ch2 = makeMockChannel('222', perms);
    const ch3 = makeMockChannel('333', perms);
    const client = makeMockClient({ '111': ch1, '222': ch2, '333': ch3 });
    const relay = createRelay(client, { prs: '111', issues: '222', releases: '333' });

    await relay.validatePermissions();

    expect(client.channels.fetch).toHaveBeenCalledTimes(3);
    expect(client.channels.fetch).toHaveBeenCalledWith('111');
    expect(client.channels.fetch).toHaveBeenCalledWith('222');
    expect(client.channels.fetch).toHaveBeenCalledWith('333');
  });
});
