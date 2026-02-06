import { describe, it, expect } from 'vitest';
import { buildWorkflowTemplate } from '../workflow-template.js';

describe('buildWorkflowTemplate', () => {
  it('library: includes issues + releases events, all channel secrets, issues permission', () => {
    const result = buildWorkflowTemplate('CI', { issues: true, releases: true });

    // Events
    expect(result).toContain('pull_request:');
    expect(result).toContain('pull_request_review:');
    expect(result).toContain('issue_comment:');
    expect(result).toContain('issues:');
    expect(result).toContain('release:');
    expect(result).toContain('workflow_run:');
    expect(result).toContain('workflows: ["CI"]');

    // Channel secrets
    expect(result).toContain('channel_prs:');
    expect(result).toContain('channel_issues:');
    expect(result).toContain('channel_releases:');

    // Permissions
    expect(result).toContain('issues: read');
    expect(result).toContain('pull-requests: read');
    expect(result).toContain('contents: read');
  });

  it('webapp: includes issues but not releases', () => {
    const result = buildWorkflowTemplate('CI', { issues: true, releases: false });

    // Has issues events
    expect(result).toContain('issue_comment:');
    expect(result).toContain('issues:');
    expect(result).toContain('channel_issues:');
    expect(result).toContain('issues: read');

    // No releases
    expect(result).not.toContain('release:');
    expect(result).not.toContain('channel_releases:');
  });

  it('minimal: PR-only events, no extra channels or permissions', () => {
    const result = buildWorkflowTemplate('CI', { issues: false, releases: false });

    // Core events present
    expect(result).toContain('pull_request:');
    expect(result).toContain('pull_request_review:');
    expect(result).toContain('workflow_run:');

    // No issue/release events
    expect(result).not.toContain('issue_comment:');
    expect(result).not.toMatch(/^ {2}issues:/m);
    expect(result).not.toContain('release:');

    // Only PRS channel
    expect(result).toContain('channel_prs:');
    expect(result).not.toContain('channel_issues:');
    expect(result).not.toContain('channel_releases:');

    // No issues permission
    expect(result).not.toContain('issues: read');
  });
});
