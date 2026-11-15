# Unattended Merge Gate

## Purpose

Defines when an autonomous session (e.g. `/autonomous-dev-flow`, `/tackle-issues`) may merge its **own** PR without a human pause, and what record it must leave behind. This replaces the old blanket "never merge — PRs accumulate for user review" rule for unattended sessions: a PR that has genuinely cleared every gate may merge so dependent work isn't deadlocked overnight, but nothing merges on faith and every merge is visible in the session report.

## The Gate — ALL conditions required

A session-created PR may be merged by the session itself ONLY when every one of these holds:

1. **`/full-review` completed with a clean verdict** — the full review pipeline (agent review + check-PR comment triage) ran on this PR and all critical findings were fixed in-PR. A skipped or partial review fails the gate.
2. **ALL CI checks pass on the final commit** — `check (20)`, `check (22)`, and `dist-freshness` must all be green; if a post-review fix was pushed, wait for the fresh run. A green run on a stale commit fails the gate.
3. **ZERO unresolved review threads** — every Copilot/agent/human thread is resolved with a reply or fix.
4. **Branch protection is satisfied without overrides** — never `--admin`, never bypass rules, never edit protection settings to get a merge through. Strict mode means the branch must be up to date with main; use `gh pr update-branch` and wait for the fresh CI run.
5. **The merge is synchronous and verified** — NEVER `gh pr merge --auto` and never GitHub's auto-merge queue. Verify gates 1–4, then merge, then confirm the PR reports `MERGED`. Queuing a merge to fire later defeats the gate: conditions are checked at queue time, not merge time.
6. **A report entry is mandatory** — every self-merged PR MUST appear as its own entry in the end-of-session report (see format below). A merge the user can't see in the report is a policy violation even if gates 1–5 passed.

**If ANY gate fails: do NOT merge.** Flag the PR for the user with the failed gate named, leave it open, and keep working. A failed gate is never retried by loosening it. (Reminder: "base branch policy prohibits the merge" is not always unresolved threads — check required-check contexts and strict-mode staleness before concluding.)

## Merge command

```bash
gh pr merge ${PR_NUM} --squash --delete-branch
# Verify — do not trust the exit code alone:
gh pr view ${PR_NUM} --json state --jq .state    # must print MERGED
```

After a verified merge, run the repo post-merge steps — **update the `v1` tag** so action consumers get the change (see Tag Management in CLAUDE.md):

```bash
git checkout main && git pull origin main
git tag -d v1 && git tag v1 main
git push origin :refs/tags/v1 && git push origin v1
```

## Report entry format

The end-of-session report (final summary / Morning Summary) must contain one entry per self-merged PR:

```markdown
### Merged by this session

| PR | Issue | Review | Checks | Merge SHA |
|----|-------|--------|--------|-----------|
| [#45](url) | #12 — Add retry logic | Approve, 0 unresolved | all green | `abc1234` |
```

PRs that passed review but failed a later gate (e.g. CI red at merge time) go under **Needs Attention** with the failed gate named — never silently dropped.

## Integration points

- **`/autonomous-dev-flow`** — Phase 5 (Full Review) merges through this gate instead of accumulating; Phase 6 report gains the Merged-by-session entries.
- **`/tackle-issues`** — merges happen inline during waves through this gate (a merged PR unblocks dependent queue items); `merge:off` disables self-merging, falling back to accumulate + manual merge. The Morning Summary carries the merge entries.
- **Interactive sessions** — this gate does NOT grant merge authority when the user is present; the existing confirm-before-merge convention applies.

## Why This Works

- **The review bar never moves** — the gate reuses the same /full-review + CI + thread-resolution bar a human merge requires; only the human pause between "green" and "merge" is removed, and only for unattended runs.
- **No fire-and-forget** — banning auto-merge means conditions are verified at merge time by the agent that is accountable for them.
- **Auditability** — the report entry per merge means the user reviews the same information they would have pre-merge, just after the fact.
- **Deadlock-free marathons** — dependent issues (Phase N+1 needs Phase N merged) no longer stall an overnight queue.

<!-- skill-templates: unattended-merge d3cd6f5 2026-06-10 -->
