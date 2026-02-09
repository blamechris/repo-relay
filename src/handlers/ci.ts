/**
 * CI/Workflow event handler
 */

import { Client, TextChannel } from 'discord.js';
import { StateDb } from '../db/state.js';
import { buildCiReply, CiStatus, buildPrEmbed, PrData } from '../embeds/builders.js';
import { getChannelForEvent, ChannelConfig } from '../config/channels.js';
import { buildEmbedWithStatus, getOrCreateThread } from './pr.js';
import { getExistingPrMessage } from '../discord/lookup.js';
import { withRetry } from '../utils/retry.js';

export interface WorkflowRunPayload {
  action: 'completed' | 'requested' | 'in_progress';
  workflow_run: {
    id: number;
    name: string;
    head_sha: string;
    head_branch: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'neutral' | null;
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
  payload: WorkflowRunPayload
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
  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
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

    const ciStatus: CiStatus = {
      status: mapCiStatus(run.status, run.conclusion),
      workflowName: run.name,
      conclusion: run.conclusion ?? undefined,
      url: run.html_url,
    };

    // Update CI status in DB
    db.updateCiStatus(repo, pr.number, ciStatus.status, run.name, run.html_url);
    console.log(`[repo-relay] Updated CI status to ${ciStatus.status}`);

    const message = await channel.messages.fetch(existing.messageId);
    console.log(`[repo-relay] Fetched Discord message`);

    // Rebuild and edit the embed with updated status
    const statusData = buildEmbedWithStatus(db, repo, pr.number);
    if (statusData) {
      console.log(`[repo-relay] Rebuilding embed with CI: ${statusData.ci.status}`);
      const embed = buildPrEmbed(statusData.prData, statusData.ci, statusData.reviews);
      await withRetry(() => message.edit({ embeds: [embed] }));
      console.log(`[repo-relay] Embed updated successfully`);

      // Only post to thread for completed runs
      if (payload.action === 'completed') {
        const thread = await getOrCreateThread(channel, db, repo, statusData.prData, existing);
        const reply = buildCiReply(ciStatus);
        await withRetry(() => thread.send(reply));
        console.log(`[repo-relay] Posted CI update to thread`);
        db.updatePrMessageTimestamp(repo, pr.number);
      }
    } else {
      console.log(`[repo-relay] No PR data found, cannot rebuild embed`);
    }
  }
}

function mapCiStatus(
  status: WorkflowRunPayload['workflow_run']['status'],
  conclusion: WorkflowRunPayload['workflow_run']['conclusion']
): CiStatus['status'] {
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
