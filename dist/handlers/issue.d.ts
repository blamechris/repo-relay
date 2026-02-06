/**
 * Issue event handler with threaded embed lifecycle
 */
import { Client, TextChannel, ThreadChannel } from 'discord.js';
import { StateDb, IssueMessage } from '../db/state.js';
import { IssueData } from '../embeds/builders.js';
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
        state_reason?: 'completed' | 'not_planned' | 'reopened' | null;
        labels: Array<{
            name: string;
        }>;
        body: string | null;
        created_at: string;
    };
    repository: {
        full_name: string;
    };
    sender: {
        login: string;
    };
    label?: {
        name: string;
    };
}
export declare function handleIssueEvent(client: Client, db: StateDb, channelConfig: ChannelConfig, payload: IssueEventPayload): Promise<void>;
export declare function getOrCreateIssueThread(channel: TextChannel, db: StateDb, repo: string, issue: IssueData, existing: IssueMessage): Promise<ThreadChannel>;
//# sourceMappingURL=issue.d.ts.map