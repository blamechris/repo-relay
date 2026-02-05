/**
 * Issue event handler
 */

import { Client, TextChannel } from 'discord.js';
import { StateDb } from '../db/state.js';
import { buildIssueEmbed } from '../embeds/builders.js';
import { getChannelForEvent, ChannelConfig } from '../config/channels.js';

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
    labels: Array<{
      name: string;
    }>;
    body: string | null;
    created_at: string;
  };
  repository: {
    full_name: string;
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

  // Only notify for opened and closed
  if (action !== 'opened' && action !== 'closed') {
    return;
  }

  const channelId = getChannelForEvent(channelConfig, 'issue');
  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }

  db.logEvent(repo, null, `issue.${action}`, payload);

  const embed = buildIssueEmbed(
    issue.number,
    issue.title,
    issue.html_url,
    issue.user.login,
    issue.user.avatar_url,
    issue.state,
    issue.labels.map((l) => l.name),
    issue.body ?? undefined
  );

  await channel.send({ embeds: [embed] });
}
