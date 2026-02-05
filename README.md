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

### 1. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create new application → Bot → Reset Token → Copy token
3. Enable intents: **Message Content Intent**, **Server Members Intent**
4. Generate invite URL (OAuth2 → URL Generator):
   - Scopes: `bot`
   - Permissions: `Send Messages`, `Create Public Threads`, `Send Messages in Threads`, `Embed Links`, `Read Message History`
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

Create `.github/workflows/discord-bot.yml`:

```yaml
name: Discord Bot Notifications

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
    # Self-hosted recommended for persistent state
    runs-on: self-hosted  # or ubuntu-latest
    permissions:
      pull-requests: read
      issues: read
      contents: read
      statuses: read
    # Skip workflow_run events without associated PRs
    if: |
      github.event_name != 'workflow_run' ||
      github.event.workflow_run.pull_requests[0] != null

    steps:
      - name: Checkout repo-relay
        uses: actions/checkout@v4
        with:
          repository: blamechris/repo-relay
          ref: v1.0.0
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
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_EVENT_NAME: ${{ github.event_name }}
          GITHUB_EVENT_PATH: ${{ github.event_path }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          STATE_DIR: ~/.repo-relay
        run: node dist/cli.js

      - name: Cleanup
        if: always()
        run: rm -rf .repo-relay
```

## State Storage

| Runner Type | Storage Location | Persistence |
|-------------|------------------|-------------|
| **Self-hosted** (recommended) | `~/.repo-relay/{repo-name}/state.db` | Permanent |
| **GitHub-hosted** | Workflow artifacts | Per-run (requires artifact upload/download) |

For GitHub-hosted runners, you'll need to add artifact upload/download steps to persist state between runs.

## Configuration

| Environment Variable | Required | Description |
|---------------------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `DISCORD_CHANNEL_PRS` | Yes | Channel for PR notifications |
| `DISCORD_CHANNEL_ISSUES` | No | Channel for issue notifications |
| `DISCORD_CHANNEL_RELEASES` | No | Channel for release notifications |
| `GITHUB_TOKEN` | Yes | GitHub token for API access (review detection) |
| `STATE_DIR` | No | Directory for SQLite state (default: `~/.repo-relay`) |

## Known Limitations

1. **Review events don't trigger immediately** - GitHub Apps using `GITHUB_TOKEN` don't trigger workflows. Reviews are detected on the next push or CI event via the piggyback approach.

2. **Self-hosted runners recommended** - GitHub-hosted runners don't persist state between runs without additional artifact handling.

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
