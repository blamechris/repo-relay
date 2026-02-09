/**
 * Issue event handler with threaded embed lifecycle
 */

import { Client, TextChannel, ThreadChannel } from 'discord.js';
import { StateDb, IssueMessage } from '../db/state.js';
import { buildIssueEmbed, buildIssueClosedReply, buildIssueReopenedReply, IssueData } from '../embeds/builders.js';
import { getChannelForEvent, ChannelConfig } from '../config/channels.js';
import { getExistingIssueMessage } from '../discord/lookup.js';
import { withRetry } from '../utils/retry.js';

export interface IssueEventPayload {
  action: 'opened' | 'closed' | 'reopened' | 'labeled' | 'unlabeled' | 'edited';
  issue: {
    number: number;
    title: string;
    html_url: string;
    user: {
      login: string;
      avatar_url: string;
    };
    state: 'open' | 'closed';
    state_reason?: 'completed' | 'not_planned' | 'reopened' | null;
    labels: Array<{
      name: string;
    }>;
    body: string | null;
    created_at: string;
  };
  repository: {
    full_name: string;
  };
  sender: {
    login: string;
  };
  label?: {
    name: string;
  };
}

export async function handleIssueEvent(
  client: Client,
  db: StateDb,
  channelConfig: ChannelConfig,
  payload: IssueEventPayload
): Promise<void> {
  const { action, issue, repository } = payload;
  const repo = repository.full_name;

  const issueData: IssueData = {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    author: issue.user.login,
    authorAvatar: issue.user.avatar_url,
    state: issue.state,
    stateReason: issue.state_reason ?? null,
    labels: issue.labels.map((l) => l.name),
    body: issue.body ?? undefined,
    createdAt: issue.created_at,
  };

  const channelId = getChannelForEvent(channelConfig, 'issue');
  const channel = await withRetry(() => client.channels.fetch(channelId));
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }

  db.logEvent(repo, issue.number, `issue.${action}`, payload);

  switch (action) {
    case 'opened':
      await handleIssueOpened(channel, db, repo, issueData);
      break;

    case 'closed':
      await handleIssueStateChange(
        channel, db, repo, issueData,
        buildIssueClosedReply(payload.sender.login, issueData.stateReason)
      );
      break;

    case 'reopened':
      await handleIssueStateChange(
        channel, db, repo, issueData,
        buildIssueReopenedReply(payload.sender.login)
      );
      break;

    case 'labeled':
    case 'unlabeled':
    case 'edited':
      // Phase 4 — will be handled in PR 3
      return;
  }
}

async function handleIssueOpened(
  channel: TextChannel,
  db: StateDb,
  repo: string,
  issue: IssueData
): Promise<void> {
  const embed = buildIssueEmbed(issue);
  const message = await withRetry(() => channel.send({ embeds: [embed] }));

  const thread = await withRetry(() => message.startThread({
    name: `Issue #${issue.number}: ${issue.title.substring(0, 90)}`,
    autoArchiveDuration: 1440,
  }));

  db.saveIssueMessage(repo, issue.number, channel.id, message.id, thread.id);
  saveIssueDataFromIssueData(db, repo, issue);

  await withRetry(() => thread.send(`📋 Updates for Issue #${issue.number} will appear here.`));
}

async function handleIssueStateChange(
  channel: TextChannel,
  db: StateDb,
  repo: string,
  issue: IssueData,
  replyText: string
): Promise<void> {
  const existing = await getExistingIssueMessage(db, channel, repo, issue.number);

  if (existing) {
    try {
      const message = await withRetry(() => channel.messages.fetch(existing.messageId));
      saveIssueDataFromIssueData(db, repo, issue);
      const embed = buildIssueEmbed(issue);
      await withRetry(() => message.edit({ embeds: [embed] }));

      const thread = await getOrCreateIssueThread(channel, db, repo, issue, existing);
      await withRetry(() => thread.send(replyText));
      db.updateIssueMessageTimestamp(repo, issue.number);
      return;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('Unknown Message')) {
        console.log(`[repo-relay] Stale message for Issue #${issue.number}, creating new one`);
        db.deleteIssueMessage(repo, issue.number);
      } else {
        throw error;
      }
    }
  }

  // No existing message (or stale message was cleared) — create new embed
  const embed = buildIssueEmbed(issue);
  const message = await withRetry(() => channel.send({ embeds: [embed] }));

  const thread = await withRetry(() => message.startThread({
    name: `Issue #${issue.number}: ${issue.title.substring(0, 90)}`,
    autoArchiveDuration: 1440,
  }));

  db.saveIssueMessage(repo, issue.number, channel.id, message.id, thread.id);
  saveIssueDataFromIssueData(db, repo, issue);
  await withRetry(() => thread.send(replyText));
  db.updateIssueMessageTimestamp(repo, issue.number);
}

function saveIssueDataFromIssueData(db: StateDb, repo: string, issue: IssueData): void {
  db.saveIssueData({
    repo,
    issueNumber: issue.number,
    title: issue.title,
    url: issue.url,
    author: issue.author,
    authorAvatar: issue.authorAvatar ?? null,
    state: issue.state,
    stateReason: issue.stateReason ?? null,
    labels: JSON.stringify(issue.labels),
    body: issue.body ?? null,
    issueCreatedAt: issue.createdAt,
  });
}

export async function getOrCreateIssueThread(
  channel: TextChannel,
  db: StateDb,
  repo: string,
  issue: IssueData,
  existing: IssueMessage
): Promise<ThreadChannel> {
  if (existing.threadId) {
    try {
      const threadId = existing.threadId;
      const thread = await withRetry(() => channel.threads.fetch(threadId));
      if (thread) {
        if (thread.archived) {
          await withRetry(async () => { await thread.setArchived(false); });
        }
        return thread;
      }
    } catch {
      // Thread doesn't exist or was deleted, create a new one
    }
  }

  const message = await withRetry(() => channel.messages.fetch(existing.messageId));
  const thread = await withRetry(() =>
    message.startThread({
      name: `Issue #${issue.number}: ${issue.title.substring(0, 90)}`,
      autoArchiveDuration: 1440,
    })
  );

  db.updateIssueThread(repo, issue.number, thread.id);

  await withRetry(() => thread.send(`📋 Updates for Issue #${issue.number} will appear here.`));

  return thread;
}
