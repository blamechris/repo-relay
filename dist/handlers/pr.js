/**
 * Pull Request event handler
 */
import { TextChannel } from 'discord.js';
import { buildPrEmbed, buildMergedReply, buildClosedReply, buildPushReply } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
export async function handlePrEvent(client, db, channelConfig, payload) {
    const { action, pull_request: pr, repository } = payload;
    const repo = repository.full_name;
    const channelId = getChannelForEvent(channelConfig, 'pr');
    const channel = await client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Channel ${channelId} not found or not a text channel`);
    }
    // Log the event
    db.logEvent(repo, pr.number, `pr.${action}`, payload);
    const prData = {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        author: pr.user.login,
        authorUrl: pr.user.html_url,
        authorAvatar: pr.user.avatar_url,
        branch: pr.head.ref,
        baseBranch: pr.base.ref,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        body: pr.body ?? undefined,
        state: pr.merged ? 'merged' : pr.state,
        draft: pr.draft,
        createdAt: pr.created_at,
        mergedAt: pr.merged_at ?? undefined,
        mergedBy: pr.merged_by?.login,
    };
    switch (action) {
        case 'opened':
        case 'reopened':
            await handlePrOpened(channel, db, repo, prData);
            break;
        case 'closed':
            await handlePrClosed(channel, db, repo, prData);
            break;
        case 'synchronize':
            await handlePrPush(channel, db, repo, prData, payload);
            break;
        case 'edited':
        case 'ready_for_review':
        case 'converted_to_draft':
            await handlePrUpdated(channel, db, repo, prData);
            break;
    }
}
async function handlePrOpened(channel, db, repo, pr) {
    const embed = buildPrEmbed(pr);
    const message = await channel.send({ embeds: [embed] });
    db.savePrMessage(repo, pr.number, channel.id, message.id);
}
async function handlePrClosed(channel, db, repo, pr) {
    const existing = db.getPrMessage(repo, pr.number);
    if (existing) {
        // Update the original embed
        const message = await channel.messages.fetch(existing.messageId);
        const embed = buildPrEmbed(pr);
        await message.edit({ embeds: [embed] });
        // Post a reply
        const reply = pr.state === 'merged'
            ? buildMergedReply(pr.mergedBy)
            : buildClosedReply();
        await message.reply(reply);
        db.updatePrMessageTimestamp(repo, pr.number);
    }
    else {
        // No existing message, create one showing the final state
        const embed = buildPrEmbed(pr);
        const message = await channel.send({ embeds: [embed] });
        db.savePrMessage(repo, pr.number, channel.id, message.id);
    }
}
async function handlePrPush(channel, db, repo, pr, payload) {
    let existing = db.getPrMessage(repo, pr.number);
    // If no message exists yet (PR opened before bot was set up), create one
    if (!existing) {
        const embed = buildPrEmbed(pr);
        const message = await channel.send({ embeds: [embed] });
        db.savePrMessage(repo, pr.number, channel.id, message.id);
        existing = { repo, prNumber: pr.number, channelId: channel.id, messageId: message.id, createdAt: '', lastUpdated: '' };
    }
    const message = await channel.messages.fetch(existing.messageId);
    // Count commits (if before/after available, otherwise assume 1)
    const commitCount = 1; // GitHub doesn't provide commit count directly in synchronize
    const replyText = buildPushReply(commitCount, payload.sender.login, pr.branch, `${pr.url}/commits`);
    await message.reply(replyText);
    db.updatePrMessageTimestamp(repo, pr.number);
}
async function handlePrUpdated(channel, db, repo, pr) {
    const existing = db.getPrMessage(repo, pr.number);
    if (existing) {
        const message = await channel.messages.fetch(existing.messageId);
        const embed = buildPrEmbed(pr);
        await message.edit({ embeds: [embed] });
        db.updatePrMessageTimestamp(repo, pr.number);
    }
    else {
        // No message exists yet (PR opened before bot was set up), create one
        const embed = buildPrEmbed(pr);
        const message = await channel.send({ embeds: [embed] });
        db.savePrMessage(repo, pr.number, channel.id, message.id);
    }
}
//# sourceMappingURL=pr.js.map