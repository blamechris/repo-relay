/**
 * Channel configuration and routing
 */
export function getChannelConfig() {
    const prs = process.env.DISCORD_CHANNEL_PRS;
    if (!prs) {
        throw new Error('DISCORD_CHANNEL_PRS environment variable is required');
    }
    return {
        prs,
        issues: process.env.DISCORD_CHANNEL_ISSUES,
        releases: process.env.DISCORD_CHANNEL_RELEASES,
        deployments: process.env.DISCORD_CHANNEL_DEPLOYMENTS,
    };
}
export function getChannelForEvent(config, eventType) {
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
        case 'deployment':
            return config.deployments ?? config.prs;
    }
}
//# sourceMappingURL=channels.js.map