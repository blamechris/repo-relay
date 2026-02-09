/**
 * Workflow template builder for repo-relay setup wizard
 */

export interface ProjectFeatures {
  issues: boolean;
  releases: boolean;
  deployments: boolean;
  reviewPolling: boolean;
  pushEvents: boolean;
  securityAlerts?: boolean;
}

export function buildWorkflowTemplate(ciWorkflowName: string, features: ProjectFeatures): string {
  const eventLines: string[] = [
    '  pull_request:',
    '    types: [opened, synchronize, closed, reopened, edited, ready_for_review, converted_to_draft]',
    '  pull_request_review:',
    '    types: [submitted]',
  ];

  if (features.pushEvents) {
    eventLines.push('  push:', `    branches: [$default-branch]`);
  }

  if (features.issues) {
    eventLines.push('  issue_comment:', '    types: [created]');
    eventLines.push('  issues:', '    types: [opened, closed]');
  }

  if (features.releases) {
    eventLines.push('  release:', '    types: [published]');
  }

  if (features.deployments) {
    eventLines.push('  deployment_status:');
  }

  if (features.securityAlerts) {
    eventLines.push(
      '  dependabot_alert:',
      '    types: [created]',
      '  secret_scanning_alert:',
      '    types: [created]',
      '  code_scanning_alert:',
      '    types: [created, appeared_in_branch]',
    );
  }

  if (features.reviewPolling) {
    eventLines.push('  # Poll open PRs for review updates every 5 minutes');
    eventLines.push('  schedule:', "    - cron: '*/5 * * * *'");
  }

  const sanitizedName = ciWorkflowName.replace(/"/g, '\\"');
  eventLines.push(
    '  workflow_run:',
    `    workflows: ["${sanitizedName}"]`,
    '    types: [completed]',
  );

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
  permissionLines.push('      contents: read');

  return `name: Discord Notifications

on:
${eventLines.join('\n')}

jobs:
  notify:
    runs-on: ubuntu-latest
    permissions:
${permissionLines.join('\n')}
    # Skip workflow_run events with no associated PR; other event types always pass
    # (workflow_run-specific fields resolve to null for non-workflow_run events)
    if: github.event_name != 'workflow_run' || github.event.workflow_run.pull_requests[0] != null

    steps:
      - uses: blamechris/repo-relay@v1
        with:
          discord_bot_token: \${{ secrets.DISCORD_BOT_TOKEN }}
${channelSecrets.join('\n')}
`;
}
