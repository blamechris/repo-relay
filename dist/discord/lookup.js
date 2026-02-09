/**
 * Discord channel search fallback for recovering message/thread mappings
 * when SQLite state is lost (e.g., on ephemeral GitHub-hosted runners).
 */
import { safeErrorMessage } from '../utils/errors.js';
const PR_TITLE_PATTERN = /PR #(\d+):/;
const ISSUE_TITLE_PATTERN = /Issue #(\d+):/;
/**
 * Search the last 100 messages in a channel for an embed matching the given pattern, number, and repo.
 */
async function findMessageInChannel(channel, pattern, repo, targetNumber, label) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        for (const message of messages.values()) {
            const embed = message.embeds[0];
            if (!embed?.title)
                continue;
            const match = embed.title.match(pattern);
            if (match && parseInt(match[1], 10) === targetNumber) {
                // Verify the embed belongs to this repo via its URL
                if (embed.url && !embed.url.includes(`github.com/${repo}/`))
                    continue;
                return {
                    messageId: message.id,
                    threadId: message.thread?.id ?? null,
                };
            }
        }
        return null;
    }
    catch (err) {
        console.error(`[repo-relay] Channel search failed for ${label} #${targetNumber}: ${safeErrorMessage(err)}`);
        return null;
    }
}
/**
 * Get an existing PR message mapping, falling back to Discord channel search.
 * If found via search, caches the result back to the DB.
 */
export async function getExistingPrMessage(db, channel, repo, prNumber) {
    // Fast path: DB lookup
    const cached = db.getPrMessage(repo, prNumber);
    if (cached)
        return cached;
    // Slow path: search Discord channel
    const found = await findMessageInChannel(channel, PR_TITLE_PATTERN, repo, prNumber, 'PR');
    if (!found)
        return null;
    // Cache back to DB and return the saved row
    db.savePrMessage(repo, prNumber, channel.id, found.messageId, found.threadId ?? undefined);
    db.savePrStatus(repo, prNumber);
    console.log(`[repo-relay] Recovered message for PR #${prNumber} from Discord channel`);
    return db.getPrMessage(repo, prNumber);
}
/**
 * Get an existing issue message mapping, falling back to Discord channel search.
 * If found via search, caches the result back to the DB.
 */
export async function getExistingIssueMessage(db, channel, repo, issueNumber) {
    // Fast path: DB lookup
    const cached = db.getIssueMessage(repo, issueNumber);
    if (cached)
        return cached;
    // Slow path: search Discord channel
    const found = await findMessageInChannel(channel, ISSUE_TITLE_PATTERN, repo, issueNumber, 'Issue');
    if (!found)
        return null;
    // Cache back to DB and return the saved row
    db.saveIssueMessage(repo, issueNumber, channel.id, found.messageId, found.threadId ?? undefined);
    console.log(`[repo-relay] Recovered message for Issue #${issueNumber} from Discord channel`);
    return db.getIssueMessage(repo, issueNumber);
}
//# sourceMappingURL=lookup.js.map