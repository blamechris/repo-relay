# Repo Relay

GitHub-Discord integration bot that tracks PRs, CI, issues, and releases with threaded updates.

## Features

- **PR Notifications** - Creates a Discord embed per PR with a thread for updates
- **Threaded Updates** - All updates (pushes, CI, reviews, merge) go to the PR's thread
- **CI Status** - Shows workflow status (pending, running, passed, failed)
- **Review Detection** - Detects Copilot and agent-review via piggyback on push/CI events
- **Issue & Release Notifications** - Separate channels for different event types
- **Persistent State** - SQLite tracks PR ↔ message mappings
- **Stale Message Handling** - Gracefully recovers if Discord messages are deleted

## How It Works

### Message Flow

When a PR is opened, repo-relay creates an embed with a thread attached:

```
┌─────────────────────────────────────────────┐
│ 🔀 PR #123: Add combat animations           │
│                                             │
│ Author: @username                           │
│ Branch: feat/combat-animations → main       │
│ Changes: 12 files (+450, -120)              │
│                                             │
│ 📋 Reviews                                  │
│ • Copilot: ⏳ Pending                       │
│ • Agent Review: ⏳ Pending                  │
│                                             │
│ 🔄 CI: ⏳ Pending                           │
└─────────────────────────────────────────────┘
   └── Thread: "PR #123: Add combat animations"
       ├── 📋 Updates for PR #123 will appear here.
       ├── 📤 Push: 1 commit by @username
       ├── 🔄 CI: ✅ Passed (CI)
       ├── 🤖 Copilot: Reviewed
       └── 🎉 Merged by @username
```

### Review Detection (Piggyback Approach)

GitHub Apps using `GITHUB_TOKEN` don't trigger workflows. To work around this:

- When any PR event fires (push, CI completion), the bot checks GitHub API for reviews
- If Copilot or agent-review is detected, the embed and thread are updated
- Reviews are detected on the **next** event, not immediately

## Quick Start

The fastest way to get started:

```bash
npx blamechris/repo-relay init
```

This interactive wizard will guide you through setup and create the workflow file automatically.

<details>
<summary><strong>Manual Setup</strong></summary>

### 1. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create new application → Bot → Reset Token → Copy token
3. Enable intents: **Message Content Intent**, **Server Members Intent**
4. Generate invite URL (OAuth2 → URL Generator):
   - Scopes: `bot`
   - Permissions: See [Required Discord Permissions](#required-discord-permissions) below
5. Invite bot to your server

### 2. Get Channel IDs

1. Enable Developer Mode in Discord (Settings → Advanced → Developer Mode)
2. Right-click channels → Copy ID

### 3. Add Secrets to Repository

Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

| Secret | Required | Description |
|--------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Bot token from step 1 |
| `DISCORD_CHANNEL_PRS` | Yes | Channel ID for PR notifications |
| `DISCORD_CHANNEL_ISSUES` | No | Channel ID for issue notifications |
| `DISCORD_CHANNEL_RELEASES` | No | Channel ID for release notifications |

### 4. Add Workflow

Create `.github/workflows/discord-notify.yml`:

```yaml
name: Discord Notifications

on:
  pull_request:
    types: [opened, synchronize, closed, reopened, edited, ready_for_review, converted_to_draft]
  pull_request_review:
    types: [submitted]
  issue_comment:
    types: [created]
  issues:
    types: [opened, closed]
  release:
    types: [published]
  workflow_run:
    workflows: ["CI"]  # Name of your CI workflow
    types: [completed]

jobs:
  notify:
    runs-on: self-hosted  # or ubuntu-latest (see State Storage below)
    permissions:
      pull-requests: read
      issues: read
      contents: read
    # Skip workflow_run events without PRs
    if: github.event_name != 'workflow_run' || github.event.workflow_run.pull_requests[0] != null

    steps:
      - uses: blamechris/repo-relay@v1
        with:
          discord_bot_token: ${{ secrets.DISCORD_BOT_TOKEN }}
          channel_prs: ${{ secrets.DISCORD_CHANNEL_PRS }}
          channel_issues: ${{ secrets.DISCORD_CHANNEL_ISSUES }}
          channel_releases: ${{ secrets.DISCORD_CHANNEL_RELEASES }}
```

That's it! The action handles Node.js setup, dependency installation, and execution automatically.

</details>

### Action Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `discord_bot_token` | Yes | - | Discord bot token |
| `channel_prs` | Yes | - | Channel ID for PR notifications |
| `channel_issues` | No | `channel_prs` | Channel ID for issue notifications |
| `channel_releases` | No | `channel_prs` | Channel ID for release notifications |
| `state_dir` | No | `~/.repo-relay` | Directory for SQLite state |
| `github_token` | No | `github.token` | GitHub token for API access |

<details>
<summary><strong>Advanced: Manual Workflow Setup</strong></summary>

If you need more control (custom Node.js version, additional steps, etc.), you can set up the workflow manually:

```yaml
name: Discord Notifications

on:
  pull_request:
    types: [opened, synchronize, closed, reopened, edited, ready_for_review, converted_to_draft]
  pull_request_review:
    types: [submitted]
  issue_comment:
    types: [created]
  issues:
    types: [opened, closed]
  release:
    types: [published]
  workflow_run:
    workflows: ["CI"]
    types: [completed]

jobs:
  notify:
    runs-on: self-hosted
    permissions:
      pull-requests: read
      issues: read
      contents: read
    if: github.event_name != 'workflow_run' || github.event.workflow_run.pull_requests[0] != null

    steps:
      - name: Checkout repo-relay
        uses: actions/checkout@v4
        with:
          repository: blamechris/repo-relay
          ref: v1
          path: .repo-relay

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: .repo-relay/package-lock.json

      - name: Install dependencies
        working-directory: .repo-relay
        run: npm ci --omit=dev

      - name: Run repo-relay
        working-directory: .repo-relay
        env:
          DISCORD_BOT_TOKEN: ${{ secrets.DISCORD_BOT_TOKEN }}
          DISCORD_CHANNEL_PRS: ${{ secrets.DISCORD_CHANNEL_PRS }}
          DISCORD_CHANNEL_ISSUES: ${{ secrets.DISCORD_CHANNEL_ISSUES }}
          DISCORD_CHANNEL_RELEASES: ${{ secrets.DISCORD_CHANNEL_RELEASES }}
          GITHUB_TOKEN: ${{ github.token }}
          STATE_DIR: ~/.repo-relay
        run: node dist/cli.js

      - name: Cleanup
        if: always()
        run: rm -rf .repo-relay
```

</details>

## Required Discord Permissions

When generating the bot invite URL, ensure these permissions are enabled:

| Permission | Why It's Needed |
|------------|-----------------|
| **Send Messages** | Post PR/issue/release embeds |
| **Create Public Threads** | Create threads for PR updates |
| **Send Messages in Threads** | Post updates to PR threads |
| **Embed Links** | Render rich embeds with PR info |
| **Read Message History** | Find existing PR messages to update |

**Invite URL scopes:** `bot`

If the bot connects but can't post, check the channel-level permissions. The bot needs these permissions in each channel it posts to.

## Self-Hosted vs GitHub-Hosted Runners

| Aspect | Self-Hosted | GitHub-Hosted |
|--------|-------------|---------------|
| **State Persistence** | ✅ SQLite persists in `~/.repo-relay/` | ❌ Lost after each run |
| **Setup** | Requires runner installation | Zero setup |
| **Cost** | Your hardware | GitHub Actions minutes |
| **Speed** | Fast (no cold start) | ~30s cold start |
| **Availability** | Depends on your uptime | Always available |
| **Queue Blocking** | Can block behind long CI jobs | Isolated from other workflows |

**Recommendation:**
- **Self-hosted** if you have existing runners and want persistent PR tracking
- **GitHub-hosted** (`ubuntu-latest`) with `actions/cache` for state persistence (see below)

### State Persistence with GitHub-Hosted Runners

Add an `actions/cache` step before repo-relay to persist state between runs:

```yaml
    - uses: actions/cache@v4
      with:
        path: ~/.repo-relay
        key: repo-relay-state-${{ github.repository }}

    - uses: blamechris/repo-relay@v1
      ...
```

**Notes:**
- Cache evicts after 7 days of inactivity (fine for active repos)
- No security concern — the state DB contains only Discord message IDs and PR metadata
- If cache misses, repo-relay falls back to searching the last 100 channel messages

## State Storage

| Runner Type | Storage Location | Persistence |
|-------------|------------------|-------------|
| **Self-hosted** (recommended) | `~/.repo-relay/{repo-name}/state.db` | Permanent |
| **GitHub-hosted** | `actions/cache` | Persistent with cache (see [State Persistence](#state-persistence-with-github-hosted-runners)) |

## Troubleshooting

### "Missing Access" Error

**Symptom:** Bot connects but fails to send messages with "Missing Access" error.

**Fix:** The bot lacks permissions in the target channel. Check:
1. Bot has the [required permissions](#required-discord-permissions) at the server level
2. Channel-specific permissions don't override/block the bot
3. The channel ID is correct (right-click channel → Copy ID with Developer Mode enabled)

### Notification Cascades (Too Many Messages)

**Symptom:** Replying to Copilot review comments triggers more notifications.

**Fix:** This is handled automatically since v1. The review handler filters out `pull_request_review` events where the reviewer is the repo owner and the review state is `commented`. No workflow-level filter needed.

### First PR Shows Red X

**Symptom:** First PR fails before secrets are configured.

**Fix:** This is expected - configure the secrets, then re-run the failed workflow. Future PRs will work.

### Job Queued Behind Long CI

**Symptom:** Discord notification waits in queue while long-running CI jobs complete.

**Fix:**
- Use `ubuntu-latest` instead of self-hosted runner (isolates from other jobs)
- Or configure runner labels to separate notification jobs from build jobs

## Known Limitations

1. **Review events don't trigger immediately** - GitHub Apps using `GITHUB_TOKEN` don't trigger workflows. Reviews are detected on the next push or CI event via the piggyback approach.

2. **GitHub-hosted runners lose state** - GitHub-hosted runners don't persist state between runs. Use `actions/cache` to persist the `~/.repo-relay` directory (see [State Persistence](#state-persistence-with-github-hosted-runners)).

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run locally (requires environment variables)
npm run dev
```

## License

MIT License - see [LICENSE](LICENSE)
