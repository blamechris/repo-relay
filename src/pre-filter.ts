/**
 * Pre-filter: skip events before Discord gateway connect to save sessions.
 *
 * Each check mirrors the corresponding handler's early-exit so we avoid
 * burning a gateway session for payloads the handler would discard anyway.
 */

import type { GitHubEventPayload } from './index.js';

/**
 * Returns a human-readable skip reason if the event can be discarded
 * without connecting to Discord, or `null` if it should be processed.
 */
export function shouldSkipEvent(eventData: GitHubEventPayload): string | null {
  switch (eventData.event) {
    case 'workflow_run': {
      // ci.ts:46 — no PRs means nothing to update
      const prs = eventData.payload.workflow_run.pull_requests;
      if (prs.length === 0) {
        return 'workflow_run: no associated PRs';
      }
      return null;
    }

    case 'issue_comment': {
      // comment.ts:52 — only created comments on PRs
      if (eventData.payload.action !== 'created') {
        return `issue_comment: action '${eventData.payload.action}' not handled`;
      }
      if (!eventData.payload.issue.pull_request) {
        return 'issue_comment: not a PR comment';
      }
      return null;
    }

    case 'deployment_status': {
      // deployment.ts:48 — only terminal states
      const state = eventData.payload.deployment_status.state;
      if (state !== 'success' && state !== 'failure' && state !== 'error') {
        return `deployment_status: state '${state}' not terminal`;
      }
      return null;
    }

    case 'push': {
      const payload = eventData.payload;
      const branch = payload.ref.replace('refs/heads/', '');
      // push.ts:47 — only default branch
      if (branch !== payload.repository.default_branch) {
        return `push: branch '${branch}' is not default branch`;
      }
      // push.ts:52 — skip branch creation/deletion
      if (payload.created || payload.deleted) {
        return 'push: branch creation or deletion event';
      }
      return null;
    }

    case 'release': {
      // release.ts:42 — only published, non-draft
      if (eventData.payload.action !== 'published') {
        return `release: action '${eventData.payload.action}' not handled`;
      }
      if (eventData.payload.release.draft) {
        return 'release: draft release';
      }
      return null;
    }

    case 'pull_request_review': {
      // review.ts:45 — only submitted
      if (eventData.payload.action !== 'submitted') {
        return `pull_request_review: action '${eventData.payload.action}' not handled`;
      }
      return null;
    }

    case 'issues': {
      // issue.ts:90-94 — only opened, closed, reopened
      const action = eventData.payload.action;
      if (action !== 'opened' && action !== 'closed' && action !== 'reopened') {
        return `issues: action '${action}' not handled`;
      }
      return null;
    }

    // pull_request and schedule are always processed
    case 'pull_request':
    case 'schedule':
      return null;

    default:
      return null;
  }
}
