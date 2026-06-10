import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateDb } from '../state.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'repo-relay-slim-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('event_log slimming', () => {
  it('logEvent does not persist the event payload', () => {
    // Full payloads (30-80KB each) grew the actions/cache artifact unboundedly
    // and put private-repo content at rest in the cache; Actions logs already
    // record every payload.
    const db = new StateDb('test/repo', dir);
    db.logEvent('test/repo', 1, 'pr.opened', { huge: 'x'.repeat(1000) });

    const events = db.getRecentEvents('test/repo', 1);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('pr.opened');
    expect(events[0].payload).toBeNull();
    db.close();
  });

  it('prunes event_log rows older than 30 days on open', () => {
    const db = new StateDb('test/repo', dir);
    db.logEvent('test/repo', 1, 'pr.opened', {});
    db.close();

    // Backdate the row well past the retention window
    const dbPath = join(dir, 'test-repo', 'state.db');
    const raw = new Database(dbPath);
    raw.exec("UPDATE event_log SET created_at = datetime('now', '-40 days')");
    raw.exec(`INSERT INTO event_log (repo, entity_number, event_type, payload, created_at)
              VALUES ('test/repo', 2, 'pr.recent', NULL, datetime('now', '-1 day'))`);
    raw.close();

    const reopened = new StateDb('test/repo', dir);
    expect(reopened.getRecentEvents('test/repo', 1)).toHaveLength(0);
    expect(reopened.getRecentEvents('test/repo', 2)).toHaveLength(1);
    reopened.close();
  });
});

describe('issue_data removal', () => {
  it('write-only issue_data methods no longer exist', () => {
    const db = new StateDb('test/repo', dir);
    expect((db as unknown as Record<string, unknown>).saveIssueData).toBeUndefined();
    expect((db as unknown as Record<string, unknown>).getIssueData).toBeUndefined();
    db.close();
  });
});
