# Builder's Audit: repo-relay Full Bug & Quality Audit

**Agent**: Builder -- pragmatic full-stack dev who will implement and maintain this
**Overall Rating**: 3.5 / 5
**Date**: 2026-06-09

Verified by reading every source file; `npm run typecheck` passes, `npm test` is 210/220 locally (the 10 failures are a local better-sqlite3 NODE_MODULE_VERSION ABI mismatch, not code defects), `npm run lint` is **broken** (see findings).

---

## 1. Subsystem Ratings

### CLI entry / event mapping (`src/cli.ts`) — 4/5
Clean fail-fast env validation (cli.ts:27-43), pre-filter before gateway connect saves Discord sessions (cli.ts:72-76), and `mapGitHubEvent()` covers all 12 events with a sensible `schedule` synthesis (cli.ts:143-156). Weakness: every payload is a blind cast — `payload as PrEventPayload` (cli.ts:111) etc. — with zero runtime validation, so a malformed/renamed field surfaces as a `TypeError` deep inside a handler rather than a clear "bad payload" error. Acceptable for GitHub-generated payloads, but thin for a production dependency.

### Handlers
- **`pr.ts` — 3/5.** Functionally complete and the source of the shared helpers, but the worst duplication in the codebase. The "send embed → startThread → savePrMessage → savePrStatus → seed thread" block is copy-pasted **four times** (pr.ts:121-138, 185-198, 230-245, 300-315), and the stale-message `Unknown Message` recovery block three times (pr.ts:171-181, 216-225, 287-296). `handlePrUpdated` and `handlePrClosed` are ~80% identical.
- **`ci.ts` — 4/5.** Model citizen: uses `buildEmbedWithStatus` (ci.ts:90), `getOrCreateThread` (ci.ts:100), `withRetry` throughout, fetches failed steps once per run and shares across PRs (ci.ts:64-68). Minor: `neutral`/`skipped` mapped to `success` (ci.ts:136) is a silent opinion.
- **`review.ts` — 3/5.** Only reacts to **Copilot** bot reviews (review.ts:73-76); a human submitting `approved` or `changes_requested` is completely ignored — no embed update, no thread post. For a "production dependency" notification bot, dropping human reviews is a surprising functional hole, not just a style issue.
- **`comment.ts` — 4/5.** Correctly uses shared patterns from `patterns/agent-review.ts`, persists status before the Discord try-block (comment.ts:90, good crash ordering), uses all shared helpers.
- **`issue.ts` — 3.5/5.** Follows the PR lifecycle pattern, but does so by **cloning** it: `getOrCreateIssueThread` (issue.ts:180-215) is a line-for-line twin of `getOrCreateThread` (pr.ts:380-419), and the create-message block is duplicated twice (issue.ts:104-115, 150-161). `labeled`/`unlabeled`/`edited` are stubbed "Phase 4 — will be handled in PR 3" (issue.ts:90-94) — but pre-filter already skips them (pre-filter.ts:93), so the stub is unreachable dead promise.
- **`release.ts`, `deployment.ts`, `push.ts`, `security.ts` — 4/5 each.** Simple fire-and-forget embeds, consistent structure (channel fetch → logEvent → build → send with `withRetry`), defense-in-depth action guards matching the pre-filter (security.ts:81-92). Push's `PR_MERGE_COMMIT_PATTERN` is duplicated as a literal regex in pre-filter.ts:59 instead of importing the constant from push.ts:32 — they can drift.

### Embed builders (`src/embeds/builders.ts`) — 3.5/5
Titles are consistently truncated via `truncateTitle` (builders.ts:546-548), descriptions via `truncateDescription`, footer metadata for state recovery is a genuinely good design (builders.ts:563-596). Two real limit gaps:
- **Issue labels field is unbounded** (builders.ts:226-232): `issue.labels.map(l => \`\`${l}\`\`).join(' ')`. GitHub allows ~100 labels × 50 chars; Discord field values cap at 1024 chars → `400 Invalid Form Body` and the whole notification fails.
- Dependabot summary set as description with no truncation (builders.ts:413) — bounded upstream (~1024) so it fits in 4096, but it's the only untruncated `setDescription` and inconsistent with every other builder.
Branch field (builders.ts:62) is safe (2×256-byte refs + formatting < 1024). Total-6000 budget is comfortably met for all builders.

### DB / state layer (`src/db/state.ts`) — 4.5/5
Best subsystem. Integrity check + auto-recreate on corruption (state.ts:102-119), WAL checkpoint on close (state.ts:560-568), guarded migrations (state.ts:126-144), parameterized statements everywhere, explicit boolean coercion for `draft` (state.ts:365-401). Two gaps: (a) `savePrData`'s `ON CONFLICT` update list omits `branch`/`base_branch` (state.ts:410-417), so a PR retargeted to a different base branch keeps showing the stale base in rebuilt embeds forever; (b) `event_log` stores full JSON payloads with **no pruning** (state.ts:522-533) — on a self-hosted runner or actions/cache this grows unboundedly; PR payloads are ~30-80KB each.

### Review detection (`src/github/reviews.ts` + piggyback in `index.ts`) — 4/5
Shared pattern module prevents the two detection paths drifting (patterns/agent-review.ts), status-diff before writing avoids redundant edits (reviews.ts:86, 120). Real bug: `checkAndUpdateReviews` posts thread notifications via a raw `channel.threads.fetch` + `thread.send` (index.ts:422-431) instead of `getOrCreateThread`, so it never unarchives. Threads auto-archive after 24h, and the scheduled poller exists precisely to catch **quiet PRs** — i.e., the exact PRs whose threads are archived. The send fails with `Thread is archived` and the bare `catch {}` (index.ts:434-436) swallows it: embed updates, thread notification silently lost. Also: only first 100 reviews/comments fetched, no pagination (reviews.ts:77, 100) — fine in practice, worth a comment.

### Channel routing / config (`src/config/channels.ts`) — 5/5
48 lines, exhaustive switch with compiler-enforced coverage, sane fallback-to-PRs defaults matching action.yml and docs. Cannot find meaningful fault.

### Error handling — 3.5/5
`safeErrorMessage()` is used consistently at every log site I checked (cli.ts, index.ts, reviews.ts, ci.ts, lookup.ts, setup.ts) — good discipline. `withRetry` correctly limits to Discord 5xx (retry.ts:7-12; 429s are handled inside discord.js). The big wart: stale-message detection is `errMsg.includes('Unknown Message')` **string matching, copy-pasted at 7 sites** (pr.ts:174, 218, 289; ci.ts:113; comment.ts:111; review.ts:100; issue.ts:140) instead of checking `DiscordAPIError.code === 10008` — brittle against discord.js message wording changes and a textbook case for one `isUnknownMessageError()` helper next to `withRetry`. Also `connect()` has no timeout if `login` resolves but `ready` never fires (index.ts:112-115) — a hung Actions job until the step timeout.

### `action.yml` — 3/5
Composite action runs **committed `dist/`** (`node dist/cli.js`, action.yml:78) with no build step — fine, *if* dist is guaranteed fresh, but nothing guarantees it (see CI below; current drift is only an `index.d.ts.map`, so you've been disciplined manually — that's luck, not a control). Inputs are interpolated directly into bash: `if [ -z "${{ inputs.discord_bot_token }}" ]` and the channel echo (action.yml:52-63) — the standard GitHub-documented injection-resistant pattern is passing inputs via `env:`. `npm ci --omit=dev 2>/dev/null || npm ci --production` (action.yml:47) discards stderr from the primary path, hiding real install failures, and runs a full `npm ci` of better-sqlite3 (native compile) **on every single event** with no dependency caching — that's 15-40s of latency tax per notification.

### Tests / build tooling — 3/5
220 tests with genuinely good coverage of the leaf modules: pre-filter, patterns, lookup (incl. footer recovery), retry, workflow-template, DB resilience, security/comment/issue/review handlers, embed builders. But:
- **Zero tests for `handlers/pr.ts`** (419 lines, the core product) and zero for `handleCiEvent`'s orchestration — only `fetchFailedSteps` is tested. `src/handlers/__tests__/` contains comment/issue/review/security only.
- **`npm run lint` is completely broken**: ESLint 9 is installed but there is no `eslint.config.js` (and no `.eslintrc*`) anywhere in the repo. The script in package.json also uses the removed `--ext` flag. Lint has plausibly never run since the ESLint 9 upgrade.
- CI (`.github/workflows/ci.yml`) runs only `npm test` + `npm run typecheck` — no lint, no `npm run build`, and crucially **no check that committed `dist/` matches `src/`**, despite consumers executing dist directly via `@v1`.

### Dead code: `src/commands/*` — 2/5 (flagging separately)
~520 lines of slash-command code (`pr.ts`, `issue.ts`, `status.ts`, `register.ts`) that **nothing imports** — no `interactionCreate` listener exists, and a fire-once CLI architecturally cannot serve interactions. It also violates house patterns: hand-rolled `EmbedBuilder` usage and raw `fetch` (commands/pr.ts:72-101, commands/status.ts:53-115) bypassing `builders.ts`, `withRetry`, and truncation helpers. Untested, unmaintained, and it will be the first thing to silently rot.

---

## 2. Top 5 Findings

1. **Toolchain integrity gap: lint is broken and CI doesn't guard the committed `dist/`.** No `eslint.config.js` exists for ESLint 9, so `npm run lint` errors out; ci.yml runs neither lint nor build nor a dist-freshness diff. For an action whose consumers execute `dist/cli.js` at `@v1`, a PR that edits `src/` without rebuilding ships **stale code with green CI**. (ci.yml:14-16, action.yml:78, package.json `lint` script.)

2. **Thread-name length overflow at 8 call sites.** `name: \`Issue #${issue.number}: ${issue.title.substring(0, 90)}\`` (issue.ts:108, 154, 205) hits 101 chars for any issue ≥ #10 with a ≥90-char title — Discord's hard cap is 100 → API 400, handler throws, notification job fails. Same construction for PRs breaks at #10000 (pr.ts:127, 192, 236, 307, 408). The fix belongs in one shared `buildThreadName()` helper, which doesn't exist because the string is copy-pasted eight times.

3. **Unbounded issue-labels embed field** (builders.ts:226-232). Label names joined without any cap flow into a field value limited to 1024 chars; a label-heavy issue kills the entire embed send. This is the one true Discord-limit violation from unbounded GitHub content — everything else (titles, bodies, branch names, commit messages) is correctly truncated.

4. **Systemic copy-paste where helpers should be.** The create-message+thread block ×4 in pr.ts and ×2 in issue.ts; `getOrCreateIssueThread` is a clone of `getOrCreateThread`; the `Unknown Message` string check ×7 instead of a `DiscordAPIError.code === 10008` helper; `PR_MERGE_COMMIT_PATTERN` re-declared in pre-filter.ts:59. Each future fix (e.g., finding #2) currently requires 6-8 coordinated edits — this is the project's biggest maintenance-burden multiplier.

5. **Piggyback/polling path silently drops thread notifications on archived threads** (index.ts:422-436). It bypasses `getOrCreateThread` (no unarchive) and swallows the send failure in a bare `catch`. Since threads auto-archive at 24h and scheduled polling specifically targets quiet PRs, the feature's headline use case partially no-ops. Bonus in the same area: `handleReviewEvent` ignores all human reviews (review.ts:73-76), and `src/commands/` is ~520 lines of unwired dead code.

---

## 3. Recommendations (effort estimates)

| # | Fix | Effort |
|---|-----|--------|
| 1 | Add `eslint.config.js` (flat config), fix `lint` script, add `lint` + `build` + `git diff --exit-code dist/` steps to ci.yml | ~half a day |
| 2 | Shared `buildThreadName(kind, number, title)` capping total at 100 chars; replace 8 call sites | ~1 hour |
| 3 | Cap labels field: truncate join at ~1000 chars with `+N more`; truncate Dependabot summary for consistency | ~1 hour |
| 4 | Extract `createPrMessageWithThread()` / `createIssueMessageWithThread()`, unify `getOrCreateThread` (parametrize name prefix), add `isUnknownMessageError()` checking code 10008, export the merge-commit regex | ~1 day, mostly mechanical + tests |
| 5 | Use `getOrCreateThread` in `checkAndUpdateReviews`; log (not swallow) thread-send failures | ~1-2 hours |
| 6 | Delete `src/commands/` (or move to an `experimental/` branch until a daemon mode exists) | ~30 min |
| 7 | Add handler tests for pr.ts lifecycle (opened/closed/synchronize/stale-message) with a mocked Client — highest-value missing coverage | ~1-2 days |
| 8 | `event_log` retention (e.g., `DELETE ... WHERE created_at < datetime('now','-30 days')` on open); add `base_branch` to `savePrData`'s conflict-update list | ~1 hour |
| 9 | action.yml: pass inputs via `env:` in the validate step; drop `2>/dev/null`; consider `actions/setup-node` npm cache keyed on the action's lockfile | ~half a day |
| 10 | Decide on human-review handling in review.ts (at minimum post approved/changes_requested to the thread) | ~half a day |

---

## 4. Verdict

repo-relay is a well-architected small system with several genuinely above-grade engineering decisions — the footer-metadata state recovery, the pre-filter session saver, the DB corruption auto-heal, and the shared-pattern module all show real production thinking, and the prescribed handler→index→dispatch→cli pattern is followed by every live handler. What holds it at 3.5 is execution hygiene rather than design: the lint toolchain is silently dead, CI can green-light a stale `dist/` that consumers execute directly, the codebase's most-repeated string (thread names) and most-repeated block (create-message+thread) are copy-pasted instead of factored — which is exactly why the latent thread-name and labels-field Discord-limit bugs exist at 8+ sites instead of 1 — and the core 419-line PR handler has zero test coverage. None of this is hard to fix; items 1-5 above are roughly three days of work and would move this to a solid 4+ before chroxy takes a dependency on it. I'd want at minimum the CI/dist guard, the thread-name cap, and the labels-field cap landed before calling it production-grade.
