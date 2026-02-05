/**
 * CI/Workflow event handler
 */
import { TextChannel } from 'discord.js';
import { buildCiReply } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
export async function handleCiEvent(client, db, channelConfig, payload) {
    const { workflow_run: run, repository } = payload;
    const repo = repository.full_name;
    // Only notify for PRs we're tracking
    if (run.pull_requests.length === 0) {
        return;
    }
    const channelId = getChannelForEvent(channelConfig, 'ci');
    const channel = await client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Channel ${channelId} not found or not a text channel`);
    }
    for (const pr of run.pull_requests) {
        db.logEvent(repo, pr.number, `ci.${payload.action}`, payload);
        const existing = db.getPrMessage(repo, pr.number);
        if (!existing) {
            continue;
        }
        const ciStatus = {
            status: mapCiStatus(run.status, run.conclusion),
            workflowName: run.name,
            conclusion: run.conclusion ?? undefined,
            url: run.html_url,
        };
        // Only post replies for completed runs
        if (payload.action === 'completed') {
            const message = await channel.messages.fetch(existing.messageId);
            const reply = buildCiReply(ciStatus);
            await message.reply(reply);
            db.updatePrMessageTimestamp(repo, pr.number);
        }
    }
}
function mapCiStatus(status, conclusion) {
    if (status === 'completed') {
        switch (conclusion) {
            case 'success':
                return 'success';
            case 'failure':
                return 'failure';
            case 'cancelled':
                return 'cancelled';
            default:
                return 'success'; // neutral, skipped treated as success
        }
    }
    if (status === 'in_progress') {
        return 'running';
    }
    return 'pending';
}
//# sourceMappingURL=ci.js.map