/**
 * GitHub API helpers for checking reviews
 *
 * Used to detect Copilot and agent-review status by piggybacking on other events,
 * since GitHub Apps using GITHUB_TOKEN don't trigger workflows.
 */
// Patterns to detect agent-review comments (same as comment.ts)
const AGENT_REVIEW_PATTERNS = [
    /## Code Review Summary/i,
    /### Agent Review/i,
    /## 🔍 Code Review/i,
    /\*\*Verdict:\*\*/i,
    /## Review Result/i,
    /## Code Review: PR #\d+/i,
];
const APPROVED_PATTERNS = [
    /verdict.*approved/i,
    /✅.*approved/i,
    /\[x\].*approve/i,
];
const CHANGES_REQUESTED_PATTERNS = [
    /changes.*requested/i,
    /⚠️.*changes/i,
    /needs.*changes/i,
    /\[x\].*request changes/i,
];
/**
 * Check GitHub API for Copilot reviews and agent-review comments
 * Returns whether any status changed (for deciding whether to update embed)
 */
export async function checkForReviews(db, repo, prNumber, githubToken) {
    const [owner, repoName] = repo.split('/');
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
        const reviewsUrl = `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}/reviews`;
        const reviewsRes = await fetch(reviewsUrl, { headers });
        if (reviewsRes.ok) {
            const reviews = await reviewsRes.json();
            const copilotReview = reviews.find(r => r.user?.login?.toLowerCase().includes('copilot') ||
                r.user?.type === 'Bot' && r.user?.login?.toLowerCase().includes('copilot'));
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
        console.log(`[repo-relay] Warning: Failed to check Copilot reviews: ${error}`);
    }
    // Check for agent-review comments
    try {
        const commentsUrl = `https://api.github.com/repos/${owner}/${repoName}/issues/${prNumber}/comments`;
        console.log(`[repo-relay] Fetching comments from: ${commentsUrl}`);
        const commentsRes = await fetch(commentsUrl, { headers });
        console.log(`[repo-relay] Comments API response: ${commentsRes.status}`);
        if (commentsRes.ok) {
            const comments = await commentsRes.json();
            console.log(`[repo-relay] Found ${comments.length} comments`);
            // Find the most recent agent-review comment
            const matchingComments = comments.filter(c => AGENT_REVIEW_PATTERNS.some(p => p.test(c.body)));
            console.log(`[repo-relay] Found ${matchingComments.length} comments matching agent-review patterns`);
            if (matchingComments.length === 0 && comments.length > 0) {
                console.log(`[repo-relay] First comment preview: ${comments[0].body?.substring(0, 100)}...`);
            }
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
        console.log(`[repo-relay] Warning: Failed to check agent-review comments: ${error}`);
    }
    result.changed = changed;
    return result;
}
//# sourceMappingURL=reviews.js.map