import { describe, it, expect } from 'vitest';
import { buildPrEmbed, buildIssueEmbed, buildPrComponents, buildCiReply, buildCiFailureReply, CiStatus } from '../builders.js';
import { ButtonStyle } from 'discord.js';

describe('title truncation', () => {
  const longTitle = 'A'.repeat(300);

  it('truncates PR embed titles exceeding 256 characters', () => {
    const embed = buildPrEmbed({
      number: 1,
      title: longTitle,
      url: 'https://github.com/test/repo/pull/1',
      author: 'user',
      authorUrl: 'https://github.com/user',
      branch: 'feat/test',
      baseBranch: 'main',
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      state: 'open',
      draft: false,
      createdAt: new Date().toISOString(),
    });

    const title = embed.data.title!;
    expect(title.length).toBeLessThanOrEqual(256);
    expect(title).toMatch(/…$/);
  });

  it('does not truncate PR embed titles at or under 256 characters', () => {
    const embed = buildPrEmbed({
      number: 1,
      title: 'Short title',
      url: 'https://github.com/test/repo/pull/1',
      author: 'user',
      authorUrl: 'https://github.com/user',
      branch: 'feat/test',
      baseBranch: 'main',
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      state: 'open',
      draft: false,
      createdAt: new Date().toISOString(),
    });

    const title = embed.data.title!;
    expect(title).not.toMatch(/…$/);
    expect(title).toContain('Short title');
  });

  it('truncates issue embed titles exceeding 256 characters', () => {
    const embed = buildIssueEmbed({
      number: 1,
      title: longTitle,
      url: 'https://github.com/test/repo/issues/1',
      author: 'user',
      state: 'open',
      labels: [],
      createdAt: new Date().toISOString(),
    });

    const title = embed.data.title!;
    expect(title.length).toBeLessThanOrEqual(256);
    expect(title).toMatch(/…$/);
  });

  it('does not truncate issue embed titles at or under 256 characters', () => {
    const embed = buildIssueEmbed({
      number: 1,
      title: 'Short title',
      url: 'https://github.com/test/repo/issues/1',
      author: 'user',
      state: 'open',
      labels: [],
      createdAt: new Date().toISOString(),
    });

    const title = embed.data.title!;
    expect(title).not.toMatch(/…$/);
    expect(title).toContain('Short title');
  });
});

describe('buildPrComponents', () => {
  const prUrl = 'https://github.com/test/repo/pull/1';

  it('returns 2 buttons without ciUrl', () => {
    const row = buildPrComponents(prUrl);
    const components = row.components;
    expect(components).toHaveLength(2);
    expect(components[0].data).toMatchObject({
      label: 'View PR',
      style: ButtonStyle.Link,
      url: prUrl,
    });
    expect(components[1].data).toMatchObject({
      label: 'View Diff',
      style: ButtonStyle.Link,
      url: `${prUrl}/files`,
    });
  });

  it('returns 3 buttons with ciUrl', () => {
    const ciUrl = 'https://github.com/test/repo/actions/runs/123';
    const row = buildPrComponents(prUrl, ciUrl);
    const components = row.components;
    expect(components).toHaveLength(3);
    expect(components[2].data).toMatchObject({
      label: 'View CI',
      style: ButtonStyle.Link,
      url: ciUrl,
    });
  });
});

describe('buildCiFailureReply', () => {
  const ci: CiStatus = {
    status: 'failure',
    workflowName: 'CI',
    url: 'https://github.com/test/repo/actions/runs/123',
  };

  it('returns same as buildCiReply when no failed steps', () => {
    const result = buildCiFailureReply(ci, []);
    expect(result).toBe(buildCiReply(ci));
  });

  it('includes failed step names', () => {
    const steps = [
      { jobName: 'build', stepName: 'Run tests' },
      { jobName: 'lint', stepName: 'ESLint' },
    ];
    const result = buildCiFailureReply(ci, steps);
    expect(result).toContain('**Failed steps:**');
    expect(result).toContain('`build` > `Run tests`');
    expect(result).toContain('`lint` > `ESLint`');
  });

  it('truncates at 5 steps', () => {
    const steps = Array.from({ length: 7 }, (_, i) => ({
      jobName: `job${i}`,
      stepName: `step${i}`,
    }));
    const result = buildCiFailureReply(ci, steps);
    expect(result).toContain('`job4` > `step4`');
    expect(result).not.toContain('`job5`');
    expect(result).toContain('...and 2 more');
  });
});
