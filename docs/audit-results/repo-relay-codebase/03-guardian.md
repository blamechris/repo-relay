# Guardian's Audit: repo-relay Codebase

**Agent**: Guardian -- Paranoid security/SRE who designs for 3am pages
**Overall Rating**: 3.6 / 5
**Date**: 2026-02-09

---

## Section Ratings

### 1. SQLite State Management (`src/db/state.ts`) -- 4.0 / 5

**Good:** WAL mode enabled (line 121), integrity check on startup with auto-recreation (lines 102-119), WAL checkpoint on close (line 562), all SQL parameterized, `ON CONFLICT` upserts throughout, migration system for schema evolution, WAL+SHM files cleaned up on corruption.

**Concerning:** No `busy_timeout` pragma set -- concurrent writers get `SQLITE_BUSY` immediately. No `PRAGMA foreign_keys = ON`. Event log grows unbounded with no pruning.

### 2. Stale Message Recovery & "Unknown Message" Handling -- 3.5 / 5

**Good:** Consistent pattern across `pr.ts` and `issue.ts`. Fallback channel search in `discord/lookup.ts`. Footer metadata encoding for state recovery.

**Concerning:** "Unknown Message" detection relies on string matching (`errMsg.includes('Unknown Message')`) instead of numeric error codes (10008). 100-message search limit means recovery silently fails for busy channels. Stale message recovery in `handlePrClosed` creates a new embed without CI/review status.

### 3. Race Conditions in Concurrent Webhook Deliveries -- 3.0 / 5

**Good:** Execution model (one process per event) limits concurrency. SQLite serialization for writes. `ON CONFLICT DO UPDATE` makes individual writes idempotent.

**Concerning:** Read-modify-write race on embed updates -- two handlers can read DB, build embeds, and the last `message.edit()` wins, silently losing the other update. Duplicate embed creation possible when events race through the "check DB -> not found -> create" path. No mutex or advisory locking.

### 4. Error Handling & `safeErrorMessage()` Usage -- 4.0 / 5

Consistently used across the entire codebase. Properly extracts only `.message` from Errors. `String()` fallback for non-Error throwables. Retry utility only retries 5xx, preventing infinite loops on auth failures.

### 5. Token & Secret Handling -- 3.5 / 5

**Good:** Tokens via environment variables, `.gitignore` covers secrets, Actions uses `secrets.*`, `undici` override pins vulnerable transitive dep.

**Concerning:** `setup.ts:256` prints first 10 chars of bot token. `action.yml:52` expands token in bash `if` statement. Event payloads logged in full to `event_log` (contains PII, no TTL).

### 6. Discord API Resilience -- 3.5 / 5

**Good:** `withRetry` exponential backoff for 5xx, session budget monitoring, permission validation on startup, pre-filter avoids burning sessions.

**Concerning:** No handling for 429 rate limits. No timeout on overall CLI execution (could run until Actions 6-hour timeout). If `db.close()` throws, `client.destroy()` won't be called.

### 7. Input Validation & Type Safety -- 3.5 / 5

**Good:** `REPO_NAME_PATTERN` validates repo format. Channel ID validation in `action.yml`. Discriminated union provides compile-time safety.

**Concerning:** `mapGitHubEvent` uses unchecked `as` casts for all payloads. Footer metadata parsing trusts Discord embed content without bot-author verification -- potential spoofing vector.

---

## Top 5 Findings

### Finding 1: Read-Modify-Write Race on Embed Updates (Medium)
**Location:** `src/handlers/ci.ts:82-94`, `src/index.ts:339-362`
Multiple handlers follow non-atomic: write DB -> read status -> build embed -> edit Discord message. Concurrent events can silently overwrite each other's visual state.

### Finding 2: No Runtime Payload Validation (Medium)
**Location:** `src/cli.ts:111-141`
Every event uses unchecked `as` assertion on `unknown` payload. Malformed payloads produce confusing deep crashes instead of clear validation errors.

### Finding 3: Duplicate Discord Messages on Concurrent PR Events (Medium)
**Location:** `src/handlers/pr.ts:227-243`, `src/discord/lookup.ts:55-90`
Two racing events can both create embeds before either saves to DB, resulting in orphaned duplicate Discord messages.

### Finding 4: Unbounded Event Log Growth (Low)
**Location:** `src/db/state.ts:522-533`
Every event logged with full JSON payload. No TTL, no pruning, no cleanup. Full payloads contain PII.

### Finding 5: Footer Metadata Spoofing for State Recovery (Low)
**Location:** `src/discord/lookup.ts:74-85`
Channel search doesn't filter by bot author. A crafted embed from another user could inject false CI/review status during state recovery. Fix: filter `findMessageInChannel` to bot-authored messages only.

---

## Overall Rating: 3.6 / 5

Competently built with thoughtful safety mechanisms: DB integrity checks, corruption auto-recovery, WAL checkpointing, footer-encoded state recovery, pre-filtering, and consistent error sanitization. The main weaknesses are absence of runtime payload validation, the read-modify-write race on embed updates, and string-based Discord error detection. For a 3am page scenario: the most likely failure is a Discord embed showing stale status after concurrent events -- annoying but not catastrophic.
