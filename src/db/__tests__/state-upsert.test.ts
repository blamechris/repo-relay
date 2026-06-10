import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateDb, type StoredPrData } from '../state.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dir: string;
let db: StateDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'repo-relay-upsert-'));
  db = new StateDb('test/repo', dir);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function prData(overrides: Partial<StoredPrData> = {}): StoredPrData {
  return {
    repo: 'test/repo',
    prNumber: 7,
    title: 'Add feature',
    url: 'https://github.com/test/repo/pull/7',
    author: 'author',
    authorUrl: 'https://github.com/author',
    authorAvatar: null,
    branch: 'feat/x',
    baseBranch: 'develop',
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    state: 'open',
    draft: false,
    prCreatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('savePrData upsert', () => {
  it('a retargeted PR updates base_branch (was frozen at first save forever)', () => {
    db.savePrData(prData({ baseBranch: 'develop' }));
    db.savePrData(prData({ baseBranch: 'main' }));

    expect(db.getPrData('test/repo', 7)?.baseBranch).toBe('main');
  });

  it('a renamed head branch updates too', () => {
    db.savePrData(prData({ branch: 'feat/x' }));
    db.savePrData(prData({ branch: 'feat/x-renamed' }));

    expect(db.getPrData('test/repo', 7)?.branch).toBe('feat/x-renamed');
  });

  it('title/state/draft updates still work as before', () => {
    db.savePrData(prData({ title: 'Old', state: 'open', draft: true }));
    db.savePrData(prData({ title: 'New', state: 'merged', draft: false }));

    const stored = db.getPrData('test/repo', 7);
    expect(stored?.title).toBe('New');
    expect(stored?.state).toBe('merged');
    expect(stored?.draft).toBe(false);
  });
});
