/**
 * Workflow template builder for repo-relay setup wizard
 */
export function buildWorkflowTemplate(ciWorkflowName, features) {
    const eventLines = [
        '  pull_request:',
        '    types: [opened, synchronize, closed, reopened, edited, ready_for_review, converted_to_draft]',
        '  pull_request_review:',
        '    types: [submitted]',
    ];
    if (features.issues) {
        eventLines.push('  issue_comment:', '    types: [created]');
        eventLines.push('  issues:', '    types: [opened, closed]');
    }
    if (features.releases) {
        eventLines.push('  release:', '    types: [published]');
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
    const permissionLines = ['      pull-requests: read'];
    if (features.issues) {
        permissionLines.push('      issues: read');
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
    if: github.event_name != 'workflow_run' || github.event.workflow_run.pull_requests[0] != null

    steps:
      - uses: blamechris/repo-relay@v1
        with:
          discord_bot_token: \${{ secrets.DISCORD_BOT_TOKEN }}
${channelSecrets.join('\n')}
`;
}
//# sourceMappingURL=workflow-template.js.map