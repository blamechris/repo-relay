#!/usr/bin/env node
/**
 * CLI entry point for GitHub Actions integration
 *
 * Reads GitHub event from GITHUB_EVENT_PATH and processes it.
 */
import { readFileSync } from 'fs';
import { RepoRelay } from './index.js';
import { safeErrorMessage } from './utils/errors.js';
import { getChannelConfig } from './config/channels.js';
import { shouldSkipEvent } from './pre-filter.js';
async function main() {
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
    }
    catch (error) {
        console.error(`[repo-relay] ERROR: ${safeErrorMessage(error)}`);
        process.exit(1);
    }
    // Read event payload
    let payload;
    try {
        const eventData = readFileSync(eventPath, 'utf-8');
        payload = JSON.parse(eventData);
    }
    catch (error) {
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
    try {
        await relay.connect();
        await relay.validatePermissions();
        await relay.handleEvent(eventData);
        console.log('[repo-relay] Event processed successfully');
    }
    catch (error) {
        console.error(`[repo-relay] ERROR: ${safeErrorMessage(error)}`);
        process.exit(1);
    }
    finally {
        await relay.disconnect();
    }
}
function mapGitHubEvent(eventName, payload) {
    switch (eventName) {
        case 'pull_request':
            return { event: 'pull_request', payload: payload };
        case 'workflow_run':
            return { event: 'workflow_run', payload: payload };
        case 'pull_request_review':
            return { event: 'pull_request_review', payload: payload };
        case 'issue_comment':
            return { event: 'issue_comment', payload: payload };
        case 'issues':
            return { event: 'issues', payload: payload };
        case 'release':
            return { event: 'release', payload: payload };
        case 'deployment_status':
            return { event: 'deployment_status', payload: payload };
        case 'push':
            return { event: 'push', payload: payload };
        case 'dependabot_alert':
            return { event: 'dependabot_alert', payload: payload };
        case 'secret_scanning_alert':
            return { event: 'secret_scanning_alert', payload: payload };
        case 'code_scanning_alert':
            return { event: 'code_scanning_alert', payload: payload };
        case 'schedule': {
            const repoFullName = process.env.GITHUB_REPOSITORY;
            if (!repoFullName) {
                console.log('[repo-relay] Schedule event but GITHUB_REPOSITORY not set, skipping');
                return null;
            }
            return {
                event: 'schedule',
                payload: {
                    schedule: payload?.schedule ?? '',
                    repository: { full_name: repoFullName },
                },
            };
        }
        default:
            return null;
    }
}
main().catch((error) => {
    console.error('[repo-relay] Unhandled error:', safeErrorMessage(error));
    process.exit(1);
});
//# sourceMappingURL=cli.js.map