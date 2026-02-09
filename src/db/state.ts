/**
 * SQLite state management for PR/Issue ↔ Discord message mappings
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface PrMessage {
  repo: string;
  prNumber: number;
  channelId: string;
  messageId: string;
  threadId: string | null;
  createdAt: string;
  lastUpdated: string;
}

export interface StoredPrData {
  repo: string;
  prNumber: number;
  title: string;
  url: string;
  author: string;
  authorUrl: string;
  authorAvatar: string | null;
  branch: string;
  baseBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  state: string;
  draft: boolean;
  prCreatedAt: string;
}

export interface PrStatus {
  repo: string;
  prNumber: number;
  copilotStatus: 'pending' | 'reviewed';
  copilotComments: number;
  agentReviewStatus: 'pending' | 'approved' | 'changes_requested' | 'none';
  ciStatus: 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
  ciWorkflowName: string | null;
  ciUrl: string | null;
}

export interface IssueMessage {
  repo: string;
  issueNumber: number;
  channelId: string;
  messageId: string;
  threadId: string | null;
  createdAt: string;
  lastUpdated: string;
}

export interface StoredIssueData {
  repo: string;
  issueNumber: number;
  title: string;
  url: string;
  author: string;
  authorAvatar: string | null;
  state: string;
  stateReason: string | null;
  labels: string;
  body: string | null;
  issueCreatedAt: string;
}

export interface EventLogEntry {
  id: number;
  repo: string;
  entityNumber: number | null;
  eventType: string;
  payload: string;
  createdAt: string;
}

export class StateDb {
  private db: Database.Database;

  constructor(repo: string, stateDir?: string) {
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
    this.runMigrations();
  }

  private runMigrations(): void {
    // Migration: Add thread_id column if it doesn't exist
    const prColumns = this.db.prepare("PRAGMA table_info(pr_messages)").all() as Array<{ name: string }>;
    const hasThreadId = prColumns.some(col => col.name === 'thread_id');
    if (!hasThreadId) {
      console.log('[repo-relay] Running migration: Adding thread_id column to pr_messages');
      this.db.exec("ALTER TABLE pr_messages ADD COLUMN thread_id TEXT");
    }

    // Migration: Rename event_log.pr_number → entity_number
    const eventColumns = this.db.prepare("PRAGMA table_info(event_log)").all() as Array<{ name: string }>;
    const hasPrNumber = eventColumns.some(col => col.name === 'pr_number');
    if (hasPrNumber) {
      console.log('[repo-relay] Running migration: Renaming event_log.pr_number to entity_number');
      this.db.exec("ALTER TABLE event_log RENAME COLUMN pr_number TO entity_number");
      this.db.exec("DROP INDEX IF EXISTS idx_event_log_repo_pr");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_event_log_repo_entity ON event_log(repo, entity_number)");
    }
  }

  private initSchema(): void {
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

  getPrMessage(repo: string, prNumber: number): PrMessage | null {
    const stmt = this.db.prepare(`
      SELECT repo, pr_number as prNumber, channel_id as channelId,
             message_id as messageId, thread_id as threadId,
             created_at as createdAt, last_updated as lastUpdated
      FROM pr_messages
      WHERE repo = ? AND pr_number = ?
    `);
    return (stmt.get(repo, prNumber) as PrMessage) ?? null;
  }

  savePrMessage(
    repo: string,
    prNumber: number,
    channelId: string,
    messageId: string,
    threadId?: string
  ): void {
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

  updatePrThread(repo: string, prNumber: number, threadId: string): void {
    const stmt = this.db.prepare(`
      UPDATE pr_messages
      SET thread_id = ?, last_updated = CURRENT_TIMESTAMP
      WHERE repo = ? AND pr_number = ?
    `);
    stmt.run(threadId, repo, prNumber);
  }

  updatePrMessageTimestamp(repo: string, prNumber: number): void {
    const stmt = this.db.prepare(`
      UPDATE pr_messages
      SET last_updated = CURRENT_TIMESTAMP
      WHERE repo = ? AND pr_number = ?
    `);
    stmt.run(repo, prNumber);
  }

  deletePrMessage(repo: string, prNumber: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM pr_messages
      WHERE repo = ? AND pr_number = ?
    `);
    stmt.run(repo, prNumber);
  }

  getPrStatus(repo: string, prNumber: number): PrStatus | null {
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
    return (stmt.get(repo, prNumber) as PrStatus) ?? null;
  }

  savePrStatus(repo: string, prNumber: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO pr_status (repo, pr_number)
      VALUES (?, ?)
      ON CONFLICT(repo, pr_number) DO NOTHING
    `);
    stmt.run(repo, prNumber);
  }

  updateCopilotStatus(
    repo: string,
    prNumber: number,
    status: 'pending' | 'reviewed',
    comments: number
  ): void {
    this.savePrStatus(repo, prNumber);
    const stmt = this.db.prepare(`
      UPDATE pr_status
      SET copilot_status = ?, copilot_comments = ?
      WHERE repo = ? AND pr_number = ?
    `);
    stmt.run(status, comments, repo, prNumber);
  }

  updateAgentReviewStatus(
    repo: string,
    prNumber: number,
    status: 'pending' | 'approved' | 'changes_requested' | 'none'
  ): void {
    this.savePrStatus(repo, prNumber);
    const stmt = this.db.prepare(`
      UPDATE pr_status
      SET agent_review_status = ?
      WHERE repo = ? AND pr_number = ?
    `);
    stmt.run(status, repo, prNumber);
  }

  updateCiStatus(
    repo: string,
    prNumber: number,
    status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled',
    workflowName?: string,
    url?: string
  ): void {
    this.savePrStatus(repo, prNumber);
    const stmt = this.db.prepare(`
      UPDATE pr_status
      SET ci_status = ?, ci_workflow_name = ?, ci_url = ?
      WHERE repo = ? AND pr_number = ?
    `);
    stmt.run(status, workflowName ?? null, url ?? null, repo, prNumber);
  }

  getPrData(repo: string, prNumber: number): StoredPrData | null {
    const stmt = this.db.prepare(`
      SELECT repo, pr_number as prNumber, title, url, author,
             author_url as authorUrl, author_avatar as authorAvatar,
             branch, base_branch as baseBranch, additions, deletions,
             changed_files as changedFiles, state, draft,
             pr_created_at as prCreatedAt
      FROM pr_data
      WHERE repo = ? AND pr_number = ?
    `);
    // SQLite returns draft as integer (0/1), need to convert to boolean
    interface DbRow {
      repo: string;
      prNumber: number;
      title: string;
      url: string;
      author: string;
      authorUrl: string;
      authorAvatar: string | null;
      branch: string;
      baseBranch: string;
      additions: number;
      deletions: number;
      changedFiles: number;
      state: string;
      draft: number;
      prCreatedAt: string;
    }
    const row = stmt.get(repo, prNumber) as DbRow | undefined;
    if (!row) return null;
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

  savePrData(data: StoredPrData): void {
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
    stmt.run(
      data.repo, data.prNumber, data.title, data.url, data.author,
      data.authorUrl, data.authorAvatar, data.branch, data.baseBranch,
      data.additions, data.deletions, data.changedFiles, data.state,
      data.draft ? 1 : 0, data.prCreatedAt
    );
  }

  getOpenPrNumbers(repo: string): number[] {
    const stmt = this.db.prepare(
      'SELECT pr_number FROM pr_data WHERE repo = ? AND state = ?'
    );
    return (stmt.all(repo, 'open') as Array<{ pr_number: number }>).map(r => r.pr_number);
  }

  getIssueMessage(repo: string, issueNumber: number): IssueMessage | null {
    const stmt = this.db.prepare(`
      SELECT repo, issue_number as issueNumber, channel_id as channelId,
             message_id as messageId, thread_id as threadId,
             created_at as createdAt, last_updated as lastUpdated
      FROM issue_messages
      WHERE repo = ? AND issue_number = ?
    `);
    return (stmt.get(repo, issueNumber) as IssueMessage) ?? null;
  }

  saveIssueMessage(
    repo: string,
    issueNumber: number,
    channelId: string,
    messageId: string,
    threadId?: string
  ): void {
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

  updateIssueThread(repo: string, issueNumber: number, threadId: string): void {
    const stmt = this.db.prepare(`
      UPDATE issue_messages
      SET thread_id = ?, last_updated = CURRENT_TIMESTAMP
      WHERE repo = ? AND issue_number = ?
    `);
    stmt.run(threadId, repo, issueNumber);
  }

  updateIssueMessageTimestamp(repo: string, issueNumber: number): void {
    const stmt = this.db.prepare(`
      UPDATE issue_messages
      SET last_updated = CURRENT_TIMESTAMP
      WHERE repo = ? AND issue_number = ?
    `);
    stmt.run(repo, issueNumber);
  }

  deleteIssueMessage(repo: string, issueNumber: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM issue_messages
      WHERE repo = ? AND issue_number = ?
    `);
    stmt.run(repo, issueNumber);
  }

  getIssueData(repo: string, issueNumber: number): StoredIssueData | null {
    const stmt = this.db.prepare(`
      SELECT repo, issue_number as issueNumber, title, url, author,
             author_avatar as authorAvatar, state, state_reason as stateReason,
             labels, body, issue_created_at as issueCreatedAt
      FROM issue_data
      WHERE repo = ? AND issue_number = ?
    `);
    return (stmt.get(repo, issueNumber) as StoredIssueData) ?? null;
  }

  saveIssueData(data: StoredIssueData): void {
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
    stmt.run(
      data.repo, data.issueNumber, data.title, data.url, data.author,
      data.authorAvatar, data.state, data.stateReason, data.labels,
      data.body, data.issueCreatedAt
    );
  }

  logEvent(
    repo: string,
    entityNumber: number | null,
    eventType: string,
    payload: object
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO event_log (repo, entity_number, event_type, payload)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(repo, entityNumber, eventType, JSON.stringify(payload));
  }

  getRecentEvents(
    repo: string,
    entityNumber?: number,
    limit = 50
  ): EventLogEntry[] {
    let query = `
      SELECT id, repo, entity_number as entityNumber, event_type as eventType,
             payload, created_at as createdAt
      FROM event_log
      WHERE repo = ?
    `;
    const params: (string | number)[] = [repo];

    if (entityNumber !== undefined) {
      query += ' AND entity_number = ?';
      params.push(entityNumber);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as EventLogEntry[];
  }

  close(): void {
    this.db.close();
  }
}
