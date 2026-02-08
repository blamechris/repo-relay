# /check-pr

Address all PR review comments systematically and respond inline.

## Arguments

- `$ARGUMENTS` - PR number (optional, defaults to current branch's PR)

## Instructions

### 0. Fetch PR Info and Wait for CI/Copilot

```bash
# Get PR number for current branch (or use provided arg)
PR_NUM=${1:-$(gh pr view --json number -q .number)}

# Get repo info
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

**IMPORTANT:** Before processing comments, wait for CI to pass and Copilot review to complete (or timeout after 5 minutes). See `.claude/skills/check-pr/skill.md` section 0 for the full three-state Copilot detection and polling loop.

```bash
# Wait for CI to pass
gh pr checks ${PR_NUM} --watch

# Then check Copilot review status (COMPLETED / IN PROGRESS / NOT REQUESTED)
# If IN PROGRESS, poll every 30s up to 5 minutes
```

### 1. Fetch Review Comments

```bash
# Fetch all review comments
gh api repos/${REPO}/pulls/${PR_NUM}/comments
gh api repos/${REPO}/pulls/${PR_NUM}/reviews
```

### 2. Skip Already-Replied Comments

Before processing, filter out comments that already have a reply from this bot/agent. This ensures re-running `/check-pr` on the same PR is idempotent and doesn't double-reply.

```bash
# Determine the current authenticated user (this bot/agent)
BOT_LOGIN=$(gh api user --jq .login)

# Fetch all replies from this user and build a set of already-addressed comment IDs
REPLIES=$(gh api repos/${REPO}/pulls/${PR_NUM}/comments --paginate \
  --jq "[.[] | select(.in_reply_to_id and .user.login==\"${BOT_LOGIN}\") | .in_reply_to_id]")

# When building worklist, only consider TOP-LEVEL comments (in_reply_to_id == null)
# For each top-level comment, skip if its ID appears in the REPLIES list
# Only process comments where in_reply_to_id is null AND COMMENT_ID is NOT in REPLIES
```

### 3. Process EVERY Unaddressed Comment

For each review comment (Copilot or human) not already replied to, you MUST:

1. Read the comment carefully
2. Evaluate if it's actionable
3. Take action AND post a reply

**ONLY THREE valid outcomes per comment — no exceptions:**

| Outcome | Requirements | No comment may be... |
|---------|-------------|---------------------|
| **FIX** | Commit hash + before/after code diff — both mandatory | ...acknowledged without a fix |
| **FALSE POSITIVE** | Evidence required (docs, code refs, reasoning) | ...dismissed without evidence |
| **FOLLOW-UP ISSUE** | `gh issue create` — issue URL mandatory | ...deferred without a tracked issue |

There is NO "acknowledge and move on" option. Every comment results in a commit, evidence, or an issue.

#### If Valid Issue → FIX IMMEDIATELY

1. Make the code fix
2. Commit with descriptive message
3. Reply inline on the PR comment:

```bash
gh api repos/${REPO}/pulls/${PR_NUM}/comments/${COMMENT_ID}/replies \
  --method POST \
  -f body="Fixed in \`${COMMIT_SHA}\`

**Change:** Brief description of fix

\`\`\`typescript
// Before
old_code_snippet

// After
new_code_snippet
\`\`\`"
```

#### If False Positive → EXPLAIN WHY

Only use this if the suggestion is incorrect. Reply inline:

```bash
gh api repos/${REPO}/pulls/${PR_NUM}/comments/${COMMENT_ID}/replies \
  --method POST \
  -f body="**Not an issue**

**Reason:** Clear explanation of why this is correct

**Evidence:**
- Reference to docs/pattern used
- Link to similar code in codebase"
```

#### If Valid But Out of Scope → CREATE FOLLOW-UP ISSUE

When a suggestion is valid but would expand scope, create a tracked issue:

```bash
# 1. Create the issue with REQUIRED labels
ISSUE_URL=$(gh issue create \
  --title "Short descriptive title" \
  --label "enhancement" \
  --label "from-review" \
  --label "complexity:low" \
  --label "testing:low" \
  --body "$(cat <<'EOF'
## Context

This was identified during review of PR #${PR_NUM}.

## Description

What needs to be done and why.

## Original Comment

> Quote the review comment here

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
EOF
)")

# 2. Reply inline referencing the issue
gh api repos/${REPO}/pulls/${PR_NUM}/comments/${COMMENT_ID}/replies \
  --method POST \
  -f body="**Acknowledged - tracked for follow-up**

Valid suggestion. Created ${ISSUE_URL} to track this work.

**Reason for deferral:** Brief explanation why not in this PR"
```

**Required labels for follow-up issues:**
- `from-review` - Always add this to identify issues from PR reviews
- Type label: `enhancement`, `bug`, `test`, `docs`, etc.
- `complexity:[low|medium|high]` - **REQUIRED** (see guidelines below)
- `testing:[low|medium|high]` - **REQUIRED** (see guidelines below)
- Optional: `tech-debt`, `low-priority`, `good-first-issue`

**Label Guidelines:**

| Complexity | Criteria |
|------------|----------|
| `low` | Single file, clear implementation, < 1 day |
| `medium` | Multiple files, moderate decisions, 1-3 days |
| `high` | Architectural changes, new systems, > 3 days |

| Testing | Criteria |
|---------|----------|
| `low` | Pure logic, unit testable, no external dependencies |
| `medium` | Requires Discord bot setup, moderate verification |
| `high` | Full GitHub Actions integration testing needed |

### 4. Push All Fixes

```bash
git push
```

### 5. Post Summary Comment

After addressing all comments, post a summary on the PR using heredoc:

```bash
gh pr comment ${PR_NUM} --body "$(cat <<'EOF'
## Review Comments Addressed

| Comment | Action | Commit/Issue |
|---------|--------|--------------|
| Comment 1 summary | Fixed | `abc123` |
| Comment 2 summary | False positive | Evidence provided |
| Comment 3 summary | Follow-up | #456 |

**Total:** X comments addressed
- Fixed: Y
- False positives: Z
- Follow-up issues: W
EOF
)"
```

### 6. Report to User

Output:
- Total comments processed
- Fixes committed (with hashes)
- Items dismissed (with reasons)
- Follow-up issues created (with URLs)
- PR ready for re-review: Yes/No

## Critical Rules

1. **EVERY comment gets a reply** - No silent dismissals
2. **Fix first, defer second** - Default is to fix the issue
3. **Be specific** - Show before/after code in replies
4. **Link commits** - Every fix references its commit hash
5. **No attribution** - Follow Attribution Policy (sole author)

## Example Workflow

```
1. Copilot says: "Consider null check on line 45"
2. Evaluate: Valid concern? YES
3. Fix: Add null check
4. Commit: "fix: Add null safety check for channel parameter"
5. Reply: "Fixed in `abc1234` - Added early return for null channel"
6. Next comment...
```
