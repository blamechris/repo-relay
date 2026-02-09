/**
 * Pull Request event handler
 */

import { Client, TextChannel, ThreadChannel, ChannelType } from 'discord.js';
import { StateDb, StoredPrData, PrMessage } from '../db/state.js';
import { buildPrEmbed, buildMergedReply, buildClosedReply, buildPushReply, PrData, ReviewStatus, CiStatus } from '../embeds/builders.js';
import { getChannelForEvent, ChannelConfig } from '../config/channels.js';
import { getExistingPrMessage } from '../discord/lookup.js';
import { withRetry } from '../utils/retry.js';

export interface PrEventPayload {
  action: 'opened' | 'closed' | 'reopened' | 'synchronize' | 'edited' | 'ready_for_review' | 'converted_to_draft';
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    user: {
      login: string;
      html_url: string;
      avatar_url: string;
    };
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
    };
    additions: number;
    deletions: number;
    changed_files: number;
    body: string | null;
    state: 'open' | 'closed';
    draft: boolean;
    merged: boolean;
    merged_at: string | null;
    merged_by?: {
      login: string;
    };
    created_at: string;
  };
  repository: {
    full_name: string;
  };
  sender: {
    login: string;
  };
  before?: string;
  after?: string;
}

export async function handlePrEvent(
  client: Client,
  db: StateDb,
  channelConfig: ChannelConfig,
  payload: PrEventPayload
): Promise<void> {
  const { action, pull_request: pr, repository } = payload;
  const repo = repository.full_name;
  const channelId = getChannelForEvent(channelConfig, 'pr');

  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }

  // Log the event
  db.logEvent(repo, pr.number, `pr.${action}`, payload);

  const prData: PrData = {
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    author: pr.user.login,
    authorUrl: pr.user.html_url,
    authorAvatar: pr.user.avatar_url,
    branch: pr.head.ref,
    baseBranch: pr.base.ref,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    body: pr.body ?? undefined,
    state: pr.merged ? 'merged' : pr.state,
    draft: pr.draft,
    createdAt: pr.created_at,
    mergedAt: pr.merged_at ?? undefined,
    mergedBy: pr.merged_by?.login,
  };

  switch (action) {
    case 'opened':
    case 'reopened':
      await handlePrOpened(channel, db, repo, prData);
      break;

    case 'closed':
      await handlePrClosed(channel, db, repo, prData);
      break;

    case 'synchronize':
      await handlePrPush(channel, db, repo, prData, payload);
      break;

    case 'edited':
    case 'ready_for_review':
    case 'converted_to_draft':
      await handlePrUpdated(channel, db, repo, prData);
      break;
  }
}

async function handlePrOpened(
  channel: TextChannel,
  db: StateDb,
  repo: string,
  pr: PrData
): Promise<void> {
  const embed = buildPrEmbed(pr);
  const message = await withRetry(() => channel.send({ embeds: [embed] }));

  // Create a thread for updates
  const thread = await withRetry(() => message.startThread({
    name: `PR #${pr.number}: ${pr.title.substring(0, 90)}`,
    autoArchiveDuration: 1440, // 24 hours
  }));

  db.savePrMessage(repo, pr.number, channel.id, message.id, thread.id);

  // Save PR data for future embed rebuilding
  savePrDataFromPrData(db, repo, pr);
  db.savePrStatus(repo, pr.number);

  // Post initial message in thread
  await withRetry(() => thread.send(`📋 Updates for PR #${pr.number} will appear here.`));
}

async function handlePrClosed(
  channel: TextChannel,
  db: StateDb,
  repo: string,
  pr: PrData
): Promise<void> {
  let existing = await getExistingPrMessage(db, channel, repo, pr.number);

  if (existing) {
    try {
      // Update the original embed with full status
      const message = await channel.messages.fetch(existing.messageId);
      savePrDataFromPrData(db, repo, pr);
      const statusData = buildEmbedWithStatus(db, repo, pr.number);
      const embed = statusData
        ? buildPrEmbed(statusData.prData, statusData.ci, statusData.reviews)
        : buildPrEmbed(pr);
      await withRetry(() => message.edit({ embeds: [embed] }));

      // Post to thread
      const thread = await getOrCreateThread(channel, db, repo, pr, existing);
      const reply = pr.state === 'merged'
        ? buildMergedReply(pr.mergedBy)
        : buildClosedReply();

      await withRetry(() => thread.send(reply));
      db.updatePrMessageTimestamp(repo, pr.number);
      return;
    } catch (error: unknown) {
      // Message was deleted from Discord - clear stale DB entry
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('Unknown Message')) {
        console.log(`[repo-relay] Stale message for PR #${pr.number}, creating new one`);
        db.deletePrMessage(repo, pr.number);
        existing = null;
      } else {
        throw error;
      }
    }
  }

  if (!existing) {
    // No existing message, create one showing the final state
    const embed = buildPrEmbed(pr);
    const message = await withRetry(() => channel.send({ embeds: [embed] }));

    // Create a thread
    const thread = await withRetry(() => message.startThread({
      name: `PR #${pr.number}: ${pr.title.substring(0, 90)}`,
      autoArchiveDuration: 1440,
    }));

    db.savePrMessage(repo, pr.number, channel.id, message.id, thread.id);
    savePrDataFromPrData(db, repo, pr);
    db.savePrStatus(repo, pr.number);
  }
}

async function handlePrPush(
  channel: TextChannel,
  db: StateDb,
  repo: string,
  pr: PrData,
  payload: PrEventPayload
): Promise<void> {
  let existing = await getExistingPrMessage(db, channel, repo, pr.number);

  // Check if existing message is stale (deleted from Discord)
  if (existing) {
    try {
      await channel.messages.fetch(existing.messageId);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('Unknown Message')) {
        console.log(`[repo-relay] Stale message for PR #${pr.number}, creating new one`);
        db.deletePrMessage(repo, pr.number);
        existing = null;
      } else {
        throw error;
      }
    }
  }

  // If no message exists yet (PR opened before bot was set up), create one
  if (!existing) {
    const embed = buildPrEmbed(pr);
    const message = await withRetry(() => channel.send({ embeds: [embed] }));

    // Create a thread for updates
    const thread = await withRetry(() => message.startThread({
      name: `PR #${pr.number}: ${pr.title.substring(0, 90)}`,
      autoArchiveDuration: 1440,
    }));

    db.savePrMessage(repo, pr.number, channel.id, message.id, thread.id);
    savePrDataFromPrData(db, repo, pr);
    db.savePrStatus(repo, pr.number);
    existing = { repo, prNumber: pr.number, channelId: channel.id, messageId: message.id, threadId: thread.id, createdAt: '', lastUpdated: '' };

    await withRetry(() => thread.send(`📋 Updates for PR #${pr.number} will appear here.`));
  } else {
    // Update PR data for future rebuilds
    savePrDataFromPrData(db, repo, pr);
  }

  // Get or create thread
  const thread = await getOrCreateThread(channel, db, repo, pr, existing);

  // Count commits (if before/after available, otherwise assume 1)
  const commitCount = 1; // GitHub doesn't provide commit count directly in synchronize

  const replyText = buildPushReply(
    commitCount,
    payload.sender.login,
    pr.branch,
    `${pr.url}/commits`
  );

  await withRetry(() => thread.send(replyText));
  db.updatePrMessageTimestamp(repo, pr.number);
}

async function handlePrUpdated(
  channel: TextChannel,
  db: StateDb,
  repo: string,
  pr: PrData
): Promise<void> {
  let existing = await getExistingPrMessage(db, channel, repo, pr.number);

  if (existing) {
    try {
      const message = await channel.messages.fetch(existing.messageId);
      const embed = buildPrEmbed(pr);
      await withRetry(() => message.edit({ embeds: [embed] }));
      db.updatePrMessageTimestamp(repo, pr.number);
      savePrDataFromPrData(db, repo, pr);
      return;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('Unknown Message')) {
        console.log(`[repo-relay] Stale message for PR #${pr.number}, creating new one`);
        db.deletePrMessage(repo, pr.number);
        existing = null;
      } else {
        throw error;
      }
    }
  }

  if (!existing) {
    // No message exists yet (PR opened before bot was set up), create one
    const embed = buildPrEmbed(pr);
    const message = await withRetry(() => channel.send({ embeds: [embed] }));

    // Create a thread for updates
    const thread = await withRetry(() => message.startThread({
      name: `PR #${pr.number}: ${pr.title.substring(0, 90)}`,
      autoArchiveDuration: 1440,
    }));

    db.savePrMessage(repo, pr.number, channel.id, message.id, thread.id);
    savePrDataFromPrData(db, repo, pr);
    db.savePrStatus(repo, pr.number);

    await withRetry(() => thread.send(`📋 Updates for PR #${pr.number} will appear here.`));
  }
}

// Helper to save PR data from PrData interface
function savePrDataFromPrData(db: StateDb, repo: string, pr: PrData): void {
  db.savePrData({
    repo,
    prNumber: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.author,
    authorUrl: pr.authorUrl,
    authorAvatar: pr.authorAvatar ?? null,
    branch: pr.branch,
    baseBranch: pr.baseBranch,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    state: pr.state,
    draft: pr.draft,
    prCreatedAt: pr.createdAt,
  });
}

// Helper to rebuild embed with current status from DB
export function buildEmbedWithStatus(db: StateDb, repo: string, prNumber: number): { prData: PrData; reviews: ReviewStatus; ci: CiStatus } | null {
  const stored = db.getPrData(repo, prNumber);
  if (!stored) return null;

  const status = db.getPrStatus(repo, prNumber);

  const prData: PrData = {
    number: stored.prNumber,
    title: stored.title,
    url: stored.url,
    author: stored.author,
    authorUrl: stored.authorUrl,
    authorAvatar: stored.authorAvatar ?? undefined,
    branch: stored.branch,
    baseBranch: stored.baseBranch,
    additions: stored.additions,
    deletions: stored.deletions,
    changedFiles: stored.changedFiles,
    state: stored.state as 'open' | 'closed' | 'merged',
    draft: stored.draft,
    createdAt: stored.prCreatedAt,
  };

  const reviews: ReviewStatus = {
    copilot: status?.copilotStatus ?? 'pending',
    copilotComments: status?.copilotComments ?? 0,
    agentReview: status?.agentReviewStatus ?? 'pending',
  };

  const ci: CiStatus = {
    status: status?.ciStatus ?? 'pending',
    workflowName: status?.ciWorkflowName ?? undefined,
    url: status?.ciUrl ?? undefined,
  };

  return { prData, reviews, ci };
}

// Helper to get existing thread or create one if it doesn't exist
export async function getOrCreateThread(
  channel: TextChannel,
  db: StateDb,
  repo: string,
  pr: PrData,
  existing: PrMessage
): Promise<ThreadChannel> {
  // If we have a thread ID, try to fetch it
  if (existing.threadId) {
    try {
      const thread = await channel.threads.fetch(existing.threadId);
      if (thread) {
        // Unarchive if archived
        if (thread.archived) {
          await withRetry(() => thread.setArchived(false) as Promise<ThreadChannel>);
        }
        return thread;
      }
    } catch {
      // Thread doesn't exist or was deleted, create a new one
    }
  }

  // Create a new thread on the message
  const message = await channel.messages.fetch(existing.messageId);
  const thread = await withRetry(() =>
    message.startThread({
      name: `PR #${pr.number}: ${pr.title.substring(0, 90)}`,
      autoArchiveDuration: 1440,
    })
  ) as ThreadChannel;

  // Update the database with the new thread ID
  db.updatePrThread(repo, pr.number, thread.id);

  await withRetry(() => thread.send(`📋 Updates for PR #${pr.number} will appear here.`));

  return thread;
}
