#!/usr/bin/env node
/**
 * CLI entry point for GitHub Actions integration
 *
 * Reads GitHub event from GITHUB_EVENT_PATH and processes it.
 */

import { readFileSync } from 'fs';
import { RepoRelay, type GitHubEventPayload } from './index.js';
import { safeErrorMessage } from './utils/errors.js';
import { getChannelConfig } from './config/channels.js';
import type { PrEventPayload } from './handlers/pr.js';
import type { WorkflowRunPayload } from './handlers/ci.js';
import type { PrReviewPayload } from './handlers/review.js';
import type { IssueCommentPayload } from './handlers/comment.js';
import type { IssueEventPayload } from './handlers/issue.js';
import type { ReleaseEventPayload } from './handlers/release.js';

async function main(): Promise<void> {
  console.log('[repo-relay] Starting...');

  // Validate required environment variables
  const discordToken = process.env.DISCORD_BOT_TOKEN;
  if (!discordToken) {
    console.error('[repo-relay] ERROR: DISCORD_BOT_TOKEN is required');
    process.exit(1);
  }

  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!eventName) {
    console.error('[repo-relay] ERROR: GITHUB_EVENT_NAME is required');
    process.exit(1);
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.error('[repo-relay] ERROR: GITHUB_EVENT_PATH is required');
    process.exit(1);
  }

  // Get channel config
  let channelConfig;
  try {
    channelConfig = getChannelConfig();
  } catch (error) {
    console.error(`[repo-relay] ERROR: ${safeErrorMessage(error)}`);
    process.exit(1);
  }

  // Read event payload
  let payload: unknown;
  try {
    const eventData = readFileSync(eventPath, 'utf-8');
    payload = JSON.parse(eventData);
  } catch (error) {
    console.error(`[repo-relay] ERROR: Failed to read event payload: ${safeErrorMessage(error)}`);
    process.exit(1);
  }

  // Map GitHub event name to our event type
  const eventData = mapGitHubEvent(eventName, payload);
  if (!eventData) {
    console.log(`[repo-relay] Event '${eventName}' not handled, skipping`);
    process.exit(0);
  }

  // Get optional GitHub token for review detection
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    console.log('[repo-relay] Note: GITHUB_TOKEN not set, review detection via piggyback disabled');
  }

  // Initialize and run
  const relay = new RepoRelay({
    discordToken,
    githubToken,
    channelConfig,
    stateDir: process.env.STATE_DIR,
  });

  try {
    await relay.connect();
    await relay.validatePermissions();
    await relay.handleEvent(eventData);
    console.log('[repo-relay] Event processed successfully');
  } catch (error) {
    console.error(`[repo-relay] ERROR: ${safeErrorMessage(error)}`);
    process.exit(1);
  } finally {
    await relay.disconnect();
  }
}

function mapGitHubEvent(
  eventName: string,
  payload: unknown
): GitHubEventPayload | null {
  switch (eventName) {
    case 'pull_request':
      return { event: 'pull_request', payload: payload as PrEventPayload };

    case 'workflow_run':
      return { event: 'workflow_run', payload: payload as WorkflowRunPayload };

    case 'pull_request_review':
      return { event: 'pull_request_review', payload: payload as PrReviewPayload };

    case 'issue_comment':
      return { event: 'issue_comment', payload: payload as IssueCommentPayload };

    case 'issues':
      return { event: 'issues', payload: payload as IssueEventPayload };

    case 'release':
      return { event: 'release', payload: payload as ReleaseEventPayload };

    default:
      return null;
  }
}

main().catch((error) => {
  console.error('[repo-relay] Unhandled error:', safeErrorMessage(error));
  process.exit(1);
});
