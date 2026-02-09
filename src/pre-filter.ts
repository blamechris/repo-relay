/**
 * Pre-filter: skip events before Discord gateway connect to save sessions.
 *
 * These checks approximate the corresponding handlers' early-exit conditions
 * so we avoid burning a gateway session for payloads likely to be discarded.
 */

import type { GitHubEventPayload } from './index.js';

/**
 * Returns a human-readable skip reason if the event can be discarded
 * without connecting to Discord, or `null` if it should be processed.
 */
export function shouldSkipEvent(eventData: GitHubEventPayload): string | null {
  switch (eventData.event) {
    case 'workflow_run': {
      // Also guarded in workflow YAML if-condition (defense-in-depth)
      // Mirrors ci handler: no PRs means nothing to update
      const prs = eventData.payload.workflow_run.pull_requests;
      if (prs.length === 0) {
        return 'workflow_run: no associated PRs';
      }
      return null;
    }

    case 'issue_comment': {
      // Mirrors comment handler: only created comments on PRs
      if (eventData.payload.action !== 'created') {
        return `issue_comment: action '${eventData.payload.action}' not handled`;
      }
      if (!eventData.payload.issue.pull_request) {
        return 'issue_comment: not a PR comment';
      }
      return null;
    }

    case 'deployment_status': {
      // Mirrors deployment handler: only terminal states
      const state = eventData.payload.deployment_status.state;
      if (state !== 'success' && state !== 'failure' && state !== 'error') {
        return `deployment_status: state '${state}' not terminal`;
      }
      return null;
    }

    case 'push': {
      const payload = eventData.payload;
      const branch = payload.ref.replace('refs/heads/', '');
      // Mirrors push handler: only default branch
      if (branch !== payload.repository.default_branch) {
        return `push: branch '${branch}' is not default branch`;
      }
      // Mirrors push handler: skip branch creation/deletion
      if (payload.created || payload.deleted) {
        return 'push: branch creation or deletion event';
      }
      // Mirrors push handler: skip if every commit is a PR merge commit
      if (
        payload.commits.length > 0 &&
        payload.commits.every((c: { message: string }) => /^Merge pull request #\d+/.test(c.message))
      ) {
        return 'push: all commits are PR merge commits';
      }
      return null;
    }

    case 'release': {
      // Mirrors release handler: only published, non-draft
      if (eventData.payload.action !== 'published') {
        return `release: action '${eventData.payload.action}' not handled`;
      }
      if (eventData.payload.release.draft) {
        return 'release: draft release';
      }
      return null;
    }

    case 'pull_request_review': {
      // Mirrors review handler: only submitted
      if (eventData.payload.action !== 'submitted') {
        return `pull_request_review: action '${eventData.payload.action}' not handled`;
      }
      // Mirrors review handler: ignore owner comment replies to avoid cascades
      const { review, repository } = eventData.payload;
      if (review?.user?.login === repository?.owner?.login && review?.state === 'commented') {
        return 'pull_request_review: owner comment reply';
      }
      return null;
    }

    case 'issues': {
      // Mirrors issue handler: only opened, closed, reopened
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
