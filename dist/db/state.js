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
        // Expand ~ to actual home directory (GitHub Actions doesn't expand ~)
        let baseDir = stateDir ?? join(homedir(), '.repo-relay');
        if (baseDir.startsWith('~')) {
            baseDir = baseDir.replace('~', homedir());
        }
        const repoDir = join(baseDir, repo.replace('/', '-'));
        console.log(`[repo-relay] Using state directory: ${repoDir}`);
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

      CREATE TABLE IF NOT EXISTS pr_status (
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

      CREATE TABLE IF NOT EXISTS pr_data (
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        author TEXT NOT NULL,
        author_url TEXT NOT NULL,
        author_avatar TEXT,
        branch TEXT NOT NULL,
        base_branch TEXT NOT NULL,
        additions INTEGER DEFAULT 0,
        deletions INTEGER DEFAULT 0,
        changed_files INTEGER DEFAULT 0,
        state TEXT DEFAULT 'open',
        draft INTEGER DEFAULT 0,
        pr_created_at TEXT NOT NULL,
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
    getPrStatus(repo, prNumber) {
        const stmt = this.db.prepare(`
      SELECT repo, pr_number as prNumber,
             copilot_status as copilotStatus,
             copilot_comments as copilotComments,
             agent_review_status as agentReviewStatus,
             ci_status as ciStatus,
             ci_workflow_name as ciWorkflowName,
             ci_url as ciUrl
      FROM pr_status
      WHERE repo = ? AND pr_number = ?
    `);
        return stmt.get(repo, prNumber) ?? null;
    }
    savePrStatus(repo, prNumber) {
        const stmt = this.db.prepare(`
      INSERT INTO pr_status (repo, pr_number)
      VALUES (?, ?)
      ON CONFLICT(repo, pr_number) DO NOTHING
    `);
        stmt.run(repo, prNumber);
    }
    updateCopilotStatus(repo, prNumber, status, comments) {
        this.savePrStatus(repo, prNumber);
        const stmt = this.db.prepare(`
      UPDATE pr_status
      SET copilot_status = ?, copilot_comments = ?
      WHERE repo = ? AND pr_number = ?
    `);
        stmt.run(status, comments, repo, prNumber);
    }
    updateAgentReviewStatus(repo, prNumber, status) {
        this.savePrStatus(repo, prNumber);
        const stmt = this.db.prepare(`
      UPDATE pr_status
      SET agent_review_status = ?
      WHERE repo = ? AND pr_number = ?
    `);
        stmt.run(status, repo, prNumber);
    }
    updateCiStatus(repo, prNumber, status, workflowName, url) {
        this.savePrStatus(repo, prNumber);
        const stmt = this.db.prepare(`
      UPDATE pr_status
      SET ci_status = ?, ci_workflow_name = ?, ci_url = ?
      WHERE repo = ? AND pr_number = ?
    `);
        stmt.run(status, workflowName ?? null, url ?? null, repo, prNumber);
    }
    getPrData(repo, prNumber) {
        const stmt = this.db.prepare(`
      SELECT repo, pr_number as prNumber, title, url, author,
             author_url as authorUrl, author_avatar as authorAvatar,
             branch, base_branch as baseBranch, additions, deletions,
             changed_files as changedFiles, state, draft,
             pr_created_at as prCreatedAt
      FROM pr_data
      WHERE repo = ? AND pr_number = ?
    `);
        const row = stmt.get(repo, prNumber);
        if (!row)
            return null;
        return {
            repo: row.repo,
            prNumber: row.prNumber,
            title: row.title,
            url: row.url,
            author: row.author,
            authorUrl: row.authorUrl,
            authorAvatar: row.authorAvatar,
            branch: row.branch,
            baseBranch: row.baseBranch,
            additions: row.additions,
            deletions: row.deletions,
            changedFiles: row.changedFiles,
            state: row.state,
            draft: Boolean(row.draft),
            prCreatedAt: row.prCreatedAt,
        };
    }
    savePrData(data) {
        const stmt = this.db.prepare(`
      INSERT INTO pr_data (repo, pr_number, title, url, author, author_url,
                          author_avatar, branch, base_branch, additions,
                          deletions, changed_files, state, draft, pr_created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo, pr_number) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        additions = excluded.additions,
        deletions = excluded.deletions,
        changed_files = excluded.changed_files,
        state = excluded.state,
        draft = excluded.draft
    `);
        stmt.run(data.repo, data.prNumber, data.title, data.url, data.author, data.authorUrl, data.authorAvatar, data.branch, data.baseBranch, data.additions, data.deletions, data.changedFiles, data.state, data.draft ? 1 : 0, data.prCreatedAt);
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