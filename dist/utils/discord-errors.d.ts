/**
 * Discord error classification helpers.
 *
 * Error-code checks are primary (stable across discord.js versions); the
 * message-substring fallbacks tolerate wrapped errors and keep behavior
 * consistent for callers that surface plain Errors.
 */
/**
 * Is this a definitive configuration error (vs transient infrastructure)?
 *
 * The config-fatal set is deliberately a closed enumeration: outage shapes
 * are open-ended, and an unclassified transient error tolerated as
 * best-effort is annoying, while an unclassified transient error treated as
 * config would re-create a red X on every PR until the action is patched.
 *
 * Lives here rather than errors.ts because it needs the discord.js error
 * classes — errors.ts stays dependency-free for the setup wizard (#185).
 */
export declare function isConfigError(error: unknown): boolean;
/** The referenced message no longer exists on Discord (stale DB entry). */
export declare function isUnknownMessageError(error: unknown): boolean;
/** startThread was called on a message that already has a (possibly archived) thread. */
export declare function isThreadAlreadyCreatedError(error: unknown): boolean;
//# sourceMappingURL=discord-errors.d.ts.map