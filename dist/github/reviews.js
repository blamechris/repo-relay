/**
 * GitHub API helpers for checking reviews
 *
 * Used to detect Copilot and agent-review status by piggybacking on other events,
 * since GitHub Apps using GITHUB_TOKEN don't trigger workflows.
 */
import { AGENT_REVIEW_PATTERNS, APPROVED_PATTERNS, CHANGES_REQUESTED_PATTERNS, } from '../patterns/agent-review.js';
import { safeErrorMessage } from '../utils/errors.js';
/**
 * Check GitHub API for Copilot reviews and agent-review comments
 * Returns whether any status changed (for deciding whether to update embed)
 */
export async function checkForReviews(db, repo, prNumber, githubToken) {
    const parts = repo.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(`Invalid repo format: expected "owner/name", got "${repo}"`);
    }
    const [owner, repoName] = parts;
    const headers = {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    const currentStatus = db.getPrStatus(repo, prNumber);
    let changed = false;
    const result = {
        copilotReviewed: currentStatus?.copilotStatus === 'reviewed',
        agentReviewStatus: currentStatus?.agentReviewStatus ?? 'pending',
        changed: false,
    };
    // Check for Copilot reviews
    try {
        const reviewsUrl = `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}/reviews?per_page=100`;
        const reviewsRes = await fetch(reviewsUrl, { headers });
        if (reviewsRes.ok) {
            const reviews = await reviewsRes.json();
            const copilotReview = reviews.find(r => r.user?.type === 'Bot' && r.user?.login?.toLowerCase().includes('copilot'));
            if (copilotReview && currentStatus?.copilotStatus !== 'reviewed') {
                console.log(`[repo-relay] Detected Copilot review for PR #${prNumber}`);
                db.updateCopilotStatus(repo, prNumber, 'reviewed', 0);
                result.copilotReviewed = true;
                result.copilotUrl = copilotReview.html_url;
                changed = true;
            }
        }
    }
    catch (error) {
        console.log(`[repo-relay] Warning: Failed to check Copilot reviews: ${safeErrorMessage(error)}`);
    }
    // Check for agent-review comments
    try {
        const commentsUrl = `https://api.github.com/repos/${owner}/${repoName}/issues/${prNumber}/comments?per_page=100`;
        const commentsRes = await fetch(commentsUrl, { headers });
        if (commentsRes.ok) {
            const comments = await commentsRes.json();
            // Find the most recent agent-review comment
            const matchingComments = comments.filter(c => AGENT_REVIEW_PATTERNS.some(p => p.test(c.body)));
            const agentReviewComment = matchingComments
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
            if (agentReviewComment) {
                let status = 'pending';
                if (APPROVED_PATTERNS.some(p => p.test(agentReviewComment.body))) {
                    status = 'approved';
                }
                else if (CHANGES_REQUESTED_PATTERNS.some(p => p.test(agentReviewComment.body))) {
                    status = 'changes_requested';
                }
                if (currentStatus?.agentReviewStatus !== status) {
                    console.log(`[repo-relay] Detected agent-review (${status}) for PR #${prNumber}`);
                    db.updateAgentReviewStatus(repo, prNumber, status);
                    result.agentReviewStatus = status;
                    result.agentReviewUrl = agentReviewComment.html_url;
                    changed = true;
                }
            }
        }
    }
    catch (error) {
        console.log(`[repo-relay] Warning: Failed to check agent-review comments: ${safeErrorMessage(error)}`);
    }
    result.changed = changed;
    return result;
}
//# sourceMappingURL=reviews.js.map