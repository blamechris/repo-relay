/**
 * Repo Relay - GitHub-Discord Integration Bot
 *
 * Entry point for the bot library.
 */
import { type ChannelConfig } from './config/channels.js';
import { type PrEventPayload, type WorkflowRunPayload, type PrReviewPayload, type IssueCommentPayload, type IssueEventPayload, type ReleaseEventPayload, type DeploymentStatusPayload } from './handlers/index.js';
import { REPO_NAME_PATTERN } from './utils/validation.js';
export interface RepoRelayConfig {
    discordToken: string;
    githubToken?: string;
    channelConfig: ChannelConfig;
    stateDir?: string;
}
export type GitHubEventPayload = {
    event: 'pull_request';
    payload: PrEventPayload;
} | {
    event: 'workflow_run';
    payload: WorkflowRunPayload;
} | {
    event: 'pull_request_review';
    payload: PrReviewPayload;
} | {
    event: 'issue_comment';
    payload: IssueCommentPayload;
} | {
    event: 'issues';
    payload: IssueEventPayload;
} | {
    event: 'release';
    payload: ReleaseEventPayload;
} | {
    event: 'deployment_status';
    payload: DeploymentStatusPayload;
};
export { REPO_NAME_PATTERN };
export declare class RepoRelay {
    private client;
    private db;
    private config;
    private repo;
    constructor(config: RepoRelayConfig);
    connect(): Promise<void>;
    validatePermissions(): Promise<void>;
    disconnect(): Promise<void>;
    handleEvent(eventData: GitHubEventPayload): Promise<void>;
    /**
     * Check GitHub API for reviews and update embed if status changed
     * This is the "piggyback" approach - we check for reviews when other events fire
     */
    private checkAndUpdateReviews;
    private extractRepo;
}
export { StateDb } from './db/state.js';
export { getChannelConfig, type ChannelConfig } from './config/channels.js';
export * from './embeds/builders.js';
export * from './handlers/index.js';
//# sourceMappingURL=index.d.ts.map