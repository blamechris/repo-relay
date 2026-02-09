/**
 * Channel configuration and routing
 */

export interface ChannelConfig {
  prs: string;
  issues?: string;
  releases?: string;
  deployments?: string;
}

export function getChannelConfig(): ChannelConfig {
  const prs = process.env.DISCORD_CHANNEL_PRS;
  if (!prs) {
    throw new Error('DISCORD_CHANNEL_PRS environment variable is required');
  }

  return {
    prs,
    issues: process.env.DISCORD_CHANNEL_ISSUES || undefined,
    releases: process.env.DISCORD_CHANNEL_RELEASES || undefined,
    deployments: process.env.DISCORD_CHANNEL_DEPLOYMENTS || undefined,
  };
}

export function getChannelForEvent(
  config: ChannelConfig,
  eventType: 'pr' | 'issue' | 'release' | 'ci' | 'review' | 'comment' | 'deployment' | 'push'
): string {
  switch (eventType) {
    case 'pr':
    case 'ci':
    case 'review':
    case 'comment':
    case 'push':
      return config.prs;
    case 'issue':
      return config.issues ?? config.prs;
    case 'release':
      return config.releases ?? config.prs;
    case 'deployment':
      return config.deployments ?? config.prs;
  }
}
