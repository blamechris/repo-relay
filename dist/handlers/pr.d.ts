/**
 * Pull Request event handler
 */
import { Client, TextChannel, ThreadChannel } from 'discord.js';
import { StateDb, PrMessage } from '../db/state.js';
import { PrData, ReviewStatus, CiStatus } from '../embeds/builders.js';
import { ChannelConfig } from '../config/channels.js';
export interface PrEventPayload {
    action: 'opened' | 'closed' | 'reopened' | 'synchronize' | 'edited' | 'ready_for_review' | 'converted_to_draft';
    pull_request: {
        number: number;
        title: string;
        html_url: string;
        user: {
            login: string;
            html_url: string;
            avatar_url: string;
        };
        head: {
            ref: string;
            sha: string;
        };
        base: {
            ref: string;
        };
        additions: number;
        deletions: number;
        changed_files: number;
        body: string | null;
        state: 'open' | 'closed';
        draft: boolean;
        merged: boolean;
        merged_at: string | null;
        merged_by?: {
            login: string;
        };
        created_at: string;
    };
    repository: {
        full_name: string;
    };
    sender: {
        login: string;
    };
    before?: string;
    after?: string;
}
export declare function handlePrEvent(client: Client, db: StateDb, channelConfig: ChannelConfig, payload: PrEventPayload): Promise<void>;
export declare function buildEmbedWithStatus(db: StateDb, repo: string, prNumber: number): {
    prData: PrData;
    reviews: ReviewStatus;
    ci: CiStatus;
} | null;
export declare function getOrCreateThread(channel: TextChannel, db: StateDb, repo: string, pr: PrData, existing: PrMessage): Promise<ThreadChannel>;
//# sourceMappingURL=pr.d.ts.map