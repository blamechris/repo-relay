import { describe, it, expect } from 'vitest';
import { shouldSkipEvent } from '../pre-filter.js';
import type { GitHubEventPayload } from '../index.js';

describe('shouldSkipEvent', () => {
  // ── workflow_run ──────────────────────────────────────────────

  it('skips workflow_run with no associated PRs', () => {
    const event: GitHubEventPayload = {
      event: 'workflow_run',
      payload: {
        action: 'completed',
        workflow_run: {
          id: 1, name: 'CI', head_sha: 'abc', head_branch: 'main',
          status: 'completed', conclusion: 'success', html_url: '',
          pull_requests: [],
        },
        repository: { full_name: 'owner/repo' },
      },
    };
    expect(shouldSkipEvent(event)).toBe('workflow_run: no associated PRs');
  });

  it('passes workflow_run with associated PRs', () => {
    const event: GitHubEventPayload = {
      event: 'workflow_run',
      payload: {
        action: 'completed',
        workflow_run: {
          id: 1, name: 'CI', head_sha: 'abc', head_branch: 'feat',
          status: 'completed', conclusion: 'success', html_url: '',
          pull_requests: [{ number: 1 }],
        },
        repository: { full_name: 'owner/repo' },
      },
    };
    expect(shouldSkipEvent(event)).toBeNull();
  });

  // ── issue_comment ─────────────────────────────────────────────

  it('skips issue_comment with action !== created', () => {
    const event: GitHubEventPayload = {
      event: 'issue_comment',
      payload: {
        action: 'edited',
        comment: { id: 1, user: { login: 'u', type: 'User' }, body: '', html_url: '', created_at: '' },
        issue: { number: 1, pull_request: { url: '' } },
        repository: { full_name: 'owner/repo' },
      },
    };
    expect(shouldSkipEvent(event)).toBe("issue_comment: action 'edited' not handled");
  });

  it('skips issue_comment on non-PR issue', () => {
    const event: GitHubEventPayload = {
      event: 'issue_comment',
      payload: {
        action: 'created',
        comment: { id: 1, user: { login: 'u', type: 'User' }, body: '', html_url: '', created_at: '' },
        issue: { number: 1 },
        repository: { full_name: 'owner/repo' },
      },
    };
    expect(shouldSkipEvent(event)).toBe('issue_comment: not a PR comment');
  });

  it('passes issue_comment created on PR', () => {
    const event: GitHubEventPayload = {
      event: 'issue_comment',
      payload: {
        action: 'created',
        comment: { id: 1, user: { login: 'u', type: 'User' }, body: '', html_url: '', created_at: '' },
        issue: { number: 1, pull_request: { url: '' } },
        repository: { full_name: 'owner/repo' },
      },
    };
    expect(shouldSkipEvent(event)).toBeNull();
  });

  // ── deployment_status ─────────────────────────────────────────

  it('skips deployment_status with non-terminal state', () => {
    const event: GitHubEventPayload = {
      event: 'deployment_status',
      payload: {
        action: 'created',
        deployment_status: {
          state: 'pending', description: null, environment: 'prod',
          target_url: null, creator: { login: 'u', avatar_url: '' },
        },
        deployment: { id: 1, ref: 'main', sha: 'abc', environment: 'prod', description: null },
        repository: { full_name: 'owner/repo' },
      },
    };
    expect(shouldSkipEvent(event)).toBe("deployment_status: state 'pending' not terminal");
  });

  it.each(['success', 'failure', 'error'] as const)(
    'passes deployment_status with terminal state: %s',
    (state) => {
      const event: GitHubEventPayload = {
        event: 'deployment_status',
        payload: {
          action: 'created',
          deployment_status: {
            state, description: null, environment: 'prod',
            target_url: null, creator: { login: 'u', avatar_url: '' },
          },
          deployment: { id: 1, ref: 'main', sha: 'abc', environment: 'prod', description: null },
          repository: { full_name: 'owner/repo' },
        },
      };
      expect(shouldSkipEvent(event)).toBeNull();
    }
  );

  // ── push ──────────────────────────────────────────────────────

  it('skips push to non-default branch', () => {
    const event: GitHubEventPayload = {
      event: 'push',
      payload: {
        ref: 'refs/heads/feat', before: 'a', after: 'b', forced: false,
        compare: '', created: false, deleted: false, commits: [],
        head_commit: null, pusher: { name: 'u' },
        sender: { login: 'u', avatar_url: '' },
        repository: { full_name: 'owner/repo', default_branch: 'main' },
      },
    };
    expect(shouldSkipEvent(event)).toBe("push: branch 'feat' is not default branch");
  });

  it('skips push branch creation', () => {
    const event: GitHubEventPayload = {
      event: 'push',
      payload: {
        ref: 'refs/heads/main', before: '0'.repeat(40), after: 'b', forced: false,
        compare: '', created: true, deleted: false, commits: [],
        head_commit: null, pusher: { name: 'u' },
        sender: { login: 'u', avatar_url: '' },
        repository: { full_name: 'owner/repo', default_branch: 'main' },
      },
    };
    expect(shouldSkipEvent(event)).toBe('push: branch creation or deletion event');
  });

  it('skips push branch deletion', () => {
    const event: GitHubEventPayload = {
      event: 'push',
      payload: {
        ref: 'refs/heads/main', before: 'a', after: '0'.repeat(40), forced: false,
        compare: '', created: false, deleted: true, commits: [],
        head_commit: null, pusher: { name: 'u' },
        sender: { login: 'u', avatar_url: '' },
        repository: { full_name: 'owner/repo', default_branch: 'main' },
      },
    };
    expect(shouldSkipEvent(event)).toBe('push: branch creation or deletion event');
  });

  it('passes push to default branch with commits', () => {
    const event: GitHubEventPayload = {
      event: 'push',
      payload: {
        ref: 'refs/heads/main', before: 'a', after: 'b', forced: false,
        compare: '', created: false, deleted: false,
        commits: [{ id: 'c', message: 'fix: thing', author: { name: 'u' } }],
        head_commit: { id: 'c', message: 'fix: thing' },
        pusher: { name: 'u' },
        sender: { login: 'u', avatar_url: '' },
        repository: { full_name: 'owner/repo', default_branch: 'main' },
      },
    };
    expect(shouldSkipEvent(event)).toBeNull();
  });

  // ── release ───────────────────────────────────────────────────

  it('skips release with action !== published', () => {
    const event: GitHubEventPayload = {
      event: 'release',
      payload: {
        action: 'created',
        release: {
          id: 1, name: 'v1', tag_name: 'v1', html_url: '',
          author: { login: 'u', avatar_url: '' },
          body: null, prerelease: false, draft: false, published_at: '',
        },
        repository: { full_name: 'owner/repo' },
      },
    };
    expect(shouldSkipEvent(event)).toBe("release: action 'created' not handled");
  });

  it('skips draft release', () => {
    const event: GitHubEventPayload = {
      event: 'release',
      payload: {
        action: 'published',
        release: {
          id: 1, name: 'v1', tag_name: 'v1', html_url: '',
          author: { login: 'u', avatar_url: '' },
          body: null, prerelease: false, draft: true, published_at: '',
        },
        repository: { full_name: 'owner/repo' },
      },
    };
    expect(shouldSkipEvent(event)).toBe('release: draft release');
  });

  it('passes published non-draft release', () => {
    const event: GitHubEventPayload = {
      event: 'release',
      payload: {
        action: 'published',
        release: {
          id: 1, name: 'v1', tag_name: 'v1', html_url: '',
          author: { login: 'u', avatar_url: '' },
          body: null, prerelease: false, draft: false, published_at: '',
        },
        repository: { full_name: 'owner/repo' },
      },
    };
    expect(shouldSkipEvent(event)).toBeNull();
  });

  // ── pull_request_review ───────────────────────────────────────

  it('skips pull_request_review with action !== submitted', () => {
    const event: GitHubEventPayload = {
      event: 'pull_request_review',
      payload: {
        action: 'dismissed',
        review: {
          id: 1, user: { login: 'u', type: 'User' },
          body: null, state: 'dismissed', html_url: '',
        },
        pull_request: { number: 1 },
        repository: { full_name: 'owner/repo', owner: { login: 'o' } },
      },
    };
    expect(shouldSkipEvent(event)).toBe("pull_request_review: action 'dismissed' not handled");
  });

  it('passes pull_request_review with action submitted', () => {
    const event: GitHubEventPayload = {
      event: 'pull_request_review',
      payload: {
        action: 'submitted',
        review: {
          id: 1, user: { login: 'u', type: 'User' },
          body: 'lgtm', state: 'approved', html_url: '',
        },
        pull_request: { number: 1 },
        repository: { full_name: 'owner/repo', owner: { login: 'o' } },
      },
    };
    expect(shouldSkipEvent(event)).toBeNull();
  });

  // ── issues ────────────────────────────────────────────────────

  it.each(['labeled', 'unlabeled', 'edited'] as const)(
    'skips issues with unhandled action: %s',
    (action) => {
      const event: GitHubEventPayload = {
        event: 'issues',
        payload: {
          action,
          issue: {
            number: 1, title: 'test', html_url: '',
            user: { login: 'u', avatar_url: '' },
            state: 'open', labels: [], body: null, created_at: '',
          },
          repository: { full_name: 'owner/repo' },
          sender: { login: 'u' },
        },
      };
      expect(shouldSkipEvent(event)).toBe(`issues: action '${action}' not handled`);
    }
  );

  it.each(['opened', 'closed', 'reopened'] as const)(
    'passes issues with handled action: %s',
    (action) => {
      const event: GitHubEventPayload = {
        event: 'issues',
        payload: {
          action,
          issue: {
            number: 1, title: 'test', html_url: '',
            user: { login: 'u', avatar_url: '' },
            state: 'open', labels: [], body: null, created_at: '',
          },
          repository: { full_name: 'owner/repo' },
          sender: { login: 'u' },
        },
      };
      expect(shouldSkipEvent(event)).toBeNull();
    }
  );

  // ── always-process events ─────────────────────────────────────

  it('never skips pull_request events', () => {
    const event = {
      event: 'pull_request' as const,
      payload: {
        action: 'opened',
        pull_request: {
          number: 1, title: 'test', html_url: '', state: 'open',
          draft: false, merged: false, user: { login: 'u', avatar_url: '' },
          head: { ref: 'feat', sha: 'abc', repo: { full_name: 'owner/repo' } },
          base: { ref: 'main' }, body: null, created_at: '',
          additions: 0, deletions: 0, changed_files: 0,
        },
        repository: { full_name: 'owner/repo' },
        sender: { login: 'u' },
      },
    } as GitHubEventPayload;
    expect(shouldSkipEvent(event)).toBeNull();
  });

  it('never skips schedule events', () => {
    const event: GitHubEventPayload = {
      event: 'schedule',
      payload: { schedule: '*/5 * * * *', repository: { full_name: 'owner/repo' } },
    };
    expect(shouldSkipEvent(event)).toBeNull();
  });
});
