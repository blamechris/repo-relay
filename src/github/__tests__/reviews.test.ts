import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkForReviews } from '../reviews.js';

function makeDb(status: Partial<{
  copilotStatus: 'pending' | 'reviewed';
  agentReviewStatus: 'pending' | 'approved' | 'changes_requested' | 'none';
}> = {}) {
  return {
    getPrStatus: vi.fn(() => ({
      repo: 'test/repo',
      prNumber: 7,
      copilotStatus: status.copilotStatus ?? 'pending',
      copilotComments: 0,
      agentReviewStatus: status.agentReviewStatus ?? 'pending',
      ciStatus: 'pending',
      ciWorkflowName: null,
      ciUrl: null,
    })),
    updateCopilotStatus: vi.fn(),
    updateAgentReviewStatus: vi.fn(),
  };
}

function jsonResponse(body: unknown, opts: { status?: number; link?: string } = {}) {
  const headers = new Map<string, string>();
  if (opts.link) headers.set('link', opts.link);
  return {
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    json: async () => body,
  };
}

const copilotReview = {
  id: 1,
  user: { login: 'copilot-pull-request-reviewer[bot]', type: 'Bot' },
  state: 'COMMENTED',
  body: 'review',
  html_url: 'https://github.com/test/repo/pull/7#review-1',
};

function agentComment(id: number, body: string, createdAt: string) {
  return {
    id,
    user: { login: 'agent-bot', type: 'Bot' },
    body,
    html_url: `https://github.com/test/repo/pull/7#comment-${id}`,
    created_at: createdAt,
  };
}

describe('checkForReviews', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects a Copilot review and marks changed', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([copilotReview]) as never)
      .mockResolvedValueOnce(jsonResponse([]) as never);
    const db = makeDb();

    const result = await checkForReviews(db as never, 'test/repo', 7, 'token');

    expect(db.updateCopilotStatus).toHaveBeenCalledWith('test/repo', 7, 'reviewed', 0);
    expect(result.copilotReviewed).toBe(true);
    expect(result.changed).toBe(true);
  });

  it('does not re-announce an already-recorded Copilot review', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([copilotReview]) as never)
      .mockResolvedValueOnce(jsonResponse([]) as never);
    const db = makeDb({ copilotStatus: 'reviewed' });

    const result = await checkForReviews(db as never, 'test/repo', 7, 'token');

    expect(db.updateCopilotStatus).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
  });

  it('follows Link pagination — an agent review beyond page 1 is found', async () => {
    // Issue comments are returned ascending by created_at, so on busy PRs the
    // latest agent-review comment is precisely the one past the first page.
    const page1 = Array.from({ length: 100 }, (_, i) =>
      agentComment(i, `comment ${i}`, '2024-01-01T00:00:00Z')
    );
    const page2 = [agentComment(200, '## Code Review Summary\n**Verdict:** Approved', '2024-02-01T00:00:00Z')];

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([]) as never) // reviews
      .mockResolvedValueOnce(jsonResponse(page1, {
        link: '<https://api.github.com/repos/test/repo/issues/7/comments?page=2>; rel="next"',
      }) as never)
      .mockResolvedValueOnce(jsonResponse(page2) as never);
    const db = makeDb();

    const result = await checkForReviews(db as never, 'test/repo', 7, 'token');

    expect(db.updateAgentReviewStatus).toHaveBeenCalledWith('test/repo', 7, 'approved');
    expect(result.agentReviewStatus).toBe('approved');
    expect(result.changed).toBe(true);
  });

  it('logs non-2xx responses instead of silently ignoring them', async () => {
    const logSpy = vi.spyOn(console, 'log');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ message: 'rate limited' }, { status: 403 }) as never)
      .mockResolvedValueOnce(jsonResponse({ message: 'rate limited' }, { status: 403 }) as never);
    const db = makeDb();

    const result = await checkForReviews(db as never, 'test/repo', 7, 'token');

    expect(result.changed).toBe(false);
    const warned = logSpy.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].includes('HTTP 403')
    );
    expect(warned).toBe(true);
    logSpy.mockRestore();
  });

  it('agent-review status transition gating: same status does not re-announce', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([]) as never)
      .mockResolvedValueOnce(jsonResponse([
        agentComment(1, '## Code Review Summary\n**Verdict:** Approved', '2024-01-01T00:00:00Z'),
      ]) as never);
    const db = makeDb({ agentReviewStatus: 'approved' });

    const result = await checkForReviews(db as never, 'test/repo', 7, 'token');

    expect(db.updateAgentReviewStatus).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
  });
});
