#!/usr/bin/env node
/**
 * CLI entry point for GitHub Actions integration
 *
 * Reads GitHub event from GITHUB_EVENT_PATH and processes it.
 */

import { readFileSync, realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import { safeErrorMessage } from './utils/errors.js';
import type { GitHubEventPayload } from './index.js';
import type { PrEventPayload } from './handlers/pr.js';
import type { WorkflowRunPayload } from './handlers/ci.js';
import type { PrReviewPayload } from './handlers/review.js';
import type { IssueCommentPayload } from './handlers/comment.js';
import type { IssueEventPayload } from './handlers/issue.js';
import type { ReleaseEventPayload } from './handlers/release.js';
import type { DeploymentStatusPayload } from './handlers/deployment.js';
import type { PushEventPayload } from './handlers/push.js';
import type { DependabotAlertPayload, SecretScanningAlertPayload, CodeScanningAlertPayload } from './handlers/security.js';

async function main(): Promise<void> {
  // `npx blamechris/repo-relay init` runs THIS bin, not repo-relay-init: npm
  // picks the bin matching the package name. Dispatch before any env-var
  // checks so the wizard is reachable without DISCORD_* set. Dynamic imports
  // both ways: prompts/execSync stay out of the GitHub Actions hot path, and
  // the Actions runtime (discord.js, sqlite) stays out of the wizard's —
  // this module's eager imports must remain fs/url-light (#185).
  if (process.argv[2] === 'init') {
    const { runSetup } = await import('./setup.js');
    await runSetup();
    return;
  } else if (process.argv[2]) {
    // A stray argument is a typo'd wizard invocation, not the argless
    // Actions path — say so before the env-var errors muddy the water
    console.error(`[repo-relay] Unknown argument '${process.argv[2]}' — the setup wizard is 'init'. Continuing as the Actions runner...`);
  }

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

  // The Actions runtime (discord.js, better-sqlite3 via ./index.js) loads
  // only past this point — after the init dispatch and the env-var checks —
  // so the wizard path stands alone and a module-load failure in the heavy
  // stack can't crash `init` (#185). An import failure here surfaces via
  // main().catch and always exits 1 — REPO_RELAY_BEST_EFFORT is deliberately
  // not consulted: a broken install is owner-actionable environment breakage,
  // not transient delivery trouble (and pre-#185 the static imports crashed
  // before the flag was ever read)
  const [{ getChannelConfig }, { shouldSkipEvent }, { isConfigError }, { RepoRelay }] =
    await Promise.all([
      import('./config/channels.js'),
      import('./pre-filter.js'),
      import('./utils/discord-errors.js'),
      import('./index.js'),
    ]);

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

  // Pre-filter: skip events that handlers would discard, saving a gateway session
  const skipReason = shouldSkipEvent(eventData);
  if (skipReason) {
    console.log(`[repo-relay] Skipping event (pre-filter): ${skipReason}`);
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

  const bestEffortEnv = (process.env.REPO_RELAY_BEST_EFFORT ?? '').trim().toLowerCase();
  const bestEffort = bestEffortEnv === 'true' || bestEffortEnv === '1';

  try {
    await relay.connect();
    await relay.validatePermissions();
    await relay.handleEvent(eventData);
    console.log('[repo-relay] Event processed successfully');
  } catch (error) {
    if (bestEffort && !isConfigError(error)) {
      // Transient infrastructure trouble (Discord 5xx, timeouts, network):
      // annotate loudly but exit 0 so a notification hiccup doesn't fail the
      // consumer's check. Config errors (bad token, missing channel/perms)
      // still fail — they need the repo owner, not a retry.
      // Workflow-command data escaping (same as @actions/core escapeData):
      // raw %/CR/LF would truncate the annotation, and a LF would start a
      // fresh line that could smuggle a new ::command::
      const message = safeErrorMessage(error)
        .replace(/%/g, '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A');
      console.log(`::warning::[repo-relay] Notification not delivered (best-effort): ${message}`);
    } else {
      console.error(`[repo-relay] ERROR: ${safeErrorMessage(error)}`);
      // exitCode (not exit()) so the finally block runs: disconnect() closes
      // the DB with a WAL checkpoint — skipping it leaves a dirty WAL for the
      // actions/cache post step to snapshot
      process.exitCode = 1;
    }
  } finally {
    try {
      await relay.disconnect();
    } catch (error) {
      // Teardown trouble must not override the delivery outcome (a gateway
      // mid-outage can fail the close handshake) — but a half-destroyed
      // client can hold the event loop open, so force the exit
      console.log(`[repo-relay] Disconnect failed (non-fatal): ${safeErrorMessage(error)}`);
      process.exit(process.exitCode ?? 0);
    }
  }
}

export function mapGitHubEvent(
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

    case 'deployment_status':
      return { event: 'deployment_status', payload: payload as DeploymentStatusPayload };

    case 'push':
      return { event: 'push', payload: payload as PushEventPayload };

    case 'dependabot_alert':
      return { event: 'dependabot_alert', payload: payload as DependabotAlertPayload };

    case 'secret_scanning_alert':
      return { event: 'secret_scanning_alert', payload: payload as SecretScanningAlertPayload };

    case 'code_scanning_alert':
      return { event: 'code_scanning_alert', payload: payload as CodeScanningAlertPayload };

    case 'schedule': {
      const repoFullName = process.env.GITHUB_REPOSITORY;
      if (!repoFullName) {
        console.log('[repo-relay] Schedule event but GITHUB_REPOSITORY not set, skipping');
        return null;
      }
      return {
        event: 'schedule',
        payload: {
          schedule: (payload as { schedule?: string })?.schedule ?? '',
          repository: { full_name: repoFullName },
        },
      };
    }

    default:
      return null;
  }
}

/**
 * Only run main() when cli.js is the process entry point (the GitHub Action
 * runs `node dist/cli.js`). Importing this module (e.g. from tests) must not
 * trigger execution. realpath both sides so npm bin symlinks still match.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((error) => {
    // Full stack, not just the message: module-load failures from the
    // dynamic runtime imports land here, and before #185 they crashed at
    // static-import time with a stack — an install problem needs the trace
    console.error(
      '[repo-relay] Unhandled error:',
      error instanceof Error ? error.stack ?? error.message : safeErrorMessage(error)
    );
    process.exit(1);
  });
}
