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
      // CI handler skips when no PRs are associated with the run
      const prs = eventData.payload.workflow_run.pull_requests;
      if (prs.length === 0) {
        return 'workflow_run: no associated PRs';
      }
      return null;
    }

    case 'issue_comment': {
      // Comment handler only processes newly created comments on PRs
      if (eventData.payload.action !== 'created') {
        return `issue_comment: action '${eventData.payload.action}' not handled`;
      }
      if (!eventData.payload.issue.pull_request) {
        return 'issue_comment: not a PR comment';
      }
      return null;
    }

    case 'deployment_status': {
      // Deployment handler only processes terminal states (success/failure/error)
      const state = eventData.payload.deployment_status.state;
      if (state !== 'success' && state !== 'failure' && state !== 'error') {
        return `deployment_status: state '${state}' not terminal`;
      }
      return null;
    }

    case 'push': {
      const payload = eventData.payload;
      const branch = payload.ref.replace('refs/heads/', '');
      // Push handler only processes the default branch
      if (branch !== payload.repository.default_branch) {
        return `push: branch '${branch}' is not default branch`;
      }
      // Push handler skips branch creation and deletion events
      if (payload.created || payload.deleted) {
        return 'push: branch creation or deletion event';
      }
      // Push handler skips pushes consisting entirely of PR merge commits
      if (
        payload.commits.length > 0 &&
        payload.commits.every((c: { message: string }) => /^Merge pull request #\d+/.test(c.message))
      ) {
        return 'push: all commits are PR merge commits';
      }
      return null;
    }

    case 'release': {
      // Release handler only processes published, non-draft releases
      if (eventData.payload.action !== 'published') {
        return `release: action '${eventData.payload.action}' not handled`;
      }
      if (eventData.payload.release.draft) {
        return 'release: draft release';
      }
      return null;
    }

    case 'pull_request_review': {
      // Review handler only processes submitted reviews
      if (eventData.payload.action !== 'submitted') {
        return `pull_request_review: action '${eventData.payload.action}' not handled`;
      }
      // Ignore owner comment replies to avoid notification cascades
      const { review, repository } = eventData.payload;
      if (review?.user?.login === repository?.owner?.login && review?.state === 'commented') {
        return 'pull_request_review: owner comment reply';
      }
      return null;
    }

    case 'issues': {
      // Issue handler only processes opened, closed, and reopened actions
      const action = eventData.payload.action;
      if (action !== 'opened' && action !== 'closed' && action !== 'reopened') {
        return `issues: action '${action}' not handled`;
      }
      return null;
    }

    case 'dependabot_alert': {
      if (eventData.payload.action !== 'created') {
        return `dependabot_alert: action '${eventData.payload.action}' not handled`;
      }
      return null;
    }

    case 'secret_scanning_alert': {
      if (eventData.payload.action !== 'created') {
        return `secret_scanning_alert: action '${eventData.payload.action}' not handled`;
      }
      return null;
    }

    case 'code_scanning_alert': {
      const action = eventData.payload.action;
      if (action !== 'created' && action !== 'appeared_in_branch') {
        return `code_scanning_alert: action '${action}' not handled`;
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
