/**
 * Comment event handler (agent-review detection)
 */

import { Client, TextChannel } from 'discord.js';
import { StateDb } from '../db/state.js';
import { buildReviewReply, buildPrEmbed } from '../embeds/builders.js';
import { getChannelForEvent, ChannelConfig } from '../config/channels.js';
import { buildEmbedWithStatus, getOrCreateThread } from './pr.js';
import { getExistingPrMessage } from '../discord/lookup.js';
import { withRetry } from '../utils/retry.js';
import {
  AGENT_REVIEW_PATTERNS,
  APPROVED_PATTERNS,
  CHANGES_REQUESTED_PATTERNS,
} from '../patterns/agent-review.js';

export interface IssueCommentPayload {
  action: 'created' | 'edited' | 'deleted';
  comment: {
    id: number;
    user: {
      login: string;
      type: 'User' | 'Bot';
    };
    body: string;
    html_url: string;
    created_at: string;
  };
  issue: {
    number: number;
    pull_request?: {
      url: string;
    };
  };
  repository: {
    full_name: string;
  };
}


export async function handleCommentEvent(
  client: Client,
  db: StateDb,
  channelConfig: ChannelConfig,
  payload: IssueCommentPayload
): Promise<void> {
  const { action, comment, issue, repository } = payload;
  const repo = repository.full_name;

  // Only handle created comments on PRs
  if (action !== 'created' || !issue.pull_request) {
    return;
  }

  const prNumber = issue.number;
  const body = comment.body;

  // Check if this is an agent-review comment
  const isAgentReview = AGENT_REVIEW_PATTERNS.some((pattern) =>
    pattern.test(body)
  );

  if (!isAgentReview) {
    return;
  }

  const channelId = getChannelForEvent(channelConfig, 'review');
  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }

  db.logEvent(repo, prNumber, 'review.agent', payload);

  const existing = await getExistingPrMessage(db, channel, repo, prNumber);
  if (!existing) {
    return;
  }

  // Determine verdict
  let status: 'approved' | 'changes_requested' | 'pending' | 'none' = 'pending';
  if (APPROVED_PATTERNS.some((pattern) => pattern.test(body))) {
    status = 'approved';
  } else if (CHANGES_REQUESTED_PATTERNS.some((pattern) => pattern.test(body))) {
    status = 'changes_requested';
  }

  const message = await channel.messages.fetch(existing.messageId);

  // Update status in DB
  db.updateAgentReviewStatus(repo, prNumber, status);

  // Rebuild and edit the embed with updated status
  const statusData = buildEmbedWithStatus(db, repo, prNumber);
  if (statusData) {
    const embed = buildPrEmbed(statusData.prData, statusData.ci, statusData.reviews);
    await withRetry(() => message.edit({ embeds: [embed] }));

    // Post to thread
    const thread = await getOrCreateThread(channel, db, repo, statusData.prData, existing);
    const reply = buildReviewReply('agent', status, undefined, comment.html_url);
    await withRetry(() => thread.send(reply));
  }

  db.updatePrMessageTimestamp(repo, prNumber);
}
