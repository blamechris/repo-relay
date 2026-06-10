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

/** Author associations allowed to set review state (besides bots). */
const TRUSTED_AUTHOR_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/**
 * Gate agent-review detection on the comment author. Without this, any
 * commenter on a public repo can mark a PR "Agent Review: ✅ Approved" with
 * one pattern-matching comment — poisoning the merge-readiness signal.
 */
export function isTrustedReviewAuthor(
  user: { type?: string } | null | undefined,
  authorAssociation?: string
): boolean {
  if (user?.type === 'Bot') return true;
  return authorAssociation !== undefined && TRUSTED_AUTHOR_ASSOCIATIONS.has(authorAssociation);
}
