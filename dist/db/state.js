/**
 * SQLite state management for PR/Issue ↔ Discord message mappings
 */
import Database from 'better-sqlite3';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
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
        // Verify database integrity (catches corruption from incomplete cache restore)
        let integrityOk = false;
        let integrityDetail = 'unreadable';
        try {
            const integrityResult = this.db.pragma('integrity_check');
            const result = integrityResult[0]?.integrity_check;
            integrityOk = result === 'ok';
            if (!integrityOk)
                integrityDetail = result ?? 'unknown';
        }
        catch {
            // Completely corrupt file — pragma itself throws
        }
        if (!integrityOk) {
            console.warn(`[repo-relay] Database integrity check failed (${integrityDetail}), recreating...`);
            this.db.close();
            for (const suffix of ['', '-wal', '-shm']) {
                try {
                    unlinkSync(dbPath + suffix);
                }
                catch { /* may not exist */ }
            }
            this.db = new Database(dbPath);
        }
        this.db.pragma('journal_mode = WAL');
        this.runMigrations();
        this.initSchema();
    }
    runMigrations() {
        // Migration: Add thread_id column if it doesn't exist
        // Guard: table may not exist yet on a fresh DB (initSchema runs after)
        const prColumns = this.db.prepare("PRAGMA table_info(pr_messages)").all();
        if (prColumns.length > 0 && !prColumns.some(col => col.name === 'thread_id')) {
            console.log('[repo-relay] Running migration: Adding thread_id column to pr_messages');
            this.db.exec("ALTER TABLE pr_messages ADD COLUMN thread_id TEXT");
        }
        // Migration: Rename event_log.pr_number → entity_number
        // Must run before initSchema so the index on entity_number can be created
        const eventColumns = this.db.prepare("PRAGMA table_info(event_log)").all();
        if (eventColumns.length > 0 && eventColumns.some(col => col.name === 'pr_number')) {
            console.log('[repo-relay] Running migration: Renaming event_log.pr_number to entity_number');
            this.db.exec("ALTER TABLE event_log RENAME COLUMN pr_number TO entity_number");
            this.db.exec("DROP INDEX IF EXISTS idx_event_log_repo_pr");
            this.db.exec("CREATE INDEX IF NOT EXISTS idx_event_log_repo_entity ON event_log(repo, entity_number)");
        }
    }
    initSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS pr_messages (
        repo TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        thread_id TEXT,
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

      CREATE TABLE IF NOT EXISTS issue_messages (
        repo TEXT NOT NULL,
        issue_number INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        thread_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (repo, issue_number)
      );

      CREATE TABLE IF NOT EXISTS issue_data (
        repo TEXT NOT NULL,
        issue_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        author TEXT NOT NULL,
        author_avatar TEXT,
        state TEXT DEFAULT 'open',
        state_reason TEXT,
        labels TEXT DEFAULT '[]',
        body TEXT,
        issue_created_at TEXT NOT NULL,
        PRIMARY KEY (repo, issue_number)
      );

      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT NOT NULL,
        entity_number INTEGER,
        event_type TEXT,
        payload TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_event_log_repo_entity
        ON event_log(repo, entity_number);
    `);
    }
    getPrMessage(repo, prNumber) {
        const stmt = this.db.prepare(`
      SELECT repo, pr_number as prNumber, channel_id as channelId,
             message_id as messageId, thread_id as threadId,
             created_at as createdAt, last_updated as lastUpdated
      FROM pr_messages
      WHERE repo = ? AND pr_number = ?
    `);
        return stmt.get(repo, prNumber) ?? null;
    }
    savePrMessage(repo, prNumber, channelId, messageId, threadId) {
        const stmt = this.db.prepare(`
      INSERT INTO pr_messages (repo, pr_number, channel_id, message_id, thread_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(repo, pr_number) DO UPDATE SET
        message_id = excluded.message_id,
        channel_id = excluded.channel_id,
        thread_id = excluded.thread_id,
        last_updated = CURRENT_TIMESTAMP
    `);
        stmt.run(repo, prNumber, channelId, messageId, threadId ?? null);
    }
    updatePrThread(repo, prNumber, threadId) {
        const stmt = this.db.prepare(`
      UPDATE pr_messages
      SET thread_id = ?, last_updated = CURRENT_TIMESTAMP
      WHERE repo = ? AND pr_number = ?
    `);
        stmt.run(threadId, repo, prNumber);
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
    getOpenPrNumbers(repo) {
        const stmt = this.db.prepare('SELECT pr_number FROM pr_data WHERE repo = ? AND state = ? ORDER BY pr_number ASC');
        return stmt.all(repo, 'open').map(r => r.pr_number);
    }
    getIssueMessage(repo, issueNumber) {
        const stmt = this.db.prepare(`
      SELECT repo, issue_number as issueNumber, channel_id as channelId,
             message_id as messageId, thread_id as threadId,
             created_at as createdAt, last_updated as lastUpdated
      FROM issue_messages
      WHERE repo = ? AND issue_number = ?
    `);
        return stmt.get(repo, issueNumber) ?? null;
    }
    saveIssueMessage(repo, issueNumber, channelId, messageId, threadId) {
        const stmt = this.db.prepare(`
      INSERT INTO issue_messages (repo, issue_number, channel_id, message_id, thread_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(repo, issue_number) DO UPDATE SET
        message_id = excluded.message_id,
        channel_id = excluded.channel_id,
        thread_id = excluded.thread_id,
        last_updated = CURRENT_TIMESTAMP
    `);
        stmt.run(repo, issueNumber, channelId, messageId, threadId ?? null);
    }
    updateIssueThread(repo, issueNumber, threadId) {
        const stmt = this.db.prepare(`
      UPDATE issue_messages
      SET thread_id = ?, last_updated = CURRENT_TIMESTAMP
      WHERE repo = ? AND issue_number = ?
    `);
        stmt.run(threadId, repo, issueNumber);
    }
    updateIssueMessageTimestamp(repo, issueNumber) {
        const stmt = this.db.prepare(`
      UPDATE issue_messages
      SET last_updated = CURRENT_TIMESTAMP
      WHERE repo = ? AND issue_number = ?
    `);
        stmt.run(repo, issueNumber);
    }
    deleteIssueMessage(repo, issueNumber) {
        const stmt = this.db.prepare(`
      DELETE FROM issue_messages
      WHERE repo = ? AND issue_number = ?
    `);
        stmt.run(repo, issueNumber);
    }
    getIssueData(repo, issueNumber) {
        const stmt = this.db.prepare(`
      SELECT repo, issue_number as issueNumber, title, url, author,
             author_avatar as authorAvatar, state, state_reason as stateReason,
             labels, body, issue_created_at as issueCreatedAt
      FROM issue_data
      WHERE repo = ? AND issue_number = ?
    `);
        return stmt.get(repo, issueNumber) ?? null;
    }
    saveIssueData(data) {
        const stmt = this.db.prepare(`
      INSERT INTO issue_data (repo, issue_number, title, url, author,
                             author_avatar, state, state_reason, labels,
                             body, issue_created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repo, issue_number) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        state = excluded.state,
        state_reason = excluded.state_reason,
        labels = excluded.labels,
        body = excluded.body
    `);
        stmt.run(data.repo, data.issueNumber, data.title, data.url, data.author, data.authorAvatar, data.state, data.stateReason, data.labels, data.body, data.issueCreatedAt);
    }
    logEvent(repo, entityNumber, eventType, payload) {
        const stmt = this.db.prepare(`
      INSERT INTO event_log (repo, entity_number, event_type, payload)
      VALUES (?, ?, ?, ?)
    `);
        stmt.run(repo, entityNumber, eventType, JSON.stringify(payload));
    }
    getRecentEvents(repo, entityNumber, limit = 50) {
        let query = `
      SELECT id, repo, entity_number as entityNumber, event_type as eventType,
             payload, created_at as createdAt
      FROM event_log
      WHERE repo = ?
    `;
        const params = [repo];
        if (entityNumber !== undefined) {
            query += ' AND entity_number = ?';
            params.push(entityNumber);
        }
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);
        const stmt = this.db.prepare(query);
        return stmt.all(...params);
    }
    close() {
        try {
            this.db.pragma('wal_checkpoint(TRUNCATE)');
        }
        catch {
            // Checkpoint can fail if DB is already closed or not in WAL mode
        }
        finally {
            this.db.close();
        }
    }
}
//# sourceMappingURL=state.js.map