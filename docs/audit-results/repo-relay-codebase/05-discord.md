# Discord Specialist's Audit: repo-relay Codebase

**Agent**: Discord -- discord.js 14.x specialist
**Overall Rating**: 3.7 / 5
**Date**: 2026-02-09

---

## Section Ratings

| Section | Rating | Notes |
|---------|--------|-------|
| Thread auto-archive & unarchiving | 4.0 / 5 | Correct patterns in handlers, gap in piggyback path |
| Channel type guards & permissions | 3.5 / 5 | Consistent but too narrow (TextChannel only), missing ManageThreads |
| Rate limit handling | 3.5 / 5 | Good 5xx retry with backoff, no 429 handling, no burst throttling |
| Embed limit compliance | 3.5 / 5 | Title truncation solid, no total/field-value enforcement |
| Message component usage | 4.5 / 5 | Clean, correct, well-tested |
| Gateway session management | 4.0 / 5 | Minimal intents, session budget tracking, no cache config |

---

## Detailed Analysis

### Thread Auto-Archive (4.0 / 5)

Consistent `autoArchiveDuration: 1440` (24 hours). Thread unarchiving correctly handled in handlers with retry wrapping. Thread name truncation to 90 chars is borderline for high-numbered PRs (PR #12345 = 100 chars total, right at the limit).

**Gap:** `checkAndUpdateReviews` in `src/index.ts:366-383` fetches a thread and sends to it without checking archived status. Unlike `getOrCreateThread` which properly unarchives, the piggyback path silently fails on archived threads.

### Channel Type Guards (3.5 / 5)

Every handler uses `channel instanceof TextChannel` consistently. However, this rejects `NewsChannel` (announcement channels), which are commonly used for notification bots. Users configuring announcement channels get a hard error.

**Missing permissions:** `ManageThreads` not in `REQUIRED_PERMISSIONS` but required for `setArchived(false)`. `ViewChannel` also missing (caught indirectly but with unclear error messages).

### Rate Limits (3.5 / 5)

`withRetry` provides exponential backoff for 5xx errors. Pre-filter saves gateway sessions. Session budget monitoring is proactive.

**Gaps:** No 429 rate limit handling. `pollOpenPrReviews` iterates sequentially with no throttling between iterations. No handling for `DiscordAPIError` code 50001 (Missing Access).

### Embed Limits (3.5 / 5)

Title truncation solid and tested. Description truncation applied to most builders. No total character count enforcement (6000 limit). No field value length enforcement (1024 limit) -- the issue Labels field could exceed this with many labels.

### Components (4.5 / 5)

`buildPrComponents` uses `ActionRowBuilder<ButtonBuilder>` correctly. Max 3 buttons, `ButtonStyle.Link` for external URLs. Well-tested.

### Gateway Sessions (4.0 / 5)

Minimal intents (`Guilds` + `GuildMessages`). No privileged intents. Session budget monitoring with two warning thresholds. Clean lifecycle with try/finally. No cache configuration (acceptable for ephemeral deployment).

---

## Top 5 Findings

### Finding 1 (Medium): Missing `ManageThreads` Permission
**File**: `src/index.ts:70-76`
`setArchived(false)` requires `ManageThreads`, not in `REQUIRED_PERMISSIONS`. Unarchiving fails silently, causing duplicate thread creation.

### Finding 2 (Medium): `instanceof TextChannel` Rejects Announcement Channels
**Files**: Every handler file (pr.ts:64, ci.ts:53, review.ts:61, etc.)
`NewsChannel` is excluded. Users with announcement channels get hard errors. Replace with broader `channel.isTextBased()` check.

### Finding 3 (Low-Medium): No Embed Field Value 1024-Char Limit Enforcement
**File**: `src/embeds/builders.ts:229-233`
Issue Labels field built from unbounded array (GitHub allows 100 labels). Could exceed 1024-char field value limit.

### Finding 4 (Low-Medium): Thread Unarchive Not Applied in Piggyback Review Path
**File**: `src/index.ts:366-383`
`checkAndUpdateReviews` sends to threads without checking archived state. Auto-archived threads (after 24h inactivity) cause silent failures.

### Finding 5 (Low): Retry Utility Does Not Handle 429 Rate Limits
**File**: `src/utils/retry.ts:7-12`
`isRetryable` only returns true for status >= 500. Discord 429s not retried. discord.js handles most internally, but edge cases exist.

---

## Additional Notes

- Stale message detection via string matching (`errMsg.includes('Unknown Message')`) is fragile. Discord.js provides `DiscordAPIError` with numeric code 10008. Match on code instead.
- Footer metadata recovery (`repo-relay:v1:` prefix with versioning) is well-designed.
- Pre-filter is an excellent pattern for gateway session conservation.

---

## Overall Rating: 3.7 / 5

The codebase demonstrates solid understanding of discord.js 14.x patterns. Consistent retry usage, pre-filter optimization, footer state recovery, and thorough permission validation are above average. The two most impactful issues are `instanceof TextChannel` narrowness (immediate failures for announcement channels) and missing `ManageThreads` permission (silent failures on thread unarchive). All issues are point fixes -- no restructuring needed.
