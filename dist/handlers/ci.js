/**
 * CI/Workflow event handler
 */
import { TextChannel } from 'discord.js';
import { buildCiReply, buildPrEmbed } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
import { buildEmbedWithStatus } from './pr.js';
export async function handleCiEvent(client, db, channelConfig, payload) {
    const { workflow_run: run, repository } = payload;
    const repo = repository.full_name;
    console.log(`[repo-relay] CI event: ${run.pull_requests.length} PRs associated, branch: ${run.head_branch}, sha: ${run.head_sha.substring(0, 7)}`);
    // Only notify for PRs we're tracking
    if (run.pull_requests.length === 0) {
        console.log(`[repo-relay] No PRs in workflow_run event, skipping CI update`);
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
        // Update CI status in DB
        db.updateCiStatus(repo, pr.number, ciStatus.status, run.name, run.html_url);
        const message = await channel.messages.fetch(existing.messageId);
        // Rebuild and edit the embed with updated status
        const statusData = buildEmbedWithStatus(db, repo, pr.number);
        if (statusData) {
            const embed = buildPrEmbed(statusData.prData, statusData.ci, statusData.reviews);
            await message.edit({ embeds: [embed] });
        }
        // Only post replies for completed runs
        if (payload.action === 'completed') {
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