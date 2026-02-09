/**
 * Review event handler (Copilot and agent-review detection)
 */
import { TextChannel } from 'discord.js';
import { buildReviewReply, buildPrEmbed, buildPrComponents } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
import { buildEmbedWithStatus, getOrCreateThread } from './pr.js';
import { getExistingPrMessage } from '../discord/lookup.js';
import { withRetry } from '../utils/retry.js';
export async function handleReviewEvent(client, db, channelConfig, payload) {
    const { action, review, pull_request: pr, repository } = payload;
    const repo = repository.full_name;
    if (action !== 'submitted') {
        return;
    }
    // Skip owner comment replies to prevent notification cascades (#13)
    // When an owner replies to Copilot review comments, GitHub fires another
    // pull_request_review event with state 'commented'. These are noise.
    const isOwnerComment = review.user.login === repository.owner.login &&
        review.state === 'commented';
    if (isOwnerComment) {
        return;
    }
    const channelId = getChannelForEvent(channelConfig, 'review');
    const channel = await withRetry(() => client.channels.fetch(channelId));
    if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Channel ${channelId} not found or not a text channel`);
    }
    db.logEvent(repo, pr.number, `review.${action}`, payload);
    const existing = await getExistingPrMessage(db, channel, repo, pr.number);
    if (!existing) {
        return;
    }
    // Detect Copilot review
    const isCopilot = review.user.type === 'Bot' &&
        review.user.login.toLowerCase().includes('copilot');
    if (isCopilot) {
        const message = await withRetry(() => channel.messages.fetch(existing.messageId));
        // Update status in DB
        db.updateCopilotStatus(repo, pr.number, 'reviewed', 0);
        // Rebuild and edit the embed with updated status
        const statusData = buildEmbedWithStatus(db, repo, pr.number);
        if (statusData) {
            const embed = buildPrEmbed(statusData.prData, statusData.ci, statusData.reviews);
            const components = [buildPrComponents(statusData.prData.url, statusData.ci.url)];
            await withRetry(() => message.edit({ embeds: [embed], components }));
            // Post to thread
            const thread = await getOrCreateThread(channel, db, repo, statusData.prData, existing);
            const reply = buildReviewReply('copilot', 'reviewed', undefined, review.html_url);
            await withRetry(() => thread.send(reply));
        }
        db.updatePrMessageTimestamp(repo, pr.number);
    }
}
//# sourceMappingURL=review.js.map