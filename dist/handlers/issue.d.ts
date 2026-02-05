/**
 * Issue event handler
 */
import { Client } from 'discord.js';
import { StateDb } from '../db/state.js';
import { ChannelConfig } from '../config/channels.js';
export interface IssueEventPayload {
    action: 'opened' | 'closed' | 'reopened' | 'labeled' | 'unlabeled' | 'edited';
    issue: {
        number: number;
        title: string;
        html_url: string;
        user: {
            login: string;
            avatar_url: string;
        };
        state: 'open' | 'closed';
        labels: Array<{
            name: string;
        }>;
        body: string | null;
        created_at: string;
    };
    repository: {
        full_name: string;
    };
}
export declare function handleIssueEvent(client: Client, db: StateDb, channelConfig: ChannelConfig, payload: IssueEventPayload): Promise<void>;
//# sourceMappingURL=issue.d.ts.map