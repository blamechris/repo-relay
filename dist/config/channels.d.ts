/**
 * Channel configuration and routing
 */
export interface ChannelConfig {
    prs: string;
    issues?: string;
    releases?: string;
    deployments?: string;
}
export declare function getChannelConfig(): ChannelConfig;
export declare function getChannelForEvent(config: ChannelConfig, eventType: 'pr' | 'issue' | 'release' | 'ci' | 'review' | 'comment' | 'deployment'): string;
//# sourceMappingURL=channels.d.ts.map