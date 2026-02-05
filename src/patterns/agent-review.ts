/**
 * Shared agent-review detection patterns
 *
 * Used by both the webhook handler (comment.ts) and piggyback polling (reviews.ts)
 * to ensure consistent detection regardless of code path.
 */

/** Patterns that identify a comment as an agent-review */
export const AGENT_REVIEW_PATTERNS = [
  /## Code Review Summary/i,
  /### Agent Review/i,
  /## 🔍 Code Review/i,
  /\*\*Verdict:\*\*/i,
  /## Review Result/i,
  /## Code Review: PR #\d+/i,
];

/** Patterns that indicate an approved verdict */
export const APPROVED_PATTERNS = [
  /verdict.*approved/i,
  /✅.*approved/i,
  /lgtm/i,
  /looks good to me/i,
  /\[x\].*approve/i,
];

/** Patterns that indicate changes were requested */
export const CHANGES_REQUESTED_PATTERNS = [
  /changes.*requested/i,
  /⚠️.*changes/i,
  /needs.*changes/i,
  /\[x\].*request changes/i,
];
