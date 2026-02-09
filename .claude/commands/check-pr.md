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

### 5. Cross-Reference Fixes Against Open Issues

After pushing fixes, check if any open `from-review` issues were resolved by the work in this PR. Close them with a comment linking the PR — every closed issue MUST reference a PR for paper trail.

```bash
gh issue list --label "from-review" --json number,title,body
# For each resolved issue:
gh issue comment ${ISSUE_NUM} --body "Addressed in PR #${PR_NUM} — ${DESCRIPTION}."
gh issue close ${ISSUE_NUM}
```

### 6. Verify All Inline Replies Were Posted

**This step is MANDATORY. Do NOT skip it.**

```bash
# Count root comments (not replies) from reviewers
ROOT_COUNT=$(gh api repos/${REPO}/pulls/${PR_NUM}/comments \
  --jq '[.[] | select(.in_reply_to_id == null)] | length')

# Count unique root comments that have at least one reply
REPLIED_COUNT=$(gh api repos/${REPO}/pulls/${PR_NUM}/comments \
  --jq '[.[] | select(.in_reply_to_id != null) | .in_reply_to_id] | unique | length')

echo "Root comments: ${ROOT_COUNT}, Replied: ${REPLIED_COUNT}"
```

If `REPLIED_COUNT < ROOT_COUNT`, you have UNREPLIED comments. Go back to step 3 and post the missing inline replies BEFORE proceeding. **Do NOT post the summary comment until every thread has a reply.**

### 7. Post Summary Comment

After addressing ALL comments, post a summary on the PR. Every row MUST have a commit hash or issue URL in the Commit/Issue column -- no empty cells, no "N/A" for deferred items.

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
- Existing issues closed: A
EOF
)"
```

### 8. Report to User

Output:
- Total comments processed
- Fixes committed (with hashes)
- Items dismissed (with reasons)
- Follow-up issues created (with URLs)
- Existing issues closed (with URLs)
- PR ready for re-review: Yes/No

## Critical Rules

1. **EVERY comment gets an INLINE reply** -- No silent dismissals. The `gh api .../replies` call is the MOST IMPORTANT output. A summary comment WITHOUT inline replies is a FAILURE.
2. **Reply IMMEDIATELY after each comment** -- Process one comment at a time: read -> fix/defer -> post inline reply -> next. Do NOT batch replies.
3. **Verify before summarizing** -- Run the verification step (step 5) and confirm all threads have replies BEFORE posting the summary comment.
4. **Fix first, defer second** -- Default is to fix the issue
5. **Be specific** -- ALWAYS show before/after code diffs in fix replies
6. **Link commits** -- EVERY fix reply MUST include its commit hash
7. **ALWAYS create issues for deferred items** -- NEVER say "good idea" without a GitHub issue URL. If it's valid and you're not fixing it now, create the issue. No exceptions.
8. **No attribution** -- Follow Attribution Policy (sole author)
9. **No editing comments** -- Reply inline to comments, never edit them
10. **Idempotent** -- Skip comments that already have replies (check in_reply_to_id)

## Example Workflow

```
1. Copilot says: "Consider null check on line 45"
2. Evaluate: Valid concern? YES
3. Fix: Add null check
4. Commit: "fix: Add null safety check for channel parameter"
5. Reply: "Fixed in `abc1234` - Added early return for null channel"
6. Next comment...
```
