/**
 * CI/Workflow event handler
 */
import { TextChannel } from 'discord.js';
import { buildCiReply, buildCiFailureReply } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
import { updatePrEmbedAndNotify } from './pr.js';
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
        // Only post to thread for completed runs
        const result = await updatePrEmbedAndNotify(channel, db, repo, pr.number, existing, payload.action === 'completed'
            ? (failedSteps ? buildCiFailureReply(ciStatus, failedSteps) : buildCiReply(ciStatus))
            : undefined);
        if (result.posted) {
            console.log(`[repo-relay] Posted CI update to thread`);
            db.updatePrMessageTimestamp(repo, pr.number);
        }
    }
}
export function mapCiStatus(status, conclusion) {
    if (status === 'completed') {
        switch (conclusion) {
            case 'success':
            case 'neutral':
            case 'skipped':
                // Informational outcomes deliberately render as success
                return 'success';
            case 'failure':
            case 'timed_out':
            case 'startup_failure':
                return 'failure';
            case 'cancelled':
            case 'stale':
                return 'cancelled';
            case 'action_required':
                // Blocked waiting on approval — not a pass, not a fail
                return 'pending';
            default:
                // Fail safe: a completed run with an unrecognized (or null) conclusion
                // must never render as "✅ Passed"
                console.warn(`[repo-relay] Unknown workflow_run conclusion "${conclusion}" — treating as failure`);
                return 'failure';
        }
    }
    if (status === 'in_progress') {
        return 'running';
    }
    return 'pending';
}
//# sourceMappingURL=ci.js.map