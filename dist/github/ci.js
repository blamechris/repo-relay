/**
 * GitHub API helpers for fetching CI failure details
 */
import { safeErrorMessage } from '../utils/errors.js';
/**
 * Fetch failed steps from a GitHub Actions workflow run.
 * Returns [] on any error (graceful fallback).
 */
export async function fetchFailedSteps(repo, runId, githubToken) {
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
        const data = await res.json();
        const failedSteps = [];
        for (const job of data.jobs) {
            if (job.conclusion !== 'failure')
                continue;
            for (const step of job.steps ?? []) {
                if (step.conclusion === 'failure') {
                    failedSteps.push({ jobName: job.name, stepName: step.name });
                }
            }
        }
        return failedSteps;
    }
    catch (error) {
        console.log(`[repo-relay] Warning: Failed to fetch CI failure details: ${safeErrorMessage(error)}`);
        return [];
    }
}
//# sourceMappingURL=ci.js.map