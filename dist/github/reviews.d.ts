/**
 * GitHub API helpers for checking reviews
 *
 * Used to detect Copilot and agent-review status by piggybacking on other events,
 * since GitHub Apps using GITHUB_TOKEN don't trigger workflows.
 */
import { StateDb } from '../db/state.js';
export interface ReviewCheckResult {
    copilotReviewed: boolean;
    copilotUrl?: string;
    agentReviewStatus: 'approved' | 'changes_requested' | 'pending' | 'none';
    agentReviewUrl?: string;
    changed: boolean;
}
/**
 * Check GitHub API for Copilot reviews and agent-review comments
 * Returns whether any status changed (for deciding whether to update embed)
 */
export declare function checkForReviews(db: StateDb, repo: string, prNumber: number, githubToken: string): Promise<ReviewCheckResult>;
//# sourceMappingURL=reviews.d.ts.map