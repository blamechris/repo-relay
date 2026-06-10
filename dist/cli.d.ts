#!/usr/bin/env node
/**
 * CLI entry point for GitHub Actions integration
 *
 * Reads GitHub event from GITHUB_EVENT_PATH and processes it.
 */
import { type GitHubEventPayload } from './index.js';
export declare function mapGitHubEvent(eventName: string, payload: unknown): GitHubEventPayload | null;
//# sourceMappingURL=cli.d.ts.map