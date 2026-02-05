/**
 * SQLite state management for PR ↔ Discord message mappings
 */
export interface PrMessage {
    repo: string;
    prNumber: number;
    channelId: string;
    messageId: string;
    createdAt: string;
    lastUpdated: string;
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
    private initSchema;
    getPrMessage(repo: string, prNumber: number): PrMessage | null;
    savePrMessage(repo: string, prNumber: number, channelId: string, messageId: string): void;
    updatePrMessageTimestamp(repo: string, prNumber: number): void;
    deletePrMessage(repo: string, prNumber: number): void;
    logEvent(repo: string, prNumber: number | null, eventType: string, payload: object): void;
    getRecentEvents(repo: string, prNumber?: number, limit?: number): EventLogEntry[];
    close(): void;
}
//# sourceMappingURL=state.d.ts.map