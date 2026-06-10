import { describe, it, expect } from 'vitest';
import { getChannelForEvent, type ChannelConfig } from '../channels.js';

const EVENT_TYPES = [
  'pr', 'ci', 'review', 'comment', 'push', 'issue', 'release', 'deployment', 'security',
] as const;

describe('getChannelForEvent', () => {
  it('falls back to the prs channel for every route when optional channels are unset', () => {
    const config: ChannelConfig = { prs: 'prs-channel' };
    for (const eventType of EVENT_TYPES) {
      expect(getChannelForEvent(config, eventType)).toBe('prs-channel');
    }
  });

  it('routes to dedicated channels when configured', () => {
    const config: ChannelConfig = {
      prs: 'prs-channel',
      issues: 'issues-channel',
      releases: 'releases-channel',
      deployments: 'deployments-channel',
      security: 'security-channel',
    };
    expect(getChannelForEvent(config, 'issue')).toBe('issues-channel');
    expect(getChannelForEvent(config, 'release')).toBe('releases-channel');
    expect(getChannelForEvent(config, 'deployment')).toBe('deployments-channel');
    expect(getChannelForEvent(config, 'security')).toBe('security-channel');
    // PR-family events always use the prs channel
    for (const eventType of ['pr', 'ci', 'review', 'comment', 'push'] as const) {
      expect(getChannelForEvent(config, eventType)).toBe('prs-channel');
    }
  });
});
