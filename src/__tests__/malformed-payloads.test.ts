import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mapGitHubEvent } from '../cli.js';
import { shouldSkipEvent } from '../pre-filter.js';

/**
 * GitHub occasionally delivers truncated or null-ridden payloads. The
 * mapGitHubEvent → shouldSkipEvent pipeline runs before Discord connect and
 * must never throw an uncaught TypeError — every malformed payload must
 * resolve to a clean skip reason (string) or pass through to a handler that
 * can cope. These tests pin the "never throw, always skip" contract for the
 * pre-filterable event families.
 */

/** Events whose pre-filter must skip a malformed payload outright. */
const PREFILTER_EVENTS = [
  'pull_request',
  'workflow_run',
  'pull_request_review',
  'issue_comment',
  'issues',
  'release',
  'deployment_status',
  'push',
  'dependabot_alert',
  'secret_scanning_alert',
  'code_scanning_alert',
] as const;

function mapAndFilter(eventName: string, payload: unknown): string | null {
  const eventData = mapGitHubEvent(eventName, payload);
  expect(eventData).not.toBeNull();
  return shouldSkipEvent(eventData!);
}

describe('mapGitHubEvent', () => {
  it('returns null for unknown event names', () => {
    expect(mapGitHubEvent('watch', {})).toBeNull();
    expect(mapGitHubEvent('star', { action: 'created' })).toBeNull();
    expect(mapGitHubEvent('', {})).toBeNull();
  });

  it.each(PREFILTER_EVENTS)('maps %s to its event type', (eventName) => {
    const result = mapGitHubEvent(eventName, {});
    expect(result?.event).toBe(eventName);
  });

  describe('schedule', () => {
    const saved = process.env.GITHUB_REPOSITORY;
    beforeEach(() => {
      delete process.env.GITHUB_REPOSITORY;
    });
    afterEach(() => {
      if (saved === undefined) delete process.env.GITHUB_REPOSITORY;
      else process.env.GITHUB_REPOSITORY = saved;
    });

    it('returns null when GITHUB_REPOSITORY is not set', () => {
      expect(mapGitHubEvent('schedule', {})).toBeNull();
    });

    it('builds a schedule event from env, tolerating a null payload', () => {
      process.env.GITHUB_REPOSITORY = 'owner/repo';
      const result = mapGitHubEvent('schedule', null);
      expect(result).toEqual({
        event: 'schedule',
        payload: { schedule: '', repository: { full_name: 'owner/repo' } },
      });
    });
  });
});

describe('malformed payloads are skipped, never throw', () => {
  it.each(PREFILTER_EVENTS)('%s with an empty payload {} skips cleanly', (eventName) => {
    const reason = mapAndFilter(eventName, {});
    expect(reason).toBeTypeOf('string');
  });

  it('pull_request with a handled action but null pull_request skips', () => {
    const reason = mapAndFilter('pull_request', {
      action: 'opened',
      pull_request: null,
      repository: { full_name: 'owner/repo' },
    });
    expect(reason).toBe('pull_request: malformed payload');
  });

  it('pull_request with a handled action but missing repository skips', () => {
    const reason = mapAndFilter('pull_request', {
      action: 'closed',
      pull_request: { number: 1 },
    });
    expect(reason).toBe('pull_request: malformed payload');
  });

  it('workflow_run with null workflow_run skips as "no associated PRs"', () => {
    const reason = mapAndFilter('workflow_run', { action: 'completed', workflow_run: null });
    expect(reason).toBe('workflow_run: no associated PRs');
  });

  it('workflow_run with missing pull_requests array skips', () => {
    const reason = mapAndFilter('workflow_run', {
      action: 'completed',
      workflow_run: { id: 1, name: 'CI' },
    });
    expect(reason).toBe('workflow_run: no associated PRs');
  });

  it('workflow_run with PRs but missing repository skips', () => {
    const reason = mapAndFilter('workflow_run', {
      action: 'completed',
      workflow_run: { id: 1, name: 'CI', pull_requests: [{ number: 1 }] },
    });
    expect(reason).toBe('workflow_run: malformed payload (missing repository)');
  });

  it('pull_request_review submitted with null review skips', () => {
    const reason = mapAndFilter('pull_request_review', {
      action: 'submitted',
      review: null,
      pull_request: { number: 1 },
      repository: { full_name: 'owner/repo', owner: { login: 'o' } },
    });
    expect(reason).toBe('pull_request_review: malformed payload');
  });

  it('issue_comment created with null issue skips as not a PR comment', () => {
    const reason = mapAndFilter('issue_comment', { action: 'created', issue: null });
    expect(reason).toBe('issue_comment: not a PR comment');
  });

  it('issue_comment created on a PR but with null comment skips', () => {
    const reason = mapAndFilter('issue_comment', {
      action: 'created',
      comment: null,
      issue: { number: 1, pull_request: { url: '' } },
      repository: { full_name: 'owner/repo' },
    });
    expect(reason).toBe('issue_comment: malformed payload');
  });

  it('issues opened with null issue skips', () => {
    const reason = mapAndFilter('issues', { action: 'opened', issue: null });
    expect(reason).toBe('issues: malformed payload');
  });

  it('release published with null release skips', () => {
    const reason = mapAndFilter('release', { action: 'published', release: null });
    expect(reason).toBe('release: malformed payload');
  });

  it('deployment_status with null deployment_status skips as non-terminal', () => {
    const reason = mapAndFilter('deployment_status', { action: 'created', deployment_status: null });
    expect(reason).toBe("deployment_status: state 'undefined' not terminal");
  });

  it('deployment_status terminal but null deployment skips', () => {
    const reason = mapAndFilter('deployment_status', {
      action: 'created',
      deployment_status: { state: 'success' },
      deployment: null,
      repository: { full_name: 'owner/repo' },
    });
    expect(reason).toBe('deployment_status: malformed payload');
  });

  it('push with missing ref skips as malformed', () => {
    const reason = mapAndFilter('push', { repository: { full_name: 'owner/repo', default_branch: 'main' } });
    expect(reason).toBe('push: malformed payload (missing ref or repository)');
  });

  it('push to default branch with missing commits array skips nothing and does not throw', () => {
    const reason = mapAndFilter('push', {
      ref: 'refs/heads/main',
      repository: { full_name: 'owner/repo', default_branch: 'main' },
    });
    expect(reason).toBeNull();
  });

  it.each(['dependabot_alert', 'secret_scanning_alert', 'code_scanning_alert'] as const)(
    '%s created with null alert skips',
    (eventName) => {
      const reason = mapAndFilter(eventName, { action: 'created', alert: null });
      expect(reason).toBe(`${eventName}: malformed payload`);
    }
  );
});
