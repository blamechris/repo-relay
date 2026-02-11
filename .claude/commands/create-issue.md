# /create-issue

Create a standardized GitHub issue with labels and traceability.

## Arguments

- `$ARGUMENTS` - Issue title (required). Optionally followed by flags:
  - `--from-pr N` — Link to source PR
  - `--comment-url URL` — Link to specific review comment
  - `--complexity low|medium|high` — Set complexity label
  - `--testing low|medium|high` — Set testing label
  - `--label NAME` — Additional label (repeatable)

## Instructions

### 1. Parse Arguments and Gather Context

Extract the title and any flags from `$ARGUMENTS`. Determine context:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# Check if we're on a PR branch (auto-detect source PR)
CURRENT_PR=$(gh pr view --json number -q .number 2>/dev/null || echo "")
```

If `--from-pr` was not specified but we're on a PR branch, use the current PR as the source.

### 2. Check for Duplicates

Before creating, scan for existing issues with similar titles:

```bash
# Search open issues for potential duplicates
gh issue list --state open --search "${ISSUE_TITLE}" --json number,title --limit 5
```

If a close match exists, show it to the user and ask whether to proceed or reference the existing issue instead.

### 3. Build Issue Body

Construct the issue body based on available context.

#### From-Review Issue (has source PR or comment URL)

```markdown
## Context

Identified during review of PR #${SOURCE_PR}.

**Review comment:** ${COMMENT_URL}

**Location:** `${FILE_PATH}:${LINE_NUMBER}`

## Description

What needs to be done and why. Be specific — another developer should be able to pick this up without reading the original review thread.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
```

#### Standalone Issue (no review context)

```markdown
## Description

What needs to be done and why.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
```

### 4. Determine Labels

Build the label set. **Every issue MUST have `complexity:` and `testing:` labels.**

```bash
LABELS="enhancement"

# Always add from-review if this came from a PR review
if [ -n "$SOURCE_PR" ] || [ -n "$COMMENT_URL" ]; then
  LABELS="$LABELS,from-review"
fi

# Add complexity label (REQUIRED — prompt user if not specified)
if [ -n "$COMPLEXITY" ]; then
  LABELS="$LABELS,complexity:$COMPLEXITY"
fi

# Add testing label (REQUIRED — prompt user if not specified)
if [ -n "$TESTING" ]; then
  LABELS="$LABELS,testing:$TESTING"
fi

# Add any extra --label flags
for extra in "${EXTRA_LABELS[@]}"; do
  LABELS="$LABELS,$extra"
done
```

If `--complexity` or `--testing` are not provided, infer reasonable defaults from the issue description:

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

**Verify labels exist** before using them:

```bash
gh label list --json name -q '.[].name' | grep -q "^from-review$" || echo "Warning: 'from-review' label not found"
```

### 5. Create the Issue

```bash
ISSUE_URL=$(gh issue create \
  --title "${ISSUE_TITLE}" \
  --label "${LABELS}" \
  --body "$(cat <<'EOF'
${ISSUE_BODY}
EOF
)")
```

### 6. Extract Issue Number

```bash
ISSUE_NUM=$(echo "$ISSUE_URL" | grep -oE '[0-9]+$')
```

### 7. Report to User

Output a **summary table** — this is the PRIMARY output:

```markdown
| Issue | Title | Labels | Source |
|-------|-------|--------|--------|
| #${ISSUE_NUM} | ${ISSUE_TITLE} | from-review, complexity:low, testing:low | PR #${SOURCE_PR} |
```

Then below the table:
- Issue URL (clickable)
- Labels applied
- Source PR link (if applicable)
- Review comment link (if applicable)

## Critical Rules

1. **No attribution** — Follow Attribution Policy (sole author).
2. **Check for duplicates** — Always search before creating. Don't create duplicate issues.
3. **Labels must exist** — Verify labels exist in the repo. Skip missing labels gracefully.
4. **REQUIRED labels** — Every issue MUST have `complexity:` and `testing:` labels. Infer if not specified.
5. **Be specific** — The issue description must be self-contained. Another developer should understand it without reading the review thread.
6. **Always include acceptance criteria** — Even if just one checkbox. Issues without criteria are hard to close confidently.
7. **Link to source** — If from a review, always include the PR number and comment URL in the body.
