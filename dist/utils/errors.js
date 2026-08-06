/**
 * Dependency-free error helpers. This module is on the setup wizard's eager
 * import path (both bins) — it must not import discord.js or other Actions
 * runtime deps (#185). Discord-aware classification lives in
 * discord-errors.ts.
 */
/** Extract a safe message from an unknown thrown value. */
export function safeErrorMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/**
 * A definitive configuration problem (bad token, missing channel/permissions)
 * that the repo owner must fix — as opposed to transient infrastructure
 * trouble. Under best-effort delivery these still fail the run.
 */
export class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigError';
    }
}
//# sourceMappingURL=errors.js.map