/**
 * Dependency-free error helpers. This module is on the setup wizard's eager
 * import path (both bins) — it must not import discord.js or other Actions
 * runtime deps (#185). Discord-aware classification lives in
 * discord-errors.ts.
 */
/** Extract a safe message from an unknown thrown value. */
export declare function safeErrorMessage(error: unknown): string;
/**
 * A definitive configuration problem (bad token, missing channel/permissions)
 * that the repo owner must fix — as opposed to transient infrastructure
 * trouble. Under best-effort delivery these still fail the run.
 */
export declare class ConfigError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=errors.d.ts.map