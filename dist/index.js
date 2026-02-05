/**
 * Repo Relay - GitHub-Discord Integration Bot
 *
 * Entry point for the bot library.
 */
import { Client, GatewayIntentBits, PermissionsBitField } from 'discord.js';
import { StateDb } from './db/state.js';
import { handlePrEvent, handleCiEvent, handleReviewEvent, handleCommentEvent, handleIssueEvent, handleReleaseEvent, } from './handlers/index.js';
import { checkForReviews } from './github/reviews.js';
import { buildEmbedWithStatus } from './handlers/pr.js';
import { buildPrEmbed, buildReviewReply } from './embeds/builders.js';
import { TextChannel } from 'discord.js';
import { getChannelForEvent } from './config/channels.js';
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
    async validatePermissions() {
        const requiredPermissions = [
            { flag: PermissionsBitField.Flags.SendMessages, name: 'Send Messages' },
            { flag: PermissionsBitField.Flags.CreatePublicThreads, name: 'Create Public Threads' },
            { flag: PermissionsBitField.Flags.SendMessagesInThreads, name: 'Send Messages in Threads' },
            { flag: PermissionsBitField.Flags.EmbedLinks, name: 'Embed Links' },
            { flag: PermissionsBitField.Flags.ReadMessageHistory, name: 'Read Message History' },
        ];
        const requiredNames = requiredPermissions.map((p) => p.name).join(', ');
        // Collect unique channel IDs
        const { prs, issues, releases } = this.config.channelConfig;
        const channelIds = [...new Set([prs, issues, releases].filter(Boolean))];
        const errors = [];
        for (const channelId of channelIds) {
            let channel;
            try {
                channel = await this.client.channels.fetch(channelId);
            }
            catch {
                errors.push(`[repo-relay] ERROR: Could not access channel ${channelId}\n` +
                    `  The channel may not exist or the bot may not have access to it.`);
                continue;
            }
            if (!channel || !('guild' in channel)) {
                errors.push(`[repo-relay] ERROR: Channel ${channelId} is not a guild text channel`);
                continue;
            }
            const guildChannel = channel;
            const me = guildChannel.guild.members.me;
            if (!me) {
                errors.push(`[repo-relay] ERROR: Could not resolve bot member in guild for channel ${channelId}`);
                continue;
            }
            const permissions = guildChannel.permissionsFor(me);
            if (!permissions) {
                errors.push(`[repo-relay] ERROR: Could not resolve permissions for channel ${channelId}`);
                continue;
            }
            const missing = requiredPermissions
                .filter((p) => !permissions.has(p.flag))
                .map((p) => p.name);
            if (missing.length > 0) {
                errors.push(`[repo-relay] ERROR: Bot lacks permissions in channel ${channelId}\n` +
                    `  Missing: ${missing.join(', ')}\n` +
                    `  Required: ${requiredNames}`);
            }
        }
        if (errors.length > 0) {
            const message = errors.join('\n');
            console.error(message);
            throw new Error(`Missing Discord permissions in ${errors.length} channel(s). See logs above for details.`);
        }
        console.log('[repo-relay] Permission check passed for all channels');
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
                // Piggyback: check for reviews that may have been posted
                if (this.config.githubToken) {
                    await this.checkAndUpdateReviews(repo, eventData.payload.pull_request.number);
                }
                break;
            case 'workflow_run':
                await handleCiEvent(this.client, db, this.config.channelConfig, eventData.payload);
                // Piggyback: check for reviews on associated PRs
                if (this.config.githubToken) {
                    for (const pr of eventData.payload.workflow_run.pull_requests) {
                        await this.checkAndUpdateReviews(repo, pr.number);
                    }
                }
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
    /**
     * Check GitHub API for reviews and update embed if status changed
     * This is the "piggyback" approach - we check for reviews when other events fire
     */
    async checkAndUpdateReviews(repo, prNumber) {
        if (!this.db || !this.config.githubToken) {
            return;
        }
        const result = await checkForReviews(this.db, repo, prNumber, this.config.githubToken);
        // If status changed, update the embed
        if (result.changed) {
            const existing = this.db.getPrMessage(repo, prNumber);
            if (!existing)
                return;
            try {
                const channelId = getChannelForEvent(this.config.channelConfig, 'pr');
                const channel = await this.client.channels.fetch(channelId);
                if (!channel || !(channel instanceof TextChannel))
                    return;
                const message = await channel.messages.fetch(existing.messageId);
                const statusData = buildEmbedWithStatus(this.db, repo, prNumber);
                if (statusData) {
                    const embed = buildPrEmbed(statusData.prData, statusData.ci, statusData.reviews);
                    await message.edit({ embeds: [embed] });
                    console.log(`[repo-relay] Updated embed for PR #${prNumber} with detected reviews`);
                    // Post to thread about detected reviews
                    if (existing.threadId) {
                        try {
                            const thread = await channel.threads.fetch(existing.threadId);
                            if (thread) {
                                if (result.copilotReviewed && result.copilotUrl) {
                                    const reply = buildReviewReply('copilot', 'reviewed', undefined, result.copilotUrl);
                                    await thread.send(reply);
                                }
                                if (result.agentReviewStatus !== 'pending' && result.agentReviewUrl) {
                                    const reply = buildReviewReply('agent', result.agentReviewStatus, undefined, result.agentReviewUrl);
                                    await thread.send(reply);
                                }
                            }
                        }
                        catch {
                            // Thread might be archived or deleted
                        }
                    }
                }
            }
            catch (error) {
                console.log(`[repo-relay] Warning: Failed to update embed for detected reviews: ${error}`);
            }
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