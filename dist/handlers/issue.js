/**
 * Issue event handler
 */
import { TextChannel } from 'discord.js';
import { buildIssueEmbed } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
export async function handleIssueEvent(client, db, channelConfig, payload) {
    const { action, issue, repository } = payload;
    const repo = repository.full_name;
    // Only notify for opened and closed
    if (action !== 'opened' && action !== 'closed') {
        return;
    }
    const channelId = getChannelForEvent(channelConfig, 'issue');
    const channel = await client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Channel ${channelId} not found or not a text channel`);
    }
    db.logEvent(repo, null, `issue.${action}`, payload);
    const embed = buildIssueEmbed(issue.number, issue.title, issue.html_url, issue.user.login, issue.user.avatar_url, issue.state, issue.labels.map((l) => l.name), issue.body ?? undefined);
    await channel.send({ embeds: [embed] });
}
//# sourceMappingURL=issue.js.map