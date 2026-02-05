/**
 * Comment event handler (agent-review detection)
 */
import { Client } from 'discord.js';
import { StateDb } from '../db/state.js';
import { ChannelConfig } from '../config/channels.js';
export interface IssueCommentPayload {
    action: 'created' | 'edited' | 'deleted';
    comment: {
        id: number;
        user: {
            login: string;
            type: 'User' | 'Bot';
        };
        body: string;
        html_url: string;
        created_at: string;
    };
    issue: {
        number: number;
        pull_request?: {
            url: string;
        };
    };
    repository: {
        full_name: string;
    };
}
export declare function handleCommentEvent(client: Client, db: StateDb, channelConfig: ChannelConfig, payload: IssueCommentPayload): Promise<void>;
//# sourceMappingURL=comment.d.ts.map