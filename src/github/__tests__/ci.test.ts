import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchFailedSteps } from '../ci.js';

describe('fetchFailedSteps', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts failed steps from jobs response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        jobs: [
          {
            name: 'build',
            conclusion: 'failure',
            steps: [
              { name: 'Checkout', conclusion: 'success' },
              { name: 'Run tests', conclusion: 'failure' },
            ],
          },
          {
            name: 'lint',
            conclusion: 'failure',
            steps: [
              { name: 'ESLint', conclusion: 'failure' },
            ],
          },
        ],
      }),
    } as Response);

    const steps = await fetchFailedSteps('owner/repo', 123, 'token');
    expect(steps).toEqual([
      { jobName: 'build', stepName: 'Run tests' },
      { jobName: 'lint', stepName: 'ESLint' },
    ]);
  });

  it('returns [] for non-failure jobs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        jobs: [
          {
            name: 'build',
            conclusion: 'success',
            steps: [
              { name: 'Checkout', conclusion: 'success' },
              { name: 'Run tests', conclusion: 'success' },
            ],
          },
        ],
      }),
    } as Response);

    const steps = await fetchFailedSteps('owner/repo', 123, 'token');
    expect(steps).toEqual([]);
  });

  it('returns [] on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const steps = await fetchFailedSteps('owner/repo', 123, 'token');
    expect(steps).toEqual([]);
  });

  it('returns [] on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));

    const steps = await fetchFailedSteps('owner/repo', 123, 'token');
    expect(steps).toEqual([]);
  });
});
