import { describe, it, expect } from 'vitest';
import { buildThreadName, buildCiFailureReply, buildIssueEmbed, type IssueData } from '../builders.js';

const DISCORD_THREAD_NAME_LIMIT = 100;
const DISCORD_FIELD_VALUE_LIMIT = 1024;
const DISCORD_MESSAGE_LIMIT = 2000;

describe('buildThreadName', () => {
  it('keeps short names intact', () => {
    expect(buildThreadName('PR', 7, 'Add feature')).toBe('PR #7: Add feature');
  });

  it('PR #10000 with a 90+ char title stays within 100 chars', () => {
    // The old code truncated only the title to 90 chars, ignoring the prefix:
    // "PR #10000: " (11 chars) + 90 = 101 → Discord 400
    const name = buildThreadName('PR', 10000, 'x'.repeat(120));
    expect(name.length).toBeLessThanOrEqual(DISCORD_THREAD_NAME_LIMIT);
    expect(name).toContain('PR #10000: ');
  });

  it('Issue #10 with a 90-char title stays within 100 chars', () => {
    // "Issue #10: " (11 chars) + 90 = 101 — reachable today
    const name = buildThreadName('Issue', 10, 'y'.repeat(90));
    expect(name.length).toBeLessThanOrEqual(DISCORD_THREAD_NAME_LIMIT);
    expect(name).toContain('Issue #10: ');
  });

  it('does not truncate when the full name exactly fits', () => {
    const title = 'z'.repeat(DISCORD_THREAD_NAME_LIMIT - 'PR #1: '.length);
    expect(buildThreadName('PR', 1, title)).toBe(`PR #1: ${title}`);
  });
});

describe('issue labels field cap', () => {
  function makeIssue(labels: string[]): IssueData {
    return {
      number: 42,
      title: 'Labeled issue',
      url: 'https://github.com/test/repo/issues/42',
      author: 'author',
      authorAvatar: 'https://avatar.url',
      state: 'open',
      labels,
      body: 'body',
      createdAt: '2024-01-01T00:00:00Z',
    };
  }

  it('60 labels of 20 chars stay within the 1024-char field limit', () => {
    const labels = Array.from({ length: 60 }, (_, i) => `label-${String(i).padStart(2, '0')}-${'x'.repeat(10)}`);
    const embed = buildIssueEmbed(makeIssue(labels)).toJSON();
    const labelsField = embed.fields?.find((f) => f.name === 'Labels');
    expect(labelsField).toBeDefined();
    expect(labelsField!.value.length).toBeLessThanOrEqual(DISCORD_FIELD_VALUE_LIMIT);
    expect(labelsField!.value).toMatch(/\+\d+ more/);
  });

  it('a handful of labels render unmodified', () => {
    const embed = buildIssueEmbed(makeIssue(['bug', 'help wanted'])).toJSON();
    const labelsField = embed.fields?.find((f) => f.name === 'Labels');
    expect(labelsField!.value).toBe('`bug` `help wanted`');
  });
});

describe('CI failure reply message cap', () => {
  it('5 failed steps with very long job/step names stay within 2000 chars', () => {
    const steps = Array.from({ length: 5 }, (_, i) => ({
      jobName: `matrix-job-${i}-${'a'.repeat(300)}`,
      stepName: `step-${i}-${'b'.repeat(300)}`,
    }));
    const reply = buildCiFailureReply(
      { status: 'failure', workflowName: 'CI', url: 'https://github.com/test/repo/actions/runs/1' },
      steps
    );
    expect(reply.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    expect(reply).toContain('Failed steps:');
  });

  it('normal step names are untouched', () => {
    const reply = buildCiFailureReply(
      { status: 'failure', workflowName: 'CI' },
      [{ jobName: 'build', stepName: 'npm test' }]
    );
    expect(reply).toContain('`build` > `npm test`');
  });
});
