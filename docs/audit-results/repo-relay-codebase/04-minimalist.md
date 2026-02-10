# Minimalist's Audit: repo-relay Codebase

**Agent**: Minimalist -- Ruthless engineer who believes the best code is no code
**Overall Rating**: 3.4 / 5
**Date**: 2026-02-09

---

## Source Profile

- **Non-test source**: 4,645 lines across 28 files
- **Core path** (PR + CI + thread lifecycle): ~1,700 lines
- **Secondary handlers** (issue, review, comment, release, deployment, push, security): ~1,000 lines
- **Dead/scaffolding code** (slash commands, setup wizard): ~850 lines
- **Infrastructure** (DB, embeds, utils, pre-filter, lookup): ~1,100 lines

---

## Section-by-Section Ratings

### 1. Core Event Routing (`src/index.ts`, `src/cli.ts`) -- 3/5
`extractRepo` is a 24-line switch returning the same expression for every branch. `checkAndUpdateReviews` is 55 lines of inline handler logic living inside the orchestrator class.

### 2. Pre-filter (`src/pre-filter.ts`) -- 2/5
129 lines duplicating every handler's early-exit logic. Every filter change requires updating two files. A `canHandle(payload)` export on each handler would eliminate this entirely.

### 3. Database Layer (`src/db/state.ts`) -- 3/5
6 tables for a message-mapping problem. `pr_status` and `pr_data` could collapse into `pr_messages`. Issue tables are copy-paste of PR tables. 28 public methods where 14 would suffice with generics. `event_log` is write-only with no production consumer.

### 4. Embed Builders (`src/embeds/builders.ts`) -- 3.5/5
598 lines, largest single file. Mostly justified. Three security alert builders share identical structure and could be one. Footer metadata recovery is clever and earns its complexity.

### 5. Handlers (`src/handlers/`) -- 2.5/5
Four copies of "create embed + thread + save" in `pr.ts`. Three copies of stale message try/catch. Review and comment handlers are nearly identical. This is the YAGNI hotspot.

### 6. Slash Commands (`src/commands/`) -- 1.5/5
580 lines of dead code. "Phase 5 scaffolding" that is never consumed by `cli.ts` or `index.ts`. Duplicates embed-building logic and defines its own API calls.

### 7. Setup Wizard (`src/setup.ts`, `src/setup/workflow-template.ts`) -- 3/5
Nice UX but `prompts` is a runtime dependency used only here. Should be a devDependency or separate script.

### 8. Discord Lookup/Recovery (`src/discord/lookup.ts`) -- 4/5
Right abstraction level. Clean separation. Footer-metadata recovery is elegant. Minor: `getExistingPrMessage` and `getExistingIssueMessage` are near-identical.

### 9. Utilities -- 4/5
Small, focused, well-tested. No complaints.

---

## Top 5 Findings

### Finding 1: Slash Commands Are Dead Code (580 lines)
**Files**: `src/commands/pr.ts`, `issue.ts`, `status.ts`, `register.ts`, `index.ts`
No handler for interaction events in RepoRelay class. `cli.ts` never imports from `commands/`. Delete entirely.

### Finding 2: Four Copies of "Create PR Message + Thread" Logic
**File**: `src/handlers/pr.ts` lines 113-137, 182-197, 227-243, 296-313
~80 duplicated lines. Extract a single `createPrEmbedWithThread()` helper.

### Finding 3: Pre-Filter Duplicates Handler Logic
**File**: `src/pre-filter.ts` (129 lines)
Every check re-checked in the corresponding handler. The push handler's three filter conditions match pre-filter exactly. Handler-exported `canHandle()` functions would eliminate this.

### Finding 4: `event_log` Table Has No Production Consumer
**File**: `src/db/state.ts:216-227, 522-558`
`getRecentEvents` is never called outside tests. Table grows without bound. Either add a consumer and retention policy, or remove.

### Finding 5: `extractRepo` Is 24 Lines That Do Nothing
**File**: `src/index.ts:421-445`
Every switch case returns `eventData.payload.repository.full_name`. Replace with a single line and a shared base type.

---

## What I Would Cut for 30% Reduction (~1,400 lines)

| Cut | Lines saved |
|-----|-------------|
| Delete `src/commands/` (dead code) | ~580 |
| Move `setup.ts` + `workflow-template.ts` to separate tool | ~380 |
| Generic entity tables, merge `pr_status` into `pr_messages` | ~120 |
| Extract PR create/thread + stale-message helpers | ~100 |
| Delete `event_log` and all `logEvent` calls | ~50 |
| Delete `pre-filter.ts`, move filters to handler contract | ~129 |
| Merge `review.ts` and `comment.ts` | ~50 |
| **Total** | **~1,410** |

---

## Overall Rating: 3.4 / 5

Solid core buried under premature feature expansion. The PR/CI core works well and the embed recovery system is genuinely clever. But the codebase has grown through additive features without consolidating repeating patterns. Slash commands are dead code. Pre-filter is a maintenance hazard. DB schema has 6 tables where 2-3 would suffice. PR handler has four copies of the same block. A focused consolidation pass could cut 30% while improving maintainability.
