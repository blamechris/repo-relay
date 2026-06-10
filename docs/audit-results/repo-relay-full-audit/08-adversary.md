# Adversary's Audit: repo-relay Full Bug & Quality Audit

**Agent**: Adversary -- offensive-minded security reviewer (authorized defensive review for the maintainer)
**Overall Rating**: 3.2 / 5
**Date**: 2026-06-09

A defensive review of repo-relay through an attacker's lens: untrusted GitHub content → Discord, review-state spoofing, secrets, cache/state poisoning, and the supply-chain delivery model. I read the actual code paths and verified exploitability before rating.

## Subsystem Ratings (1–5)

| Subsystem | Rating | Notes |
|---|---|---|
| GitHub content → Discord embeds | 3 / 5 | Embeds don't ping (verified), but markdown masked links render in descriptions — phishing vector. Titles/thread names are safe (plain text, truncated). |
| Comment pattern matching (review state) | 2 / 5 | **No author gating.** Any commenter can spoof "Agent Review ✅ Approved". Strongest finding. |
| action.yml shell layer | 3.5 / 5 | `channel_prs` validated numeric; secret interpolated directly into a `run:` shell test (owner-controlled, so low exploitability but bad pattern). |
| DB / cache trust | 3.5 / 5 | SQL fully parameterized; integrity check on restore is good. Full event payloads persisted; poisoned cache re-renders stored content into embeds. |
| Token / secret handling | 4 / 5 | Tokens flow via env; `safeErrorMessage()` extracts only `.message`; no token logging found. |
| Dependency / supply chain | 3 / 5 | Lockfile + `undici` override pinned, but committed `dist/` executed by consumers behind a **mutable `v1` tag**. |

## Top 5 Findings (ranked by exploitability × impact)

### 1. Review-state spoofing — anyone who can comment can mark a PR "Agent Review: Approved" (HIGH)
`src/handlers/comment.ts:42-90` and `src/github/reviews.ts:99-127` match `AGENT_REVIEW_PATTERNS` / `APPROVED_PATTERNS` against comment bodies with **zero author check** — no `author_association`, no bot-identity gate, no allowlist.

- Attacker capability: any GitHub user who can comment on a PR in a consumer repo (i.e. anyone, on a public repo).
- Steps: post a single comment containing `**Verdict:** lgtm` (the `/\*\*Verdict:\*\*/i` detection pattern at `agent-review.ts:12` plus the `/lgtm/i` approval pattern at `:21`).
- Outcome: the bot sets `agent_review_status = 'approved'` (`comment.ts:90`), edits the team's Discord embed to show "Agent Review: ✅ Approved", and posts "🔍 Agent review: ✅ Approved" into the PR thread. Maintainers watching Discord may merge believing an automated reviewer signed off. The piggyback path (`reviews.ts:107-118`) does the same on the next PR/CI event, and it picks the *most recent* matching comment, so an attacker's comment overrides a real review.
- Copilot impersonation is harder: `reviews.ts:82-84` requires `user.type === 'Bot'` AND login containing `copilot`, which a normal user can't forge — but the agent-review path has no such guard.
- Mitigation: gate detection on `comment.user.type === 'Bot'` and/or `author_association ∈ {OWNER, MEMBER, COLLABORATOR}`; or restrict to a configured set of reviewer logins. At minimum, render the review author's login in the embed so spoofs are visible.

### 2. Masked-link phishing via embed descriptions (MEDIUM)
Discord renders markdown — including masked links `[text](url)` — inside embed *descriptions* (not titles, not plain content). Untrusted bodies flow straight into `setDescription`:
- Issue body → `builders.ts:234-236` (via `truncateDescription`)
- Release notes → `builders.ts:291-293`
- Deployment description → `builders.ts:333-335`
- Commit message first lines → `buildPushEmbed` `builders.ts:352-367`

Attacker capability: open an issue (anyone on a public repo) with body `[Verify your Discord account](https://evil.example)`. Outcome: a clickable, disguised phishing link appears in the team's notification channel, lent credibility by the bot. `truncateDescription` only length-limits; no markdown/link sanitization.
- Note for the maintainer: I verified mention injection (`@everyone`, `<@&role>`) is **not** exploitable here — embeds never ping, and the only untrusted values reaching plain-text `thread.send()` are GitHub logins/SHAs, which can't form mention syntax, and the bot doesn't request Mention Everyone (`index.ts:70-77`). So the embed risk is phishing links, not pings.
- Mitigation: escape `[`/`]` (or strip `](`) in description text before `setDescription`, or set `EmbedBuilder` description from a sanitized version.

### 3. Mutable `v1` tag + committed `dist/` (MEDIUM, supply-chain)
Consumers pin `uses: blamechris/repo-relay@v1`; `CLAUDE.md` and the deploy model force-move `v1` to `main` on every change. `dist/` is committed (`.gitignore:6-7`, `git ls-files dist/` confirms ~tracked JS) and executed as `node dist/cli.js` (`action.yml:78`) in consumer CI with `DISCORD_BOT_TOKEN` + `GITHUB_TOKEN` in env.
- Risk: a moved tag (compromised maintainer account, or a malicious commit reaching `main`) silently ships new code to every consumer's CI, where it has repo-token and a Discord bot token in scope. There's no integrity pin for consumers.
- Also: `dist/` being hand-committed means the running code isn't guaranteed to match `src/` — reviewers audit `src/`, consumers run `dist/`.
- Mitigation: recommend consumers pin to a commit SHA; publish immutable `v1.x.y` tags alongside `v1`; build `dist/` in CI and verify it matches committed output (or generate it at release time).

### 4. Secret interpolated into action.yml shell step (LOW–MEDIUM)
`action.yml:52` runs `if [ -z "${{ inputs.discord_bot_token }}" ]; then` — the token value is template-expanded directly into the bash script rather than passed via env and referenced as `"$VAR"`. `channel_prs` is similarly interpolated and echoed at `:61`. Because these inputs are owner-set secrets/inputs (not attacker-controlled PR content), exploitability is low, but it's the classic Actions script-injection anti-pattern: a value containing shell metacharacters would execute. The token is never echoed (good), but it does appear on a process command line.
- Mitigation: move both inputs into an `env:` block and reference `"$DISCORD_BOT_TOKEN"` / `"$CHANNEL_PRS"` inside the `run:` script, matching how the "Run repo-relay" step already does it (`:69-77`).

### 5. Full event payloads persisted in cache-restored DB (LOW–MEDIUM)
`db.logEvent(...)` stores entire GitHub event payloads as JSON in `event_log` (`state.ts:522-533`), called from every handler. The README recommends persisting `~/.repo-relay` via `actions/cache@v4`.
- Exposure: private-repo issue/PR/commit content is written to a cache artifact at rest. I confirmed secrets don't leak here — `GITHUB_TOKEN` lives in env, not payloads, and `secret_scanning_alert` webhooks don't include raw secrets (the embed uses only `secret_type_display_name`, `builders.ts:432-449`).
- State-poisoning angle: if a cache is poisoned (possible in some fork-PR cache configurations), restored `pr_data` is re-rendered into embeds (no ping, but attacker-chosen text/links), and `pr_messages` rows drive `channel.messages.fetch(messageId)` — message edits are still confined to the configured channel ID (from env, not DB), which limits blast radius. The integrity check (`state.ts:104-119`) catches corruption but not semantically valid poisoning.
- Mitigation: don't store full payloads (store only the fields needed for debugging), and/or document that cache persistence widens data-at-rest exposure for private repos.

## What's solid
- All SQL uses parameterized statements (`state.ts` throughout); `getRecentEvents` builds the query string but binds values — safe.
- `safeErrorMessage()` consistently strips error objects to `.message` in catch/log paths.
- `REPO_NAME_PATTERN` validates `owner/repo` before DB/path use (`index.ts:495`); `repo.replace('/', '-')` plus the pattern prevents path traversal in the state dir.
- DB integrity check on cache restore with safe recreation.
- The agent-review regexes are **not** ReDoS-prone — single unbounded `.*`, no nested quantifiers, linear backtracking even against max-size (~65 KB) comment bodies.
- Pre-filter (`pre-filter.ts`) discards non-actionable events before connecting to Discord, shrinking the live attack surface.

## Verdict
repo-relay is competently built on the fundamentals that usually sink integration bots — parameterized SQL, sanitized error logging, input validation, no token leakage, and (importantly) it does *not* fall to the embed-mention-ping trap because Discord embeds don't ping and the only plain-text untrusted values are non-forgeable logins. The real weaknesses are trust-boundary omissions, not memory-safety or injection-of-secrets bugs. The headline issue is that review state is unauthenticated: any commenter can forge an "Agent Review: Approved" signal into a channel maintainers use to gauge merge-readiness — a meaningful problem for a tool about to feed the chroxy ecosystem's merge decisions. Combined with masked-link phishing through embed descriptions and a mutable-tag delivery model that runs committed `dist/` in consumers' CI with live secrets, this lands at "adequate with real gaps." Fixing finding #1 (author gating) and #2 (description link escaping), then hardening the supply-chain pinning, would move it toward 4/5.
