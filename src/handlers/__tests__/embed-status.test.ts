import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildEmbedWithStatus } from '../pr.js';
import { StateDb } from '../../db/state.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * buildEmbedWithStatus maps DB status rows onto the ReviewStatus/CiStatus
 * shapes the embed builder consumes — verified against a real StateDb.
 */

let dir: string;
let db: StateDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'repo-relay-embed-status-'));
  db = new StateDb('test/repo', dir);
  db.savePrData({
    repo: 'test/repo',
    prNumber: 7,
    title: 'Add feature',
    url: 'https://github.com/test/repo/pull/7',
    author: 'author',
    authorUrl: 'https://github.com/author',
    authorAvatar: null,
    branch: 'feat/x',
    baseBranch: 'main',
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    state: 'open',
    draft: false,
    prCreatedAt: '2024-01-01T00:00:00Z',
  });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('buildEmbedWithStatus human review mapping (#146)', () => {
  it('defaults to none with no reviewer when no human review exists', () => {
    db.savePrStatus('test/repo', 7);

    const result = buildEmbedWithStatus(db, 'test/repo', 7);
    expect(result?.reviews.humanReview).toBe('none');
    expect(result?.reviews.humanReviewer).toBeUndefined();
  });

  it('maps a stored human verdict and reviewer login', () => {
    db.updateHumanReviewStatus('test/repo', 7, 'changes_requested', 'alice');

    const result = buildEmbedWithStatus(db, 'test/repo', 7);
    expect(result?.reviews.humanReview).toBe('changes_requested');
    expect(result?.reviews.humanReviewer).toBe('alice');
  });

  it('defaults to none when no status row exists at all', () => {
    const result = buildEmbedWithStatus(db, 'test/repo', 7);
    expect(result?.reviews.humanReview).toBe('none');
  });
});
