/**
 * Pre-filter: skip events before Discord gateway connect to save sessions.
 *
 * These checks approximate the corresponding handlers' early-exit conditions
 * so we avoid burning a gateway session for payloads likely to be discarded.
 */

import type { GitHubEventPayload } from './index.js';
import { CASCADE_REVIEW_ASSOCIATIONS } from './handlers/review.js';

/**
 * Returns a human-readable skip reason if the event can be discarded
 * without connecting to Discord, or `null` if it should be processed.
 */
export function shouldSkipEvent(eventData: GitHubEventPayload): string | null {
  switch (eventData.event) {
    case 'workflow_run': {
      // CI handler skips when no PRs are associated with the run.
      // Optional chaining: a malformed payload (missing workflow_run) must
      // skip cleanly, not throw before Discord connect.
      const prs = eventData.payload.workflow_run?.pull_requests ?? [];
      if (prs.length === 0) {
        return 'workflow_run: no associated PRs';
      }
      if (!eventData.payload.repository) {
        return 'workflow_run: malformed payload (missing repository)';
      }
      return null;
    }

    case 'issue_comment': {
      // Comment handler only processes newly created comments on PRs
      if (eventData.payload.action !== 'created') {
        return `issue_comment: action '${eventData.payload.action}' not handled`;
      }
      if (!eventData.payload.issue?.pull_request) {
        return 'issue_comment: not a PR comment';
      }
      if (!eventData.payload.comment || !eventData.payload.repository) {
        return 'issue_comment: malformed payload';
      }
      return null;
    }

    case 'deployment_status': {
      // Deployment handler only processes terminal states (success/failure/error)
      const state = eventData.payload.deployment_status?.state;
      if (state !== 'success' && state !== 'failure' && state !== 'error') {
        return `deployment_status: state '${state}' not terminal`;
      }
      if (!eventData.payload.deployment || !eventData.payload.repository) {
        return 'deployment_status: malformed payload';
      }
      return null;
    }

    case 'push': {
      const payload = eventData.payload;
      if (typeof payload.ref !== 'string' || !payload.repository) {
        return 'push: malformed payload (missing ref or repository)';
      }
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
      const commits = payload.commits ?? [];
      if (
        commits.length > 0 &&
        commits.every((c: { message: string }) => /^Merge pull request #\d+/.test(c.message))
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
      const release = eventData.payload.release;
      if (!release || !eventData.payload.repository) {
        return 'release: malformed payload';
      }
      if (release.draft) {
        return 'release: draft release';
      }
      return null;
    }

    case 'pull_request_review': {
      // Review handler only processes submitted reviews
      if (eventData.payload.action !== 'submitted') {
        return `pull_request_review: action '${eventData.payload.action}' not handled`;
      }
      if (!eventData.payload.review || !eventData.payload.pull_request || !eventData.payload.repository) {
        return 'pull_request_review: malformed payload';
      }
      // Ignore collaborator comment replies to avoid notification cascades
      // (#13, #146) — Bot reviews (Copilot) always pass through. Optional
      // chaining: a malformed payload (missing user) must skip the filter
      // cleanly, not throw before Discord connect.
      const { review } = eventData.payload;
      if (
        review.state === 'commented' &&
        review.user?.type === 'User' &&
        CASCADE_REVIEW_ASSOCIATIONS.has(review.author_association)
      ) {
        return 'pull_request_review: collaborator comment reply';
      }
      return null;
    }

    case 'issues': {
      // Issue handler only processes opened, closed, and reopened actions
      const action = eventData.payload.action;
      if (action !== 'opened' && action !== 'closed' && action !== 'reopened') {
        return `issues: action '${action}' not handled`;
      }
      if (!eventData.payload.issue || !eventData.payload.repository) {
        return 'issues: malformed payload';
      }
      return null;
    }

    case 'dependabot_alert': {
      if (eventData.payload.action !== 'created') {
        return `dependabot_alert: action '${eventData.payload.action}' not handled`;
      }
      if (!eventData.payload.alert || !eventData.payload.repository) {
        return 'dependabot_alert: malformed payload';
      }
      return null;
    }

    case 'secret_scanning_alert': {
      if (eventData.payload.action !== 'created') {
        return `secret_scanning_alert: action '${eventData.payload.action}' not handled`;
      }
      if (!eventData.payload.alert || !eventData.payload.repository) {
        return 'secret_scanning_alert: malformed payload';
      }
      return null;
    }

    case 'code_scanning_alert': {
      const action = eventData.payload.action;
      if (action !== 'created' && action !== 'appeared_in_branch') {
        return `code_scanning_alert: action '${action}' not handled`;
      }
      if (!eventData.payload.alert || !eventData.payload.repository) {
        return 'code_scanning_alert: malformed payload';
      }
      return null;
    }

    case 'pull_request': {
      const handled = new Set(['opened', 'closed', 'reopened', 'synchronize', 'edited', 'ready_for_review', 'converted_to_draft']);
      if (!handled.has(eventData.payload.action)) {
        return `pull_request: action '${eventData.payload.action}' not handled`;
      }
      if (!eventData.payload.pull_request || !eventData.payload.repository) {
        return 'pull_request: malformed payload';
      }
      return null;
    }

    // schedule is always processed
    case 'schedule':
      return null;

    default:
      return null;
  }
}
