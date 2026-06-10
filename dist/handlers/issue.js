/**
 * Issue event handler with threaded embed lifecycle
 */
import { TextChannel } from 'discord.js';
import { buildIssueEmbed, buildIssueClosedReply, buildIssueReopenedReply, buildThreadName } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
import { getExistingIssueMessage } from '../discord/lookup.js';
import { getOrCreateMessageThread } from '../discord/threads.js';
import { withRetry } from '../utils/retry.js';
import { isUnknownMessageError } from '../utils/discord-errors.js';
export async function handleIssueEvent(client, db, channelConfig, payload) {
    const { action, issue, repository } = payload;
    const repo = repository.full_name;
    const issueData = {
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        author: issue.user.login,
        authorAvatar: issue.user.avatar_url,
        state: issue.state,
        stateReason: issue.state_reason ?? null,
        labels: issue.labels.map((l) => l.name),
        body: issue.body ?? undefined,
        createdAt: issue.created_at,
    };
    const channelId = getChannelForEvent(channelConfig, 'issue');
    const channel = await withRetry(() => client.channels.fetch(channelId));
    if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Channel ${channelId} not found or not a text channel`);
    }
    db.logEvent(repo, issue.number, `issue.${action}`, payload);
    switch (action) {
        case 'opened':
            await handleIssueOpened(channel, db, repo, issueData);
            break;
        case 'closed':
            await handleIssueStateChange(channel, db, repo, issueData, buildIssueClosedReply(payload.sender.login, issueData.stateReason));
            break;
        case 'reopened':
            await handleIssueStateChange(channel, db, repo, issueData, buildIssueReopenedReply(payload.sender.login));
            break;
        case 'labeled':
        case 'unlabeled':
        case 'edited':
            // Phase 4 — will be handled in PR 3
            return;
    }
}
async function handleIssueOpened(channel, db, repo, issue) {
    await createIssueMessageWithThread(channel, db, repo, issue, `📋 Updates for Issue #${issue.number} will appear here.`);
}
/**
 * Send a fresh issue embed, attach its updates thread, persist the message
 * row, and post `threadMessage` to the new thread.
 */
async function createIssueMessageWithThread(channel, db, repo, issue, threadMessage) {
    const embed = buildIssueEmbed(issue);
    const message = await withRetry(() => channel.send({ embeds: [embed] }));
    const thread = await withRetry(() => message.startThread({
        name: buildThreadName('Issue', issue.number, issue.title),
        autoArchiveDuration: 1440,
    }));
    db.saveIssueMessage(repo, issue.number, channel.id, message.id, thread.id);
    await withRetry(() => thread.send(threadMessage));
}
async function handleIssueStateChange(channel, db, repo, issue, replyText) {
    const existing = await getExistingIssueMessage(db, channel, repo, issue.number);
    if (existing) {
        try {
            const message = await withRetry(() => channel.messages.fetch(existing.messageId));
            const embed = buildIssueEmbed(issue);
            await withRetry(() => message.edit({ embeds: [embed] }));
            const thread = await getOrCreateIssueThread(channel, db, repo, issue, existing);
            await withRetry(() => thread.send(replyText));
            db.updateIssueMessageTimestamp(repo, issue.number);
            return;
        }
        catch (error) {
            if (isUnknownMessageError(error)) {
                console.log(`[repo-relay] Stale message for Issue #${issue.number}, creating new one`);
                db.deleteIssueMessage(repo, issue.number);
            }
            else {
                throw error;
            }
        }
    }
    // No existing message (or stale message was cleared) — create new embed
    await createIssueMessageWithThread(channel, db, repo, issue, replyText);
    db.updateIssueMessageTimestamp(repo, issue.number);
}
export async function getOrCreateIssueThread(channel, db, repo, issue, existing) {
    return getOrCreateMessageThread(channel, existing, buildThreadName('Issue', issue.number, issue.title), `📋 Updates for Issue #${issue.number} will appear here.`, (threadId) => db.updateIssueThread(repo, issue.number, threadId));
}
//# sourceMappingURL=issue.js.map