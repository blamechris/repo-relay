/**
 * GitHub API helpers for checking reviews
 *
 * Used to detect Copilot and agent-review status by piggybacking on other events,
 * since GitHub Apps using GITHUB_TOKEN don't trigger workflows.
 */
import { AGENT_REVIEW_PATTERNS, APPROVED_PATTERNS, CHANGES_REQUESTED_PATTERNS, } from '../patterns/agent-review.js';
import { safeErrorMessage } from '../utils/errors.js';
/** Bound pagination — 10 pages × 100 items covers any realistic PR. */
const MAX_PAGES = 10;
function parseNextLink(header) {
    if (!header)
        return null;
    const match = header.match(/<([^>]+)>;\s*rel="next"/);
    return match ? match[1] : null;
}
/**
 * Fetch all pages of a GitHub list endpoint. Issue comments are returned
 * ascending by created_at, so on busy PRs the newest agent-review comment is
 * precisely the one past page 1 — a single-page fetch silently misses it.
 * Non-2xx responses are logged (a rate-limited poll must not look identical
 * to "no reviews") and return the pages collected so far.
 */
async function fetchAllPages(startUrl, headers, label) {
    const results = [];
    let url = startUrl;
    let pages = 0;
    while (url && pages < MAX_PAGES) {
        const res = await fetch(url, { headers });
        if (!res.ok) {
            const remaining = res.headers.get('x-ratelimit-remaining');
            const rateNote = remaining === '0' ? ' (rate limit exhausted)' : '';
            console.log(`[repo-relay] Warning: GitHub API ${label} request failed: HTTP ${res.status}${rateNote}`);
            return results;
        }
        results.push(...(await res.json()));
        url = parseNextLink(res.headers.get('link'));
        pages++;
    }
    if (url) {
        console.log(`[repo-relay] Warning: ${label} pagination capped at ${MAX_PAGES} pages`);
    }
    return results;
}
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
        const reviews = await fetchAllPages(reviewsUrl, headers, 'reviews');
        const copilotReview = reviews.find(r => r.user?.type === 'Bot' && r.user?.login?.toLowerCase().includes('copilot'));
        if (copilotReview && currentStatus?.copilotStatus !== 'reviewed') {
            console.log(`[repo-relay] Detected Copilot review for PR #${prNumber}`);
            db.updateCopilotStatus(repo, prNumber, 'reviewed', 0);
            result.copilotReviewed = true;
            result.copilotUrl = copilotReview.html_url;
            changed = true;
        }
    }
    catch (error) {
        console.log(`[repo-relay] Warning: Failed to check Copilot reviews: ${safeErrorMessage(error)}`);
    }
    // Check for agent-review comments
    try {
        const commentsUrl = `https://api.github.com/repos/${owner}/${repoName}/issues/${prNumber}/comments?per_page=100`;
        const comments = await fetchAllPages(commentsUrl, headers, 'comments');
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
    catch (error) {
        console.log(`[repo-relay] Warning: Failed to check agent-review comments: ${safeErrorMessage(error)}`);
    }
    result.changed = changed;
    return result;
}
//# sourceMappingURL=reviews.js.map