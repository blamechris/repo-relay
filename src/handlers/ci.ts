/**
 * CI/Workflow event handler
 */

import { Client, TextChannel } from 'discord.js';
import { StateDb } from '../db/state.js';
import { buildCiReply, buildCiFailureReply, CiStatus } from '../embeds/builders.js';
import { getChannelForEvent, ChannelConfig } from '../config/channels.js';
import { updatePrEmbedAndNotify } from './pr.js';
import { getExistingPrMessage } from '../discord/lookup.js';
import { withRetry } from '../utils/retry.js';
import { fetchFailedSteps } from '../github/ci.js';

export interface WorkflowRunPayload {
  action: 'completed' | 'requested' | 'in_progress';
  workflow_run: {
    id: number;
    name: string;
    head_sha: string;
    head_branch: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion:
      | 'success'
      | 'failure'
      | 'cancelled'
      | 'skipped'
      | 'neutral'
      | 'timed_out'
      | 'action_required'
      | 'stale'
      | 'startup_failure'
      | null;
    html_url: string;
    pull_requests: Array<{
      number: number;
    }>;
  };
  repository: {
    full_name: string;
  };
}

export async function handleCiEvent(
  client: Client,
  db: StateDb,
  channelConfig: ChannelConfig,
  payload: WorkflowRunPayload,
  githubToken?: string
): Promise<void> {
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

  const ciStatus: CiStatus = {
    status: mapCiStatus(run.status, run.conclusion),
    workflowName: run.name,
    conclusion: run.conclusion ?? undefined,
    url: run.html_url,
  };

  // Fetch failed steps once for the run (shared across all associated PRs)
  let failedSteps: Awaited<ReturnType<typeof fetchFailedSteps>> | undefined;
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
    const result = await updatePrEmbedAndNotify(
      channel, db, repo, pr.number, existing,
      payload.action === 'completed'
        ? (failedSteps ? buildCiFailureReply(ciStatus, failedSteps) : buildCiReply(ciStatus))
        : undefined
    );
    if (result.posted) {
      console.log(`[repo-relay] Posted CI update to thread`);
      db.updatePrMessageTimestamp(repo, pr.number);
    }
  }
}

export function mapCiStatus(
  status: WorkflowRunPayload['workflow_run']['status'],
  conclusion: WorkflowRunPayload['workflow_run']['conclusion']
): CiStatus['status'] {
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
