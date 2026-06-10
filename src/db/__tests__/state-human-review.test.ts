import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateDb } from '../state.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'repo-relay-human-review-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('human review status storage', () => {
  it('defaults to none with no reviewer login', () => {
    const db = new StateDb('test/repo', dir);
    db.savePrStatus('test/repo', 7);

    const status = db.getPrStatus('test/repo', 7);
    expect(status?.humanReviewStatus).toBe('none');
    expect(status?.humanReviewLogin).toBeNull();
    db.close();
  });

  it('round-trips approved status with reviewer login', () => {
    const db = new StateDb('test/repo', dir);
    db.updateHumanReviewStatus('test/repo', 7, 'approved', 'alice');

    const status = db.getPrStatus('test/repo', 7);
    expect(status?.humanReviewStatus).toBe('approved');
    expect(status?.humanReviewLogin).toBe('alice');
    db.close();
  });

  it('round-trips changes_requested and overwrites a prior verdict', () => {
    const db = new StateDb('test/repo', dir);
    db.updateHumanReviewStatus('test/repo', 7, 'approved', 'alice');
    db.updateHumanReviewStatus('test/repo', 7, 'changes_requested', 'bob');

    const status = db.getPrStatus('test/repo', 7);
    expect(status?.humanReviewStatus).toBe('changes_requested');
    expect(status?.humanReviewLogin).toBe('bob');
    db.close();
  });

  it('creates the pr_status row when none exists (upsert pattern)', () => {
    const db = new StateDb('test/repo', dir);
    expect(db.getPrStatus('test/repo', 99)).toBeNull();

    db.updateHumanReviewStatus('test/repo', 99, 'approved', 'carol');

    const status = db.getPrStatus('test/repo', 99);
    expect(status?.humanReviewStatus).toBe('approved');
    expect(status?.copilotStatus).toBe('pending');
    db.close();
  });
});

describe('pr_status migration on pre-existing databases', () => {
  it('adds human review columns to a DB created before the migration', () => {
    // Build a DB with the pre-#146 pr_status schema and an existing row,
    // exactly what a consumer's cached state.db looks like
    const repoDir = join(dir, 'test-repo');
    mkdirSync(repoDir, { recursive: true });
    const raw = new Database(join(repoDir, 'state.db'));
    raw.exec(`
      CREATE TABLE pr_status (
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        copilot_status TEXT DEFAULT 'pending',
        copilot_comments INTEGER DEFAULT 0,
        agent_review_status TEXT DEFAULT 'pending',
        ci_status TEXT DEFAULT 'pending',
        ci_workflow_name TEXT,
        ci_url TEXT,
        PRIMARY KEY (repo, pr_number)
      );
    `);
    raw.prepare(
      "INSERT INTO pr_status (repo, pr_number, copilot_status, ci_status) VALUES (?, ?, 'reviewed', 'success')"
    ).run('test/repo', 5);
    raw.close();

    const db = new StateDb('test/repo', dir);

    // Existing row survives with defaults applied
    const status = db.getPrStatus('test/repo', 5);
    expect(status?.copilotStatus).toBe('reviewed');
    expect(status?.ciStatus).toBe('success');
    expect(status?.humanReviewStatus).toBe('none');
    expect(status?.humanReviewLogin).toBeNull();

    // And the new columns are writable
    db.updateHumanReviewStatus('test/repo', 5, 'approved', 'alice');
    expect(db.getPrStatus('test/repo', 5)?.humanReviewStatus).toBe('approved');
    db.close();
  });

  it('is idempotent across reopen', () => {
    const first = new StateDb('test/repo', dir);
    first.updateHumanReviewStatus('test/repo', 1, 'approved', 'alice');
    first.close();

    const second = new StateDb('test/repo', dir);
    const status = second.getPrStatus('test/repo', 1);
    expect(status?.humanReviewStatus).toBe('approved');
    expect(status?.humanReviewLogin).toBe('alice');
    second.close();
  });
});
