# Security Policy

## Reporting a Vulnerability

Please report vulnerabilities privately via [GitHub's private vulnerability reporting](https://github.com/blamechris/repo-relay/security/advisories/new). Do not open a public issue for security reports.

Include what you can of:

- A description of the issue and its impact
- Steps to reproduce (a minimal workflow or payload is ideal)
- The version or commit you tested against

This is a single-maintainer project; reports are handled on a best-effort basis, and you should normally hear back within a few days.

## Scope

Repo Relay runs inside GitHub Actions and handles a Discord bot token and a GitHub token. Reports in these areas are particularly relevant:

- Token handling — leakage into logs, embeds, or the state database
- Injection via untrusted event payload fields (PR titles, branch names, comment bodies) into shell steps, Discord content, or SQL
- State database handling, including state persisted via `actions/cache`

## Supported Versions

Fixes land on `main`; the `v1` tag is updated to point at the latest fixed release. There are no backports to older tags — consumers should reference `blamechris/repo-relay@v1` (or pin a commit SHA and update it).
