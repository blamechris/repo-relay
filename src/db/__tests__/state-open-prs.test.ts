import { describe, it, expect, afterEach } from 'vitest';
import { StateDb, type StoredPrData } from '../state.js';
import { unlinkSync, rmSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function makePrData(repo: string, prNumber: number, state: string): StoredPrData {
  return {
    repo,
    prNumber,
    title: `PR #${prNumber}`,
    url: `https://github.com/${repo}/pull/${prNumber}`,
    author: 'test-user',
    authorUrl: `https://github.com/test-user`,
    authorAvatar: null,
    branch: 'feature',
    baseBranch: 'main',
    additions: 10,
    deletions: 5,
    changedFiles: 2,
    state,
    draft: false,
    prCreatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('StateDb.getOpenPrNumbers', () => {
  let tmpDir: string;
  let db: StateDb;

  function createDb(repo: string) {
    tmpDir = mkdtempSync(join(tmpdir(), 'repo-relay-test-'));
    db = new StateDb(repo, tmpDir);
    return db;
  }

  afterEach(() => {
    db?.close();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns PR numbers where state is open', () => {
    const db = createDb('test/repo');
    db.savePrData(makePrData('test/repo', 1, 'open'));
    db.savePrData(makePrData('test/repo', 2, 'open'));
    db.savePrData(makePrData('test/repo', 3, 'open'));

    const result = db.getOpenPrNumbers('test/repo');
    expect(result).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(result).toHaveLength(3);
  });

  it('excludes closed and merged PRs', () => {
    const db = createDb('test/repo');
    db.savePrData(makePrData('test/repo', 1, 'open'));
    db.savePrData(makePrData('test/repo', 2, 'closed'));
    db.savePrData(makePrData('test/repo', 3, 'merged'));

    const result = db.getOpenPrNumbers('test/repo');
    expect(result).toEqual([1]);
  });

  it('returns empty array when no open PRs exist', () => {
    const db = createDb('test/repo');
    db.savePrData(makePrData('test/repo', 1, 'closed'));

    const result = db.getOpenPrNumbers('test/repo');
    expect(result).toEqual([]);
  });

  it('returns empty array when no PRs exist at all', () => {
    const db = createDb('test/repo');

    const result = db.getOpenPrNumbers('test/repo');
    expect(result).toEqual([]);
  });

  it('scopes results to the given repo', () => {
    const db = createDb('test/repo');
    db.savePrData(makePrData('test/repo', 1, 'open'));
    db.savePrData(makePrData('other/repo', 2, 'open'));

    const result = db.getOpenPrNumbers('test/repo');
    expect(result).toEqual([1]);

    const otherResult = db.getOpenPrNumbers('other/repo');
    expect(otherResult).toEqual([2]);
  });
});
