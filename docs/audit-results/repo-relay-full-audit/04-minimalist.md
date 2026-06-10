# Minimalist's Audit: repo-relay Full Bug & Quality Audit

**Agent**: Minimalist -- ruthless engineer who believes the best code is no code
**Overall Rating**: 3.5 / 5
**Date**: 2026-06-09

Scope: full read of `/Users/blamechris/Projects/repo-relay/src` (~4,700 src LoC + ~3,300 test LoC), `action.yml`, `package.json`, README references, and caller-verification greps for everything condemned below.

## Subsystem Ratings (5 = appropriately minimal, 1 = drowning in accidental complexity)

| Subsystem | Rating | Notes |
|---|---|---|
| CLI entry (`src/cli.ts`, 166 LoC) | 4 | Lean and linear. `mapGitHubEvent()` is 11 identical `case X: return {event, payload: payload as Y}` arms (cli.ts:109-141) — a `Set` of handled names plus one cast would do the same in ~10 lines. |
| Handlers (`src/handlers/*`) | 3 | The simple handlers (release, deployment, push, security) are exemplary — payload in, embed out, ~70-115 LoC each. `pr.ts` (419 LoC) drags the rating down: four near-identical "send embed + startThread + save + seed message" blocks, and the `Unknown Message` stale-recovery try/catch is copy-pasted 5+ times across pr/ci/review/comment. |
| Embeds (`src/embeds/builders.ts`, 596 LoC) | 4 | Mostly honest presentation code. Footer-metadata encode/decode is justified (used by `discord/lookup.ts` state recovery). Dead weight: `copilotComments` plumbing that can only ever display 0, and `CiStatus.conclusion` which nothing reads. |
| DB layer (`src/db/state.ts`, 569 LoC) | 3 | Clean parameterized SQL, sensible WAL/integrity handling. But **two of six tables are write-only** (`event_log`, `issue_data`), and `last_updated` is written by 4 methods and read by nothing. |
| Review detection (`src/github/reviews.ts`, `patterns/`, `github/ci.ts`) | 4 | The piggyback + scheduled-polling dual path is real essential complexity (GITHUB_TOKEN apps don't fire review events — documented, issue-linked). Shared patterns module prevents drift. Appropriate. |
| Config/routing (`src/config/channels.ts`, 48 LoC) | 5 | Exactly as small as it should be. |
| Pre-filter (`src/pre-filter.ts`, 136 LoC) | 4 | Duplicates handler early-exits, but deliberately — it saves Discord gateway sessions, a real constraint this repo has been burned by (the session-limit retry machinery in index.ts exists for the same reason). Justified duplication; handlers keeping their own checks as defense-in-depth is fine. |
| Setup wizard (`src/setup.ts` + `setup/workflow-template.ts`, 382 LoC) | 3.5 | Documented product surface (README, `repo-relay-init` bin) so not dead, and sole consumer of the `prompts` dep. The three copy-pasted channel-ID prompt blocks (setup.ts:160-200) could be one loop. Acceptable. |
| Slash commands (`src/commands/`, 582 LoC) | 1 | Fully dead. See Finding 1. |
| Utils (`retry`, `errors`, `validation`) | 4.5 | 39 LoC total, all used. A 2-line file for one regex (`validation.ts`) is silly but harmless. |
| Tests | 4 | ~3,300 LoC, proportionate, test real logic (pre-filter, session retry, lookup recovery, DB resilience). No tests for the dead `commands/` dir — which is telling. |

## Top 5 Findings

### 1. `src/commands/` is 582 LoC of dead code that ships in the action — DELETE
Self-described scaffolding: `src/commands/pr.ts:5` and `src/commands/status.ts:5` say *"Slash commands require a persistent bot process. This is scaffolding for Phase 5."* The fire-once CLI never registers an `interactionCreate` listener — grep across the entire repo for `interactionCreate|handlePrCommand|handleIssueCommand|handleStatusCommand|registerCommands` finds zero callers outside `src/commands/` itself. `src/index.ts` does **not** re-export it (only `embeds` and `handlers`, index.ts:505-506), `package.json` bins are only `cli.js`/`setup.js`, README never mentions slash commands, and `action.yml` runs `node dist/cli.js`. Worse: because `dist/` is committed for the composite action, the dead code ships to every consumer (`dist/commands/*` is in git), and it has already cost real maintenance — PRs #30 and #40 (`git log -- src/commands/`) fixed and refactored code nothing executes. This is the textbook liability for chroxy adoption.

### 2. `event_log` is a write-only audit table that bloats the actions cache
`db.logEvent()` is called from 9 handler sites (e.g. `handlers/pr.ts:69`, `handlers/ci.ts:72`, `handlers/security.ts:79`), each persisting the **entire JSON event payload** (`state.ts:522-533`). The only reader, `getRecentEvents()` (`state.ts:535-558`), has exactly one caller: a unit test (`state-resilience.test.ts:104`). No CLI flag, no command, no doc surfaces it. Meanwhile the recommended persistence model is `actions/cache` of `~/.repo-relay` — so this table grows the cache blob forever for data nobody can see. GitHub Actions logs already record every payload. Cut the table, `logEvent`, `getRecentEvents`, `EventLogEntry`, the `pr_number→entity_number` migration (`state.ts:135-143`), and 9 call sites.

### 3. `issue_data` is a second write-only table
`saveIssueData()` is called (`handlers/issue.ts:164-178`), but `getIssueData()` (`state.ts:490-499`) has **zero production callers** — only a mock in `issue.test.ts:88`. Unlike PRs (where `buildEmbedWithStatus` genuinely rebuilds embeds from `pr_data`), issue embeds are always rebuilt directly from the incoming payload (`handlers/issue.ts:131,150`). The table, interface `StoredIssueData`, both methods, and the `saveIssueDataFromIssueData` helper exist "for future rebuilding" that never arrived. ~70 LoC of pure YAGNI.

### 4. One PR lifecycle, four copies of it — plus a fifth embed-update sequence
`src/handlers/pr.ts` contains the "send embed → startThread → savePrMessage → savePrData → seed thread message" block four times: `handlePrOpened` (121-138), `handlePrClosed` fallback (184-199), `handlePrPush` fallback (229-245), `handlePrUpdated` fallback (299-316). Separately, the "fetch message → buildEmbedWithStatus → edit embed → getOrCreateThread → send reply → catch Unknown Message" sequence is re-implemented in `handlers/review.ts:77-106`, `handlers/comment.ts:92-117`, `handlers/ci.ts:85-119`, and `index.ts:400-441` (`checkAndUpdateReviews`). And `getOrCreateThread` (pr.ts:380-419) vs `getOrCreateIssueThread` (issue.ts:180-215) are the same function with different strings. Two small helpers (`createPrMessage()`, `updatePrEmbedAndNotify()`) would delete ~150 LoC and make the stale-message recovery pattern impossible to get inconsistently wrong.

### 5. `copilotComments` is plumbing for a constant zero
Every live write hardcodes 0: `handlers/review.ts:82` and `github/reviews.ts:88` both call `db.updateCopilotStatus(repo, pr, 'reviewed', 0)`. The only other source, footer recovery (`discord/lookup.ts:79`), just round-trips that same 0. Yet the value is carried through a DB column (`copilot_comments`), `PrStatus`, `ReviewStatus.copilotComments`, footer metadata (`builders.ts:121,573`), and the display string `✅ Reviewed (0 comments)` (`builders.ts:78`). Users see "(0 comments)" on every reviewed PR forever. Either count the comments or — minimalist verdict — delete the parameter and show "✅ Reviewed".

**Honorable mentions:** `CiStatus.conclusion` is set (`handlers/ci.ts:60`) but never read anywhere; `getOrCreateIssueThread` is exported as public API (`handlers/index.ts:9`) with one internal caller; `REPO_RELAY_LOG_SESSION_BUDGET` (index.ts:155) is an undocumented env flag (absent from README and CLAUDE.md's env table); `last_updated` column + `updatePrMessageTimestamp`/`updateIssueMessageTimestamp` are written constantly and read never; the blanket `export * from './handlers/index.js'` (index.ts:506) makes every internal helper de-facto public API, which is exactly how dead code gets immortality.

## Concrete Cut List

| # | Action | Est. LoC saved | Risk |
|---|---|---|---|
| 1 | Delete `src/commands/` + `dist/commands/*` | 582 src (+~600 dist) | **Low** — verified zero callers, not exported from index.ts, no bin, no README/action.yml reference |
| 2 | Drop `event_log` table, `logEvent`/`getRecentEvents`/`EventLogEntry`, migration, 9 call sites, 1 test block | ~85 | **Low-Med** — loses a theoretical debug affordance; Actions logs cover it. Old cached DBs unaffected (table just orphans) |
| 3 | Drop `issue_data` table, `StoredIssueData`, `save/getIssueData`, `saveIssueDataFromIssueData` + call sites | ~70 | **Low** — read path provably dead |
| 4 | Extract `createPrMessage()` + `updatePrEmbedAndNotify()` helpers; collapse 4 creation blocks and 4 update sequences; merge the two `getOrCreateThread` twins | ~150-180 | **Medium** — core path refactor, but review/comment/issue handlers have solid test coverage to lean on |
| 5 | Remove `copilotComments` plumbing (column, fields, footer key, display) or actually count comments | ~25 | **Low** |
| 6 | Collapse `mapGitHubEvent` to a handled-events `Set` + single cast; drop `CiStatus.conclusion`; document or remove `REPO_RELAY_LOG_SESSION_BUDGET`; drop `last_updated` bookkeeping | ~50 | **Low** |
| 7 | Replace `export *` in index.ts with explicit exports (cli.ts + action consumers need almost nothing) | ~0 (shrinks API surface) | **Low** |

Total: **~950-1,000 src LoC (~20% of the codebase)** plus the committed dist artifacts, with items 1-3 alone removing ~740 LoC at low risk.

## Verdict

repo-relay's core is genuinely good minimalist engineering: the fire-once CLI is linear, the simple handlers are payload-in/embed-out, the pre-filter and session-limit machinery are complexity earned by a real Discord constraint, and config/utils are as small as they can be. But it carries three classic "Phase N someday" liabilities — a 582-LoC dead slash-command subsystem that has already absorbed two maintenance PRs and ships in every consumer's checkout, plus two write-only SQLite tables silently fattening the actions cache — and its hottest file (`handlers/pr.ts`) pays a copy-paste tax that guarantees the stale-message recovery logic will eventually drift between its five implementations. Before chroxy takes this on as a production dependency, do cuts 1-3 (an afternoon, near-zero risk, −740 LoC) and schedule cut 4; the result would be a comfortable 4.5/5 codebase where everything that exists, runs.
