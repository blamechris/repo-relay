/**
 * Channel configuration and routing
 */

export interface ChannelConfig {
  prs: string;
  issues?: string;
  releases?: string;
}

export function getChannelConfig(): ChannelConfig {
  const prs = process.env.DISCORD_CHANNEL_PRS;
  if (!prs) {
    throw new Error('DISCORD_CHANNEL_PRS environment variable is required');
  }

  return {
    prs,
    issues: process.env.DISCORD_CHANNEL_ISSUES,
    releases: process.env.DISCORD_CHANNEL_RELEASES,
  };
}

export function getChannelForEvent(
  config: ChannelConfig,
  eventType: 'pr' | 'issue' | 'release' | 'ci' | 'review' | 'comment'
): string {
  switch (eventType) {
    case 'pr':
    case 'ci':
    case 'review':
    case 'comment':
      return config.prs;
    case 'issue':
      return config.issues ?? config.prs;
    case 'release':
      return config.releases ?? config.prs;
  }
}
