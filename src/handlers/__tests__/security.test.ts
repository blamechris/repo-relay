import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSecurityAlertEvent, type SecurityAlertPayload, type DependabotAlertPayload, type SecretScanningAlertPayload, type CodeScanningAlertPayload } from '../security.js';
import { TextChannel } from 'discord.js';

vi.mock('../../embeds/builders.js', () => ({
  buildDependabotAlertEmbed: vi.fn(() => ({ mock: 'dependabot-embed' })),
  buildSecretScanningAlertEmbed: vi.fn(() => ({ mock: 'secret-embed' })),
  buildCodeScanningAlertEmbed: vi.fn(() => ({ mock: 'code-embed' })),
}));

function makeDependabotPayload(action: DependabotAlertPayload['action'] = 'created'): DependabotAlertPayload {
  return {
    action,
    alert: {
      number: 1,
      state: 'open',
      dependency: { package: { ecosystem: 'npm', name: 'lodash' }, scope: 'runtime' },
      security_advisory: {
        ghsa_id: 'GHSA-1234-5678',
        cve_id: 'CVE-2024-0001',
        summary: 'Prototype pollution in lodash',
        severity: 'critical',
      },
      security_vulnerability: {
        first_patched_version: { identifier: '4.17.21' },
      },
      html_url: 'https://github.com/test/repo/security/dependabot/1',
    },
    repository: { full_name: 'test/repo' },
  };
}

function makeSecretPayload(action: SecretScanningAlertPayload['action'] = 'created'): SecretScanningAlertPayload {
  return {
    action,
    alert: {
      number: 2,
      state: 'open',
      secret_type: 'github_personal_access_token',
      secret_type_display_name: 'GitHub Personal Access Token',
      html_url: 'https://github.com/test/repo/security/secret-scanning/2',
      push_protection_bypassed: null,
      resolution: null,
    },
    repository: { full_name: 'test/repo' },
  };
}

function makeCodePayload(action: CodeScanningAlertPayload['action'] = 'created'): CodeScanningAlertPayload {
  return {
    action,
    alert: {
      number: 3,
      state: 'open',
      rule: { id: 'js/sql-injection', name: 'SQL Injection', severity: 'error', description: 'Unsanitized input in SQL query' },
      tool: { name: 'CodeQL' },
      most_recent_instance: {
        location: { path: 'src/db.ts', start_line: 42 },
      },
      html_url: 'https://github.com/test/repo/security/code-scanning/3',
    },
    repository: { full_name: 'test/repo' },
  };
}

function makeMockChannel() {
  const channel = Object.create(TextChannel.prototype);
  Object.assign(channel, {
    id: 'channel-1',
    send: vi.fn(() => Promise.resolve({ id: 'msg-1' })),
  });
  return channel as TextChannel;
}

function makeMockClient(channel: TextChannel) {
  return {
    channels: {
      fetch: vi.fn(() => Promise.resolve(channel)),
    },
  };
}

function makeMockDb() {
  return {
    logEvent: vi.fn(),
  };
}

describe('handleSecurityAlertEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Dependabot ──────────────────────────────────────────────

  it('posts embed for dependabot_alert created', async () => {
    const channel = makeMockChannel();
    const client = makeMockClient(channel);
    const db = makeMockDb();
    const payload = makeDependabotPayload('created');

    await handleSecurityAlertEvent(
      client as any, db as any, { prs: 'channel-1' },
      { event: 'dependabot_alert', payload }
    );

    expect(channel.send).toHaveBeenCalledWith({ embeds: [{ mock: 'dependabot-embed' }] });
    expect(db.logEvent).toHaveBeenCalledWith('test/repo', 1, 'dependabot_alert.created', payload);
  });

  it('skips dependabot_alert dismissed', async () => {
    const channel = makeMockChannel();
    const client = makeMockClient(channel);
    const db = makeMockDb();

    await handleSecurityAlertEvent(
      client as any, db as any, { prs: 'channel-1' },
      { event: 'dependabot_alert', payload: makeDependabotPayload('dismissed') }
    );

    expect(channel.send).not.toHaveBeenCalled();
    expect(db.logEvent).not.toHaveBeenCalled();
  });

  it('skips dependabot_alert fixed', async () => {
    const channel = makeMockChannel();
    const client = makeMockClient(channel);
    const db = makeMockDb();

    await handleSecurityAlertEvent(
      client as any, db as any, { prs: 'channel-1' },
      { event: 'dependabot_alert', payload: makeDependabotPayload('fixed') }
    );

    expect(channel.send).not.toHaveBeenCalled();
  });

  // ── Secret scanning ─────────────────────────────────────────

  it('posts embed for secret_scanning_alert created', async () => {
    const channel = makeMockChannel();
    const client = makeMockClient(channel);
    const db = makeMockDb();
    const payload = makeSecretPayload('created');

    await handleSecurityAlertEvent(
      client as any, db as any, { prs: 'channel-1' },
      { event: 'secret_scanning_alert', payload }
    );

    expect(channel.send).toHaveBeenCalledWith({ embeds: [{ mock: 'secret-embed' }] });
    expect(db.logEvent).toHaveBeenCalledWith('test/repo', 2, 'secret_scanning_alert.created', payload);
  });

  it('skips secret_scanning_alert resolved', async () => {
    const channel = makeMockChannel();
    const client = makeMockClient(channel);
    const db = makeMockDb();

    await handleSecurityAlertEvent(
      client as any, db as any, { prs: 'channel-1' },
      { event: 'secret_scanning_alert', payload: makeSecretPayload('resolved') }
    );

    expect(channel.send).not.toHaveBeenCalled();
  });

  // ── Code scanning ───────────────────────────────────────────

  it('posts embed for code_scanning_alert created', async () => {
    const channel = makeMockChannel();
    const client = makeMockClient(channel);
    const db = makeMockDb();
    const payload = makeCodePayload('created');

    await handleSecurityAlertEvent(
      client as any, db as any, { prs: 'channel-1' },
      { event: 'code_scanning_alert', payload }
    );

    expect(channel.send).toHaveBeenCalledWith({ embeds: [{ mock: 'code-embed' }] });
    expect(db.logEvent).toHaveBeenCalledWith('test/repo', 3, 'code_scanning_alert.created', payload);
  });

  it('posts embed for code_scanning_alert appeared_in_branch', async () => {
    const channel = makeMockChannel();
    const client = makeMockClient(channel);
    const db = makeMockDb();
    const payload = makeCodePayload('appeared_in_branch');

    await handleSecurityAlertEvent(
      client as any, db as any, { prs: 'channel-1' },
      { event: 'code_scanning_alert', payload }
    );

    expect(channel.send).toHaveBeenCalledWith({ embeds: [{ mock: 'code-embed' }] });
  });

  it('skips code_scanning_alert fixed', async () => {
    const channel = makeMockChannel();
    const client = makeMockClient(channel);
    const db = makeMockDb();

    await handleSecurityAlertEvent(
      client as any, db as any, { prs: 'channel-1' },
      { event: 'code_scanning_alert', payload: makeCodePayload('fixed') }
    );

    expect(channel.send).not.toHaveBeenCalled();
  });

  // ── Channel handling ────────────────────────────────────────

  it('throws when channel is not found', async () => {
    const client = {
      channels: { fetch: vi.fn(() => Promise.resolve(null)) },
    };
    const db = makeMockDb();

    await expect(
      handleSecurityAlertEvent(
        client as any, db as any, { prs: 'channel-1' },
        { event: 'dependabot_alert', payload: makeDependabotPayload('created') }
      )
    ).rejects.toThrow('not found or not a text channel');
  });

  it('uses security channel when configured', async () => {
    const channel = makeMockChannel();
    const client = makeMockClient(channel);
    const db = makeMockDb();

    await handleSecurityAlertEvent(
      client as any, db as any, { prs: 'channel-prs', security: 'channel-sec' },
      { event: 'dependabot_alert', payload: makeDependabotPayload('created') }
    );

    expect(client.channels.fetch).toHaveBeenCalledWith('channel-sec');
  });
});
