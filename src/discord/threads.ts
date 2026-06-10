/**
 * Shared recovery/creation logic for the update thread attached to an
 * embed message (PRs and issues differ only in naming and persistence).
 */

import { TextChannel, ThreadChannel } from 'discord.js';
import { withRetry } from '../utils/retry.js';
import { isThreadAlreadyCreatedError } from '../utils/discord-errors.js';

/** The subset of a stored message row needed to locate its thread. */
export interface ThreadAnchor {
  messageId: string;
  threadId: string | null;
}

/**
 * Get the existing thread for a message or create one if it doesn't exist.
 * `persistThreadId` is called whenever a thread ID needs to be (re)saved.
 */
export async function getOrCreateMessageThread(
  channel: TextChannel,
  existing: ThreadAnchor,
  threadName: string,
  seedMessage: string,
  persistThreadId: (threadId: string) => void
): Promise<ThreadChannel> {
  // A message thread's ID equals its parent message's ID, so even when the
  // DB has no threadId (channel-search recovery can't see archived threads —
  // Message#thread is cache-only), the thread is still fetchable directly.
  const threadId = existing.threadId ?? existing.messageId;
  const recovered = await fetchAndUnarchiveThread(channel, threadId);
  if (recovered) {
    if (!existing.threadId) {
      persistThreadId(recovered.id);
    }
    return recovered;
  }

  // Create a new thread on the message
  const message = await withRetry(() => channel.messages.fetch(existing.messageId));
  let thread: ThreadChannel;
  try {
    thread = await withRetry(() =>
      message.startThread({
        name: threadName,
        autoArchiveDuration: 1440, // 24 hours
      })
    );
  } catch (error: unknown) {
    // 160004: the message already has a thread we couldn't see — fetch it
    if (isThreadAlreadyCreatedError(error)) {
      const fallback = await fetchAndUnarchiveThread(channel, existing.messageId);
      if (fallback) {
        persistThreadId(fallback.id);
        return fallback;
      }
    }
    throw error;
  }

  // Update the database with the new thread ID
  persistThreadId(thread.id);

  await withRetry(() => thread.send(seedMessage));

  return thread;
}

/** Fetch a thread by ID and unarchive it; null if it doesn't exist. */
export async function fetchAndUnarchiveThread(
  channel: TextChannel,
  threadId: string
): Promise<ThreadChannel | null> {
  try {
    const thread = await withRetry(() => channel.threads.fetch(threadId));
    if (!thread) return null;
    if (thread.archived) {
      await withRetry(async () => { await thread.setArchived(false); });
    }
    return thread;
  } catch {
    return null;
  }
}
