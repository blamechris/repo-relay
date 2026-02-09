/**
 * Release event handler
 */
import { TextChannel } from 'discord.js';
import { buildReleaseEmbed } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
import { withRetry } from '../utils/retry.js';
export async function handleReleaseEvent(client, db, channelConfig, payload) {
    const { action, release, repository } = payload;
    const repo = repository.full_name;
    // Only notify for published (not drafts)
    if (action !== 'published' || release.draft) {
        return;
    }
    const channelId = getChannelForEvent(channelConfig, 'release');
    const channel = await client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Channel ${channelId} not found or not a text channel`);
    }
    db.logEvent(repo, null, `release.${action}`, payload);
    const embed = buildReleaseEmbed(release.name ?? release.tag_name, release.tag_name, release.html_url, release.author.login, release.author.avatar_url, release.body ?? undefined, release.prerelease);
    await withRetry(() => channel.send({ embeds: [embed] }));
}
//# sourceMappingURL=release.js.map