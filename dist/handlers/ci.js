/**
 * CI/Workflow event handler
 */
import { TextChannel } from 'discord.js';
import { buildCiReply, buildCiFailureReply, buildPrEmbed, buildPrComponents } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
import { buildEmbedWithStatus, getOrCreateThread } from './pr.js';
import { getExistingPrMessage } from '../discord/lookup.js';
import { withRetry } from '../utils/retry.js';
import { fetchFailedSteps } from '../github/ci.js';
export async function handleCiEvent(client, db, channelConfig, payload, githubToken) {
    const { workflow_run: run, repository } = payload;
    const repo = repository.full_name;
    console.log(`[repo-relay] CI event: ${run.pull_requests.length} PRs associated, branch: ${run.head_branch}, sha: ${run.head_sha.substring(0, 7)}`);
    // Only notify for PRs we're tracking
    if (run.pull_requests.length === 0) {
        console.log(`[repo-relay] No PRs in workflow_run event, skipping CI update`);
        return;
    }
    const channelId = getChannelForEvent(channelConfig, 'ci');
    const channel = await withRetry(() => client.channels.fetch(channelId));
    if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Channel ${channelId} not found or not a text channel`);
    }
    const ciStatus = {
        status: mapCiStatus(run.status, run.conclusion),
        workflowName: run.name,
        conclusion: run.conclusion ?? undefined,
        url: run.html_url,
    };
    // Fetch failed steps once for the run (shared across all associated PRs)
    let failedSteps;
    if (payload.action === 'completed' && ciStatus.status === 'failure' && githubToken) {
        failedSteps = await fetchFailedSteps(repo, run.id, githubToken);
    }
    for (const pr of run.pull_requests) {
        console.log(`[repo-relay] Processing CI for PR #${pr.number}`);
        db.logEvent(repo, pr.number, `ci.${payload.action}`, payload);
        const existing = await getExistingPrMessage(db, channel, repo, pr.number);
        if (!existing) {
            console.log(`[repo-relay] No message found for PR #${pr.number}, skipping`);
            continue;
        }
        console.log(`[repo-relay] Found message ${existing.messageId} for PR #${pr.number}`);
        // Update CI status in DB
        db.updateCiStatus(repo, pr.number, ciStatus.status, run.name, run.html_url);
        console.log(`[repo-relay] Updated CI status to ${ciStatus.status}`);
        try {
            const message = await withRetry(() => channel.messages.fetch(existing.messageId));
            console.log(`[repo-relay] Fetched Discord message`);
            // Rebuild and edit the embed with updated status
            const statusData = buildEmbedWithStatus(db, repo, pr.number);
            if (statusData) {
                console.log(`[repo-relay] Rebuilding embed with CI: ${statusData.ci.status}`);
                const embed = buildPrEmbed(statusData.prData, statusData.ci, statusData.reviews);
                const components = [buildPrComponents(statusData.prData.url, statusData.ci.url)];
                await withRetry(() => message.edit({ embeds: [embed], components }));
                console.log(`[repo-relay] Embed updated successfully`);
                // Only post to thread for completed runs
                if (payload.action === 'completed') {
                    const thread = await getOrCreateThread(channel, db, repo, statusData.prData, existing);
                    const reply = failedSteps
                        ? buildCiFailureReply(ciStatus, failedSteps)
                        : buildCiReply(ciStatus);
                    await withRetry(() => thread.send(reply));
                    console.log(`[repo-relay] Posted CI update to thread`);
                    db.updatePrMessageTimestamp(repo, pr.number);
                }
            }
            else {
                console.log(`[repo-relay] No PR data found, cannot rebuild embed`);
            }
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            if (errMsg.includes('Unknown Message')) {
                console.log(`[repo-relay] Stale message for PR #${pr.number}, clearing DB entry`);
                db.deletePrMessage(repo, pr.number);
            }
            else {
                throw error;
            }
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