/**
 * SQLite state management for PR ↔ Discord message mappings
 */
import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
export class StateDb {
    db;
    constructor(repo, stateDir) {
        const baseDir = stateDir ?? join(homedir(), '.repo-relay');
        const repoDir = join(baseDir, repo.replace('/', '-'));
        if (!existsSync(repoDir)) {
            mkdirSync(repoDir, { recursive: true });
        }
        const dbPath = join(repoDir, 'state.db');
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.initSchema();
    }
    initSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS pr_messages (
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (repo, pr_number)
      );

      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT NOT NULL,
        pr_number INTEGER,
        event_type TEXT,
        payload TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_event_log_repo_pr
        ON event_log(repo, pr_number);
    `);
    }
    getPrMessage(repo, prNumber) {
        const stmt = this.db.prepare(`
      SELECT repo, pr_number as prNumber, channel_id as channelId,
             message_id as messageId, created_at as createdAt,
             last_updated as lastUpdated
      FROM pr_messages
      WHERE repo = ? AND pr_number = ?
    `);
        return stmt.get(repo, prNumber) ?? null;
    }
    savePrMessage(repo, prNumber, channelId, messageId) {
        const stmt = this.db.prepare(`
      INSERT INTO pr_messages (repo, pr_number, channel_id, message_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(repo, pr_number) DO UPDATE SET
        message_id = excluded.message_id,
        channel_id = excluded.channel_id,
        last_updated = CURRENT_TIMESTAMP
    `);
        stmt.run(repo, prNumber, channelId, messageId);
    }
    updatePrMessageTimestamp(repo, prNumber) {
        const stmt = this.db.prepare(`
      UPDATE pr_messages
      SET last_updated = CURRENT_TIMESTAMP
      WHERE repo = ? AND pr_number = ?
    `);
        stmt.run(repo, prNumber);
    }
    deletePrMessage(repo, prNumber) {
        const stmt = this.db.prepare(`
      DELETE FROM pr_messages
      WHERE repo = ? AND pr_number = ?
    `);
        stmt.run(repo, prNumber);
    }
    logEvent(repo, prNumber, eventType, payload) {
        const stmt = this.db.prepare(`
      INSERT INTO event_log (repo, pr_number, event_type, payload)
      VALUES (?, ?, ?, ?)
    `);
        stmt.run(repo, prNumber, eventType, JSON.stringify(payload));
    }
    getRecentEvents(repo, prNumber, limit = 50) {
        let query = `
      SELECT id, repo, pr_number as prNumber, event_type as eventType,
             payload, created_at as createdAt
      FROM event_log
      WHERE repo = ?
    `;
        const params = [repo];
        if (prNumber !== undefined) {
            query += ' AND pr_number = ?';
            params.push(prNumber);
        }
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);
        const stmt = this.db.prepare(query);
        return stmt.all(...params);
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=state.js.map