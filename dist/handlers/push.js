/**
 * Push event handler — notifies on direct pushes to the default branch
 */
import { TextChannel } from 'discord.js';
import { buildPushEmbed, buildForcePushEmbed } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
import { withRetry } from '../utils/retry.js';
const PR_MERGE_COMMIT_PATTERN = /^Merge pull request #\d+/;
export async function handlePushEvent(client, db, channelConfig, payload) {
    const { ref, forced, created, deleted, commits, compare, sender, repository } = payload;
    const repo = repository.full_name;
    // Extract branch name from ref (refs/heads/main → main)
    const branch = ref.replace('refs/heads/', '');
    // Only notify for pushes to the default branch
    if (branch !== repository.default_branch) {
        return;
    }
    // Skip branch creation/deletion events
    if (created || deleted) {
        return;
    }
    // Skip if every commit is a PR merge commit (PR handler covers these)
    if (commits.length > 0 && commits.every(c => PR_MERGE_COMMIT_PATTERN.test(c.message))) {
        return;
    }
    const channelId = getChannelForEvent(channelConfig, 'push');
    const channel = await withRetry(() => client.channels.fetch(channelId));
    if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Channel ${channelId} not found or not a text channel`);
    }
    db.logEvent(repo, null, forced ? 'push.forced' : 'push', payload);
    let embed;
    if (forced) {
        embed = buildForcePushEmbed(branch, payload.before, payload.after, sender.login, sender.avatar_url, compare);
    }
    else {
        embed = buildPushEmbed(branch, commits, sender.login, sender.avatar_url, compare);
    }
    await withRetry(() => channel.send({ embeds: [embed] }));
}
//# sourceMappingURL=push.js.map