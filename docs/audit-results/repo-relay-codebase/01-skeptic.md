# Skeptic's Audit: repo-relay Codebase

**Agent**: Skeptic -- Cynical systems engineer who has seen too many designs fail
**Overall Rating**: 3.8 / 5
**Date**: 2026-02-09

---

## Section-by-Section Ratings

### 1. Event Routing & CLI Entry Point (`src/index.ts`, `src/cli.ts`) -- 4 / 5

**Claims vs Reality:**

The CLAUDE.md documents the `handleEvent()` routing and `mapGitHubEvent()` function accurately. The switch statement in `src/index.ts:222-327` covers all documented events plus `deployment_status`, `push`, and security alerts that are mentioned in handlers/index.ts. The `mapGitHubEvent()` in `src/cli.ts:105-161` is a 1:1 mirror of the type union. These are consistent.

The CLAUDE.md project structure section lists only the six original handler files (`pr.ts`, `ci.ts`, `review.ts`, `comment.ts`, `issue.ts`, `release.ts`), but the actual handlers directory also includes `deployment.ts`, `push.ts`, and `security.ts`. The documentation is slightly behind reality -- not dangerous, but a minor drift.

**Good practices observed:**
- Pre-filter (`src/pre-filter.ts`) saves gateway sessions by skipping events before connecting to Discord. This is a genuine optimization and well-tested (36 tests).
- The `payload as X` casts in `mapGitHubEvent()` are unavoidable with `unknown` input, but there is zero runtime validation of the payload shape. If GitHub changes their payload schema, this code will crash in confusing ways deep inside handlers rather than at the boundary.

**Specific concern:**
`src/cli.ts:111` -- `payload as PrEventPayload` is an unsafe cast. There is no schema validation. If a malformed payload arrives (e.g., GitHub changes the `pull_request` field name), it will produce a runtime error like "Cannot read properties of undefined (reading 'number')" instead of a clear "invalid payload" error. This is a systemic risk across all event types.

### 2. State Management (`src/db/state.ts`) -- 4.5 / 5

This is the strongest part of the codebase. Claims match reality closely.

**Verified claims:**
- WAL mode: `src/db/state.ts:121` -- `this.db.pragma('journal_mode = WAL')` -- confirmed.
- WAL checkpoint on close: `src/db/state.ts:562` -- `this.db.pragma('wal_checkpoint(TRUNCATE)')` -- confirmed.
- Integrity check on startup: `src/db/state.ts:102-119` -- confirmed, and it auto-recreates a corrupt DB. Tested in `state-resilience.test.ts`.
- All SQL queries use parameterized statements: Verified across all methods. No string interpolation in queries.
- Tables match documentation: `pr_messages`, `pr_status`, `pr_data`, `event_log` all present, plus `issue_messages` and `issue_data` (not documented in the tables list).

**One subtle issue:**
The `event_log` table has no TTL or pruning mechanism. Over time, for a busy repo, this table will grow unbounded. The `getRecentEvents` method has a default `limit = 50`, but there is no scheduled cleanup. On GitHub-hosted runners where the DB is ephemeral, this is fine. On self-hosted runners or with cache persistence, this could eventually become a large table.

### 3. Embed Builders (`src/embeds/builders.ts`) -- 3.5 / 5

**The `buildMergedReply` function hardcodes "Merged to main":**
`src/embeds/builders.ts:193` -- `return '... Merged to main${byText}!';`

This is factually wrong for repositories whose default branch is not `main`. The function receives no branch information. The `PrData` type includes `baseBranch`, but `buildMergedReply` only takes an optional `mergedBy` parameter.

**The `handlePrUpdated` function strips CI and review status:**
`src/handlers/pr.ts:278` -- When a PR is edited, marked ready for review, or converted to draft, the embed is rebuilt with `buildPrEmbed(pr)` which has no CI or review status. Compare with `handlePrClosed` at line 153 which *does* call `buildEmbedWithStatus()`. This means if you edit a PR title, the embed will temporarily show "CI: Pending" and "Reviews: Pending" even if CI passed and reviews are in.

**Footer metadata for state recovery** (`src/embeds/builders.ts:567-598`) is a clever mechanism that encodes status into embed footers so it can be recovered after state loss. Well-implemented and tested.

**Title truncation** at 256 characters (`src/embeds/builders.ts:548-549`) is correct for Discord's embed title limit.

### 4. Handler Logic (`src/handlers/`) -- 3.5 / 5

**Stale message handling -- claims vs reality:**
CLAUDE.md says: "1. Bot tries to fetch message -> gets 'Unknown Message' error / 2. DB entry is cleared / 3. New embed/thread is created."

This is accurate for `handlePrClosed` (line 169-179), `handlePrPush` (line 214-223), and `handlePrUpdated` (line 284-293). All three follow the exact same pattern.

However, `handleCiEvent` at `src/handlers/ci.ts:74-78` does NOT handle stale messages. Same for the review handler (`src/handlers/review.ts`) and the comment handler (`src/handlers/comment.ts`). If someone deletes a Discord embed, the next CI completion, Copilot review, or agent-review comment will crash the bot instead of recovering gracefully.

**The `handlePrPush` function passes branch name as commit SHA:**
`src/handlers/pr.ts:255-260` -- The `sha` parameter passed to `buildPushReply` is actually `pr.branch` (the branch name), not a commit SHA. `buildPushReply` at `src/embeds/builders.ts:150` does `sha.substring(0, 7)` on this value, producing output like "feat/my" as the "SHA." Additionally, `commitCount` is hardcoded to `1` at line 253.

### 5. Piggyback Review Detection (`src/github/reviews.ts`) -- 3.5 / 5

**The Copilot detection regex has an operator precedence issue:**
`src/github/reviews.ts:82-84` -- Due to `&&` binding tighter than `||`, the first branch matches *any* user whose login contains "copilot" regardless of whether they are a Bot. Compare with `src/handlers/review.ts:73-75` which does it correctly.

**Copilot comment count is always hardcoded to 0:**
`src/handlers/review.ts:81` and `src/github/reviews.ts:89` both pass `0` for the comment count. The embed displays "0 comments" because the actual count is never fetched from the API.

### 6. Discord Channel Fallback & Recovery (`src/discord/lookup.ts`) -- 4 / 5

Well-designed system. When SQLite state is lost, the lookup searches the last 100 messages in the channel for a matching embed, then caches the result back to the DB. The footer metadata system (`repo-relay:v1:...`) encodes CI/review status so it survives state loss.

**Limitation:** The 100-message search window means that if the Discord channel has more than 100 messages between the embed and the current event, recovery will fail and a duplicate embed will be created.

### 7. Pre-filter System (`src/pre-filter.ts`) -- 4.5 / 5

Comprehensive and well-tested with 36 tests. Each pre-filter case verified against its corresponding handler. Defense-in-depth approach is good engineering.

### 8. Test Coverage -- 3.5 / 5

213 tests, all passing. Coverage is reasonable for pure logic but handler integration tests are missing. The bugs identified (branch-name-as-SHA, status-stripping, missing stale message handling) are not caught by any test.

### 9. Error Handling & Retry Logic -- 4 / 5

`src/utils/retry.ts` is clean: only retries on Discord 5xx errors, exponential backoff, configurable retries. `src/utils/errors.ts` is minimal but correct -- extracts only `.message` from Error objects.

---

## Top 5 Findings

### Finding 1: `handlePrUpdated` strips CI and review status from embeds (MEDIUM)
**File:** `src/handlers/pr.ts:278`
When a PR is edited, the embed is rebuilt without accumulated CI and review state. Other handlers correctly use `buildEmbedWithStatus()`. Users see "CI: Pending" after a title edit even if CI passed.

### Finding 2: `handlePrPush` passes branch name as commit SHA (BUG)
**File:** `src/handlers/pr.ts:255-260`
The branch name is passed where a SHA is expected, producing output like "feat/my" as the SHA. `commitCount` is also hardcoded to `1`.

### Finding 3: Inconsistent Copilot detection between event handler and piggyback API checker
**File:** `src/github/reviews.ts:82-84`
Operator precedence bug matches any user whose login contains "copilot" regardless of Bot type. The event handler does it correctly.

### Finding 4: CI, review, and comment handlers do not handle stale (deleted) Discord messages
**Files:** `src/handlers/ci.ts:85`, `src/handlers/review.ts:78`, `src/handlers/comment.ts:89`
These handlers lack the "Unknown Message" catch-and-recover pattern used in the PR handler. Deleted Discord messages will crash the bot.

### Finding 5: `buildMergedReply` hardcodes "Merged to main" regardless of actual target branch
**File:** `src/embeds/builders.ts:193`
Always says "Merged to main" regardless of the actual base branch. The `baseBranch` data is available but not passed through.

---

## Overall Assessment

**Rating: 3.8 / 5**

This is a competently built single-purpose bot with solid fundamentals: parameterized SQL, WAL mode with integrity checking, exponential backoff retries, proper error isolation with `safeErrorMessage()`, and a defense-in-depth pre-filter system. The code falls short of a 4+ rating because of concrete bugs: branch-name-as-SHA confusion, status-stripping on PR updates, missing stale message handling in three handlers, and Copilot detection logic inconsistency. These are all fixable without architectural changes.
