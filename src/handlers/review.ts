/**
 * Review event handler (Copilot and agent-review detection)
 */

import { Client, TextChannel } from 'discord.js';
import { StateDb } from '../db/state.js';
import { buildReviewReply } from '../embeds/builders.js';
import { getChannelForEvent, ChannelConfig } from '../config/channels.js';

export interface PrReviewPayload {
  action: 'submitted' | 'edited' | 'dismissed';
  review: {
    id: number;
    user: {
      login: string;
      type: 'User' | 'Bot';
    };
    body: string | null;
    state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
    html_url: string;
  };
  pull_request: {
    number: number;
  };
  repository: {
    full_name: string;
  };
}

export async function handleReviewEvent(
  client: Client,
  db: StateDb,
  channelConfig: ChannelConfig,
  payload: PrReviewPayload
): Promise<void> {
  const { action, review, pull_request: pr, repository } = payload;
  const repo = repository.full_name;

  if (action !== 'submitted') {
    return;
  }

  const channelId = getChannelForEvent(channelConfig, 'review');
  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }

  db.logEvent(repo, pr.number, `review.${action}`, payload);

  const existing = db.getPrMessage(repo, pr.number);
  if (!existing) {
    return;
  }

  // Detect Copilot review
  const isCopilot =
    review.user.type === 'Bot' &&
    review.user.login.toLowerCase().includes('copilot');

  if (isCopilot) {
    const message = await channel.messages.fetch(existing.messageId);
    // Copilot typically posts comments, not approvals
    const reply = buildReviewReply('copilot', 'reviewed', undefined, review.html_url);
    await message.reply(reply);
    db.updatePrMessageTimestamp(repo, pr.number);
  }
}
