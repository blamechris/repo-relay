# Webhook Specialist's Audit: repo-relay Full Bug & Quality Audit

**Agent**: Webhook -- GitHub platform specialist (webhook payloads, event sequencing, delivery guarantees, API correctness)
**Overall Rating**: 3.0 / 5
**Date**: 2026-06-09

## Subsystem Ratings

| Subsystem | Rating | One-liner |
|---|---|---|
| Event mapping (`src/cli.ts` `mapGitHubEvent`) | 4/5 | Correct routing incl. schedule special-case; blind casts but provenance (GITHUB_EVENT_PATH) is trusted |
| Pre-filter (`src/pre-filter.ts`) | 4/5 | Faithfully mirrors handler early-exits; one crash edge; drift risk is inherent to duplication |
| Handler: `pr.ts` | 3.5/5 | Excellent stale-message recovery, but `handlePrOpened` is not idempotent |
| Handler: `ci.ts` | 2.5/5 | Conclusion mapping mislabels failures as success; fork PRs invisible |
| Handler: `review.ts` | 4/5 | Owner-cascade fix correct; Copilot bot matching reasonable |
| Handler: `comment.ts` | 4/5 | Correct issue-vs-PR discrimination via `issue.pull_request` |
| Handlers: issue/release/deployment/push/security | 4/5 | Payload assumptions match real schemas; sensible action filtering |
| Piggyback detection (`src/github/reviews.ts`) | 2.5/5 | No pagination, silent non-2xx, no rate-limit awareness |
| Scheduled polling | 3/5 | Correct env usage; burns a Discord gateway session even with zero open PRs |
| Workflow template (`src/setup/workflow-template.ts`) | 2/5 | Multiple correctness bugs in the artifact consumers actually run |
| `action.yml` | 3.5/5 | Sound composite design (dist/ is committed — verified); inline `${{ }}` interpolation into bash; npm-install-per-run fragility |

## Top 5 Findings

### 1. `$default-branch` is a dead placeholder — push notifications never fire (workflow template)
`src/setup/workflow-template.ts:23` emits `push: branches: [$default-branch]`, and `src/setup.ts:241` writes this verbatim to `.github/workflows/discord-notify.yml`. The `$default-branch` macro is only substituted in **workflow templates** stored in an org's `.github/workflow-templates/` directory; in a regular workflow file Actions treats it as a literal branch name that will never match. Consumers who enable `pushEvents` get a silently dead trigger. The pre-filter (`src/pre-filter.ts:45-51`) would handle any branch correctly — the event simply never arrives. Fix: emit the actual default branch (the wizard runs in the repo; `git symbolic-ref refs/remotes/origin/HEAD` or `gh repo view`) or use `branches: ['**']` and rely on the pre-filter.

### 2. CI conclusion mapping reports failures as success (`src/handlers/ci.ts`)
`mapCiStatus` (`src/handlers/ci.ts:127-137`) handles `success | failure | cancelled` and then `default: return 'success'`. The real `workflow_run.conclusion` domain is `success, failure, neutral, cancelled, skipped, timed_out, action_required, stale, startup_failure` — the type at `src/handlers/ci.ts:22` omits four of them. Consequences: a run that **timed out** (`timed_out`), a workflow file that failed to parse (`startup_failure`), or a run blocked on approval (`action_required`) all render as ✅ success in the embed and thread. For a "production dependency" notification bot, green-washing red CI is the worst failure mode. `timed_out`/`startup_failure` → failure; `action_required` → pending/attention; `stale` → cancelled.

### 3. Fork PRs: workflow fails red, and CI status is structurally untrackable
Two layers:
- The generated template (`src/setup/workflow-template.ts:85-106`) has **no fork guard**. `pull_request` from a fork runs without secrets, so `discord_bot_token` is empty and the validate step (`action.yml:52-55`) exits 1 — every fork PR gets a red X in the consumer repo. repo-relay's own workflow has the guard (`.github/workflows/repo-relay.yml:22-27`: `github.event.pull_request.head.repo.full_name == github.repository || ...`) but the template that ships to consumers doesn't. (Note `pull_request_target` is the standard alternative for notification bots — secrets available, read-only-content risk profile acceptable here.)
- `workflow_run.pull_requests` is **documented to be empty for runs triggered from forks** (and is generally a same-repo head-SHA match). Both the pre-filter (`src/pre-filter.ts:18-22`) and the template's job-level `if` (`src/setup/workflow-template.ts:99`) skip on empty array, so even if the embed existed, fork-PR CI results can never attach. A `head_sha → GET /repos/{r}/pulls?head=` or commit-association lookup fallback would close this; today the limitation is silent and undocumented.

### 4. Piggyback review detection: no pagination and silent non-2xx (`src/github/reviews.ts`)
- `reviews.ts:77` and `:100` fetch one page with `per_page=100` and no `Link`-header follow. Issue comments are returned **ascending by `created_at`**, so on a PR with >100 comments (routine with bot-heavy repos — exactly the chroxy use case) the *latest* agent-review comment is precisely the one cut off. The code then sorts the first page descending (`reviews.ts:108-109`) and may resurrect a stale verdict or find nothing. Detection degrades silently as PRs get busier.
- `reviews.ts:80` / `:103`: `if (res.ok) { ... }` with **no else branch** — a 401 (token expired), 403 (rate limit / secondary rate limit), or 404 produces zero log output; the `catch` only fires on network errors. Compare `src/github/ci.ts:44-47`, which logs `HTTP ${status}` — reviews.ts should do the same, plus honor `Retry-After`/`x-ratelimit-remaining` given the 5-minute polling loop multiplies call volume (2 calls × N open PRs × 12/hr against the 1,000 req/hr GITHUB_TOKEN budget).

### 5. Generated permissions block omits `actions: read` — CI failure details always 403
`src/setup/workflow-template.ts:76-83` emits an explicit `permissions:` block (`pull-requests: read`, optionally `issues: read`, `security-events: read`, `contents: read`). An explicit block sets **all unlisted scopes to `none`**. But `fetchFailedSteps` calls `GET /repos/{repo}/actions/runs/{id}/jobs` (`src/github/ci.ts:35`), which requires **Actions: read**. So in every wizard-generated consumer workflow, the failed-step enrichment on CI failure (`src/handlers/ci.ts:66-68`) gets a 403 and silently returns `[]` — the feature is dead on arrival for consumers, working only in repos (like this one) without an explicit permissions block. Add `actions: read` to `permissionLines`.

## Additional Findings

- **`handlePrOpened` is not idempotent** (`src/handlers/pr.ts:115-139`): unlike `handlePrClosed`/`handlePrPush`/`handlePrUpdated`, it never calls `getExistingPrMessage`. A workflow **re-run** of an `opened` event (Actions re-runs replay the identical payload), out-of-order delivery (`closed` processed before a queued `opened` — each event is an independent workflow run with no ordering guarantee), or `reopened` on an already-tracked PR all create a duplicate embed + thread and overwrite the DB mapping, orphaning the original thread. Every other path defends against this; `opened`/`reopened` should too.
- **Template `issues` trigger omits `reopened`** (`src/setup/workflow-template.ts:28`: `types: [opened, closed]`) while the handler (`src/handlers/issue.ts:83-87`), pre-filter (`src/pre-filter.ts:93`), and repo-relay's own workflow (`.github/workflows/repo-relay.yml:14`) all support it. Consumers never see issue reopens.
- **`issue_comment` subscription is gated behind `features.issues`** (`src/setup/workflow-template.ts:26-29`), but `issue_comment` is the delivery path for agent-review detection on **PRs** (`src/handlers/comment.ts:52`). A "minimal" (PRs-only) consumer loses event-driven agent-review detection entirely and depends solely on piggyback — which itself only fires on the next PR/CI event.
- **Schedule polling burns a gateway session even when there's nothing to do**: `cli.ts:93-95` connects to Discord before `handleEvent`, so a `*/5` cron (288 runs/day against Discord's ~1,000 session-starts/day budget — clearly already felt, given the session-limit retry machinery at `src/index.ts:103-152`) connects even when `getOpenPrNumbers` would return `[]` (`src/index.ts:448-452`). Opening `StateDb` before `connect()` for schedule events and exiting early would reclaim most of that budget on quiet repos. Also worth documenting: GitHub disables scheduled workflows after 60 days of repo inactivity, and `*/5` crons routinely slip 10–30 min at peak.
- **Pre-filter crash edge**: `src/pre-filter.ts:18-19` dereferences `payload.workflow_run.pull_requests.length` with no guard; a `workflow_dispatch`-style replay or malformed payload throws an unhandled TypeError → `process.exit(1)` red X rather than a clean skip.
- **`action.yml` interpolates inputs directly into bash** (`action.yml:52`, `:60`): `[ -z "${{ inputs.discord_bot_token }}" ]` is the classic script-injection antipattern; route inputs through `env:` instead. Also, `npm ci` on every event (`action.yml:47`) adds latency and an npm-registry availability dependency to every notification; consider bundling (the `dist/` is already committed — verified via `git ls-files`, 120 files).
- **Things done right** (credit where due): the `issue_comment` issues-vs-PRs discrimination is correct; the owner-comment cascade suppression matches real `pull_request_review` payload behavior (`src/handlers/review.ts:49-57`); draft transitions (`ready_for_review`, `converted_to_draft`) are handled; `nullable` payload fields (`pr.user` → ghost at `pr.ts:71`, `release.name`, `merged_by?`) match real schemas; tilde expansion for `STATE_DIR` (`src/db/state.ts:84-88`) and DB integrity check for cache-restore corruption (`state.ts:101-113`) show real operational learning; the Discord channel-search recovery (`src/discord/lookup.ts`) is a genuinely good mitigation for ephemeral-runner state loss.

## Recommendations (priority order)

1. Fix `mapCiStatus`: enumerate all nine conclusions; map `timed_out`/`startup_failure` → failure, `action_required` → pending, `stale` → cancelled (`src/handlers/ci.ts:123-143`).
2. Fix the template: replace `$default-branch` with the resolved branch name; add `actions: read`; add the fork/actor guard from `.github/workflows/repo-relay.yml:22-27`; add `reopened` to issues types; emit `issue_comment: [created]` unconditionally.
3. Add pagination (follow `Link: rel="next"`) and non-2xx logging with rate-limit header awareness to `src/github/reviews.ts`.
4. Make `handlePrOpened` check `getExistingPrMessage` first (idempotency under re-runs and reordering).
5. For schedule events, open `StateDb` and check `getOpenPrNumbers` **before** `connect()` to stop spending gateway sessions on no-op polls.
6. Add a `head_sha`-based PR lookup fallback for `workflow_run` events with empty `pull_requests`, or document fork-PR invisibility explicitly.

## Verdict

repo-relay's core event plumbing is genuinely better than typical for this category: the pre-filter mirrors handler semantics faithfully, payload typings match real GitHub schemas including nullable corners, and the stale-message/channel-search/session-limit resilience machinery reflects hard-won operational experience. But the audit lens of "production dependency" exposes a split: the code this repo runs for itself is solid (3.5–4), while the artifact it generates for consumers — the workflow template — ships four distinct correctness bugs ($default-branch dead trigger, missing `actions: read`, no fork guard, missing `reopened`), and two silent-failure modes (CI conclusions mislabeled as success, unpaginated/unlogged review detection) degrade exactly when repos get busy, which is when chroxy will lean on it. All findings are cheap to fix and none are architectural; with items 1–3 addressed this is a 4/5 system.
