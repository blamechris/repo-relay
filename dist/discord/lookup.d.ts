/**
 * Discord channel search fallback for recovering message/thread mappings
 * when SQLite state is lost (e.g., on ephemeral GitHub-hosted runners).
 */
import { TextChannel } from 'discord.js';
import { StateDb, PrMessage, IssueMessage } from '../db/state.js';
/**
 * Get an existing PR message mapping, falling back to Discord channel search.
 * If found via search, caches the result back to the DB.
 */
export declare function getExistingPrMessage(db: StateDb, channel: TextChannel, repo: string, prNumber: number): Promise<PrMessage | null>;
/**
 * Get an existing issue message mapping, falling back to Discord channel search.
 * If found via search, caches the result back to the DB.
 */
export declare function getExistingIssueMessage(db: StateDb, channel: TextChannel, repo: string, issueNumber: number): Promise<IssueMessage | null>;
//# sourceMappingURL=lookup.d.ts.map