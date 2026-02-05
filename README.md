# Repo Relay

GitHub-Discord integration bot that tracks PRs, CI, issues, and releases with threaded updates.

## Features

- **PR Notifications** - Creates a Discord message per PR, updates as replies
- **CI Status** - Shows workflow status (running, passed, failed)
- **Review Tracking** - Detects Copilot and agent-review comments
- **Issue & Release Notifications** - Separate channels for different event types
- **Persistent State** - SQLite tracks PR ↔ message mappings

## Quick Start

### 1. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create new application → Bot → Reset Token → Copy token
3. Enable these intents: "Message Content Intent"
4. Generate invite URL with permissions: `Send Messages`, `Embed Links`, `Read Message History`
5. Invite bot to your server

### 2. Get Channel IDs

1. Enable Developer Mode in Discord (Settings → Advanced → Developer Mode)
2. Right-click channels → Copy ID

### 3. Add Secrets to Repository

Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

| Secret | Description |
|--------|-------------|
| `DISCORD_BOT_TOKEN` | Bot token from step 1 |
| `DISCORD_CHANNEL_PRS` | Channel ID for PR notifications |
| `DISCORD_CHANNEL_ISSUES` | Channel ID for issue notifications |
| `DISCORD_CHANNEL_RELEASES` | Channel ID for release notifications |

### 4. Add Workflow

Create `.github/workflows/discord-notifications.yml`:

```yaml
name: Discord Notifications

on:
  pull_request:
    types: [opened, synchronize, closed, reopened]
  pull_request_review:
    types: [submitted]
  issue_comment:
    types: [created]
  issues:
    types: [opened, closed, labeled]
  release:
    types: [published]
  workflow_run:
    workflows: ["CI"]  # Name of your CI workflow
    types: [completed]

jobs:
  notify:
    runs-on: ubuntu-latest  # or self-hosted for persistent state
    steps:
      - name: Discord Notification
        uses: blamechris/repo-relay@v1
        with:
          discord_bot_token: ${{ secrets.DISCORD_BOT_TOKEN }}
          channel_prs: ${{ secrets.DISCORD_CHANNEL_PRS }}
          channel_issues: ${{ secrets.DISCORD_CHANNEL_ISSUES }}
          channel_releases: ${{ secrets.DISCORD_CHANNEL_RELEASES }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Message Flow

### PR Opened

```
┌─────────────────────────────────────────────┐
│ 🔀 PR #123: Add combat animations           │
│                                             │
│ Author: @username                           │
│ Branch: feat/combat-animations              │
│ Files: 12 changed (+450, -120)              │
│                                             │
│ 📋 Reviews: ⏳ Pending                      │
│ 🔄 CI: ⏳ Running...                        │
└─────────────────────────────────────────────┘
```

### Updates (as replies)

```
↳ 📤 Push: 2 commits (abc1234)
↳ ✅ CI passed
↳ 🤖 Copilot reviewed: 3 comments
↳ 🔍 Agent review: Approved
↳ 🎉 Merged to main!
```

## State Storage

**Self-hosted runners (recommended):**
State persists in `~/.repo-relay/{repo-name}/state.db`

**GitHub-hosted runners:**
State is stored as artifacts (slower, but works)

## Configuration

| Environment Variable | Required | Description |
|---------------------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `DISCORD_CHANNEL_PRS` | Yes | Channel for PR notifications |
| `DISCORD_CHANNEL_ISSUES` | No | Channel for issue notifications |
| `DISCORD_CHANNEL_RELEASES` | No | Channel for release notifications |
| `STATE_DIR` | No | Directory for SQLite state (default: `~/.repo-relay`) |

## License

MIT License - see [LICENSE](LICENSE)
