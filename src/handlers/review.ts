/**
 * Review event handler (Copilot and agent-review detection)
 */

import { Client, TextChannel } from 'discord.js';
import { StateDb } from '../db/state.js';
import { buildReviewReply } from '../embeds/builders.js';
import { getChannelForEvent, ChannelConfig } from '../config/channels.js';
import { updatePrEmbedAndNotify } from './pr.js';
import { getExistingPrMessage } from '../discord/lookup.js';
import { withRetry } from '../utils/retry.js';

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
    /** Reviewer's relationship to the repository (per webhook payload docs). */
    author_association:
      | 'OWNER'
      | 'MEMBER'
      | 'COLLABORATOR'
      | 'CONTRIBUTOR'
      | 'FIRST_TIME_CONTRIBUTOR'
      | 'FIRST_TIMER'
      | 'MANNEQUIN'
      | 'NONE';
  };
  pull_request: {
    number: number;
  };
  repository: {
    full_name: string;
    owner: {
      login: string;
    };
  };
}

/**
 * Associations whose `commented` reviews are cascade noise (#13, #146):
 * replying to inline review comments fires another pull_request_review event
 * with state 'commented'. Keyed on author_association so the filter works on
 * both personal repos (OWNER) and org-owned repos (MEMBER/COLLABORATOR),
 * where the old repo-owner login comparison never matched a human reviewer.
 */
export const CASCADE_REVIEW_ASSOCIATIONS: ReadonlySet<string> = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
]);

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

  // Skip collaborator comment replies to prevent notification cascades (#13)
  // The Bot-type guard keeps Copilot reviews (state 'commented') flowing
  // regardless of the bot's association.
  const isCascadeComment =
    review.state === 'commented' &&
    review.user.type === 'User' &&
    CASCADE_REVIEW_ASSOCIATIONS.has(review.author_association);
  if (isCascadeComment) {
    return;
  }

  const channelId = getChannelForEvent(channelConfig, 'review');
  const channel = await withRetry(() => client.channels.fetch(channelId));
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }

  db.logEvent(repo, pr.number, `review.${action}`, payload);

  const existing = await getExistingPrMessage(db, channel, repo, pr.number);
  if (!existing) {
    return;
  }

  // Detect Copilot review
  const isCopilot =
    review.user.type === 'Bot' &&
    review.user.login.toLowerCase().includes('copilot');

  if (isCopilot) {
    const result = await updatePrEmbedAndNotify(
      channel, db, repo, pr.number, existing,
      buildReviewReply('copilot', 'reviewed', undefined, review.html_url),
      // Update status in DB
      () => db.updateCopilotStatus(repo, pr.number, 'reviewed', 0)
    );
    if (!result.stale) {
      db.updatePrMessageTimestamp(repo, pr.number);
    }
    return;
  }

  // Human reviews (#146): a person's approved/changes_requested verdict gets
  // the same treatment as bot reviews — thread reply + embed status update.
  // 'commented' reviews carry no verdict and stay ignored; other bots too.
  if (review.user.type !== 'User') {
    return;
  }
  if (review.state !== 'approved' && review.state !== 'changes_requested') {
    return;
  }
  const verdict = review.state;

  const result = await updatePrEmbedAndNotify(
    channel, db, repo, pr.number, existing,
    buildReviewReply('human', verdict, undefined, review.html_url, review.user.login),
    // Update status in DB so the rebuilt embed reflects the verdict
    () => db.updateHumanReviewStatus(repo, pr.number, verdict, review.user.login)
  );
  if (!result.stale) {
    db.updatePrMessageTimestamp(repo, pr.number);
  }
}
