/**
 * Repo Relay - GitHub-Discord Integration Bot
 *
 * Entry point for the bot library.
 */

import { Client, GatewayIntentBits, GuildChannel, PermissionsBitField, REST, Routes } from 'discord.js';
import { StateDb } from './db/state.js';
import { getChannelConfig, type ChannelConfig } from './config/channels.js';
import {
  handlePrEvent,
  handleCiEvent,
  handleReviewEvent,
  handleCommentEvent,
  handleIssueEvent,
  handleReleaseEvent,
  handleDeploymentEvent,
  handlePushEvent,
  handleSecurityAlertEvent,
  type PrEventPayload,
  type WorkflowRunPayload,
  type PrReviewPayload,
  type IssueCommentPayload,
  type IssueEventPayload,
  type ReleaseEventPayload,
  type DeploymentStatusPayload,
  type PushEventPayload,
  type DependabotAlertPayload,
  type SecretScanningAlertPayload,
  type CodeScanningAlertPayload,
  type SecurityAlertPayload,
} from './handlers/index.js';
import { checkForReviews } from './github/reviews.js';
import { safeErrorMessage } from './utils/errors.js';
import { REPO_NAME_PATTERN } from './utils/validation.js';
import { withRetry } from './utils/retry.js';
import { buildEmbedWithStatus } from './handlers/pr.js';
import { buildPrEmbed, buildPrComponents, buildReviewReply } from './embeds/builders.js';
import { TextChannel } from 'discord.js';
import { getChannelForEvent } from './config/channels.js';
import { getExistingPrMessage } from './discord/lookup.js';

export interface RepoRelayConfig {
  discordToken: string;
  githubToken?: string;
  channelConfig: ChannelConfig;
  stateDir?: string;
}

export type GitHubEventPayload =
  | { event: 'pull_request'; payload: PrEventPayload }
  | { event: 'workflow_run'; payload: WorkflowRunPayload }
  | { event: 'pull_request_review'; payload: PrReviewPayload }
  | { event: 'issue_comment'; payload: IssueCommentPayload }
  | { event: 'issues'; payload: IssueEventPayload }
  | { event: 'release'; payload: ReleaseEventPayload }
  | { event: 'deployment_status'; payload: DeploymentStatusPayload }
  | { event: 'push'; payload: PushEventPayload }
  | { event: 'dependabot_alert'; payload: DependabotAlertPayload }
  | { event: 'secret_scanning_alert'; payload: SecretScanningAlertPayload }
  | { event: 'code_scanning_alert'; payload: CodeScanningAlertPayload }
  | { event: 'schedule'; payload: { schedule: string; repository: { full_name: string } } };


export { REPO_NAME_PATTERN };

/** Warn if scheduled polling exceeds 80% of the 5-min cron interval. */
const POLL_WARN_THRESHOLD_MS = 4 * 60_000;

const REQUIRED_PERMISSIONS = [
  { flag: PermissionsBitField.Flags.SendMessages, name: 'Send Messages' },
  { flag: PermissionsBitField.Flags.CreatePublicThreads, name: 'Create Public Threads' },
  { flag: PermissionsBitField.Flags.SendMessagesInThreads, name: 'Send Messages in Threads' },
  { flag: PermissionsBitField.Flags.EmbedLinks, name: 'Embed Links' },
  { flag: PermissionsBitField.Flags.ReadMessageHistory, name: 'Read Message History' },
];

export class RepoRelay {
  private client: Client;
  private db: StateDb | null = null;
  private config: RepoRelayConfig;
  private repo: string | null = null;

  constructor(config: RepoRelayConfig) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
      ],
    });
  }

  async connect(): Promise<void> {
    await this.logSessionBudget();
    await this.client.login(this.config.discordToken);
    console.log(`[repo-relay] Connected to Discord as ${this.client.user?.tag}`);
  }

  private async logSessionBudget(): Promise<void> {
    try {
      const rest = new REST().setToken(this.config.discordToken);
      const data = await rest.get(Routes.gatewayBot()) as {
        session_start_limit: {
          total: number;
          remaining: number;
          reset_after: number;
        };
      };
      const { remaining, total } = data.session_start_limit;
      const pct = total > 0 ? Math.round((remaining / total) * 100) : 0;
      console.log(`[repo-relay] Session budget: ${remaining}/${total} (${pct}%)`);

      if (remaining <= 10) {
        console.log(`[repo-relay] WARNING: Session budget critically low (${remaining} remaining)`);
      } else if (pct <= 20) {
        console.log(`[repo-relay] WARNING: Session budget below 20% (${remaining}/${total})`);
      }
    } catch (err) {
      console.log(
        '[repo-relay] Could not fetch session budget (non-fatal):',
        safeErrorMessage(err),
      );
    }
  }

  async validatePermissions(): Promise<void> {
    const requiredNames = REQUIRED_PERMISSIONS.map((p) => p.name).join(', ');

    // Collect unique channel IDs
    const { prs, issues, releases, deployments, security } = this.config.channelConfig;
    const channelIds = [...new Set([prs, issues, releases, deployments, security].filter(Boolean) as string[])];

    const errors: string[] = [];

    for (const channelId of channelIds) {
      let channel;
      try {
        channel = await withRetry(() => this.client.channels.fetch(channelId));
      } catch {
        errors.push(
          `[repo-relay] ERROR: Could not access channel ${channelId}\n` +
          `  The channel may not exist or the bot may not have access to it.`
        );
        continue;
      }

      if (!channel || !('guild' in channel)) {
        errors.push(
          `[repo-relay] ERROR: Channel ${channelId} is not a guild text channel`
        );
        continue;
      }

      const guildChannel = channel as GuildChannel;
      const me = guildChannel.guild.members.me;
      if (!me) {
        errors.push(
          `[repo-relay] ERROR: Could not resolve bot member in guild for channel ${channelId}`
        );
        continue;
      }

      const permissions = guildChannel.permissionsFor(me);
      if (!permissions) {
        errors.push(
          `[repo-relay] ERROR: Could not resolve permissions for channel ${channelId}`
        );
        continue;
      }

      const missing = REQUIRED_PERMISSIONS
        .filter((p) => !permissions.has(p.flag))
        .map((p) => p.name);

      if (missing.length > 0) {
        errors.push(
          `[repo-relay] ERROR: Bot lacks permissions in channel ${channelId}\n` +
          `  Missing: ${missing.join(', ')}\n` +
          `  Required: ${requiredNames}`
        );
      }
    }

    if (errors.length > 0) {
      const message = errors.join('\n');
      console.error(message);
      throw new Error(
        `Missing Discord permissions in ${errors.length} channel(s). See logs above for details.`
      );
    }

    console.log('[repo-relay] Permission check passed for all channels');
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.client.destroy();
    console.log('[repo-relay] Disconnected from Discord');
  }

  async handleEvent(eventData: GitHubEventPayload): Promise<void> {
    // Extract repo from payload
    const repo = this.extractRepo(eventData);
    if (!repo) {
      throw new Error('Could not extract repository from event payload');
    }

    // Initialize or switch DB if repo changed
    if (this.repo !== repo) {
      this.db?.close();
      this.db = new StateDb(repo, this.config.stateDir);
      this.repo = repo;
    }

    console.log(`[repo-relay] Handling ${eventData.event} event for ${repo}`);

    // TypeScript narrowing ensures db is initialized after the block above
    const db = this.db!;

    switch (eventData.event) {
      case 'pull_request':
        await handlePrEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload
        );
        // Piggyback: check for reviews that may have been posted
        if (this.config.githubToken) {
          await this.checkAndUpdateReviews(repo, eventData.payload.pull_request.number);
        }
        break;

      case 'workflow_run':
        await handleCiEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload,
          this.config.githubToken
        );
        // Piggyback: check for reviews on associated PRs
        if (this.config.githubToken) {
          for (const pr of eventData.payload.workflow_run.pull_requests) {
            await this.checkAndUpdateReviews(repo, pr.number);
          }
        }
        break;

      case 'pull_request_review':
        await handleReviewEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload
        );
        break;

      case 'issue_comment':
        await handleCommentEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload
        );
        break;

      case 'issues':
        await handleIssueEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload
        );
        break;

      case 'release':
        await handleReleaseEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload
        );
        break;

      case 'deployment_status':
        await handleDeploymentEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload
        );
        break;

      case 'push':
        await handlePushEvent(
          this.client,
          db,
          this.config.channelConfig,
          eventData.payload
        );
        break;

      case 'dependabot_alert':
      case 'secret_scanning_alert':
      case 'code_scanning_alert':
        await handleSecurityAlertEvent(
          this.client,
          db,
          this.config.channelConfig,
          { event: eventData.event, payload: eventData.payload } as SecurityAlertPayload
        );
        break;

      case 'schedule':
        if (!this.config.githubToken) {
          console.log('[repo-relay] Skipping scheduled review poll: no GITHUB_TOKEN');
          break;
        }
        await this.pollOpenPrReviews(repo);
        break;

      default:
        console.log(`[repo-relay] Unknown event type, skipping`);
    }
  }

  /**
   * Check GitHub API for reviews and update embed if status changed
   * This is the "piggyback" approach - we check for reviews when other events fire
   */
  private async checkAndUpdateReviews(repo: string, prNumber: number): Promise<void> {
    if (!this.db || !this.config.githubToken) {
      return;
    }

    const result = await checkForReviews(
      this.db,
      repo,
      prNumber,
      this.config.githubToken
    );

    // If status changed, update the embed
    if (result.changed) {
      try {
        const channelId = getChannelForEvent(this.config.channelConfig, 'pr');
        const channel = await withRetry(() => this.client.channels.fetch(channelId));
        if (!channel || !(channel instanceof TextChannel)) return;

        const existing = await getExistingPrMessage(this.db, channel, repo, prNumber);
        if (!existing) return;

        const message = await withRetry(() => channel.messages.fetch(existing.messageId));
        const statusData = buildEmbedWithStatus(this.db, repo, prNumber);

        if (statusData) {
          const embed = buildPrEmbed(statusData.prData, statusData.ci, statusData.reviews);
          const components = [buildPrComponents(statusData.prData.url, statusData.ci.url)];
          await withRetry(() => message.edit({ embeds: [embed], components }));
          console.log(`[repo-relay] Updated embed for PR #${prNumber} with detected reviews`);

          // Post to thread about detected reviews
          if (existing.threadId) {
            try {
              const threadId = existing.threadId;
              const thread = await withRetry(() => channel.threads.fetch(threadId));
              if (thread) {
                if (result.copilotReviewed && result.copilotUrl) {
                  const reply = buildReviewReply('copilot', 'reviewed', undefined, result.copilotUrl);
                  await withRetry(() => thread.send(reply));
                }
                if (result.agentReviewStatus !== 'pending' && result.agentReviewUrl) {
                  const reply = buildReviewReply('agent', result.agentReviewStatus, undefined, result.agentReviewUrl);
                  await withRetry(() => thread.send(reply));
                }
              }
            } catch {
              // Thread might be archived or deleted
            }
          }
        }
      } catch (error) {
        console.log(`[repo-relay] Warning: Failed to update embed for detected reviews: ${safeErrorMessage(error)}`);
      }
    }
  }

  private async pollOpenPrReviews(repo: string): Promise<void> {
    if (!this.db) return;

    const openPrs = this.db.getOpenPrNumbers(repo);
    if (openPrs.length === 0) {
      console.log('[repo-relay] No open PRs to poll for reviews');
      return;
    }

    console.log(`[repo-relay] Polling ${openPrs.length} open PR(s) for review updates`);

    const startTime = performance.now();

    for (const prNumber of openPrs) {
      try {
        await this.checkAndUpdateReviews(repo, prNumber);
      } catch (error) {
        console.log(`[repo-relay] Warning: Failed to poll PR #${prNumber}: ${safeErrorMessage(error)}`);
      }
    }

    const elapsedMs = performance.now() - startTime;
    const elapsedSec = (elapsedMs / 1000).toFixed(1);
    console.log(`[repo-relay] Review polling completed: ${openPrs.length} PR(s) in ${elapsedSec}s`);

    if (elapsedMs > POLL_WARN_THRESHOLD_MS) {
      console.log(`[repo-relay] Warning: Polling took ${elapsedSec}s, approaching 5-min schedule interval`);
    }
  }

  private extractRepo(eventData: GitHubEventPayload): string | null {
    let repo: string | null = null;
    switch (eventData.event) {
      case 'pull_request':
      case 'workflow_run':
      case 'pull_request_review':
      case 'issue_comment':
      case 'issues':
      case 'release':
      case 'deployment_status':
      case 'push':
      case 'dependabot_alert':
      case 'secret_scanning_alert':
      case 'code_scanning_alert':
      case 'schedule':
        repo = eventData.payload.repository.full_name;
        break;
      default:
        return null;
    }
    if (!repo || !REPO_NAME_PATTERN.test(repo)) {
      return null;
    }
    return repo;
  }
}

// Re-export types and utilities
export { StateDb } from './db/state.js';
export { getChannelConfig, type ChannelConfig } from './config/channels.js';
export * from './embeds/builders.js';
export * from './handlers/index.js';
