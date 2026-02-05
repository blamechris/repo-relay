/**
 * Review event handler (Copilot and agent-review detection)
 */
import { Client } from 'discord.js';
import { StateDb } from '../db/state.js';
import { ChannelConfig } from '../config/channels.js';
export interface PrReviewPayload {
    action: 'submitted' | 'edited' | 'dismissed';
    review: {
        id: number;
        user: {
            login: string;
            type: 'User' | 'Bot';
        };
        body: string | null;
        state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
        html_url: string;
    };
    pull_request: {
        number: number;
    };
    repository: {
        full_name: string;
        owner: {
            login: string;
        };
    };
}
export declare function handleReviewEvent(client: Client, db: StateDb, channelConfig: ChannelConfig, payload: PrReviewPayload): Promise<void>;
//# sourceMappingURL=review.d.ts.map