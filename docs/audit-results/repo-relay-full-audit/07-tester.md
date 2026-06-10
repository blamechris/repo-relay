# Tester's Audit: repo-relay Full Bug & Quality Audit

**Agent**: Tester -- test engineer obsessed with edge cases and coverage gaps
**Overall Rating**: 2.5 / 5
**Date**: 2026-06-09

## 1. Suite run + ground truth

| Check | Result |
|---|---|
| `npm test` (vitest 3.0.4) | **220/220 pass, 18 files, ~0.5s** — but only after `npm rebuild better-sqlite3` under Node 22. Under the machine's Node 26, **10 tests fail** (better-sqlite3 11.x NODE_MODULE_VERSION mismatch, won't compile against Node 26). `package.json` says `engines: >=20` with no upper bound — a chroxy consumer on Node 26 cannot even build this. |
| `npm run typecheck` | Clean. |
| Coverage tooling | **None.** No `@vitest/coverage-v8` in devDeps, no coverage config in `vitest.config.ts`, no coverage gate in CI. Gaps below are mapped by hand. |

### Coverage map (tested vs not)

| Module | Tests | Status |
|---|---|---|
| `src/pre-filter.ts` | pre-filter.test.ts (29 cases) | Thorough |
| `src/discord/lookup.ts` | lookup.test.ts (13) | Thorough incl. footer recovery |
| `src/utils/retry.ts`, `errors.ts` | 15 cases | Thorough |
| `src/patterns/agent-review.ts` | dedicated tests | Good |
| `src/setup/workflow-template.ts` | 12 cases | Good |
| `src/handlers/issue.ts` | 9 cases, full lifecycle + stale-message | Good |
| `src/handlers/security.ts` | 10 cases | Good |
| `src/index.ts` | permissions (8), session-limit retry (6), schedule polling (6) | Partial — `handleEvent` routing, `checkAndUpdateReviews`, `extractRepo` untested |
| `src/embeds/builders.ts` | truncation, footer, components, CI-failure reply | Partial — push/release/deployment embeds, field-limit overflow untested |
| `src/db/state.ts` | resilience (5), getOpenPrNumbers (5) | Partial — all CRUD/upsert semantics untested |
| `src/handlers/review.ts`, `comment.ts` | early-exits + detection only | Partial — happy-path embed-edit/thread flow never executed |
| **`src/handlers/pr.ts` (419 lines, the core feature)** | **none** | **Zero tests** |
| **`src/github/reviews.ts` (`checkForReviews`)** | **none** | **Zero tests** (patterns tested separately) |
| `src/handlers/ci.ts` (handler body) | none (`github/ci.ts` `fetchFailedSteps` is tested) | Zero; `mapCiStatus` untested |
| `src/handlers/push.ts`, `release.ts`, `deployment.ts` | none | Zero (only their pre-filter mirrors tested) |
| `src/cli.ts` (`mapGitHubEvent`, main) | none | Zero |
| `src/config/channels.ts` | none | Zero (trivial, but routing fallbacks unasserted) |
| `src/setup.ts` wizard, `src/commands/*` | none | Zero |

## 2. Subsystem ratings (test coverage / testability, 1–5)

| Subsystem | Rating | Note |
|---|---|---|
| CLI entry (`cli.ts`) | **1.5** | `main()` executes on import (cli.ts:163), `mapGitHubEvent` not exported — structurally untestable as written |
| Handler: PR (`handlers/pr.ts`) | **1** | The product's core lifecycle, 0 tests |
| Handler: CI (`handlers/ci.ts`) | **2** | Multi-PR loop, stale-message branch, `mapCiStatus` all untested |
| Handler: review / comment | **3** | Filters tested; full flow (embed edit, thread post, stale path) not |
| Handler: issue | **4** | Best handler coverage, incl. stale recovery |
| Handler: security | **4** | Solid |
| Handlers: push / release / deployment | **1.5** | 0 direct tests; force-push branch never executed |
| Embeds (`builders.ts`) | **3** | Title truncation tested; field/message length limits not |
| DB layer (`db/state.ts`) | **2.5** | Resilience/migrations good; upsert semantics (incl. a real bug, see F5) untested |
| Review detection (`github/reviews.ts`) | **1.5** | Flagship piggyback feature, 0 tests |
| Lookup/recovery (`discord/lookup.ts`) | **4** | Strong, incl. footer status recovery |
| Pre-filter | **4.5** | Near-exhaustive — but no parity test vs handlers (the thing it "approximates", pre-filter.ts:4-5) |
| Utils | **4.5** | Cannot find meaningful fault |
| Setup wizard | **3** | Template builder well tested; interactive wizard + `getRepoUrl` (setup.ts:22-31) untested |
| CI pipeline itself | **2** | See F2 |

## 3. Top 5 findings (by blast radius)

**F1 — `handlers/pr.ts` has zero tests.** Every notification thread in every consumer repo flows through `handlePrOpened/Closed/Push/Updated` and `getOrCreateThread` (pr.ts:115-419), including three near-duplicated stale-message recovery blocks (pr.ts:171-181, 216-225, 287-296) and the create-if-missing fallbacks. The `issue.ts` test file proves the mocking pattern works (issue.test.ts:56-78 fakes `TextChannel` via `Object.create(TextChannel.prototype)`) — there is no excuse for the flagship handler to have none. Notably untested-and-suspicious: `reopened` routes to `handlePrOpened` (pr.ts:94-96) which **unconditionally** `channel.send`s — a reopened PR (or a redelivered/re-run `opened` webhook) creates a duplicate embed + thread; the upsert in `savePrMessage` silently orphans the old one.

**F2 — CI never verifies the artifact consumers actually run.** `action.yml` executes the **committed** `dist/cli.js` (action.yml, last step), and `dist/` is checked in (120 tracked files, `.gitignore` comment "Build output is committed for GitHub Action use"). But `.github/workflows/ci.yml` runs only `npm test` + `npm run typecheck` — no `npm run build`, no `git diff --exit-code dist/` freshness check, no `npm run lint` either. A PR that edits `src/` without rebuilding merges green and ships stale code to every `@v1` consumer. (Currently only a sourcemap byte differs — luck, not process.) Also: single Node version (20) despite `engines >=20`; the Node 26 build failure I hit locally would reach consumers unobserved.

**F3 — `checkForReviews` (github/reviews.ts:49-135) is completely untested.** This is the documented headline workaround ("piggyback detection"). Untested: status-transition gating (`changed` only when DB differs), the `per_page=100` single-page cap (an agent-review comment beyond 100 comments is invisible forever — no pagination), both `catch` fallbacks, the most-recent-comment sort (reviews.ts:107-109), and the invalid-repo throw (reviews.ts:56-58). `fetchFailedSteps` next door shows the global-fetch-stub pattern already exists (github/__tests__/ci.test.ts).

**F4 — Malformed-payload behavior is untested and unguarded.** `mapGitHubEvent` blind-casts (`payload as PrEventPayload`, cli.ts:111) with zero shape validation; `shouldSkipEvent` then dereferences deep fields (`eventData.payload.workflow_run.pull_requests`, pre-filter.ts:18) — a payload missing `workflow_run` throws TypeError before Discord connect; one missing `pull_request.head` throws mid-handler **after** the embed channel fetch. GitHub does occasionally deliver payloads with null `user`/missing keys (the `pr.user ?? ghost` fallback at pr.ts:71 exists for exactly this reason — and is itself untested). No test feeds a truncated/null-ridden payload anywhere.

**F5 — Untested DB upsert semantics hide a real staleness bug.** `savePrData`'s `ON CONFLICT ... DO UPDATE` (state.ts:410-417) updates title/url/counts/state/draft but **not `base_branch`**. A PR retargeted from `develop` to `main` (an `edited` event) keeps showing the old base in every rebuilt embed forever. Same class: `saveIssueMessage`/`savePrMessage` last-writer-wins under concurrent events (two parallel workflow jobs both see no message → both create embeds → race) — no test, no guard, and the WAL setup invites exactly this on self-hosted runners.

## 4. Edge-case catalog (implementable: input → expected)

1. **Thread name > 100 chars** — `handlePrEvent` with `pr.number = 10000`, 90+-char title → name is `"PR #10000: " + 90` = 101 chars (pr.ts:127); Discord rejects (limit 100). Expected: name fits ≤100 (truncate title relative to prefix). Same at pr.ts:192, 237, 307, 408 and issue.ts:108, 154, 205.
2. **Issue labels overflow 1024-char field** — `buildIssueEmbed` with 60 labels of 20 chars (builders.ts:226-232) → field value >1024 → Discord 400. Expected: truncated with "+N more".
3. **CI failure reply > 2000 chars** — `buildCiFailureReply` with 5 steps whose jobName+stepName are ~400 chars each (builders.ts:159-171) → thread message exceeds 2000. Expected: capped.
4. **Duplicate `opened` delivery / `reopened`** — call `handlePrEvent` twice with action `opened` (or once `opened`, once `reopened`) and a DB that already has a mapping → expected: second call edits/reuses, sends no second embed. Current: duplicates.
5. **PR retarget** — `savePrData` with `baseBranch: 'develop'`, then again with `'main'` → `getPrData().baseBranch` should be `'main'`. Current: `'develop'` (state.ts:410-417).
6. **CI status regression by event ordering** — `handleCiEvent` action `requested`/`in_progress` arriving *after* a `completed/success` (second workflow, late delivery) → embed flips success→pending/running (ci.ts:82). Decide and pin desired behavior; also multi-workflow clobbering (single `ci_status` column, last writer wins).
7. **`mapCiStatus` table** — (`completed`,`skipped`)→`success` and (`completed`,`neutral`)→`success` (ci.ts:136) is a deliberate choice with zero assertions.
8. **`checkForReviews` transition matrix** — DB `copilotStatus='reviewed'` + API still returns Copilot review → `changed=false`, no thread spam; DB `agentReviewStatus='approved'` + newer `changes_requested` comment → `changed=true`. Plus: 150 comments where the agent review is #120 → currently missed (no pagination).
9. **`pr.user: null`** — payload with null user → embed author `ghost` (pr.ts:71); assert no throw.
10. **`synchronize` without `after`** — payload missing `after` → falls back to `head.sha` (pr.ts:254); assert reply contains 7-char sha.
11. **Malformed payload per event type** — `{}` as payload for each of the 12 event names through `mapGitHubEvent`+`shouldSkipEvent` → expected: graceful skip/clear error, not TypeError.
12. **Pre-filter/handler parity** — property-style test: for every payload where `shouldSkipEvent` returns null, the handler must not early-return for the same reason (guards the "approximates" drift, pre-filter.ts:4-5).
13. **Lookup spoofing** — `findMessageInChannel` (lookup.ts:26-41) matches **any** author's embed titled `PR #5:` with a matching URL; a non-bot message hijacks the mapping and its forged footer is written into pr_status (lookup.ts:76-85). Expected: filter `message.author.id === client.user.id`.
14. **`connect()` hang** — login resolves but `ready` never fires (index.ts:112-115) → promise never settles, Actions job burns until 6h timeout. Expected: bounded wait + clear error.
15. **`getChannelForEvent` fallbacks** — every optional channel unset → all routes return `prs` (channels.ts:32-47); cheap, currently unasserted.
16. **Surrogate-pair truncation** — title of 260 chars ending in emoji at index 255 → `substring(0,255)` splits the pair (builders.ts:547); assert no lone surrogate sent.

## 5. Testability assessment

**What already helps:** handlers are plain `(client, db, config, payload)` functions; `StateDb` runs against real SQLite in temp dirs (state-resilience tests prove it); global-fetch stubbing works (ci.test.ts); pure modules (pre-filter, patterns, builders, workflow-template) were correctly extracted.

**What hurts, with fixes:**
- **`instanceof TextChannel` checks** (pr.ts:64, ci.ts:53, etc.) force the `Object.create(TextChannel.prototype)` prototype hack in every handler test. Replace with an `isTextChannel()` seam or a narrow `RelayChannel` interface → mocks become plain objects.
- **`RepoRelay` constructs `Client` and `StateDb` internally** (index.ts:95, 267). The session-limit and schedule tests have to module-mock discord.js wholesale. Accept optional `clientFactory`/`dbFactory` in `RepoRelayConfig` → `handleEvent` routing and `checkAndUpdateReviews` become unit-testable (today: 0 tests).
- **`cli.ts` runs `main()` at import** (cli.ts:163) and keeps `mapGitHubEvent` private. Export both, gate execution (`if (process.argv[1] endsWith cli.js)`) → the event-name→type table and env-var exits become testable without subprocesses.
- **Bare `fetch` in reviews.ts/ci.ts** — workable via stubs, but a single injected `githubGet(url)` helper would let `checkForReviews` tests be table-driven.
- **No coverage instrumentation** — add `@vitest/coverage-v8`, set thresholds per-directory (handlers are the ones to ratchet).
- **CI** — add `npm run lint`, `npm run build && git diff --exit-code dist/`, and a Node 20/22 matrix (and decide the Node-26 story: cap `engines` or bump better-sqlite3 to a Node-26-compatible major).

## 6. Verdict

This codebase is half well-tested and half untested, split exactly the wrong way. The supporting cast — pre-filter, lookup/recovery, retry, patterns, DB resilience, issue/security handlers — has genuinely good, fast, behavior-focused tests (220 passing in half a second). But the lead actors have none: the PR handler (the product), the piggyback review detector (the headline feature), the CI handler, and the CLI entry point are all at zero, and the CI pipeline doesn't lint, doesn't measure coverage, and — most dangerously for a published GitHub Action — never checks that the committed `dist/` consumers execute matches the `src/` it just tested. Combined with untested idempotency (duplicate embeds on reopen/redelivery), an unverified Node-26 build failure I reproduced locally, and a concrete untested data bug (base-branch upsert), this is not yet at "production dependency" bar for chroxy. The good news: the existing test patterns prove every gap above is cheaply fillable — roughly a week of focused test-writing plus three CI workflow lines would move this to a 4.
