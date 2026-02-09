/**
 * GitHub API helpers for fetching CI failure details
 */
export interface FailedStep {
    jobName: string;
    stepName: string;
}
/**
 * Fetch failed steps from a GitHub Actions workflow run.
 * Returns [] on any error (graceful fallback).
 */
export declare function fetchFailedSteps(repo: string, runId: number, githubToken: string): Promise<FailedStep[]>;
//# sourceMappingURL=ci.d.ts.map