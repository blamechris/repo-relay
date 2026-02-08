/**
 * Discord channel search fallback for recovering message/thread mappings
 * when SQLite state is lost (e.g., on ephemeral GitHub-hosted runners).
 */
const PR_TITLE_PATTERN = /^PR #(\d+):/;
const ISSUE_TITLE_PATTERN = /^Issue #(\d+):/;
/**
 * Search the last 100 messages in a channel for a PR embed matching the given number.
 */
async function findPrMessageInChannel(channel, prNumber) {
    const messages = await channel.messages.fetch({ limit: 100 });
    for (const message of messages.values()) {
        const embed = message.embeds[0];
        if (!embed?.title)
            continue;
        const match = embed.title.match(PR_TITLE_PATTERN);
        if (match && parseInt(match[1], 10) === prNumber) {
            return {
                messageId: message.id,
                threadId: message.thread?.id ?? null,
            };
        }
    }
    return null;
}
/**
 * Search the last 100 messages in a channel for an issue embed matching the given number.
 */
async function findIssueMessageInChannel(channel, issueNumber) {
    const messages = await channel.messages.fetch({ limit: 100 });
    for (const message of messages.values()) {
        const embed = message.embeds[0];
        if (!embed?.title)
            continue;
        const match = embed.title.match(ISSUE_TITLE_PATTERN);
        if (match && parseInt(match[1], 10) === issueNumber) {
            return {
                messageId: message.id,
                threadId: message.thread?.id ?? null,
            };
        }
    }
    return null;
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
    const found = await findPrMessageInChannel(channel, prNumber);
    if (!found)
        return null;
    // Cache back to DB
    db.savePrMessage(repo, prNumber, channel.id, found.messageId, found.threadId ?? undefined);
    db.savePrStatus(repo, prNumber);
    console.log(`[repo-relay] Recovered message for PR #${prNumber} from Discord channel`);
    return {
        repo,
        prNumber,
        channelId: channel.id,
        messageId: found.messageId,
        threadId: found.threadId,
        createdAt: '',
        lastUpdated: '',
    };
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
    const found = await findIssueMessageInChannel(channel, issueNumber);
    if (!found)
        return null;
    // Cache back to DB
    db.saveIssueMessage(repo, issueNumber, channel.id, found.messageId, found.threadId ?? undefined);
    console.log(`[repo-relay] Recovered message for Issue #${issueNumber} from Discord channel`);
    return {
        repo,
        issueNumber,
        channelId: channel.id,
        messageId: found.messageId,
        threadId: found.threadId,
        createdAt: '',
        lastUpdated: '',
    };
}
//# sourceMappingURL=lookup.js.map