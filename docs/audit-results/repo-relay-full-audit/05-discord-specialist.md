# Discord Specialist's Audit: repo-relay Full Bug & Quality Audit

**Agent**: Discord -- discord.js 14.x platform specialist (embed limits, thread lifecycle, sessions, rate limits)
**Overall Rating**: 3.1 / 5
**Date**: 2026-06-09

Audited against discord.js **14.25.1** (verified in node_modules; internals cited where load-bearing).

## Subsystem Ratings

| Subsystem | Rating | Summary |
|---|---|---|
| Client/connection lifecycle | 3.5/5 | Session-limit retry is genuinely good; deprecated `ready` listener, unawaited `destroy()`, no error listeners |
| Thread management | 2.5/5 | `getOrCreateThread` pattern is right, but three real crash/loss paths exist |
| Embed construction | 3.5/5 | Titles/descriptions consistently truncated; field values are not |
| Permission validation | 4/5 | Correct, channel-level, complete permission set; minor channel-type gap |
| Rate-limit/session handling | 3.5/5 | Sequential ops + d.js internal 429 queue are fine; withRetry misses network errors; schedule polling is session-hungry |
| Channel handling | 3/5 | `instanceof TextChannel` everywhere — loud failures, but announcement channels pass validation then fail handlers |

---

## Top 5 Findings

### 1. Thread names can exceed Discord's 100-char limit → hard API failure (HIGH)
Discord rejects thread names > 100 chars (error 50035, no client-side truncation in d.js). The bot truncates the *title* to 90 chars but ignores the prefix:

- `src/handlers/pr.ts:127` (and duplicated at :192, :236, :307, :408): `` `PR #${pr.number}: ${pr.title.substring(0, 90)}` `` — prefix is 9+digits chars, so any **PR ≥ #10000** with a ≥90-char title produces 101 chars → `startThread` throws.
- `src/handlers/issue.ts:108` (also :154, :205): `` `Issue #${issue.number}: ...` `` — prefix is 9+digits, so any **issue ≥ #10** with a long title produces ≥101 chars. This is trivially reachable today.

Worse, in `handleIssueOpened` the embed message is sent *before* `startThread` and `saveIssueMessage` (issue.ts:105-112), so the failure leaves an orphaned embed with no DB row — the next event posts a duplicate. Fix: truncate the *whole* name to 100 (one shared helper; this string is built in 8 places).

### 2. State-loss recovery path calls `startThread` on a message that already has a thread → 160004 crash (HIGH)
This is the exact scenario the project documents as normal (ephemeral runners + 24h auto-archive):

- `src/discord/lookup.ts:38` recovers `threadId: message.thread?.id ?? null`. But `Message#thread` is **cache-only** — verified in `node_modules/discord.js/src/structures/Message.js:577-579`: `return this.channel?.threads?.cache.get(this.id) ?? null;`. A fire-once process only caches *active* threads (from GUILD_CREATE); an auto-archived thread is never in cache, so recovery stores `threadId = null` even though the thread exists.
- `src/handlers/pr.ts:404-411` (`getOrCreateThread`): with `threadId` null it goes straight to `message.startThread(...)`, which Discord rejects with **160004 `ThreadAlreadyCreatedForMessage`** (confirmed in `discord-api-types/rest/common.js:204`). That's a 400, `withRetry` doesn't retry it, and the `'Unknown Message'` string check in callers (pr.ts:174, ci.ts:113) doesn't match — so the handler throws and the CLI exits 1 (`src/cli.ts:97-99`). Every subsequent event for that PR fails until the thread is manually unarchived.

Fix: thread ID == parent message ID; try `channel.threads.fetch(existing.messageId)` before `startThread`, and catch code 160004 as a fetch-by-message-id fallback. Same bug in `getOrCreateIssueThread` (issue.ts:202-208).

### 3. Piggyback review notifications use raw `thread.send` without unarchiving — silently lost (MEDIUM-HIGH)
`src/index.ts:420-436` (`checkAndUpdateReviews`) fetches the thread and calls `thread.send(reply)` directly instead of `getOrCreateThread`. Fetching an archived thread by ID succeeds, but sending to it fails with 50083 `ThreadArchived` — and the bare `catch {}` at index.ts:434-436 swallows it. Because the status change is already persisted to SQLite, `result.changed` is never true again: the review notification is **permanently dropped** for any PR quiet for >24h — precisely the PRs the scheduled-polling feature (index.ts:445-473) exists to cover. The feature partially defeats itself. Fix: check `thread.archived` → `setArchived(false)` first, or route through `getOrCreateThread`.

### 4. `reopened` PRs always create a duplicate embed + thread (MEDIUM)
`src/handlers/pr.ts:94-96` routes both `opened` and `reopened` to `handlePrOpened`, which unconditionally `channel.send`s a new embed and `startThread`s (pr.ts:121-138) with no `getExistingPrMessage` lookup. `savePrMessage` then overwrites the mapping (`src/db/state.ts:241-249`), orphaning the original embed/thread in the channel. Every close→reopen cycle leaks a stale embed. `reopened` should follow the `handlePrUpdated`/`getOrCreateThread` path.

### 5. Unbounded field values / message content can exceed Discord limits (MEDIUM)
Titles are truncated everywhere (`truncateTitle`, builders.ts:546-548) — good. Field values (1024 limit) and plain messages (2000 limit) are not:

- **Labels field** — `src/embeds/builders.ts:226-232`: `issue.labels.map(l => \`\`${l}\`\`).join(' ')` is unbounded. GitHub allows ~100 labels × 50 chars → far over 1024 → entire issue embed send fails with 50035.
- **CI field** — builders.ts:521-537 (`getCiStatusText`) interpolates `workflowName` (GitHub workflow `name:` is effectively unbounded) into a 1024-cap field (builders.ts:96-101) and into thread messages.
- **CI failure reply** — builders.ts:159-171 caps the *count* of failed steps at 5 but not job/step name length; 5 × long matrix-job names can exceed the 2000-char message limit, failing `thread.send` at ci.ts:104 and aborting the handler.

A single `truncateField(value, 1024)` applied at every `addFields` call site closes this class.

---

## Additional Findings (hygiene)

- **Deprecated `ready` event** — `src/index.ts:113` listens on `'ready'`; verified `WebSocketManager.js:383-391` emits a DeprecationWarning *because a listener exists*, every single run, and this breaks on v15. Use `Events.ClientReady`.
- **`client.destroy()` not awaited** — `Client#destroy` is `async` and awaits `ws.destroy()` (verified `Client.js:250-257`), but it's fire-and-forgotten at index.ts:131, :146, and in `disconnect()` at index.ts:253. The CLI's `finally { await relay.disconnect() }` (cli.ts:101) therefore doesn't actually wait for the gateway close handshake; the process can exit mid-close (unclean WS close ≠ resumable session — wasteful given the session-budget concern).
- **No `error`/`warn`/`shardError` listeners** — nothing in `src/` registers any client listener except the one-shot `ready`. An `'error'` emit on a listener-less EventEmitter crashes the process. One-liner fix.
- **`GuildMessages` intent is unnecessary** — index.ts:98. The bot never consumes message gateway events; REST fetches don't need it. `Guilds` alone suffices (and is what populates `channel.threads.cache`).
- **No timeout on the ready wait** — index.ts:112-115: if `login()` resolves but `ready` never fires, the Actions job hangs until the workflow timeout.
- **`withRetry` only retries `DiscordAPIError` 5xx** — `src/utils/retry.ts:7-12`. Undici network errors (`fetch failed`, `ECONNRESET`) and `HTTPError`/aborts are not `DiscordAPIError` and are never retried — the most common transient failure mode on hosted runners. (429s are correctly left to d.js's internal queue.)
- **Stale-message detection by string** — `errMsg.includes('Unknown Message')` repeated in 6 handlers (e.g., pr.ts:174, ci.ts:113, comment.ts:111). Prefer `error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMessage` (10008); string matching is locale/version-fragile and over-matches.
- **Channel-type mismatch between validation and handlers** — `validatePermissions` accepts any channel with `'guild' in channel` (index.ts:203), so an announcement (News) channel passes validation, then every handler's `instanceof TextChannel` guard throws (pr.ts:64-66 et al.). At least it fails loudly, but the error message ("not found or not a text channel") doesn't tell the user their channel *type* is the problem. Validation should assert `channel.type === ChannelType.GuildText`.
- **Session budget math** — the optional 5-minute schedule polling costs ~288 identifies/day, ~29% of the 1000/day budget *per repo* sharing the token, before any real events. Also, a schedule run with zero open PRs still burns a session: `getOpenPrNumbers` (state.ts:427-432) reads local SQLite and could run as a pre-connect filter in `shouldSkipEvent` (`src/pre-filter.ts:130-131` currently always processes `schedule`).

## What's Good
The session-limit retry with parseable reset time, capped wait, and client re-creation (index.ts:103-152) is better than most production bots; `REPO_RELAY_LOG_SESSION_BUDGET` via `Routes.gatewayBot()` is the right diagnostic; the pre-filter (pre-filter.ts) shows real awareness of the identify budget; permission validation checks the *effective* channel-level set including `SendMessagesInThreads` and `ManageThreads` (needed for `setArchived(false)` on locked threads); footer-metadata state recovery (builders.ts:563-596) is a clever fit for ephemeral runners; and sequential polling defers correctly to d.js's internal rate-limit queue.

## Verdict
repo-relay is a thoughtfully engineered bot whose connection/session layer is near production-grade, but its thread lifecycle — the core of its product promise — has three concrete failure paths that all trigger under its own *documented* operating conditions (ephemeral state + 24h auto-archive): name-length overflows that crash thread creation, a recovery path that calls `startThread` on messages that already have archived threads (160004), and a piggyback path that silently drops review notifications into archived threads. None are hard to fix (a shared `buildThreadName()` helper, fetch-thread-by-message-id, and routing all sends through `getOrCreateThread` would close all three), but until they land I'd rate it "good side-project, not yet a production dependency" for the chroxy ecosystem. Fix findings 1-3 and add error listeners/awaited destroy, and this moves to a solid 4.
