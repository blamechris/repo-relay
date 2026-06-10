/**
 * Pull Request event handler
 */

import { Client, Message, TextChannel, ThreadChannel } from 'discord.js';
import { StateDb, PrMessage } from '../db/state.js';
import { buildPrEmbed, buildPrComponents, buildMergedReply, buildClosedReply, buildPushReply, buildThreadName, PrData, ReviewStatus, CiStatus } from '../embeds/builders.js';
import { getChannelForEvent, ChannelConfig } from '../config/channels.js';
import { getExistingPrMessage } from '../discord/lookup.js';
import { getOrCreateMessageThread } from '../discord/threads.js';
import { withRetry } from '../utils/retry.js';
import { isUnknownMessageError } from '../utils/discord-errors.js';

// Re-exported for compatibility (historically defined here)
export { fetchAndUnarchiveThread } from '../discord/threads.js';

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
    } | null;
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

  const channel = await withRetry(() => client.channels.fetch(channelId));
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }

  // Log the event
  db.logEvent(repo, pr.number, `pr.${action}`, payload);

  const user = pr.user ?? { login: 'ghost', html_url: 'https://github.com/ghost', avatar_url: '' };

  const prData: PrData = {
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    author: user.login,
    authorUrl: user.html_url,
    // Empty string is rejected by EmbedBuilder.setAuthor's iconURL validation
    // (the ghost fallback has no avatar) — omit instead
    authorAvatar: user.avatar_url || undefined,
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
  // Idempotency: workflow re-runs, webhook redeliveries, and close→reopen
  // cycles all route here — reuse the existing embed instead of creating a
  // duplicate (which would orphan the original message and thread forever)
  const existing = await getExistingPrMessage(db, channel, repo, pr.number);
  if (existing) {
    try {
      const message = await withRetry(() => channel.messages.fetch(existing.messageId));
      savePrDataFromPrData(db, repo, pr);
      db.savePrStatus(repo, pr.number);
      const statusData = buildEmbedWithStatus(db, repo, pr.number);
      const embed = statusData
        ? buildPrEmbed(statusData.prData, statusData.ci, statusData.reviews)
        : buildPrEmbed(pr);
      const components = [buildPrComponents(pr.url, statusData?.ci.url)];
      await withRetry(() => message.edit({ embeds: [embed], components }));
      db.updatePrMessageTimestamp(repo, pr.number);
      return;
    } catch (error: unknown) {
      // Message was deleted from Discord - clear stale DB entry
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('Unknown Message')) {
        console.log(`[repo-relay] Stale message for PR #${pr.number}, creating new one`);
        db.deletePrMessage(repo, pr.number);
      } else {
        throw error;
      }
    }
  }

  await createPrMessageWithThread(channel, db, repo, pr);
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
      const messageId = existing.messageId;
      const message = await withRetry(() => channel.messages.fetch(messageId));
      savePrDataFromPrData(db, repo, pr);
      const statusData = buildEmbedWithStatus(db, repo, pr.number);
      const embed = statusData
        ? buildPrEmbed(statusData.prData, statusData.ci, statusData.reviews)
        : buildPrEmbed(pr);
      const components = [buildPrComponents(pr.url, statusData?.ci.url)];
      await withRetry(() => message.edit({ embeds: [embed], components }));

      // Post to thread
      const thread = await getOrCreateThread(channel, db, repo, pr, existing);
      const reply = pr.state === 'merged'
        ? buildMergedReply(pr.mergedBy, pr.baseBranch)
        : buildClosedReply();

      await withRetry(() => thread.send(reply));
      db.updatePrMessageTimestamp(repo, pr.number);
      return;
    } catch (error: unknown) {
      // Message was deleted from Discord - clear stale DB entry
      if (isUnknownMessageError(error)) {
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
    await createPrMessageWithThread(channel, db, repo, pr, { seedThread: false });
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
      const messageId = existing.messageId;
      await withRetry(() => channel.messages.fetch(messageId));
    } catch (error: unknown) {
      if (isUnknownMessageError(error)) {
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
    const { message, thread } = await createPrMessageWithThread(channel, db, repo, pr);
    existing = { repo, prNumber: pr.number, channelId: channel.id, messageId: message.id, threadId: thread.id, createdAt: '', lastUpdated: '' };
  } else {
    // Update PR data for future rebuilds
    savePrDataFromPrData(db, repo, pr);
  }

  // Get or create thread
  const thread = await getOrCreateThread(channel, db, repo, pr, existing);

  const sha = payload.after ?? payload.pull_request.head.sha;

  const replyText = buildPushReply(
    payload.sender.login,
    sha,
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
      const messageId = existing.messageId;
      const message = await withRetry(() => channel.messages.fetch(messageId));
      savePrDataFromPrData(db, repo, pr);
      const statusData = buildEmbedWithStatus(db, repo, pr.number);
      const embed = statusData
        ? buildPrEmbed(statusData.prData, statusData.ci, statusData.reviews)
        : buildPrEmbed(pr);
      const components = [buildPrComponents(pr.url, statusData?.ci.url)];
      await withRetry(() => message.edit({ embeds: [embed], components }));
      db.updatePrMessageTimestamp(repo, pr.number);
      return;
    } catch (error: unknown) {
      if (isUnknownMessageError(error)) {
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
    await createPrMessageWithThread(channel, db, repo, pr);
  }
}

/**
 * Send a fresh PR embed, attach its updates thread, and persist the
 * message/data/status rows. Pass `seedThread: false` to skip the initial
 * thread message (e.g. closed PRs that get no further updates).
 */
async function createPrMessageWithThread(
  channel: TextChannel,
  db: StateDb,
  repo: string,
  pr: PrData,
  options: { seedThread?: boolean } = {}
): Promise<{ message: Message; thread: ThreadChannel }> {
  const embed = buildPrEmbed(pr);
  const components = [buildPrComponents(pr.url)];
  const message = await withRetry(() => channel.send({ embeds: [embed], components }));

  // Create a thread for updates
  const thread = await withRetry(() => message.startThread({
    name: buildThreadName('PR', pr.number, pr.title),
    autoArchiveDuration: 1440, // 24 hours
  }));

  db.savePrMessage(repo, pr.number, channel.id, message.id, thread.id);

  // Save PR data for future embed rebuilding
  savePrDataFromPrData(db, repo, pr);
  db.savePrStatus(repo, pr.number);

  if (options.seedThread !== false) {
    // Post initial message in thread
    await withRetry(() => thread.send(`📋 Updates for PR #${pr.number} will appear here.`));
  }

  return { message, thread };
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
  return getOrCreateMessageThread(
    channel,
    existing,
    buildThreadName('PR', pr.number, pr.title),
    `📋 Updates for PR #${pr.number} will appear here.`,
    (threadId) => db.updatePrThread(repo, pr.number, threadId)
  );
}
