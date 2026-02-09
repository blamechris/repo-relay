/**
 * GitHub API helpers for fetching CI failure details
 */

import { safeErrorMessage } from '../utils/errors.js';

export interface FailedStep {
  jobName: string;
  stepName: string;
}

interface GitHubJob {
  name: string;
  conclusion: string | null;
  steps?: Array<{
    name: string;
    conclusion: string | null;
  }>;
}

interface GitHubJobsResponse {
  jobs: GitHubJob[];
}

/**
 * Fetch failed steps from a GitHub Actions workflow run.
 * Returns [] on any error (graceful fallback).
 */
export async function fetchFailedSteps(
  repo: string,
  runId: number,
  githubToken: string
): Promise<FailedStep[]> {
  try {
    const url = `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!res.ok) {
      return [];
    }

    const data = await res.json() as GitHubJobsResponse;
    const failedSteps: FailedStep[] = [];

    for (const job of data.jobs) {
      if (job.conclusion !== 'failure') continue;
      for (const step of job.steps ?? []) {
        if (step.conclusion === 'failure') {
          failedSteps.push({ jobName: job.name, stepName: step.name });
        }
      }
    }

    return failedSteps;
  } catch (error) {
    console.log(`[repo-relay] Warning: Failed to fetch CI failure details: ${safeErrorMessage(error)}`);
    return [];
  }
}
