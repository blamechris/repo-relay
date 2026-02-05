/**
 * Channel configuration and routing
 */
export interface ChannelConfig {
    prs: string;
    issues?: string;
    releases?: string;
}
export declare function getChannelConfig(): ChannelConfig;
export declare function getChannelForEvent(config: ChannelConfig, eventType: 'pr' | 'issue' | 'release' | 'ci' | 'review' | 'comment'): string;
//# sourceMappingURL=channels.d.ts.map