/**
 * Issue event handler with threaded embed lifecycle
 */
import { TextChannel } from 'discord.js';
import { buildIssueEmbed, buildIssueClosedReply, buildIssueReopenedReply } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
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
    const channel = await client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Channel ${channelId} not found or not a text channel`);
    }
    db.logEvent(repo, issue.number, `issue.${action}`, payload);
    switch (action) {
        case 'opened':
            await handleIssueOpened(channel, db, repo, issueData);
            break;
        case 'closed':
            await handleIssueClosed(channel, db, repo, issueData, payload.sender.login);
            break;
        case 'reopened':
            await handleIssueReopened(channel, db, repo, issueData, payload.sender.login);
            break;
        case 'labeled':
        case 'unlabeled':
        case 'edited':
            // Phase 4 — will be handled in PR 3
            return;
    }
}
async function handleIssueOpened(channel, db, repo, issue) {
    const embed = buildIssueEmbed(issue);
    const message = await channel.send({ embeds: [embed] });
    const thread = await message.startThread({
        name: `Issue #${issue.number}: ${issue.title.substring(0, 90)}`,
        autoArchiveDuration: 1440,
    });
    db.saveIssueMessage(repo, issue.number, channel.id, message.id, thread.id);
    saveIssueDataFromIssueData(db, repo, issue);
    await thread.send(`📋 Updates for Issue #${issue.number} will appear here.`);
}
async function handleIssueClosed(channel, db, repo, issue, closedBy) {
    let existing = db.getIssueMessage(repo, issue.number);
    if (existing) {
        try {
            const message = await channel.messages.fetch(existing.messageId);
            saveIssueDataFromIssueData(db, repo, issue);
            const embed = buildIssueEmbed(issue);
            await message.edit({ embeds: [embed] });
            const thread = await getOrCreateIssueThread(channel, db, repo, issue, existing);
            await thread.send(buildIssueClosedReply(closedBy, issue.stateReason));
            db.updateIssueMessageTimestamp(repo, issue.number);
            return;
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            if (errMsg.includes('Unknown Message')) {
                console.log(`[repo-relay] Stale message for Issue #${issue.number}, creating new one`);
                db.deleteIssueMessage(repo, issue.number);
                existing = null;
            }
            else {
                throw error;
            }
        }
    }
    if (!existing) {
        const embed = buildIssueEmbed(issue);
        const message = await channel.send({ embeds: [embed] });
        const thread = await message.startThread({
            name: `Issue #${issue.number}: ${issue.title.substring(0, 90)}`,
            autoArchiveDuration: 1440,
        });
        db.saveIssueMessage(repo, issue.number, channel.id, message.id, thread.id);
        saveIssueDataFromIssueData(db, repo, issue);
    }
}
async function handleIssueReopened(channel, db, repo, issue, reopenedBy) {
    let existing = db.getIssueMessage(repo, issue.number);
    if (existing) {
        try {
            const message = await channel.messages.fetch(existing.messageId);
            saveIssueDataFromIssueData(db, repo, issue);
            const embed = buildIssueEmbed(issue);
            await message.edit({ embeds: [embed] });
            const thread = await getOrCreateIssueThread(channel, db, repo, issue, existing);
            await thread.send(buildIssueReopenedReply(reopenedBy));
            db.updateIssueMessageTimestamp(repo, issue.number);
            return;
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            if (errMsg.includes('Unknown Message')) {
                console.log(`[repo-relay] Stale message for Issue #${issue.number}, creating new one`);
                db.deleteIssueMessage(repo, issue.number);
                existing = null;
            }
            else {
                throw error;
            }
        }
    }
    if (!existing) {
        const embed = buildIssueEmbed(issue);
        const message = await channel.send({ embeds: [embed] });
        const thread = await message.startThread({
            name: `Issue #${issue.number}: ${issue.title.substring(0, 90)}`,
            autoArchiveDuration: 1440,
        });
        db.saveIssueMessage(repo, issue.number, channel.id, message.id, thread.id);
        saveIssueDataFromIssueData(db, repo, issue);
    }
}
function saveIssueDataFromIssueData(db, repo, issue) {
    db.saveIssueData({
        repo,
        issueNumber: issue.number,
        title: issue.title,
        url: issue.url,
        author: issue.author,
        authorAvatar: issue.authorAvatar ?? null,
        state: issue.state,
        stateReason: issue.stateReason ?? null,
        labels: JSON.stringify(issue.labels),
        body: issue.body ?? null,
        issueCreatedAt: issue.createdAt,
    });
}
export async function getOrCreateIssueThread(channel, db, repo, issue, existing) {
    if (existing.threadId) {
        try {
            const thread = await channel.threads.fetch(existing.threadId);
            if (thread) {
                if (thread.archived) {
                    await thread.setArchived(false);
                }
                return thread;
            }
        }
        catch {
            // Thread doesn't exist or was deleted, create a new one
        }
    }
    const message = await channel.messages.fetch(existing.messageId);
    const thread = await message.startThread({
        name: `Issue #${issue.number}: ${issue.title.substring(0, 90)}`,
        autoArchiveDuration: 1440,
    });
    db.updateIssueThread(repo, issue.number, thread.id);
    await thread.send(`📋 Updates for Issue #${issue.number} will appear here.`);
    return thread;
}
//# sourceMappingURL=issue.js.map