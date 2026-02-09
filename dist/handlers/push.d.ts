/**
 * Push event handler — notifies on direct pushes to the default branch
 */
import { Client } from 'discord.js';
import { StateDb } from '../db/state.js';
import { ChannelConfig } from '../config/channels.js';
export interface PushEventPayload {
    ref: string;
    before: string;
    after: string;
    forced: boolean;
    compare: string;
    created: boolean;
    deleted: boolean;
    commits: Array<{
        id: string;
        message: string;
        author: {
            name: string;
            username?: string;
        };
    }>;
    head_commit: {
        id: string;
        message: string;
    } | null;
    pusher: {
        name: string;
    };
    sender: {
        login: string;
        avatar_url: string;
    };
    repository: {
        full_name: string;
        default_branch: string;
    };
}
export declare function handlePushEvent(client: Client, db: StateDb, channelConfig: ChannelConfig, payload: PushEventPayload): Promise<void>;
//# sourceMappingURL=push.d.ts.map