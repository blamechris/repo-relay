import { describe, it, expect } from 'vitest';
import { buildWorkflowTemplate } from '../workflow-template.js';

describe('buildWorkflowTemplate', () => {
  it('library: includes issues + releases events, all channel secrets, issues permission', () => {
    const result = buildWorkflowTemplate('CI', { issues: true, releases: true, deployments: false, reviewPolling: false, pushEvents: false, securityAlerts: false });

    // Events
    expect(result).toContain('pull_request:');
    expect(result).toContain('pull_request_review:');
    expect(result).toContain('issue_comment:');
    expect(result).toContain('issues:');
    expect(result).toContain('release:');
    expect(result).toContain('workflow_run:');
    expect(result).toContain('workflows: ["CI"]');

    // No deployments
    expect(result).not.toContain('deployment_status:');

    // Channel secrets
    expect(result).toContain('channel_prs:');
    expect(result).toContain('channel_issues:');
    expect(result).toContain('channel_releases:');
    expect(result).not.toContain('channel_deployments:');

    // Permissions
    expect(result).toContain('issues: read');
    expect(result).toContain('pull-requests: read');
    expect(result).toContain('contents: read');
  });

  it('webapp: includes issues but not releases or deployments', () => {
    const result = buildWorkflowTemplate('CI', { issues: true, releases: false, deployments: false, reviewPolling: false, pushEvents: false, securityAlerts: false });

    // Has issues events
    expect(result).toContain('issue_comment:');
    expect(result).toContain('issues:');
    expect(result).toContain('channel_issues:');
    expect(result).toContain('issues: read');

    // No releases or deployments
    expect(result).not.toContain('release:');
    expect(result).not.toContain('channel_releases:');
    expect(result).not.toContain('deployment_status:');
    expect(result).not.toContain('channel_deployments:');
  });

  it('minimal: PR-only events, no extra channels or permissions', () => {
    const result = buildWorkflowTemplate('CI', { issues: false, releases: false, deployments: false, reviewPolling: false, pushEvents: false, securityAlerts: false });

    // Core events present
    expect(result).toContain('pull_request:');
    expect(result).toContain('pull_request_review:');
    expect(result).toContain('workflow_run:');

    // issue_comment is ALWAYS subscribed — it's the delivery path for
    // agent-review detection on PRs, independent of the issues feature
    expect(result).toContain('issue_comment:');

    // No issues/release/deployment events
    expect(result).not.toMatch(/^ {2}issues:/m);
    expect(result).not.toContain('release:');
    expect(result).not.toContain('deployment_status:');

    // Only PRS channel
    expect(result).toContain('channel_prs:');
    expect(result).not.toContain('channel_issues:');
    expect(result).not.toContain('channel_releases:');
    expect(result).not.toContain('channel_deployments:');

    // No issues permission
    expect(result).not.toContain('issues: read');
  });

  it('app: includes issues + deployments but not releases', () => {
    const result = buildWorkflowTemplate('CI', { issues: true, releases: false, deployments: true, reviewPolling: false, pushEvents: false, securityAlerts: false });

    // Has issues events
    expect(result).toContain('issue_comment:');
    expect(result).toContain('issues:');
    expect(result).toContain('channel_issues:');
    expect(result).toContain('issues: read');

    // Has deployment events
    expect(result).toContain('deployment_status:');
    expect(result).toContain('channel_deployments:');

    // No releases
    expect(result).not.toContain('release:');
    expect(result).not.toContain('channel_releases:');

    // Core events still present
    expect(result).toContain('pull_request:');
    expect(result).toContain('workflow_run:');
  });

  it('deployments-only: has deployment_status but no issues or releases', () => {
    const result = buildWorkflowTemplate('CI', { issues: false, releases: false, deployments: true, reviewPolling: false, pushEvents: false, securityAlerts: false });

    // Has deployment events
    expect(result).toContain('deployment_status:');
    expect(result).toContain('channel_deployments:');

    // No issues or releases (issue_comment is always present for agent-review detection)
    expect(result).not.toMatch(/^ {2}issues:/m);
    expect(result).not.toContain('release:');
    expect(result).not.toContain('channel_issues:');
    expect(result).not.toContain('channel_releases:');
    expect(result).not.toContain('issues: read');

    // Core events still present
    expect(result).toContain('pull_request:');
    expect(result).toContain('workflow_run:');
    expect(result).toContain('channel_prs:');
  });

  it('all features: issues + releases + deployments all present', () => {
    const result = buildWorkflowTemplate('Build', { issues: true, releases: true, deployments: true, reviewPolling: false, pushEvents: false, securityAlerts: false });

    // All events
    expect(result).toContain('issue_comment:');
    expect(result).toContain('issues:');
    expect(result).toContain('release:');
    expect(result).toContain('deployment_status:');
    expect(result).toContain('workflow_run:');
    expect(result).toContain('workflows: ["Build"]');

    // All channel secrets
    expect(result).toContain('channel_prs:');
    expect(result).toContain('channel_issues:');
    expect(result).toContain('channel_releases:');
    expect(result).toContain('channel_deployments:');

    // Permissions
    expect(result).toContain('issues: read');
    expect(result).toContain('pull-requests: read');
    expect(result).toContain('contents: read');

    // If-guard comment explains filtering logic
    expect(result).toContain('# Defense-in-depth: skip workflow_run events with no associated PR');
  });

  it('always: actions read permission, fork guard, issues reopened, cache, and concurrency', () => {
    const result = buildWorkflowTemplate('CI', { issues: true, releases: false, deployments: false, reviewPolling: false, pushEvents: false, securityAlerts: false });

    // fetchFailedSteps calls the Actions jobs API — an explicit permissions
    // block zeroes unlisted scopes, so actions: read must be present
    expect(result).toContain('actions: read');

    // Fork PRs run without secrets — guard prevents a guaranteed red X
    expect(result).toContain('github.event.pull_request.head.repo.full_name == github.repository');

    // Handlers and pre-filter support issue reopens
    expect(result).toContain('types: [opened, closed, reopened]');

    // State persistence: per-run cache key + restore-keys prefix
    expect(result).toContain('actions/cache@v4');
    expect(result).toContain('key: repo-relay-state-${{ github.repository }}-${{ github.run_id }}');
    expect(result).toContain('restore-keys:');

    // Serialize runs to avoid duplicate embeds from racing events
    expect(result).toContain('concurrency:');
    expect(result).toContain('group: repo-relay-${{ github.repository }}');
  });

  it('reviewPolling enabled: includes schedule trigger with 5-min cron', () => {
    const result = buildWorkflowTemplate('CI', { issues: false, releases: false, deployments: false, reviewPolling: true, pushEvents: false, securityAlerts: false });

    expect(result).toContain('schedule:');
    expect(result).toContain("cron: '*/5 * * * *'");

    // Core events still present
    expect(result).toContain('pull_request:');
    expect(result).toContain('workflow_run:');
  });

  it('pushEvents enabled: includes push event with resolved default branch', () => {
    const result = buildWorkflowTemplate('CI', { issues: false, releases: false, deployments: false, reviewPolling: false, pushEvents: true, securityAlerts: false });

    expect(result).toContain('push:');
    // $default-branch is a workflow-template-only macro — it must never appear
    // in a generated user workflow (it would be treated as a literal branch name)
    expect(result).not.toContain('$default-branch');
    expect(result).toContain('branches: [main]');

    // Core events still present
    expect(result).toContain('pull_request:');
    expect(result).toContain('workflow_run:');
  });

  it('pushEvents enabled with custom default branch: uses the provided branch', () => {
    const result = buildWorkflowTemplate('CI', { issues: false, releases: false, deployments: false, reviewPolling: false, pushEvents: true, securityAlerts: false }, 'develop');

    expect(result).toContain('branches: [develop]');
    expect(result).not.toContain('$default-branch');
  });

  it('pushEvents disabled: no push event in output', () => {
    const result = buildWorkflowTemplate('CI', { issues: false, releases: false, deployments: false, reviewPolling: false, pushEvents: false, securityAlerts: false });

    expect(result).not.toMatch(/^ {2}push:/m);
  });

  it('reviewPolling disabled: no schedule or cron in output', () => {
    const result = buildWorkflowTemplate('CI', { issues: false, releases: false, deployments: false, reviewPolling: false, pushEvents: false, securityAlerts: false });

    expect(result).not.toContain('schedule:');
    expect(result).not.toContain('cron:');
  });

  it('securityAlerts enabled: includes security event triggers, channel, and permission', () => {
    const result = buildWorkflowTemplate('CI', { issues: false, releases: false, deployments: false, reviewPolling: false, pushEvents: false, securityAlerts: true });

    // Security events
    expect(result).toContain('dependabot_alert:');
    expect(result).toContain('secret_scanning_alert:');
    expect(result).toContain('code_scanning_alert:');
    expect(result).toContain('types: [created, appeared_in_branch]');

    // Channel secret
    expect(result).toContain('channel_security:');

    // Permission
    expect(result).toContain('security-events: read');

    // Core events still present
    expect(result).toContain('pull_request:');
    expect(result).toContain('workflow_run:');
  });

  it('securityAlerts disabled: no security events in output', () => {
    const result = buildWorkflowTemplate('CI', { issues: false, releases: false, deployments: false, reviewPolling: false, pushEvents: false, securityAlerts: false });

    expect(result).not.toContain('dependabot_alert:');
    expect(result).not.toContain('secret_scanning_alert:');
    expect(result).not.toContain('code_scanning_alert:');
    expect(result).not.toContain('channel_security:');
    expect(result).not.toContain('security-events:');
  });
});
