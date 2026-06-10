/**
 * Shared recovery/creation logic for the update thread attached to an
 * embed message (PRs and issues differ only in naming and persistence).
 */
import { TextChannel, ThreadChannel } from 'discord.js';
/** The subset of a stored message row needed to locate its thread. */
export interface ThreadAnchor {
    messageId: string;
    threadId: string | null;
}
/**
 * Get the existing thread for a message or create one if it doesn't exist.
 * `persistThreadId` is called whenever a thread ID needs to be (re)saved.
 */
export declare function getOrCreateMessageThread(channel: TextChannel, existing: ThreadAnchor, threadName: string, seedMessage: string, persistThreadId: (threadId: string) => void): Promise<ThreadChannel>;
/** Fetch a thread by ID and unarchive it; null if it doesn't exist. */
export declare function fetchAndUnarchiveThread(channel: TextChannel, threadId: string): Promise<ThreadChannel | null>;
//# sourceMappingURL=threads.d.ts.map