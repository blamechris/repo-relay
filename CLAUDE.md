# CLAUDE.md - repo-relay

## Project Overview

**repo-relay** is a standalone GitHub-Discord integration bot that posts notifications for PRs, CI, issues, and releases to Discord with threaded updates.

- **Tech Stack**: Node.js 20+, TypeScript (ES2022), discord.js 14.x, better-sqlite3
- **License**: MIT
- **Author**: Christopher Pishaki <ChrisPishaki@gmail.com>

## Critical: Attribution Policy

**I am the sole author of all work in this repository.**

- NEVER include `Co-Authored-By` lines in commits
- NEVER add "Generated with Claude" or similar AI attribution
- NEVER mention AI assistance in commit messages, PR descriptions, or code comments
- Commit messages should be clean and professional

## Session Start Protocol

**When starting a new session or resuming work:**

```bash
# 1. Check current state
git status && git log --oneline -5

# 2. Review any open PRs
gh pr list

# 3. Check open issues
gh issue list

# 4. If on a feature branch, check CI status
gh run list --limit 3
```

## Git Workflow

### Branch Protection
- `main` branch is protected - all changes require PRs
- Squash merge to main

### Branch Naming
```
feat/feature-name         # New features
feat/feature-name-#123    # New features (with issue reference)
fix/bug-description       # Bug fixes
fix/bug-name-#456         # Bug fixes (with issue reference)
docs/topic                # Documentation
chore/task                # Maintenance, deps, config
```

**Note:** Issue number suffix (`-#123`) is optional but recommended for work tracked via GitHub Issues.

### Commit Format
```
type(scope): description

Examples:
feat(pr): Add draft PR support
fix(ci): Handle cancelled workflow status
chore: Update discord.js to 14.17
docs: Improve README setup instructions
```

**Types:** feat, fix, refactor, docs, chore, style, perf

## GitHub Issues Workflow

**Major work should be tracked via GitHub Issues.** Issues serve as:
- Design documentation before implementation
- Living record of intent and decisions
- Post-implementation drift analysis
- Historical reference for future changes

### Issue-First Development Process

```
1. CREATE ISSUE    -> Document design/plan/intent before coding
2. CREATE BRANCH   -> Reference issue number (e.g., feat/webhook-retry-#123)
3. IMPLEMENT       -> Commit referencing issue
4. REVIEW          -> Compare implementation against issue intent
5. UPDATE ISSUE    -> Document any drift, decisions, or learnings
6. CLOSE           -> Issue becomes permanent record
```

### When to Create Issues

| Work Type | Create Issue? |
|-----------|---------------|
| New features (handlers, embeds, etc.) | Yes - with design notes |
| Multi-PR initiatives | Yes - as umbrella issue |
| Bug fixes | Yes - with reproduction steps |
| Tech debt items | Yes - for tracking and prioritization |
| Small enhancements | Optional - PR description may suffice |
| Refactoring | Yes if architectural, No if cosmetic |

### Required Labels for ALL Issues

Every GitHub issue MUST include these labels for prioritization:

| Label | Values | When to Use |
|-------|--------|-------------|
| `complexity:` | `low`, `medium`, `high` | Estimate implementation effort |
| `testing:` | `low`, `medium`, `high` | Estimate testing effort needed |

**Complexity Guidelines:**

| Level | Criteria |
|-------|----------|
| `low` | Single file, clear implementation, < 1 day |
| `medium` | Multiple files, moderate decisions, 1-3 days |
| `high` | Architectural changes, new systems, > 3 days |

**Testing Guidelines:**

| Level | Criteria |
|-------|----------|
| `low` | Pure logic, unit testable, no external dependencies |
| `medium` | Requires Discord bot setup, moderate verification |
| `high` | Full GitHub Actions integration testing needed |

### Issue Template for Features

```markdown
## Summary
One-line description of the feature.

## Motivation
Why this change? What problem does it solve?

## Design
- Key decisions and trade-offs
- Architecture overview
- Integration points with existing handlers/systems

## Implementation Plan
- [ ] Phase 1: ...
- [ ] Phase 2: ...

## Open Questions
- Question 1?
- Question 2?

## Success Criteria
- Criterion 1
- Criterion 2
```

### Referencing Issues

- **Branch names:** `feat/feature-name-#123`
- **Commit messages:** `feat(scope): Add feature (#123)`
- **PR titles:** `feat(scope): Add feature (#123)`
- **Closes syntax:** Use `Closes #123` in PR body to auto-close
- **Refs syntax:** Use `Refs #123` for partial progress (doesn't auto-close)

### Post-Implementation Review

After merging, update the issue with:
- Implementation drift (what changed from the plan)
- Lessons learned
- Follow-up issues if needed

## PR Workflow

1. Create GitHub Issue (for major work - see "When to Create Issues" above)
2. Create feature branch from `main` (include issue number if exists, e.g., `feat/name-#123`)
3. Develop and commit (reference issue in commits)
4. Push and create PR (reference issue in body: `Closes #123`)
5. CI must pass before merge
6. Squash merge to main
7. Update issue with any drift or learnings (if issue exists)

**NEVER commit directly to main.** Always use feature branches and PRs.

## Project Structure

```
src/
├── cli.ts              # CLI entry point for GitHub Actions
├── index.ts            # Main RepoRelay class and exports
├── config/
│   └── channels.ts     # Channel configuration and routing
├── db/
│   └── state.ts        # SQLite state management (StateDb class)
├── embeds/
│   └── builders.ts     # Discord embed builders (PR, issue, release)
├── github/
│   └── reviews.ts      # GitHub API helpers for piggyback review detection
├── handlers/
│   ├── index.ts        # Handler exports
│   ├── pr.ts           # Pull request events (opened, closed, synchronize, etc.)
│   ├── ci.ts           # Workflow run events
│   ├── review.ts       # PR review events
│   ├── comment.ts      # Issue comment events (including agent-review detection)
│   ├── issue.ts        # Issue events
│   └── release.ts      # Release events
├── patterns/
│   └── agent-review.ts # Shared agent-review detection patterns
└── commands/           # Discord slash commands (not primary focus)
```

## Key Technical Details

### Message Flow
1. PR opened -> Create embed with thread attached
2. Updates (pushes, CI, reviews, merge) -> Post to PR's thread
3. Embed updated to reflect current status (CI, reviews)

### Piggyback Review Detection
GitHub Apps using `GITHUB_TOKEN` don't trigger `pull_request_review` workflow events. To work around this:

- On any PR event (push, CI completion), check GitHub API for reviews
- Detect Copilot reviews via `/pulls/{pr}/reviews` endpoint
- Detect agent-review comments via `/issues/{pr}/comments` with pattern matching
- Reviews are detected on the **next** event, not immediately

Key file: `src/github/reviews.ts`

### State Storage
- Location: `~/.repo-relay/{repo-name}/state.db`
- SQLite with WAL mode for concurrent access
- Tables:
  - `pr_messages` - PR number to Discord message/thread mapping
  - `pr_status` - Copilot, agent-review, CI status per PR
  - `pr_data` - Cached PR metadata for embed rebuilding
  - `event_log` - Event history for debugging

### Stale Message Handling
If a Discord message is deleted:
1. Bot tries to fetch message -> gets "Unknown Message" error
2. DB entry is cleared
3. New embed/thread is created

Pattern used throughout handlers - check `src/handlers/pr.ts` for implementation.

### Thread Architecture
- Each PR gets one embed message with an attached thread
- All updates go to the thread (not replies to the embed)
- Threads auto-archive after 24 hours, unarchived when new updates arrive

## Development Commands

```bash
npm install       # Install dependencies
npm run build     # Compile TypeScript to dist/
npm run dev       # Run with tsx (for local testing)
npm run typecheck # Type check without emitting
npm run lint      # Run ESLint
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `DISCORD_CHANNEL_PRS` | Yes | Channel ID for PR notifications |
| `DISCORD_CHANNEL_ISSUES` | No | Channel ID for issues (defaults to PRS channel) |
| `DISCORD_CHANNEL_RELEASES` | No | Channel ID for releases (defaults to PRS channel) |
| `GITHUB_TOKEN` | Yes | For GitHub API access (review detection) |
| `STATE_DIR` | No | Custom state directory (default: `~/.repo-relay`) |

## Code Patterns

### Adding a New Handler
1. Create `src/handlers/{event}.ts` with handler function
2. Export from `src/handlers/index.ts`
3. Add case to `handleEvent()` in `src/index.ts`
4. Add event mapping in `src/cli.ts` `mapGitHubEvent()`

### Updating Embeds
Use `buildEmbedWithStatus()` to rebuild embed with current DB status:
```typescript
const statusData = buildEmbedWithStatus(db, repo, prNumber);
if (statusData) {
  const embed = buildPrEmbed(statusData.prData, statusData.ci, statusData.reviews);
  await message.edit({ embeds: [embed] });
}
```

### Thread Operations
Use `getOrCreateThread()` helper to safely get/create threads:
```typescript
const thread = await getOrCreateThread(channel, db, repo, pr, existing);
await thread.send('Update message');
```

## Agent-Review Detection Patterns

The bot detects agent-review comments by matching these patterns in comment bodies:
- `## Code Review Summary`
- `### Agent Review`
- `## 🔍 Code Review`
- `**Verdict:**`
- `## Review Result`

Status is determined by:
- Approved: `verdict.*approved`, `✅.*approved`, `lgtm`, `looks good to me`, `[x].*approve`
- Changes requested: `changes.*requested`, `⚠️.*changes`, `needs.*changes`, `[x].*request changes`

Patterns are defined in `src/patterns/agent-review.ts` and shared by both detection paths.

## Known Limitations

### Review Detection Delay (Piggyback Approach)

**Current behavior:** Reviews from Copilot and agent-review are not detected immediately. They are only discovered when the next PR event fires (push, CI completion, etc.).

**Why:** GitHub Apps using `GITHUB_TOKEN` don't trigger `pull_request_review` workflow events. The bot works around this by checking the GitHub API for reviews whenever other events occur.

**Impact:**
- Review status in embeds may be stale until the next event
- Thread updates for reviews are delayed
- If no further events occur on a PR, reviews may never be reflected

**Future improvement:** See [#4](https://github.com/blamechris/repo-relay/issues/4) for investigating active polling or webhook-based solutions to eliminate this delay.

### Self-Hosted Runners Recommended

GitHub-hosted runners don't persist state between workflow runs. The SQLite database at `~/.repo-relay/{repo}/state.db` is lost after each run unless you add artifact upload/download steps.

**Recommendation:** Use self-hosted runners for persistent state, or implement artifact-based state persistence for GitHub-hosted runners.

## Onboarding Learnings

Lessons learned from integrating repo-relay into exodus-loop and archery-apprentice.

### Common Issues

1. **"Missing Access" error** - Bot connects but can't post. Usually missing Discord permissions at channel level. See [#12](https://github.com/blamechris/repo-relay/issues/12).

2. **Review reply cascade** - Owner replies to Copilot comments trigger more notifications. Requires workflow `if` filter. See [#13](https://github.com/blamechris/repo-relay/issues/13).

3. **First-run failure** - Expected if secrets aren't configured. Users should configure secrets, then re-run.

4. **Self-hosted queue blocking** - Discord job waits behind long CI jobs. Consider `ubuntu-latest` or separate runner labels.

### Tag Management

When making changes, update the `v1` tag so consumers get the latest:

```bash
git tag -d v1
git tag v1 main
git push origin :refs/tags/v1
git push origin v1
```

Consumers reference `uses: blamechris/repo-relay@v1` which resolves to this tag.

### Key Files for Debugging

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point, RepoRelay class, event routing |
| `src/github/reviews.ts` | Piggyback review detection |
| `src/handlers/pr.ts` | PR event handling, embed building |
| `src/embeds/builders.ts` | Discord embed construction |
| `src/db/state.ts` | SQLite state management |
| `action.yml` | GitHub Action composite definition |
