import { describe, it, expect } from 'vitest';
import { buildPrEmbed, buildIssueEmbed, buildPrComponents, buildCiReply, buildCiFailureReply, CiStatus, parseFooterMetadata, extractRepoFromUrl, type PrFooterMetadata } from '../builders.js';
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

describe('footer metadata', () => {
  it('PR embed includes parseable footer with state metadata', () => {
    const embed = buildPrEmbed(
      {
        number: 42,
        title: 'Test PR',
        url: 'https://github.com/owner/repo/pull/42',
        author: 'user',
        authorUrl: 'https://github.com/user',
        branch: 'feat/test',
        baseBranch: 'main',
        additions: 10,
        deletions: 5,
        changedFiles: 3,
        state: 'open',
        draft: false,
        createdAt: new Date().toISOString(),
      },
      { status: 'success', workflowName: 'CI' },
      { copilot: 'reviewed', copilotComments: 3, agentReview: 'approved' }
    );

    const footerText = embed.data.footer?.text;
    expect(footerText).toBeDefined();
    expect(footerText).toMatch(/^repo-relay:v1:/);

    const meta = parseFooterMetadata(footerText!) as PrFooterMetadata;
    expect(meta).not.toBeNull();
    expect(meta.type).toBe('pr');
    expect(meta.pr).toBe(42);
    expect(meta.repo).toBe('owner/repo');
    expect(meta.ci).toBe('success');
    expect(meta.copilot).toBe('reviewed');
    expect(meta.copilotComments).toBe(3);
    expect(meta.agent).toBe('approved');
  });

  it('PR embed defaults to pending when no ci/reviews provided', () => {
    const embed = buildPrEmbed({
      number: 1,
      title: 'Test',
      url: 'https://github.com/owner/repo/pull/1',
      author: 'user',
      authorUrl: 'https://github.com/user',
      branch: 'feat',
      baseBranch: 'main',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      state: 'open',
      draft: false,
      createdAt: new Date().toISOString(),
    });

    const meta = parseFooterMetadata(embed.data.footer!.text) as PrFooterMetadata;
    expect(meta.ci).toBe('pending');
    expect(meta.copilot).toBe('pending');
    expect(meta.agent).toBe('pending');
  });

  it('issue embed includes parseable footer', () => {
    const embed = buildIssueEmbed({
      number: 10,
      title: 'Bug report',
      url: 'https://github.com/owner/repo/issues/10',
      author: 'user',
      state: 'open',
      labels: [],
      createdAt: new Date().toISOString(),
    });

    const footerText = embed.data.footer?.text;
    expect(footerText).toBeDefined();

    const meta = parseFooterMetadata(footerText!);
    expect(meta).not.toBeNull();
    expect(meta!.type).toBe('issue');
    if (meta!.type === 'issue') {
      expect(meta.issue).toBe(10);
      expect(meta.repo).toBe('owner/repo');
    }
  });

  it('parseFooterMetadata returns null for non-repo-relay footers', () => {
    expect(parseFooterMetadata('some random text')).toBeNull();
    expect(parseFooterMetadata('')).toBeNull();
  });

  it('parseFooterMetadata returns null for invalid JSON', () => {
    expect(parseFooterMetadata('repo-relay:v1:{invalid')).toBeNull();
  });
});

describe('extractRepoFromUrl', () => {
  it('extracts owner/repo from PR URL', () => {
    expect(extractRepoFromUrl('https://github.com/owner/repo/pull/42')).toBe('owner/repo');
  });

  it('extracts owner/repo from issue URL', () => {
    expect(extractRepoFromUrl('https://github.com/owner/repo/issues/10')).toBe('owner/repo');
  });

  it('returns null for non-GitHub URL', () => {
    expect(extractRepoFromUrl('https://example.com/foo/bar')).toBeNull();
  });

  it('returns null for bare GitHub URL without path', () => {
    expect(extractRepoFromUrl('https://github.com/')).toBeNull();
  });
});
