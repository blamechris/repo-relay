import { describe, it, expect } from 'vitest';
import { buildPrEmbed, buildIssueEmbed } from '../builders.js';

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
