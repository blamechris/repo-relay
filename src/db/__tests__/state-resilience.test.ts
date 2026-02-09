import { describe, it, expect, afterEach, vi } from 'vitest';
import { StateDb } from '../state.js';
import { rmSync, mkdtempSync, existsSync, writeFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('StateDb resilience', () => {
  let tmpDir: string;
  let db: StateDb | null = null;

  function createDb(repo: string) {
    tmpDir = mkdtempSync(join(tmpdir(), 'repo-relay-test-'));
    db = new StateDb(repo, tmpDir);
    return db;
  }

  afterEach(() => {
    db?.close();
    db = null;
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('close() checkpoints WAL so WAL file is empty or absent', () => {
    const d = createDb('test/repo');
    d.savePrMessage('test/repo', 1, 'ch1', 'msg1');
    d.close();
    db = null; // prevent double-close in afterEach

    const walPath = join(tmpDir, 'test-repo', 'state.db-wal');
    if (existsSync(walPath)) {
      const size = statSync(walPath).size;
      expect(size).toBe(0);
    }
    // If WAL file doesn't exist at all, that's also fine
  });

  it('integrity check passes on clean DB', () => {
    const d = createDb('test/repo');
    // DB should be usable — save and retrieve data
    d.savePrMessage('test/repo', 1, 'ch1', 'msg1');
    const result = d.getPrMessage('test/repo', 1);
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe('msg1');
  });

  it('corrupt DB is auto-recreated', () => {
    // Create the directory structure first with a valid DB, then close it
    tmpDir = mkdtempSync(join(tmpdir(), 'repo-relay-test-'));
    const validDb = new StateDb('test/repo', tmpDir);
    validDb.savePrMessage('test/repo', 1, 'ch1', 'msg1');
    validDb.close();

    // Corrupt the DB file
    const dbPath = join(tmpDir, 'test-repo', 'state.db');
    writeFileSync(dbPath, 'this is not a valid sqlite database');

    // Constructing a new StateDb should recover
    db = new StateDb('test/repo', tmpDir);

    // DB should be functional (old data is gone, but we can write new data)
    db.savePrMessage('test/repo', 2, 'ch2', 'msg2');
    const result = db.getPrMessage('test/repo', 2);
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe('msg2');

    // Old data should not exist (DB was recreated)
    const oldResult = db.getPrMessage('test/repo', 1);
    expect(oldResult).toBeNull();
  });

  it('recreated DB logs warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      tmpDir = mkdtempSync(join(tmpdir(), 'repo-relay-test-'));
      const validDb = new StateDb('test/repo', tmpDir);
      validDb.close();

      // Corrupt the DB file
      const dbPath = join(tmpDir, 'test-repo', 'state.db');
      writeFileSync(dbPath, 'this is not a valid sqlite database');

      db = new StateDb('test/repo', tmpDir);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('integrity check failed')
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
