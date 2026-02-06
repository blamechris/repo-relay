/**
 * Discord embed builders for various notification types
 */

import { EmbedBuilder, Colors } from 'discord.js';

export interface PrData {
  number: number;
  title: string;
  url: string;
  author: string;
  authorUrl: string;
  authorAvatar?: string;
  branch: string;
  baseBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  body?: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  createdAt: string;
  mergedAt?: string;
  mergedBy?: string;
}

export interface CiStatus {
  status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
  workflowName?: string;
  conclusion?: string;
  url?: string;
}

export interface ReviewStatus {
  copilot: 'pending' | 'reviewed';
  copilotComments?: number;
  agentReview: 'pending' | 'approved' | 'changes_requested' | 'none';
}

export function buildPrEmbed(
  pr: PrData,
  ci?: CiStatus,
  reviews?: ReviewStatus
): EmbedBuilder {
  const emoji = getPrEmoji(pr.state, pr.draft);
  const stateLabel = getPrStateLabel(pr.state, pr.draft);

  const embed = new EmbedBuilder()
    .setColor(getPrColor(pr.state, pr.draft))
    .setTitle(truncateTitle(`${emoji} PR #${pr.number}: ${pr.title}${stateLabel}`))
    .setURL(pr.url)
    .setAuthor({
      name: pr.author,
      iconURL: pr.authorAvatar,
      url: pr.authorUrl,
    })
    .addFields(
      {
        name: 'Branch',
        value: `\`${pr.branch}\` → \`${pr.baseBranch}\``,
        inline: true,
      },
      {
        name: 'Changes',
        value: `${pr.changedFiles} files (+${pr.additions}, -${pr.deletions})`,
        inline: true,
      }
    )
    .setTimestamp(new Date(pr.createdAt));

  // Add reviews section
  const reviewLines: string[] = [];
  if (reviews) {
    const copilotStatus =
      reviews.copilot === 'reviewed'
        ? `✅ Reviewed (${reviews.copilotComments ?? 0} comments)`
        : '⏳ Pending';
    reviewLines.push(`• Copilot: ${copilotStatus}`);

    const agentStatus = getAgentReviewStatus(reviews.agentReview);
    reviewLines.push(`• Agent Review: ${agentStatus}`);
  } else {
    reviewLines.push('• Copilot: ⏳ Pending');
    reviewLines.push('• Agent Review: ⏳ Pending');
  }

  embed.addFields({
    name: '📋 Reviews',
    value: reviewLines.join('\n'),
    inline: false,
  });

  // Add CI section
  const ciStatus = ci ? getCiStatusText(ci) : '⏳ Pending';
  embed.addFields({
    name: '🔄 CI',
    value: ciStatus,
    inline: false,
  });

  // Add merged info if applicable
  if (pr.state === 'merged' && pr.mergedAt) {
    embed.addFields({
      name: 'Merged',
      value: `${pr.mergedBy ? `by @${pr.mergedBy} ` : ''}on ${new Date(pr.mergedAt).toLocaleString()}`,
      inline: false,
    });
  }

  return embed;
}

export function buildPushReply(
  commitCount: number,
  author: string,
  sha: string,
  compareUrl?: string
): string {
  const shaShort = sha.substring(0, 7);
  const link = compareUrl ? `[${shaShort}](${compareUrl})` : shaShort;
  const plural = commitCount === 1 ? 'commit' : 'commits';
  return `📤 Push: ${commitCount} ${plural} by @${author} (${link})`;
}

export function buildCiReply(ci: CiStatus): string {
  const status = getCiStatusText(ci);
  return `🔄 CI: ${status}`;
}

export function buildReviewReply(
  type: 'copilot' | 'agent',
  status: string,
  comments?: number,
  url?: string
): string {
  if (type === 'copilot') {
    const commentText = comments ? ` (${comments} comments)` : '';
    return `🤖 Copilot reviewed${commentText}`;
  } else {
    const statusEmoji = status === 'approved' ? '✅' : '⚠️';
    const link = url ? ` [View](${url})` : '';
    return `🔍 Agent review: ${statusEmoji} ${capitalize(status)}${link}`;
  }
}

export function buildMergedReply(mergedBy?: string): string {
  const byText = mergedBy ? ` by @${mergedBy}` : '';
  return `🎉 Merged to main${byText}!`;
}

export function buildClosedReply(closedBy?: string): string {
  const byText = closedBy ? ` by @${closedBy}` : '';
  return `🚫 Closed without merging${byText}`;
}

export interface IssueData {
  number: number;
  title: string;
  url: string;
  author: string;
  authorAvatar?: string;
  state: 'open' | 'closed';
  stateReason?: string | null;
  labels: string[];
  body?: string;
  createdAt: string;
}

export function buildIssueEmbed(issue: IssueData): EmbedBuilder {
  const emoji = issue.state === 'open' ? '🟢' : '🟣';
  const stateLabel = getIssueStateLabel(issue.state, issue.stateReason);

  const embed = new EmbedBuilder()
    .setColor(issue.state === 'open' ? Colors.Green : Colors.Purple)
    .setTitle(truncateTitle(`${emoji} Issue #${issue.number}: ${issue.title}${stateLabel}`))
    .setURL(issue.url)
    .setAuthor({
      name: issue.author,
      iconURL: issue.authorAvatar,
    })
    .setTimestamp(new Date(issue.createdAt));

  if (issue.labels.length > 0) {
    embed.addFields({
      name: 'Labels',
      value: issue.labels.map((l) => `\`${l}\``).join(' '),
      inline: false,
    });
  }

  if (issue.body && issue.body.length > 0) {
    const truncated = issue.body.length > 200 ? issue.body.substring(0, 197) + '...' : issue.body;
    embed.setDescription(truncated);
  }

  return embed;
}

export function buildIssueClosedReply(closedBy?: string, stateReason?: string | null): string {
  const byText = closedBy ? ` by @${closedBy}` : '';
  if (stateReason === 'not_planned') {
    return `🟣 Closed as not planned${byText}`;
  }
  return `🟣 Closed${byText}`;
}

export function buildIssueReopenedReply(reopenedBy?: string): string {
  const byText = reopenedBy ? ` by @${reopenedBy}` : '';
  return `🟢 Reopened${byText}`;
}

export function buildReleaseEmbed(
  name: string,
  tagName: string,
  url: string,
  author: string,
  authorAvatar: string | undefined,
  body?: string,
  prerelease?: boolean
): EmbedBuilder {
  const emoji = prerelease ? '🧪' : '🚀';
  const label = prerelease ? ' [PRE-RELEASE]' : '';

  const embed = new EmbedBuilder()
    .setColor(prerelease ? Colors.Yellow : Colors.Blue)
    .setTitle(truncateTitle(`${emoji} Release: ${name}${label}`))
    .setURL(url)
    .setAuthor({
      name: author,
      iconURL: authorAvatar,
    })
    .addFields({
      name: 'Tag',
      value: `\`${tagName}\``,
      inline: true,
    });

  if (body && body.length > 0) {
    const truncated = body.length > 500 ? body.substring(0, 497) + '...' : body;
    embed.setDescription(truncated);
  }

  return embed;
}

// Helper functions

function getPrEmoji(state: 'open' | 'closed' | 'merged', draft: boolean): string {
  if (draft) return '📝';
  switch (state) {
    case 'open':
      return '🔀';
    case 'merged':
      return '✅';
    case 'closed':
      return '🚫';
  }
}

function getPrStateLabel(
  state: 'open' | 'closed' | 'merged',
  draft: boolean
): string {
  if (draft) return ' [DRAFT]';
  if (state === 'merged') return ' [MERGED]';
  if (state === 'closed') return ' [CLOSED]';
  return '';
}

function getPrColor(
  state: 'open' | 'closed' | 'merged',
  draft: boolean
): number {
  if (draft) return Colors.Grey;
  switch (state) {
    case 'open':
      return Colors.Green;
    case 'merged':
      return Colors.Purple;
    case 'closed':
      return Colors.Red;
  }
}

function getAgentReviewStatus(status: ReviewStatus['agentReview']): string {
  switch (status) {
    case 'approved':
      return '✅ Approved';
    case 'changes_requested':
      return '⚠️ Changes Requested';
    case 'pending':
      return '⏳ Pending';
    case 'none':
      return '—';
  }
}

function getCiStatusText(ci: CiStatus): string {
  const name = ci.workflowName ? ` (${ci.workflowName})` : '';
  const link = ci.url ? ` [View](${ci.url})` : '';

  switch (ci.status) {
    case 'pending':
      return `⏳ Pending${name}`;
    case 'running':
      return `🔄 Running...${name}${link}`;
    case 'success':
      return `✅ Passed${name}${link}`;
    case 'failure':
      return `❌ Failed${name}${link}`;
    case 'cancelled':
      return `⚪ Cancelled${name}`;
  }
}

function getIssueStateLabel(state: 'open' | 'closed', stateReason?: string | null): string {
  if (state === 'closed') {
    return stateReason === 'not_planned' ? ' [NOT PLANNED]' : ' [CLOSED]';
  }
  return '';
}

function truncateTitle(title: string): string {
  return title.length > 256 ? title.substring(0, 255) + '…' : title;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
