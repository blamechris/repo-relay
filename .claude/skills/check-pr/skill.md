# Check PR Skill

## Purpose
Check a pull request for review comments (especially from Copilot), address any issues found, and reply INLINE with either the commit hash that fixes the issue or an explanation of why it's erroneous.

## When to Use
- When user asks to check a PR for review comments
- After creating a PR to validate code quality
- When Copilot or other reviewers have left comments
- As part of PR finalization workflow

## How It Works

### 0. Wait for CI and Copilot Review
**IMPORTANT:** CI must pass, and Copilot review should either complete or time out (after up to 5 minutes), in which case you must manually check the PR before merging.

```bash
# Step 1: Wait for CI to pass (quick, usually < 1 minute)
gh pr checks {pr_number} --watch

# Step 2: Wait for Copilot review to complete (poll every 30 seconds, up to 5 minutes)
# See polling loop below
```

**Copilot Three-State Detection:**

| State | Detection | Action |
|-------|-----------|--------|
| **COMPLETED** | Reviews API returns `copilot-pull-request-reviewer[bot]` | Fetch & address comments |
| **IN PROGRESS** | Timeline shows review requested for Copilot, but no review yet | **WAIT** - Poll until complete or timeout |
| **NOT REQUESTED** | Neither API returns Copilot | Proceed (Copilot not configured for this PR) |

**Detection and Wait Logic:**
```bash
PR_NUM={pr_number}
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
MAX_WAIT=300  # 5 minutes
POLL_INTERVAL=30
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
    # Check if review completed (handle API errors explicitly)
    REVIEW_DONE=$(gh api repos/${REPO}/pulls/${PR_NUM}/reviews \
      --jq '.[] | select(.user.login | ascii_downcase | contains("copilot")) | .user.login')
    API_EXIT=$?

    if [ $API_EXIT -ne 0 ]; then
        echo "WARNING: API error checking reviews (exit $API_EXIT), retrying..."
        sleep $POLL_INTERVAL
        ELAPSED=$((ELAPSED + POLL_INTERVAL))
        continue
    fi

    if [ -n "$REVIEW_DONE" ]; then
        echo "Copilot: Review COMPLETED"
        break
    fi

    # Check if review was requested (use --paginate for long timelines)
    REVIEW_PENDING=$(gh api repos/${REPO}/issues/${PR_NUM}/timeline --paginate \
      --jq '.[] | select(.event == "review_requested" and (.requested_reviewer.login // "" | ascii_downcase | contains("copilot"))) | "pending"')
    API_EXIT=$?

    if [ $API_EXIT -ne 0 ]; then
        echo "WARNING: API error checking timeline (exit $API_EXIT), retrying..."
        sleep $POLL_INTERVAL
        ELAPSED=$((ELAPSED + POLL_INTERVAL))
        continue
    fi

    if [ -n "$REVIEW_PENDING" ]; then
        echo "Copilot: Review IN PROGRESS (${ELAPSED}s elapsed, waiting...)"
        sleep $POLL_INTERVAL
        ELAPSED=$((ELAPSED + POLL_INTERVAL))
    else
        echo "Copilot: NOT REQUESTED"
        break
    fi
done

# Final check in case review completed during the last wait interval
if [ $ELAPSED -ge $MAX_WAIT ]; then
    REVIEW_DONE=$(gh api repos/${REPO}/pulls/${PR_NUM}/reviews \
      --jq '.[] | select(.user.login | ascii_downcase | contains("copilot")) | .user.login' 2>/dev/null)

    if [ -n "$REVIEW_DONE" ]; then
        echo "Copilot: Review COMPLETED (at timeout boundary)"
    else
        echo "Copilot: TIMEOUT after ${MAX_WAIT}s - check PR manually before merging"
    fi
fi
```

**Copilot Check Logic:**
- If Copilot review **COMPLETED** → Proceed to fetch and address comments
- If Copilot review **IN PROGRESS** → **Wait and poll** every 30 seconds:
  > "Copilot review in progress... waiting (Xs elapsed)"
- If Copilot **NOT REQUESTED** → Proceed (Copilot not configured):
  > "Copilot was not requested for this PR."
- If **TIMEOUT** after 5 minutes → Proceed with warning:
  > "Copilot review timed out. Check PR manually before merging."

**Why we wait:** Merging before Copilot finishes can miss valuable feedback. The 5-minute timeout is generous - most reviews complete in 1-3 minutes.

### 1. Fetch PR Review Comments
Get all review comments from the PR, including those from Copilot:

```bash
# Get all review comments on a PR (MUST include .id for inline replies)
gh api repos/${REPO}/pulls/{pr_number}/comments \
  --jq '.[] | {id: .id, path: .path, line: .line, body: .body, user: .user.login}'
```

**IMPORTANT:** Always include `.id` in the query - this is required for inline replies.

### 2. Analyze Each Comment
For each comment:
1. **Read the comment carefully** - Understand the issue being raised
2. **Evaluate validity** - Is this a real issue or false positive?
3. **Decide action**:
   - **Fix it** if the comment is valid (DEFAULT STANCE)
   - **Explain why it's erroneous** if the comment is wrong

### 3. Fix Valid Issues
If the comment identifies a real problem:
1. Make the code change
2. Commit with descriptive message
3. Push to PR branch
4. Reply to comment with commit hash

### 4. Reply to Comments (INLINE - Not General PR Comments)
**CRITICAL:** Reply inline to each review comment using the GitHub API, NOT `gh pr comment`:

```bash
# Reply INLINE to a specific review comment (correct)
gh api repos/${REPO}/pulls/{pr_number}/comments/{comment_id}/replies \
  -F body="Fixed in \`{commit_hash}\`"

# WRONG - This posts to Conversation tab, not inline:
# gh pr comment {pr_number} --body "..."
```

**CRITICAL - Specific Inline Replies Required:**

⚠️ **DO NOT post the same generic reply to all comments.** Each comment must receive a **specific, detailed inline reply** explaining exactly what was changed for that particular issue.

**Template for fixed issues:**
```markdown
Fixed in `{commit_hash}`

**Change:** [Specific description of what was changed for THIS issue]

**Before:**
```typescript
[Relevant code/behavior before fix]
```

**After:**
```typescript
[Relevant code/behavior after fix]
```

**Why:** [Brief rationale if not obvious]
```

**Template for erroneous comments:**
```markdown
**Not an issue**

**Reason:** [Explanation of why THIS specific comment is incorrect]

**Evidence:**
- [Point 1 specific to this comment]
- [Point 2 specific to this comment]
```

**Template for intentional decisions:**
```markdown
**Intentional design decision**

**Rationale:** [Why this specific approach was chosen for THIS issue]

**Trade-offs considered:**
- Alternative A: [why not]
- Alternative B: [why not]
- Current approach: [why yes]
```

**Workflow for each comment:**
1. Read comment carefully to understand the specific issue
2. Make the fix (or determine it's erroneous)
3. Commit with clear message
4. **Reply inline with specific details about THIS comment's fix**
5. Resolve thread (via GitHub UI)
6. Move to next comment

**Why specific replies matter:** The user leverages inline replies for low-effort manual review. Generic replies like "Fixed all 9 issues in commit abc123" provide no value for understanding what was changed for each specific issue.

### 5. Resolve Comment Threads

After replying to each comment, resolve the thread so it doesn't block merges.

**Why this matters:** Branch protection may block merges with unresolved review comments. Resolving threads after addressing them ensures clean PR state.

**Resolution via GitHub Web UI (Simplest):**
```bash
# After posting inline reply, you can resolve manually:
# 1. Go to PR → Files Changed tab
# 2. Find your inline reply
# 3. Click "Resolve conversation" button
```

**Note on Automated Resolution:**

GitHub does **not** automatically resolve review threads based on keywords in replies (for example, including "Resolved:" in a comment does nothing by itself). With this workflow, you must resolve conversations manually via the GitHub UI.

Any future automation would need to call the GraphQL `resolveReviewThread` mutation explicitly.

## Commands

### Check for Copilot Review (Three-State Detection)
```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# Check if Copilot has submitted a review (COMPLETED)
gh api repos/${REPO}/pulls/{pr_number}/reviews \
  --jq '.[] | select(.user.login | ascii_downcase | contains("copilot")) | .user.login'

# If output is empty, check timeline for IN PROGRESS state
gh api repos/${REPO}/issues/{pr_number}/timeline \
  --jq '.[] | select(.event == "review_requested" and (.requested_reviewer.login // "" | ascii_downcase | contains("copilot"))) | "pending"'

# Three possible states:
# - COMPLETED: Reviews API returns copilot username
# - IN PROGRESS: Timeline shows review_requested for copilot, but no review yet
# - NOT REQUESTED: Neither API returns copilot-related data
```

### Fetch PR Comments
```bash
# Get review comments for PR #{pr_number} - ALWAYS include id!
gh api repos/${REPO}/pulls/{pr_number}/comments \
  --jq '.[] | {id: .id, path: .path, line: .line, body: .body, user: .user.login}'

# Alternative: Fetch reviews
gh api repos/${REPO}/pulls/{pr_number}/reviews
```

### Reply Inline to Review Comment
```bash
# CORRECT: Reply inline to a specific review comment
gh api repos/${REPO}/pulls/{pr_number}/comments/{comment_id}/replies \
  -F body="Fixed in \`{commit_hash}\`

{Description of fix}"

# WRONG: Do NOT use gh pr comment for review comments
# gh pr comment {pr_number} --body "..."  # This goes to Conversation tab
```

## Workflow

### Standard Check-PR Flow
```
1. User requests: "Check PR #{number} for review comments"

2. Wait for CI to pass:
   gh pr checks {pr_number} --watch

3. Wait for Copilot review (BLOCKING):
   - If COMPLETED → Proceed to fetch comments
   - If IN PROGRESS → Poll every 30s until complete (max 5 min)
   - If NOT REQUESTED → Proceed (Copilot not configured)
   - If TIMEOUT → Proceed with warning to check manually

4. Fetch all review comments:
   gh api repos/${REPO}/pulls/{pr_number}/comments

5. For each comment (PROCESS INDIVIDUALLY):
   a. Read and understand THIS SPECIFIC issue
   b. Evaluate if valid or erroneous
   c. If valid:
      - Make the fix for THIS specific issue
      - Commit with clear message
      - Push to PR branch
   d. If erroneous:
      - Document why THIS specific comment is not an issue
   e. Reply INLINE with SPECIFIC details about THIS comment:
      - Use the fix template with before/after code for THIS issue
      - Include specific rationale for THIS change
      - DO NOT post generic "fixed all X issues" replies
      - Each comment gets its own detailed reply
   f. Resolve the comment thread (via GitHub UI)
   g. Move to next comment

6. Verify all threads resolved:
   - Check PR → Files Changed tab
   - Ensure no unresolved conversations remain
   - This prevents merge blockers

7. Summary to user:
   - CI status: Passed
   - Copilot review: Completed / Not Requested / Timed Out
   - Total comments found: X
   - Fixed: Y comments
   - Explained as erroneous: Z comments
   - Commit hashes for all fixes
```

## Example Session

### User Request
```
User: "Check PR #13 for review comments"
```

### Agent Response Flow (With Copilot Review)
```
1. Wait for CI:
   gh pr checks 13 --watch
   -> All checks pass

2. Check for Copilot review (instant):
   -> Copilot review found!

3. Fetch comments:
   gh api repos/${REPO}/pulls/13/comments

4. Found 2 comments from Copilot:
   - Unnecessary serial await suggestion
   - Missing error handling recommendation

5. For each comment, evaluate: VALID - Fix it

6. Fix all issues:
   - Edit files with corrections
   - Commit: "refactor: Address Copilot review comments"
   - Push: git push

7. Reply INLINE to each comment:
   gh api repos/${REPO}/pulls/13/comments/{id}/replies \
     -F body="Fixed in \`c57a796\`"

8. Report to user:
   "Addressed 2 Copilot comments on PR #13:
   - CI: Passed
   - Copilot review: Received
   - Fixed: 2
   - Commit: c57a796
   - All inline replies posted
   - Ready to merge!"
```

### Agent Response Flow (With Copilot Wait)
```
1. Wait for CI:
   gh pr checks 13 --watch
   -> All checks pass

2. Wait for Copilot review:
   -> Copilot: IN PROGRESS (0s elapsed)
   -> Copilot: IN PROGRESS (30s elapsed)
   -> Copilot: IN PROGRESS (60s elapsed)
   -> Copilot: Review COMPLETED

3. Fetch comments:
   -> 0 comments from Copilot (approved without comments)

4. Report to user:
   "PR #13 check complete:
   - CI: Passed
   - Copilot review: Completed (no comments)
   - Ready to merge!"
```

### Agent Response Flow (Copilot Not Requested)
```
1. Wait for CI:
   gh pr checks 13 --watch
   -> All checks pass

2. Check for Copilot review:
   -> Copilot: NOT REQUESTED (not configured for this PR)

3. Fetch comments:
   -> 0 comments found

4. Report to user:
   "PR #13 check complete:
   - CI: Passed
   - Copilot: Not requested for this PR
   - Comments: 0
   - Ready for agent-review and merge"
```

## Reply Templates

### For Fixed Issues (Inline Reply)
```markdown
Fixed in `{commit_hash}`

**Change:** {Brief description of what was changed}

```typescript
// Before
{old_code}

// After
{new_code}
```
```

### For Erroneous Comments (Inline Reply)
```markdown
**Not an issue**

**Reason:** {Explanation of why the comment is incorrect}

**Evidence:**
- {Point 1}
- {Point 2}
```

### For Intentional Decisions (Inline Reply)
```markdown
**Intentional design decision**

**Rationale:** {Why this approach was chosen}

**Trade-offs considered:**
- Alternative A: why not
- Alternative B: why not
- Current approach: why yes
```

## Common Copilot Comments

### Nitpicks (Usually Valid - FIX THEM)
- Missing error handling
- Unhandled edge cases
- Unnecessary serial awaits
- Potential null/undefined issues
- Missing input validation

**Action:** Fix these - they improve code quality

### Style Preferences (Evaluate Case-by-Case)
- Variable naming
- Comment formatting
- Code organization

**Action:** Fix if it improves readability, explain if intentional

### False Positives (Explain)
- Comments about code that's actually correct
- Suggestions that would break functionality
- Recommendations that don't apply to this context

**Action:** Explain why the comment doesn't apply

## Quality Checklist

Before completing check-pr:

- [ ] CI passes (use `gh pr checks --watch`)
- [ ] **Waited for Copilot review** (COMPLETED, NOT REQUESTED, or TIMEOUT)
- [ ] Fetched all review comments from PR
- [ ] Evaluated each comment for validity
- [ ] Fixed all valid issues with clear commits
- [ ] Pushed all fixes to PR branch
- [ ] Verified CI passes after fixes (use `gh pr checks --watch`)
- [ ] **Replied INLINE to ALL comments with SPECIFIC details** (used templates, not generic replies)
- [ ] **Each reply includes before/after code and rationale for THAT specific issue**
- [ ] **NO generic "fixed all X issues" replies - each comment gets unique response**
- [ ] **Resolved all comment threads** (via GitHub UI)
- [ ] Provided summary to user with commit hashes

## Troubleshooting

### "No comments found but I can see them on GitHub"
**Possible causes:**
- Comments are on the Files Changed tab (review comments) vs Conversation tab (issue comments)
- Need to use `/pulls/{pr_number}/comments` endpoint (not `/issues/{pr_number}/comments`)

**Solution:**
```bash
# Use the pulls endpoint for review comments
gh api repos/${REPO}/pulls/{pr_number}/comments

# Use the issues endpoint for conversation comments
gh api repos/${REPO}/issues/{pr_number}/comments
```

### "Comment reply failed with 404"
**Cause:** Trying to reply to a review comment using wrong endpoint or invalid comment_id

**Solution:**
1. Ensure you're using the correct endpoint: `gh api repos/.../pulls/{pr}/comments/{id}/replies`
2. Verify comment_id is valid by fetching comments with `--jq '.[] | {id: .id, ...}'`
3. If still failing, the comment may have been deleted

### "Copilot hasn't reviewed yet"
**Cause:** Copilot reviews are asynchronous and may take 1-5 minutes

**Detection:**
Use the three-state detection to distinguish:
- **IN PROGRESS**: Timeline shows Copilot was requested but no review yet
  - The skill will automatically wait and poll until complete
- **NOT REQUESTED**: No trace of Copilot in timeline or reviews
  - Copilot may not be configured for this repo or PR type

**Solution:**
The skill now automatically waits up to 5 minutes for Copilot to complete:
1. Polls every 30 seconds while IN PROGRESS
2. Proceeds once COMPLETED
3. If timeout (5 min), warns to check PR manually before merging

### "Copilot review timed out"
**Cause:** Copilot took longer than 5 minutes (rare)

**Solution:**
1. Check the PR on GitHub manually before merging
2. If Copilot left comments after timeout, run `/check-pr` again
3. Consider increasing MAX_WAIT in the polling loop if this happens often

## Commands Reference

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# Wait for CI
gh pr checks {pr_number} --watch

# Check for Copilot review (three-state detection)
# State 1: COMPLETED - Copilot has submitted a review
gh api repos/${REPO}/pulls/{pr_number}/reviews \
  --jq '.[] | select(.user.login | ascii_downcase | contains("copilot")) | .user.login'

# State 2: IN PROGRESS - Review requested but not yet submitted
gh api repos/${REPO}/issues/{pr_number}/timeline \
  --jq '.[] | select(.event == "review_requested" and (.requested_reviewer.login // "" | ascii_downcase | contains("copilot"))) | "pending"'

# Fetch all review comments (ALWAYS include id for replies!)
gh api repos/${REPO}/pulls/{pr_number}/comments \
  --jq '.[] | {id: .id, path: .path, line: .line, body: .body, user: .user.login}'

# Reply INLINE to a review comment (correct approach)
gh api repos/${REPO}/pulls/{pr_number}/comments/{comment_id}/replies \
  -F body="Reply text here"

# Check latest commit hash
git log -1 --format="%h"

# Push fixes
git push
```

## Success Metrics

A successful check-pr execution:
- CI passes before reviewing
- **Copilot review completed** (or confirmed not requested, or timed out with warning)
- All review comments addressed (fixed or explained)
- All fixes committed with clear messages
- All comments have INLINE replies with commit hashes or explanations
- User has summary of what was done
- PR is ready to merge (all concerns addressed, Copilot feedback incorporated)

---

**Skill Version:** 1.0
**Created:** 2026-02-05
**Use Case:** Address Copilot review comments on PRs
**Related Skills:** agent-review

### Changelog
- **v1.0** (2026-02-05): Initial version for repo-relay. Adapted API endpoints, TypeScript code examples, and `testing:` label scheme for this project.
