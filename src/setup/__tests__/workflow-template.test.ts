import { describe, it, expect } from 'vitest';
import { buildWorkflowTemplate } from '../workflow-template.js';

describe('buildWorkflowTemplate', () => {
  it('library: includes issues + releases events, all channel secrets, issues permission', () => {
    const result = buildWorkflowTemplate('CI', { issues: true, releases: true, deployments: false });

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
    const result = buildWorkflowTemplate('CI', { issues: true, releases: false, deployments: false });

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
    const result = buildWorkflowTemplate('CI', { issues: false, releases: false, deployments: false });

    // Core events present
    expect(result).toContain('pull_request:');
    expect(result).toContain('pull_request_review:');
    expect(result).toContain('workflow_run:');

    // No issue/release/deployment events
    expect(result).not.toContain('issue_comment:');
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
    const result = buildWorkflowTemplate('CI', { issues: true, releases: false, deployments: true });

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
    const result = buildWorkflowTemplate('CI', { issues: false, releases: false, deployments: true });

    // Has deployment events
    expect(result).toContain('deployment_status:');
    expect(result).toContain('channel_deployments:');

    // No issues or releases
    expect(result).not.toContain('issue_comment:');
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
    const result = buildWorkflowTemplate('Build', { issues: true, releases: true, deployments: true });

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
    expect(result).toContain('# Skip workflow_run events with no associated PR');
  });
});
