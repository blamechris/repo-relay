/**
 * Comment event handler (agent-review detection)
 */
import { TextChannel } from 'discord.js';
import { buildReviewReply } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
import { updatePrEmbedAndNotify } from './pr.js';
import { getExistingPrMessage } from '../discord/lookup.js';
import { withRetry } from '../utils/retry.js';
import { AGENT_REVIEW_PATTERNS, APPROVED_PATTERNS, CHANGES_REQUESTED_PATTERNS, isTrustedReviewAuthor, } from '../patterns/agent-review.js';
export async function handleCommentEvent(client, db, channelConfig, payload) {
    const { action, comment, issue, repository } = payload;
    const repo = repository.full_name;
    // Only handle created comments on PRs
    if (action !== 'created' || !issue.pull_request) {
        return;
    }
    const prNumber = issue.number;
    const body = comment.body;
    // Check if this is an agent-review comment
    const isAgentReview = AGENT_REVIEW_PATTERNS.some((pattern) => pattern.test(body));
    if (!isAgentReview) {
        return;
    }
    // Spoofing defense: only bots and repo insiders may set review state
    if (!isTrustedReviewAuthor(comment.user, comment.author_association)) {
        console.log(`[repo-relay] Ignoring agent-review-shaped comment from untrusted author @${comment.user.login} (${comment.author_association ?? 'no association'})`);
        return;
    }
    const channelId = getChannelForEvent(channelConfig, 'review');
    const channel = await withRetry(() => client.channels.fetch(channelId));
    if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Channel ${channelId} not found or not a text channel`);
    }
    db.logEvent(repo, prNumber, 'review.agent', payload);
    const existing = await getExistingPrMessage(db, channel, repo, prNumber);
    if (!existing) {
        return;
    }
    // Determine verdict
    let status = 'pending';
    if (APPROVED_PATTERNS.some((pattern) => pattern.test(body))) {
        status = 'approved';
    }
    else if (CHANGES_REQUESTED_PATTERNS.some((pattern) => pattern.test(body))) {
        status = 'changes_requested';
    }
    // Update status in DB first so it persists even if the message is stale
    db.updateAgentReviewStatus(repo, prNumber, status);
    const result = await updatePrEmbedAndNotify(channel, db, repo, prNumber, existing, buildReviewReply('agent', status, undefined, comment.html_url));
    if (!result.stale) {
        db.updatePrMessageTimestamp(repo, prNumber);
    }
}
//# sourceMappingURL=comment.js.map