import { describe, it, expect, vi } from 'vitest';
import { TextChannel } from 'discord.js';
import { shouldSkipEvent } from '../pre-filter.js';
import type { GitHubEventPayload } from '../index.js';
import { handlePushEvent, type PushEventPayload } from '../handlers/push.js';
import { handleReleaseEvent, type ReleaseEventPayload } from '../handlers/release.js';
import { handleDeploymentEvent, type DeploymentStatusPayload } from '../handlers/deployment.js';
import { handleIssueEvent, type IssueEventPayload } from '../handlers/issue.js';
import { handleReviewEvent, type PrReviewPayload } from '../handlers/review.js';
import { handleCiEvent, type WorkflowRunPayload } from '../handlers/ci.js';

/**
 * The pre-filter "approximates the corresponding handlers' early-exit
 * conditions" (pre-filter.ts). These tests guard that contract against
 * drift: for each event family, a representative payload that PASSES the
 * pre-filter must also get past the handler's mirrored early-exits (the
 * handler may still stop later for non-mirrored reasons, e.g. no tracked
 * message — that is fine).
 */

function makeMockChannel() {
  const message = {
    id: 'msg-1',
    edit: vi.fn(),
    startThread: vi.fn(() => Promise.resolve({ id: 'thread-1', send: vi.fn() })),
  };
  const channel = Object.create(TextChannel.prototype);
  Object.assign(channel, {
    id: 'channel-1',
    send: vi.fn(() => Promise.resolve(message)),
    messages: {
      fetch: vi.fn((arg?: string | object) =>
        typeof arg === 'string' ? Promise.resolve(message) : Promise.resolve(new Map())
      ),
    },
    threads: { fetch: vi.fn(() => Promise.reject(new Error('Unknown Channel'))) },
  });
  return channel as TextChannel & { send: ReturnType<typeof vi.fn> };
}

function makeMockDb() {
  return {
    logEvent: vi.fn(),
    getPrMessage: vi.fn(() => null),
    savePrMessage: vi.fn(),
    savePrStatus: vi.fn(),
    savePrData: vi.fn(),
    getPrData: vi.fn(() => null),
    getPrStatus: vi.fn(() => null),
    updateCiStatus: vi.fn(),
    updatePrMessageTimestamp: vi.fn(),
    getIssueMessage: vi.fn(() => null),
    saveIssueMessage: vi.fn(),
    updateIssueThread: vi.fn(),
  };
}

function makeMockClient(channel: TextChannel) {
  return { channels: { fetch: vi.fn(() => Promise.resolve(channel)) } };
}

const channelConfig = { prs: 'channel-1' } as never;

describe('pre-filter / handler parity', () => {
  it('push: payload passing the pre-filter reaches channel.send in the handler', async () => {
    const payload: PushEventPayload = {
      ref: 'refs/heads/main',
      before: 'a'.repeat(40),
      after: 'b'.repeat(40),
      forced: false,
      compare: 'https://github.com/owner/repo/compare/a...b',
      created: false,
      deleted: false,
      commits: [{ id: 'c1', message: 'fix: thing', author: { name: 'u' } }],
      head_commit: { id: 'c1', message: 'fix: thing' },
      pusher: { name: 'u' },
      sender: { login: 'u', avatar_url: 'https://avatar.url' },
      repository: { full_name: 'owner/repo', default_branch: 'main' },
    };
    expect(shouldSkipEvent({ event: 'push', payload } as GitHubEventPayload)).toBeNull();

    const channel = makeMockChannel();
    const db = makeMockDb();
    await handlePushEvent(makeMockClient(channel) as never, db as never, channelConfig, payload);

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(db.logEvent).toHaveBeenCalledWith('owner/repo', null, 'push', payload);
  });

  it('release: payload passing the pre-filter reaches channel.send in the handler', async () => {
    const payload: ReleaseEventPayload = {
      action: 'published',
      release: {
        id: 1,
        name: 'v1.0.0',
        tag_name: 'v1.0.0',
        html_url: 'https://github.com/owner/repo/releases/v1.0.0',
        author: { login: 'u', avatar_url: 'https://avatar.url' },
        body: 'notes',
        prerelease: false,
        draft: false,
        published_at: '2024-01-01T00:00:00Z',
      },
      repository: { full_name: 'owner/repo' },
    };
    expect(shouldSkipEvent({ event: 'release', payload } as GitHubEventPayload)).toBeNull();

    const channel = makeMockChannel();
    const db = makeMockDb();
    await handleReleaseEvent(makeMockClient(channel) as never, db as never, channelConfig, payload);

    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it('deployment_status: terminal state passing the pre-filter reaches channel.send', async () => {
    const payload: DeploymentStatusPayload = {
      action: 'created',
      deployment_status: {
        state: 'success',
        description: null,
        environment: 'prod',
        target_url: null,
        creator: { login: 'u', avatar_url: 'https://avatar.url' },
      },
      deployment: { id: 1, ref: 'main', sha: 'abc1234', environment: 'prod', description: null },
      repository: { full_name: 'owner/repo' },
    };
    expect(shouldSkipEvent({ event: 'deployment_status', payload } as GitHubEventPayload)).toBeNull();

    const channel = makeMockChannel();
    const db = makeMockDb();
    await handleDeploymentEvent(makeMockClient(channel) as never, db as never, channelConfig, payload);

    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it('issues: opened passing the pre-filter creates the embed', async () => {
    const payload: IssueEventPayload = {
      action: 'opened',
      issue: {
        number: 5,
        title: 'A bug',
        html_url: 'https://github.com/owner/repo/issues/5',
        user: { login: 'u', avatar_url: 'https://avatar.url' },
        state: 'open',
        labels: [],
        body: null,
        created_at: '2024-01-01T00:00:00Z',
      },
      repository: { full_name: 'owner/repo' },
      sender: { login: 'u' },
    };
    expect(shouldSkipEvent({ event: 'issues', payload } as GitHubEventPayload)).toBeNull();

    const channel = makeMockChannel();
    const db = makeMockDb();
    await handleIssueEvent(makeMockClient(channel) as never, db as never, channelConfig, payload);

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(db.saveIssueMessage).toHaveBeenCalled();
  });

  it('pull_request_review: submitted non-owner review passing the pre-filter is logged by the handler', async () => {
    const payload: PrReviewPayload = {
      action: 'submitted',
      review: {
        id: 1,
        user: { login: 'reviewer', type: 'User' },
        body: 'lgtm',
        state: 'approved',
        html_url: 'https://github.com/owner/repo/pull/7#review-1',
      },
      pull_request: { number: 7 },
      repository: { full_name: 'owner/repo', owner: { login: 'owner' } },
    } as PrReviewPayload;
    expect(shouldSkipEvent({ event: 'pull_request_review', payload } as GitHubEventPayload)).toBeNull();

    const channel = makeMockChannel();
    const db = makeMockDb();
    await handleReviewEvent(makeMockClient(channel) as never, db as never, channelConfig, payload);

    // Past the mirrored action/owner-reply exits (it may stop later because
    // no message is tracked — a non-mirrored reason)
    expect(db.logEvent).toHaveBeenCalledWith('owner/repo', 7, 'review.submitted', payload);
  });

  it('workflow_run: payload with PRs passing the pre-filter is processed per PR', async () => {
    const payload: WorkflowRunPayload = {
      action: 'completed',
      workflow_run: {
        id: 1,
        name: 'CI',
        head_sha: 'abc1234def',
        head_branch: 'feat/x',
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/owner/repo/actions/runs/1',
        pull_requests: [{ number: 7 }],
      },
      repository: { full_name: 'owner/repo' },
    };
    expect(shouldSkipEvent({ event: 'workflow_run', payload } as GitHubEventPayload)).toBeNull();

    const channel = makeMockChannel();
    const db = makeMockDb();
    await handleCiEvent(makeMockClient(channel) as never, db as never, channelConfig, payload);

    // Past the mirrored no-PRs exit: the handler logged the event for PR #7
    expect(db.logEvent).toHaveBeenCalledWith('owner/repo', 7, 'ci.completed', payload);
  });
});
