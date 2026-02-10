# Webhook Specialist's Audit: repo-relay Codebase

**Agent**: Webhook -- GitHub webhook payload and event sequencing specialist
**Overall Rating**: 3.7 / 5
**Date**: 2026-02-09

---

## Section Ratings

### 1. `mapGitHubEvent()` Routing Correctness -- 4.0 / 5

Covers 12 event types correctly. `schedule` event receives special treatment (using `GITHUB_REPOSITORY` fallback) which is correct. Discriminated union provides compile-time safety.

**Issues:** All branches use unsafe `as` casts with no runtime validation. Missing `pull_request_review_comment` and `workflow_job` events (deliberate omissions but worth noting). Unhandled `pull_request` actions (labeled, assigned, etc.) pass through pre-filter, wasting gateway sessions.

### 2. Event Payload Type Accuracy -- 3.5 / 5

**PrEventPayload:** Action union is a deliberate subset. But pre-filter passes ALL `pull_request` events, wasting sessions for unhandled actions.

**Critical:** `pull_request.user` can be `null` for ghost/deleted users. Typed as non-nullable, will crash at runtime.

**WorkflowRunPayload:** `pull_requests` array empty on private repos (GitHub documented behavior). Private repo users will never see CI updates. Not documented or handled with a fallback.

**IssueCommentPayload:** `comment.body` typed as `string` but can be `null`. Low risk (coercion to "null" string doesn't crash).

**DeploymentStatusPayload:** Well-typed, accurately reflects GitHub schema.

### 3. Piggyback Review Detection Reliability -- 3.5 / 5

**Strengths:** Shared patterns in `src/patterns/agent-review.ts` ensure consistency. Per-PR error isolation. `changed` flag prevents duplicate thread posts.

**Issues:** Copilot detection has operator precedence bug (`reviews.ts:82-84`). No GitHub API pagination -- PRs with 30+ reviews or comments may miss detections. No retry for GitHub API 502/503 errors.

### 4. Scheduled Polling Edge Cases -- 4.0 / 5

Zero extra API calls to find which PRs to poll. Per-PR error isolation. Performance monitoring with 80% threshold warning. Well-tested.

**Issue:** Stale open PR list when DB state is lost -- closed PRs may be polled until next event updates state. Minor inefficiency, not a correctness bug.

### 5. Pre-Filter Accuracy -- 4.5 / 5

Every handler's early-exit conditions faithfully mirrored. Defense-in-depth approach. Comprehensive coverage across 11 event types.

**Gap:** `pull_request` events always pass -- 15+ unhandled actions waste gateway sessions.

### 6. Edge Case Handling -- 3.0 / 5

- **Draft PRs:** Handled correctly (emoji/color changes in embeds)
- **Force pushes:** Handled for `push` events, but PR `synchronize` doesn't distinguish force push from normal push
- **Bot accounts:** Only Copilot detected. No general bot filtering/suppression
- **Deleted users (ghost):** NOT handled. `pr.user.login` will throw TypeError on null user
- **Concurrent events:** Minimal risk due to one-process-per-event architecture

---

## Top 5 Findings

### Finding 1: No Payload Validation at `mapGitHubEvent()` Boundary (Systemic Risk)
**Location:** `src/cli.ts:111-141`
Every branch uses unchecked `as` cast on `unknown` payload. GitHub API schema changes or edge case payloads produce opaque crashes deep in handlers instead of clear validation errors.

### Finding 2: Copilot Detection Inconsistency Between Piggyback and Webhook Paths (Bug)
**Location:** `src/github/reviews.ts:82-84` vs `src/handlers/review.ts:73-75`
Operator precedence bug matches any user with "copilot" in login regardless of Bot type. The webhook handler correctly requires both conditions.

### Finding 3: Ghost User (Deleted User) Crash Risk
**Location:** `src/handlers/pr.ts:18-22`
`pull_request.user` can be `null` for deleted users. Code accesses `pr.user.login` unconditionally. Should default to `{ login: 'ghost' }` sentinel.

### Finding 4: GitHub API Pagination Not Applied in Review Detection
**Location:** `src/github/reviews.ts:77, 101`
No `per_page` parameter. Default page size is 30. PRs with 30+ reviews or comments may miss Copilot/agent reviews on later pages. `ci.ts:35` already uses `per_page=100` -- inconsistent.

### Finding 5: `pull_request` Events Not Pre-Filtered for Unhandled Actions
**Location:** `src/pre-filter.ts:122`
15+ unhandled actions (labeled, assigned, milestoned, etc.) each trigger full Discord gateway connection only to be silently dropped by handler switch statement.

---

## Additional Observations

- `workflow_run.pull_requests` is always empty on private repos -- private repo users will never see CI updates. Should be documented or handled with branch-name fallback.
- GitHub API calls in `reviews.ts` and `ci.ts` use raw `fetch()` with no retry. GitHub's API can return 502/503 during deployments.
- `schedule` event payload construction using `GITHUB_REPOSITORY` fallback is correct and necessary.
- Event log grows unbounded (no TTL, PII in payloads).

---

## Overall Rating: 3.7 / 5

Solid architectural judgment: pre-filter optimization, piggyback review detection, footer-encoded state recovery, and defense-in-depth are well-executed. Principal weaknesses: zero runtime payload validation, Copilot detection logic bug, no ghost user handling, and missing API pagination. None are architectural flaws -- all fixable with targeted patches. The codebase gets the hard parts right (event sequencing, state recovery, concurrency safety) while having gaps in input validation and API robustness.
