# Master Assessment: repo-relay Full Bug & Quality Audit

**Date**: 2026-06-09
**Panel**: 8 agents (4 core + 4 extended)
**Aggregate Rating**: **3.1 / 5** (weighted: core 1.0x, extended 0.8x)
**Context**: Audit commissioned because repo-relay is becoming a production dependency of the chroxy ecosystem (see chroxy#5413).

---

## a. Auditor Panel

| Agent | Lens | Rating | Key Contribution |
|---|---|---|---|
| Skeptic (core) | Claims vs reality | 2.5 | README cache recipe never persists state; permission docs guarantee failure; polling is a no-op by default |
| Builder (core) | Implementability, patterns | 3.5 | Lint toolchain dead; CI doesn't guard committed dist/; thread-name overflow ×8 sites; labels field unbounded |
| Guardian (core) | Failure modes, races | 3.1 | Concurrent-run races; non-idempotent handlePrOpened; process.exit skips WAL checkpoint; shell injection in action.yml |
| Minimalist (core) | YAGNI, dead code | 3.5 | 582 LoC dead slash-command subsystem; two write-only DB tables; ~20% of codebase cuttable |
| Discord (ext.) | discord.js platform | 3.1 | startThread-on-archived-thread crash (160004); Message#thread is cache-only; archived-thread sends silently dropped |
| Webhook (ext.) | GitHub platform | 3.0 | CI conclusions greenwashed; $default-branch dead trigger; missing `actions: read`; fork PRs fail red; no pagination |
| Tester (ext.) | Coverage, edge cases | 2.5 | Zero tests on pr.ts/reviews.ts/ci handler; Node 26 build failure; 16-item implementable edge-case catalog |
| Adversary (ext.) | Attack surface | 3.2 | Agent-review state spoofable by any commenter; masked-link phishing in descriptions; mutable v1 tag supply chain |

Weighted aggregate: (2.5+3.5+3.1+3.5)·1.0 + (3.1+3.0+2.5+3.2)·0.8 = 22.04 / 7.2 = **3.06 ≈ 3.1**

---

## b. Consensus Findings (4+ agents agree — high confidence)

### C1. The delivery pipeline doesn't verify what consumers run (Skeptic, Builder, Tester, Adversary)
`action.yml` executes committed `dist/cli.js` at a mutable `@v1` tag, but CI runs only test+typecheck — no build, no `git diff --exit-code dist/` freshness check. `npm run lint` is entirely broken (ESLint 9 installed, no flat config exists, dead `--ext` flag). A PR editing `src/` without rebuilding ships stale code to every consumer with green CI. Current sync is luck, not control.
**Action**: add `lint` + `build` + dist-diff steps to ci.yml; create `eslint.config.js`; publish immutable version tags alongside `v1`.

### C2. `handlePrOpened` is not idempotent — duplicate embeds/threads (Guardian, Discord, Webhook, Tester)
`pr.ts:115-139` unconditionally sends a new embed with no `getExistingPrMessage` check, unlike every other PR path. Triggers: job re-runs (the docs' own "configure secrets, then re-run" flow), webhook redelivery, out-of-order events, and **every close→reopen cycle** (`reopened` routes to `handlePrOpened`, pr.ts:94-96). Each occurrence orphans the old embed/thread permanently.
**Action**: check `getExistingPrMessage` first; on hit, edit/reuse.

### C3. CI conclusion mapping reports failures as success (Skeptic, Builder, Webhook, Tester)
`mapCiStatus` (ci.ts:127-137) defaults unknown conclusions to `'success'`; the type at ci.ts:22 omits `timed_out`, `action_required`, `stale`, `startup_failure`. A timed-out or unparseable workflow renders "✅ Passed". Worst possible failure mode for a notification bot feeding chroxy decisions.
**Action**: enumerate all nine conclusions; default unknown → failure (or loud log).

### C4. Stale-message detection by string matching, ×7 sites (Skeptic, Builder, Guardian, Discord)
`errMsg.includes('Unknown Message')` copy-pasted across handlers instead of `DiscordAPIError.code === 10008`. Brittle against wording changes; over- and under-matches (misses 160004, 50083).
**Action**: one `isUnknownMessageError()` helper; replace all sites.

### C5. Copy-paste structure is the bug multiplier (Builder, Minimalist, Discord, Tester)
The create-message+thread block ×4 in pr.ts, ×2 in issue.ts; `getOrCreateThread`/`getOrCreateIssueThread` twins; thread-name string built at 8 sites — which is exactly why the thread-name >100-char overflow (PR ≥ #10000 / Issue ≥ #10 with long titles → hard API 400) exists at 8 sites instead of 1.
**Action**: `buildThreadName()` helper capping at 100 chars; extract `createPrMessageWithThread()` / `updatePrEmbedAndNotify()`; merge the thread twins.

### C6. `event_log` stores full payloads, unbounded, write-only (Builder, Guardian, Minimalist, Adversary)
Every event appends its complete JSON payload (state.ts:522-533); the only reader is a unit test. It bloats the actions/cache artifact forever and writes private-repo content to cache at rest.
**Action**: delete the table (Minimalist) or prune + store minimal fields (Guardian/Adversary) — see Contested Points.

### C7. action.yml interpolates inputs directly into bash (Builder, Guardian, Webhook, Adversary)
`${{ inputs.discord_bot_token }}` / `${{ inputs.channel_prs }}` template-expanded into `run:` scripts (action.yml:52-63) — the canonical GHA injection antipattern, plus the token lands in script text.
**Action**: pass via `env:` and reference `"$VAR"`.

### Near-consensus (2-3 agents, severity warrants top billing)

- **C8. The documented actions/cache recipe never saves after the first run** (Skeptic #1, Guardian F1 — both rated it critical). `key: repo-relay-state-${{ github.repository }}` is constant; `actions/cache` skips save on exact hit. State is frozen at day one: duplicate "reviewed" posts on every event, polling sees only day-one PRs, persistence claim in README/CLAUDE.md is false. **Action**: per-run key + `restore-keys`, in README *and* wizard template, plus a `concurrency:` group (Guardian F2).
- **C9. Archived-thread handling breaks the product's own model** (Builder, Discord). Recovery stores `threadId: null` because `Message#thread` is cache-only → `startThread` on a message with an archived thread → 160004 crash, every subsequent event fails. Piggyback path raw-`thread.send`s into archived threads and swallows the error → review notifications silently lost on exactly the quiet PRs polling exists for. **Action**: fetch thread by message ID before startThread; route all sends through `getOrCreateThread`.
- **C10. Review detection degrades silently** (Guardian, Webhook, Tester). No pagination (`per_page=100`, ascending — the newest agent-review comment is the one cut off on busy PRs); non-2xx responses silently ignored; zero tests on `checkForReviews`.
- **C11. The wizard template ships broken consumer configs** (Skeptic, Webhook, Guardian): `$default-branch` literal (push trigger never fires — and a test asserts the bug), missing `actions: read` (failed-step enrichment 403s for all consumers), no fork guard (fork PRs fail red), missing `reopened` for issues, no cache step, no concurrency group.
- **C12. Agent-review state is spoofable by any commenter** (Adversary #1 — single agent, but verified exploit path and high impact given chroxy will consume these signals). One comment containing `**Verdict:** lgtm` marks any PR "Agent Review: ✅ Approved" in Discord. **Action**: gate on `author_association`/bot identity; show the author login in the embed.

---

## c. Contested Points

1. **`event_log`: delete vs prune.** Minimalist: delete outright (write-only, Actions logs duplicate it). Guardian/Builder: keep with 30-day pruning. Adversary: store minimal fields, not full payloads. **Assessment**: Minimalist is right for today's reality (no reader exists), but the chroxy integration plan (#5413) may want an event trail. Pragmatic call: stop storing full payloads now, add pruning; revisit deletion when chroxy's needs are concrete.
2. **Owner-cascade filter correctness.** Webhook: "owner-cascade suppression matches real payload behavior" (correct for personal repos). Skeptic: the filter compares against `repository.owner.login`, so on **org-owned repos** it never matches any human and does nothing; README ("handled automatically since v1") and CLAUDE.md ("requires workflow if filter") flatly contradict each other. **Assessment**: both right in their domain — the code works only for personal-owner repos. Since chroxy repos may live under an org, treat Skeptic's finding as real: filter on PR-author/maintainer association rather than repo owner, and fix whichever doc is wrong.
3. **Human reviews ignored by review.ts.** Builder: functional hole (3/5). Webhook: scoped design (4/5). **Assessment**: it's a deliberate scope choice that's now wrong for the production-dependency bar — at minimum post human approved/changes_requested to the thread. Decide explicitly rather than leave it implicit.
4. **Pre-filter duplication.** Minimalist: justified (saves gateway sessions, real constraint). Tester: wants a parity property-test so the duplicate logic can't drift. **Assessment**: both — keep the duplication, add the parity test.

---

## d. Factual Corrections (docs claims that are wrong)

| Claim | Where | Reality | Found by |
|---|---|---|---|
| Cache recipe gives "persistent" state | README.md:251-270, CLAUDE.md | Constant key → saved once, never updated; state frozen at first run | Skeptic, Guardian |
| Required Discord permissions table (5 perms) | README.md:215-229 | Code hard-requires 6 incl. Manage Threads → bot fails on every event if docs followed | Skeptic |
| "Enable Message Content + Server Members intents" | README.md:68 | Code requests neither; instruction is unnecessary (and bad hygiene) | Skeptic |
| Review-reply cascades "handled automatically since v1" | README.md:287 | Filter only works on personal-owner repos; CLAUDE.md says the opposite | Skeptic |
| Scheduled polling "polls all open PRs… catches reviews on quiet PRs" | CLAUDE.md | No-op on hosted runners without (working) cache; wizard template ships neither | Skeptic |
| `$default-branch` in generated workflow | workflow-template.ts:23 | Literal string in user workflows — push trigger never fires; test enshrines it | Skeptic, Webhook |
| Threads "unarchived when new updates arrive" | CLAUDE.md | True only via getOrCreateThread; piggyback/polling path doesn't unarchive and drops sends | Builder, Discord |

---

## e. Risk Heatmap

```
                            IMPACT →
            low                medium               high
        ┌──────────────────┬────────────────────┬─────────────────────────┐
   high │ '(0 comments)'   │ thread-name >100   │ C8 cache key freeze     │
 L      │ display nit      │ (Issue ≥ #10!)     │ C2 dup embeds (reopen)  │
 I      │                  │ event_log growth   │ C3 CI greenwashing      │
 K      ├──────────────────┼────────────────────┼─────────────────────────┤
 E  med │ deprecated       │ archived-thread    │ C9 160004 crash loop    │
 L      │ 'ready' event    │ silent drops       │ C11 broken consumer     │
 I      │ unawaited        │ no pagination      │     template            │
 H      │ destroy()        │ base_branch upsert │ C1 stale dist/ ships    │
 O      ├──────────────────┼────────────────────┼─────────────────────────┤
 O  low │ dead commands/   │ action.yml shell   │ C12 review spoofing     │
 D      │ (cost, not risk) │ injection          │ v1 tag supply chain     │
        │                  │ connect() hang     │ Node 26 build failure   │
        └──────────────────┴────────────────────┴─────────────────────────┘
```

---

## f. Recommended Action Plan

**Phase 0 — Stop the bleeding (docs + config, ~1 day, no code risk)**
1. Fix README cache recipe (per-run key + restore-keys) and add `concurrency:` group; fix permission table (+Manage Threads, −privileged intents); resolve cascade-filter doc contradiction. (C8, corrections)
2. Fix wizard template: resolve `$default-branch`, add `actions: read`, fork guard, `reopened`, cache step, concurrency. (C11)

**Phase 1 — Correctness bugs (~2-3 days)**
3. `mapCiStatus`: all nine conclusions, unknown → failure. (C3)
4. `handlePrOpened` idempotency via `getExistingPrMessage`. (C2)
5. `buildThreadName()` ≤100 chars, replace 8 sites; cap labels field at 1024 with "+N more"; cap CI-failure reply at 2000. (C5)
6. `isUnknownMessageError()` (code 10008) + handle 160004 by fetching the existing thread; route piggyback sends through `getOrCreateThread`; stop swallowing those errors. (C4, C9)
7. `process.exitCode = 1` instead of `process.exit(1)` in cli.ts catch; 60s ready-timeout; `client.on('error')` sanitized logger; await `destroy()`.
8. Author-gate agent-review detection (`author_association`); escape masked links in embed descriptions. (C12)

**Phase 2 — Pipeline + hygiene (~2-3 days)**
9. `eslint.config.js` + lint/build/dist-diff in CI; Node version matrix; decide Node 26 story. (C1)
10. Delete `src/commands/` (~582 LoC) and `issue_data`; slim `event_log` (no full payloads + pruning). (C6, Minimalist cuts 1-3)
11. reviews.ts: pagination, non-2xx logging, rate-limit awareness; add `base_branch` to savePrData upsert. (C10)
12. action.yml: inputs via `env:`; drop `2>/dev/null`. (C7)

**Phase 3 — Tests + refactor (~1 week, can interleave)**
13. pr.ts lifecycle tests (mock pattern proven in issue.test.ts); `checkForReviews` table-driven tests; `mapCiStatus` table; malformed-payload suite; coverage instrumentation with per-directory thresholds. (Tester F1/F3/F4 + edge-case catalog)
14. Extract `createPrMessageWithThread()` / `updatePrEmbedAndNotify()`; merge thread twins. (C5 structural half — after tests exist)
15. Decide human-review handling; pre-filter parity test. (Contested 3, 4)

**Dependency ordering**: Phase 0 is independent and highest leverage-per-hour. Phase 1 items 5-6 should land before Phase 3 item 14 (refactor wants the helpers' behavior pinned by tests first). Phase 2 item 9 should land before any other PRs merge, so dist/ drift can't slip in during the fix campaign.

---

## g. Final Verdict

**3.1 / 5 — Needs revision; not ready to be a production dependency, but nothing requires rethinking.**

Every agent independently converged on the same shape: the core engineering is genuinely good — parameterized SQL, DB integrity-check-and-recreate, footer-metadata recovery, pre-filter session economics, and a session-limit retry better than most production bots — but the system fails at its edges, and the edges are exactly what consumers touch. The documented persistence recipe doesn't persist, the generated workflow template ships four distinct bugs, the delivery pipeline can ship stale code with green CI, timed-out builds render as passed, and the flagship PR handler has zero tests and isn't idempotent. The unanimous good news: not one finding is architectural. The fire-once CLI design is sound for its job; the fixes are docs, mappings, one helper function, a cache key, and test coverage — roughly two focused weeks to move from 3.1 to a defensible 4+, at which point chroxy can take the dependency with confidence.

---

## h. Appendix — Individual Reports

| Report | Agent | Rating |
|---|---|---|
| [01-skeptic.md](01-skeptic.md) | Skeptic — claims vs reality | 2.5 |
| [02-builder.md](02-builder.md) | Builder — implementability | 3.5 |
| [03-guardian.md](03-guardian.md) | Guardian — failure modes | 3.1 |
| [04-minimalist.md](04-minimalist.md) | Minimalist — YAGNI | 3.5 |
| [05-discord-specialist.md](05-discord-specialist.md) | Discord — platform | 3.1 |
| [06-webhook-specialist.md](06-webhook-specialist.md) | Webhook — GitHub platform | 3.0 |
| [07-tester.md](07-tester.md) | Tester — coverage | 2.5 |
| [08-adversary.md](08-adversary.md) | Adversary — attack surface | 3.2 |
