/**
 * Release event handler
 */

import { Client, TextChannel } from 'discord.js';
import { StateDb } from '../db/state.js';
import { buildReleaseEmbed } from '../embeds/builders.js';
import { getChannelForEvent, ChannelConfig } from '../config/channels.js';
import { withRetry } from '../utils/retry.js';

export interface ReleaseEventPayload {
  action: 'published' | 'created' | 'edited' | 'deleted';
  release: {
    id: number;
    name: string | null;
    tag_name: string;
    html_url: string;
    author: {
      login: string;
      avatar_url: string;
    };
    body: string | null;
    prerelease: boolean;
    draft: boolean;
    published_at: string;
  };
  repository: {
    full_name: string;
  };
}

export async function handleReleaseEvent(
  client: Client,
  db: StateDb,
  channelConfig: ChannelConfig,
  payload: ReleaseEventPayload
): Promise<void> {
  const { action, release, repository } = payload;
  const repo = repository.full_name;

  // Only notify for published (not drafts)
  if (action !== 'published' || release.draft) {
    return;
  }

  const channelId = getChannelForEvent(channelConfig, 'release');
  const channel = await withRetry(() => client.channels.fetch(channelId));
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }

  db.logEvent(repo, null, `release.${action}`, payload);

  const embed = buildReleaseEmbed(
    release.name ?? release.tag_name,
    release.tag_name,
    release.html_url,
    release.author.login,
    release.author.avatar_url,
    release.body ?? undefined,
    release.prerelease
  );

  await withRetry(() => channel.send({ embeds: [embed] }));
}
