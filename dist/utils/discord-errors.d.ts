/**
 * Discord error classification helpers.
 *
 * Error-code checks are primary (stable across discord.js versions); the
 * message-substring fallbacks tolerate wrapped errors and keep behavior
 * consistent for callers that surface plain Errors.
 */
/** The referenced message no longer exists on Discord (stale DB entry). */
export declare function isUnknownMessageError(error: unknown): boolean;
/** startThread was called on a message that already has a (possibly archived) thread. */
export declare function isThreadAlreadyCreatedError(error: unknown): boolean;
//# sourceMappingURL=discord-errors.d.ts.map