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
/**
 * Is this a definitive configuration error (vs transient infrastructure)?
 *
 * The config-fatal set is deliberately a closed enumeration: outage shapes
 * are open-ended, and an unclassified transient error tolerated as
 * best-effort is annoying, while an unclassified transient error treated as
 * config would re-create a red X on every PR until the action is patched.
 */
export declare function isConfigError(error: unknown): boolean;
//# sourceMappingURL=errors.d.ts.map