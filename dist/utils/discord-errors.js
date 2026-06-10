/**
 * Discord error classification helpers.
 *
 * Error-code checks are primary (stable across discord.js versions); the
 * message-substring fallbacks tolerate wrapped errors and keep behavior
 * consistent for callers that surface plain Errors.
 */
import { DiscordAPIError } from 'discord.js';
const UNKNOWN_MESSAGE = 10008; // RESTJSONErrorCodes.UnknownMessage
const THREAD_ALREADY_CREATED = 160004; // RESTJSONErrorCodes.ThreadAlreadyCreatedForThisMessage
/** The referenced message no longer exists on Discord (stale DB entry). */
export function isUnknownMessageError(error) {
    if (error instanceof DiscordAPIError && error.code === UNKNOWN_MESSAGE)
        return true;
    return error instanceof Error && error.message.includes('Unknown Message');
}
/** startThread was called on a message that already has a (possibly archived) thread. */
export function isThreadAlreadyCreatedError(error) {
    if (error instanceof DiscordAPIError && error.code === THREAD_ALREADY_CREATED)
        return true;
    return error instanceof Error && error.message.includes('already has a thread');
}
//# sourceMappingURL=discord-errors.js.map