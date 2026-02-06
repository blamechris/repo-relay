/**
 * SQLite state management for PR/Issue ↔ Discord message mappings
 */
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
    prNumber: number | null;
    eventType: string;
    payload: string;
    createdAt: string;
}
export declare class StateDb {
    private db;
    constructor(repo: string, stateDir?: string);
    private runMigrations;
    private initSchema;
    getPrMessage(repo: string, prNumber: number): PrMessage | null;
    savePrMessage(repo: string, prNumber: number, channelId: string, messageId: string, threadId?: string): void;
    updatePrThread(repo: string, prNumber: number, threadId: string): void;
    updatePrMessageTimestamp(repo: string, prNumber: number): void;
    deletePrMessage(repo: string, prNumber: number): void;
    getPrStatus(repo: string, prNumber: number): PrStatus | null;
    savePrStatus(repo: string, prNumber: number): void;
    updateCopilotStatus(repo: string, prNumber: number, status: 'pending' | 'reviewed', comments: number): void;
    updateAgentReviewStatus(repo: string, prNumber: number, status: 'pending' | 'approved' | 'changes_requested' | 'none'): void;
    updateCiStatus(repo: string, prNumber: number, status: 'pending' | 'running' | 'success' | 'failure' | 'cancelled', workflowName?: string, url?: string): void;
    getPrData(repo: string, prNumber: number): StoredPrData | null;
    savePrData(data: StoredPrData): void;
    getIssueMessage(repo: string, issueNumber: number): IssueMessage | null;
    saveIssueMessage(repo: string, issueNumber: number, channelId: string, messageId: string, threadId?: string): void;
    updateIssueThread(repo: string, issueNumber: number, threadId: string): void;
    updateIssueMessageTimestamp(repo: string, issueNumber: number): void;
    deleteIssueMessage(repo: string, issueNumber: number): void;
    getIssueData(repo: string, issueNumber: number): StoredIssueData | null;
    saveIssueData(data: StoredIssueData): void;
    logEvent(repo: string, prNumber: number | null, eventType: string, payload: object): void;
    getRecentEvents(repo: string, prNumber?: number, limit?: number): EventLogEntry[];
    close(): void;
}
//# sourceMappingURL=state.d.ts.map