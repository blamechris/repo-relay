/**
 * Retry wrapper with exponential backoff for Discord API 5xx errors.
 */
export declare function withRetry<T>(fn: () => Promise<T>, retries?: number, baseDelay?: number): Promise<T>;
//# sourceMappingURL=retry.d.ts.map