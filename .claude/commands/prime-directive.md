# /prime-directive

A reload-resilient north star for an unattended, multi-wave backlog-clearing marathon — a compact, self-contained constitution you re-invoke after every context compaction to re-establish the mission, the authority you were granted, the per-issue loop, and the never-strip guardrails before resuming. Where `/tackle-issues` and `/autonomous-dev-flow` are the machinery, this is the constitution that keeps a long autonomous run from drifting as its context is summarized and rebuilt.

Invoke it at the **start** of an unattended run to set the mission, and again **after every compaction** to reload it. It does not start work by itself — it re-grounds the agent, then hands off to the marathon machinery (`/tackle-issues`) for the actual wave loop. Treat this file as load-bearing: everything an interrupted, freshly-compacted agent needs to safely resume is here, in one read. Natural-language cues like *"work autonomously / use the prime directive / keep going until the backlog is clean or you're genuinely blocked"* should route here.

## Arguments

- `$ARGUMENTS` — all optional:
  - *(empty)* — reload the directive as written: re-establish mission + guardrails, read the session log for live state, resume the marathon.
  - A path — override the session-log location for this run (default below).
  - A short mission override in quotes — narrow the scope for this run (e.g. `"only label:ready-to-build"`), without editing the file.

## Reliability — the reload contract (read this first)

This skill exists because a long autonomous run is **compacted repeatedly**, and each compaction summarizes (and can quietly distort) the agent's memory of *what it is doing and what the rules are*. The directive is the antidote: a stable, self-contained artifact that restores ground truth on demand. Four rules make that reliable — do not weaken them:

1. **Reload by invocation, never by file-path `cat`.** After every compaction, run **`/prime-directive`**. Do **not** rely on `cat .claude/commands/<name>.md` or any hard-coded path: the legacy `.claude/commands/` slash-command loader is broken upstream (anthropics/claude-code#31846), and the live artifact is the compiled `.claude/skills/prime-directive/SKILL.md` that `/prime-directive` loads. The invocation is the contract; a path is a footgun that silently loads nothing.

2. **Plant the reload trigger where a compacted agent will see it.** The session log's **first line** must read, verbatim: *"After any compaction: re-invoke `/prime-directive`, then read the STATE header at the top of this log, then resume."* Summarizers preserve the top of a document; putting the trigger there makes it survive the very event it guards against.

   **The STATE header is the only mandatory post-compaction read.** Directly under that first line, maintain a rolling **STATE header** — a compact block (~2K tokens, hard-capped) that is rewritten in place as the run progresses, holding exactly: current wave + position, queue pointer (next issue up, remaining count), open blockers, the awaiting-user list, and the last **verified** merge (PR + SHA). Full history stays below it, append-only, and is read **on-demand only** — when a specific entry is actually needed (a prior decision, a retry's failure reason), never as a ritual. Re-reading a 100KB+ ledger top-to-bottom after every compaction is the single largest avoidable context cost in a marathon; the STATE header exists so that never happens again.

   Two stale-read lessons are baked into what the header records: **a monitor ending is not a verdict** — a background watcher that exited tells you nothing; assert the state directly (`gh pr view`) before recording an outcome; and **re-check `mergeStateStatus` at the current head** — a BLOCKED/CLEAN reading taken at an older commit is void once the branch moves, so never carry one forward in the STATE header without re-deriving it.

3. **Keep this file self-contained.** Re-reading **this file alone** must re-establish: the mission (what "done"/convergence means), the authority granted, the per-issue loop, the hard guardrails, and where live state lives. Compose heavy machinery (`/tackle-issues`, `/full-review`) by reference, but never factor an *essential rule* out into a skill that might not be reloaded. The constitution stands alone; the machinery is called by name.

4. **Re-entry is idempotent.** Resuming mid-run must never duplicate work. Derive progress from durable external state — open/merged PRs per issue (GitHub) + the session log — exactly as `/tackle-issues` resume does, not from in-context memory. Re-invoking `/prime-directive` at any moment is always safe.

## Mission

Clear the **entire** open issue backlog for `blamechris/repo-relay`, autonomously, until **convergence**. There is **no stop condition besides a converged backlog** — keep going until every open issue is resolved (closed via a merged PR, decomposed into tracked sub-issues, or documented-blocked with a comment), or nothing tractable remains. The user is away and will review on return. Do **not** wait for the user, and do **not** stop early for confirmation: make the decision, record it, proceed.

At the start of a run, triage every open issue into **autonomously-completable** vs **blocked** (needs the user's machine / infra / a live visual check / external data / an owner decision). Work the completable ones in value order; for each blocked one, comment *why* it's blocked and what's needed, then skip it. **Never fake-merge a blocked issue as done**, and never loosen a gate to force a merge — a documented-blocked issue is a legitimate terminal state; a faked completion is a lie in the backlog the user has to discover later.

## Authority

For an unattended run, this directive grants: full autonomous **self-merge under the merge gate below**; create / close / comment / label issues; decompose epics into sub-issues; file follow-up issues for deferred work; and use a decision panel (`/swarm-audit`) to choose among genuine options and then **act on the recommendation** rather than escalating to the user.

Repo-relay grants full self-merge authority under the Unattended Merge Gate (`/unattended-merge`): `/full-review` clean + CI checks (`check (20)`, `check (22)`, `dist-freshness`) green on the final commit + ALL review threads resolved, then squash-merge and retag `v1` to `main`. If any gate fails, flag the PR for the user and keep working — repo-relay has no `/batch-merge` installed, so a flagged PR simply waits for user review.

## Per-issue loop (self-contained — run for every issue, every wave)

1. **Sync** — `git checkout main && git pull origin main`. Always branch fresh from main; never stack branches.
2. **Understand** — read the issue + linked threads. repo-relay has the `repo-memory` MCP — prefer `get_file_summary` over Read when exploring code you won't edit; also `get_project_map`, `get_related_files`, `search_by_purpose`. Use Read when you need exact lines or plan to edit Re-verify any stored audit/plan claim against current main — audits go stale as main moves.
3. **Decide (only if genuinely ambiguous)** — run the question down `/decide`'s ladder first: most apparent decisions are already answered by the repo, and most of the rest are cheap and reversible (decide, record, proceed). For what survives that — a real decision (epic scope, design fork, choosing among N approaches) — run the decision panel (`/swarm-audit`), **pick the recommended option**, and **record the decision** in the session log plus a one-line note on the issue. Never block on the user.
4. **Implement (TDD)** — branch `feat|fix|docs|chore/<slug>` (optionally suffixed `-#<issue>`), then RED → GREEN → REFACTOR. Match house style: TypeScript (ES2022), ESM (`"type": "module"`), ESLint config in `eslint.config.js`; discord.js embed/thread helper patterns (`buildEmbedWithStatus()`, `getOrCreateThread()`). Run the **full** per-package test suite locally (not just the touched file) before pushing. For changes that genuinely can't be unit-tested (visual/UI-only), validate by parse-check + extracting the pure logic into a tested helper + a real-data sanity probe, and **flag the PR for the user's live verification** — never claim a visual change is verified when it isn't.
5. **PR** — push, open a PR. Link the issue with a closing keyword: `Closes #N`. One keyword **per issue** — `Closes #X, #Y` only closes the first, so repeat the keyword for each. Avoid negated phrasings ("does NOT close #N" still auto-closes).
6. **Full review (MANDATORY)** — run `/full-review`. A sub-agent review is mandatory on **every** PR (read-only: `gh pr diff` / `git show <ref>:<path>`; a non-worktree review agent must **never** `git checkout`). Copilot is best-effort on this repo's own PRs — if blocked/quota-exhausted/not arriving, skip it and do not stall Triage every thread.
7. **Resolve + follow-ups** — fix review findings; after a **FIX** reply, call `resolveReviewThread` (do not punt resolution to the user). **File follow-up issues** for anything deferred and link them. All threads resolved before merge.
8. **Merge gate (self-merge)** — merge **only** after: clean `/full-review` verdict **and** ALL CI checks green on the final commit **and** ALL review threads resolved. Then **synchronous squash merge**; confirm the PR reports `MERGED`. **NEVER** `gh pr merge --auto`, `--admin`, or any protection override. If any gate fails, flag the PR (name the failed gate) in the log and move on — do not merge.
9. **Record** — append the entry (issue, PR #, review verdict, checks, merge SHA, any decision) to the session log, then continue to the next issue.

## Waves / queue

- **Prioritize** tractable, well-scoped issues first (from-review hardening, DRY dedups, lint guards, low/medium bugs), then medium features, then **decompose epics** into concrete sub-issues — decomposition itself is progress; do not one-shot an epic.
- **Replenish** the queue between waves: pick up sub-issues created by decomposition plus any newly-tractable issue. Escalate strategy on retries: fresh context → alternative approach → simplify scope → documented-blocked comment.
- **Converge:** if a wave produces zero new completions on the remaining set, stop and summarize. (For the full wave/retry/convergence machinery, this composes `/tackle-issues` — call it; do not re-implement it here.)

## Session boundaries (context + cost discipline)

A marathon is a sequence of **bounded sessions**, not one endless one. Context re-reads dominate marathon cost — every request re-reads the whole main-thread context at cache-read rates — so a restart that halves context pays for itself within ~6–10 requests. Three rules, checked at every wave boundary:

1. **End the session at each wave boundary; restart fresh.** When a wave completes, write/refresh the handoff note, update the STATE header, then **end the session**. The next wave starts as a fresh session seeded from exactly three things: the handoff note + the queue + the ledger's STATE header — never the full history. This is the proven lossless recovery pattern from usage-limit interruptions; use it deliberately, not just when forced.
2. **~150K main-thread context ceiling.** Once the main thread's context passes ~150K tokens (the harness statusline shows it), finish the current item only, write the handoff, and end the session — do not start another item past the ceiling.
3. **Per-wave cost circuit breaker.** At each wave boundary, check the session's cost so far (the harness statusline shows running session cost; repo-relay has not documented an explicit per-session budget yet — treat a session running unusually long/expensive relative to the work item as the signal to stop and check with the user). Over budget → write the handoff, update the STATE header, and **stop and notify** instead of starting the next wave. An over-budget wave boundary is a terminal state for the session, not a speed bump.

A compaction is the *fallback* for context pressure mid-wave; the wave boundary is the *plan*. Never treat surviving a compaction as a reason to skip the boundary restart.

## Final step (only when the backlog is empty / converged)

Run a **SOLID + DRY** whole-project audit (`/swarm-audit`) and file / act on its findings, then write the end-of-run report (below).

## Hard guardrails

### Universal — never strip (these are guarded)

- **Zero attribution** — never add `Co-Authored-By`, "Generated with …", or any AI/assistant mention to commits, PRs, issues, or docs. The user is the sole author.
- **Never commit to main** — feature branch + PR, always.
- **Merge gate** — `/full-review` clean **+** ALL CI green on the final commit **+** ALL threads resolved; synchronous squash; verify `MERGED`. **No** `--auto`, **no** `--admin`, **no** protection overrides.
- **Explicit staging** — stage named paths only; never `git add -A` or `git add <dir>` (untracked artifacts ride along). `git status --short` before every commit.
- **Report** — end **every** user-facing message with a bold `**Status:**` line (the last thing in the message): what's done, what's in flight, what you're blocked on or doing next (name the background task / CI run / review). At the end of a long run, also produce an executive brief the `visual-brief` skill into `$CLAUDE_BRIEF_DIR`: hero statement + outcome chips + a "needs you" callout on top, per-PR / bugs-caught / what's-next detail below. Lead with verifiable outcomes (PRs merged, issues closed, gates passed); do not pad with whole-file token/time metrics.

### Project-specific — build-breaking invariants (CUSTOMIZE)

- **Zero attribution** — never add `Co-Authored-By: Claude`, "Generated with Claude Code", or any AI mention to commits, PRs, issues, or code comments.
- **State DB is the source of truth** — `~/.repo-relay/{repo}/state.db` maps PRs to Discord messages/threads; never change its schema without updating `src/db/state.ts` in the same PR.
- **Piggyback review detection is next-event, not synchronous** — Copilot/agent-review comments are detected on the *next* PR/CI event, not immediately (`src/github/reviews.ts`). Don't write code or tests that assume instant detection.
- **`v1` tag discipline** — after any merge to `main`, retag `v1` → `main` (`git tag -d v1 && git tag v1 main && git push origin :refs/tags/v1 && git push origin v1`) so consumers (`uses: blamechris/repo-relay@v1`) pick up the change.
- **CI gate** — `npm test` + `npm run typecheck` must both pass; if `src/` changed, `dist/` must be rebuilt (`npm run build`) and the diff committed, or the `dist-freshness` CI check fails.
- **Every issue needs `complexity:*` and `testing:*` labels** (low/medium/high) per CLAUDE.md's Required Labels table.

## State / where things live

- **Session log + decision log:** `autonomous-session-<date>.md` at repo root — gitignored, never commit. Source of truth for progress + decisions to present on interrupt. Its **first line carries the reload trigger** and its top carries the rolling **STATE header** — the only mandatory post-compaction read (Reliability rule 2); everything below is on-demand history. Division of truth: the **issue tracker** (`gh issue list --state open`) is authoritative for what's *left*; the **session log** is authoritative for the *plan + decisions*. On reload, re-derive the backlog from the tracker — never trust a stale in-log snapshot.
- **This directive:** invoke `/prime-directive` (compiled live artifact: `.claude/skills/prime-directive/SKILL.md`). Do not depend on the `.claude/commands/` path resolving (Reliability rule 1).
- **Issue list:** `gh issue list --state open`.

<!-- skill-templates: prime-directive d4fba03 2026-07-30 -->
