/**
 * Shared agent-review detection patterns
 *
 * Used by both the webhook handler (comment.ts) and piggyback polling (reviews.ts)
 * to ensure consistent detection regardless of code path.
 */
/** Patterns that identify a comment as an agent-review */
export declare const AGENT_REVIEW_PATTERNS: RegExp[];
/** Patterns that indicate an approved verdict */
export declare const APPROVED_PATTERNS: RegExp[];
/** Patterns that indicate changes were requested */
export declare const CHANGES_REQUESTED_PATTERNS: RegExp[];
//# sourceMappingURL=agent-review.d.ts.map