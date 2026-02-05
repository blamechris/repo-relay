/**
 * Repo Relay - GitHub-Discord Integration Bot
 *
 * Entry point for the bot library.
 */
import { Client, GatewayIntentBits } from 'discord.js';
import { StateDb } from './db/state.js';
import { handlePrEvent, handleCiEvent, handleReviewEvent, handleCommentEvent, handleIssueEvent, handleReleaseEvent, } from './handlers/index.js';
export class RepoRelay {
    client;
    db = null;
    config;
    repo = null;
    constructor(config) {
        this.config = config;
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
            ],
        });
    }
    async connect() {
        await this.client.login(this.config.discordToken);
        console.log(`[repo-relay] Connected to Discord as ${this.client.user?.tag}`);
    }
    async disconnect() {
        this.db?.close();
        this.client.destroy();
        console.log('[repo-relay] Disconnected from Discord');
    }
    async handleEvent(eventData) {
        // Extract repo from payload
        const repo = this.extractRepo(eventData);
        if (!repo) {
            throw new Error('Could not extract repository from event payload');
        }
        // Initialize or switch DB if repo changed
        if (this.repo !== repo) {
            this.db?.close();
            this.db = new StateDb(repo, this.config.stateDir);
            this.repo = repo;
        }
        console.log(`[repo-relay] Handling ${eventData.event} event for ${repo}`);
        // TypeScript narrowing ensures db is initialized after the block above
        const db = this.db;
        switch (eventData.event) {
            case 'pull_request':
                await handlePrEvent(this.client, db, this.config.channelConfig, eventData.payload);
                break;
            case 'workflow_run':
                await handleCiEvent(this.client, db, this.config.channelConfig, eventData.payload);
                break;
            case 'pull_request_review':
                await handleReviewEvent(this.client, db, this.config.channelConfig, eventData.payload);
                break;
            case 'issue_comment':
                await handleCommentEvent(this.client, db, this.config.channelConfig, eventData.payload);
                break;
            case 'issues':
                await handleIssueEvent(this.client, db, this.config.channelConfig, eventData.payload);
                break;
            case 'release':
                await handleReleaseEvent(this.client, db, this.config.channelConfig, eventData.payload);
                break;
            default:
                console.log(`[repo-relay] Unknown event type, skipping`);
        }
    }
    extractRepo(eventData) {
        switch (eventData.event) {
            case 'pull_request':
            case 'workflow_run':
            case 'pull_request_review':
            case 'issue_comment':
            case 'issues':
            case 'release':
                return eventData.payload.repository.full_name;
            default:
                return null;
        }
    }
}
// Re-export types and utilities
export { StateDb } from './db/state.js';
export { getChannelConfig } from './config/channels.js';
export * from './embeds/builders.js';
export * from './handlers/index.js';
//# sourceMappingURL=index.js.map