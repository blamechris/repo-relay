/**
 * Workflow template builder for repo-relay setup wizard
 */
export function buildWorkflowTemplate(ciWorkflowName, features, defaultBranch = 'main') {
    const eventLines = [
        '  pull_request:',
        '    types: [opened, synchronize, closed, reopened, edited, ready_for_review, converted_to_draft]',
        '  pull_request_review:',
        '    types: [submitted]',
        // Always subscribed: issue_comment delivers agent-review detection on PRs,
        // independent of whether issue notifications are enabled
        '  issue_comment:',
        '    types: [created]',
    ];
    if (features.pushEvents) {
        // NOTE: $default-branch is only substituted inside org workflow *templates*;
        // in a generated user workflow it would be a literal, dead branch filter.
        eventLines.push('  push:', `    branches: [${defaultBranch}]`);
    }
    if (features.issues) {
        eventLines.push('  issues:', '    types: [opened, closed, reopened]');
    }
    if (features.releases) {
        eventLines.push('  release:', '    types: [published]');
    }
    if (features.deployments) {
        eventLines.push('  deployment_status:');
    }
    if (features.securityAlerts) {
        eventLines.push('  dependabot_alert:', '    types: [created]', '  secret_scanning_alert:', '    types: [created]', '  code_scanning_alert:', '    types: [created, appeared_in_branch]');
    }
    if (features.reviewPolling) {
        eventLines.push('  # Poll open PRs for review updates every 5 minutes');
        eventLines.push('  schedule:', "    - cron: '*/5 * * * *'");
    }
    const sanitizedName = ciWorkflowName.replace(/"/g, '\\"');
    eventLines.push('  workflow_run:', `    workflows: ["${sanitizedName}"]`, '    types: [completed]');
    const channelSecrets = ['          channel_prs: ${{ secrets.DISCORD_CHANNEL_PRS }}'];
    if (features.issues) {
        channelSecrets.push('          channel_issues: ${{ secrets.DISCORD_CHANNEL_ISSUES }}');
    }
    if (features.releases) {
        channelSecrets.push('          channel_releases: ${{ secrets.DISCORD_CHANNEL_RELEASES }}');
    }
    if (features.deployments) {
        channelSecrets.push('          channel_deployments: ${{ secrets.DISCORD_CHANNEL_DEPLOYMENTS }}');
    }
    if (features.securityAlerts) {
        channelSecrets.push('          channel_security: ${{ secrets.DISCORD_CHANNEL_SECURITY }}');
    }
    const permissionLines = ['      pull-requests: read'];
    if (features.issues) {
        permissionLines.push('      issues: read');
    }
    if (features.securityAlerts) {
        permissionLines.push('      security-events: read');
    }
    // workflow_run is always subscribed; fetchFailedSteps reads the Actions jobs
    // API, and an explicit permissions block zeroes every unlisted scope
    permissionLines.push('      actions: read');
    permissionLines.push('      contents: read');
    return `name: Discord Notifications

on:
${eventLines.join('\n')}

# Serialize runs — simultaneous events (push + CI completing) can otherwise
# race and create duplicate embeds or lose status updates
concurrency:
  group: repo-relay-\${{ github.repository }}

jobs:
  notify:
    runs-on: ubuntu-latest
    permissions:
${permissionLines.join('\n')}
    # Defense-in-depth: skip workflow_run events with no associated PR.
    # The pre-filter also catches this, but this guard protects against
    # direct workflow dispatch where the pre-filter is bypassed.
    # (workflow_run-specific fields resolve to null for non-workflow_run events)
    # Also skip fork PRs (no secrets available — the run would always fail red)
    # and bot actors (prevents notification cascades).
    if: >-
      github.actor != 'github-actions[bot]' &&
      (github.event.pull_request.head.repo.full_name == github.repository ||
       github.event.pull_request == null) &&
      (github.event_name != 'workflow_run' ||
       github.event.workflow_run.pull_requests[0] != null)

    steps:
      # Persist state between runs. The key MUST be unique per run — cache
      # entries are immutable, so a constant key would freeze state at the
      # first run forever. restore-keys restores the most recent snapshot.
      - uses: actions/cache@v4
        with:
          path: ~/.repo-relay
          key: repo-relay-state-\${{ github.repository }}-\${{ github.run_id }}
          restore-keys: |
            repo-relay-state-\${{ github.repository }}-

      - uses: blamechris/repo-relay@v1
        with:
          discord_bot_token: \${{ secrets.DISCORD_BOT_TOKEN }}
${channelSecrets.join('\n')}
`;
}
//# sourceMappingURL=workflow-template.js.map