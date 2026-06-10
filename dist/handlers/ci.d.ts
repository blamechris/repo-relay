/**
 * CI/Workflow event handler
 */
import { Client } from 'discord.js';
import { StateDb } from '../db/state.js';
import { CiStatus } from '../embeds/builders.js';
import { ChannelConfig } from '../config/channels.js';
export interface WorkflowRunPayload {
    action: 'completed' | 'requested' | 'in_progress';
    workflow_run: {
        id: number;
        name: string;
        head_sha: string;
        head_branch: string;
        status: 'queued' | 'in_progress' | 'completed';
        conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'neutral' | 'timed_out' | 'action_required' | 'stale' | 'startup_failure' | null;
        html_url: string;
        pull_requests: Array<{
            number: number;
        }>;
    };
    repository: {
        full_name: string;
    };
}
export declare function handleCiEvent(client: Client, db: StateDb, channelConfig: ChannelConfig, payload: WorkflowRunPayload, githubToken?: string): Promise<void>;
export declare function mapCiStatus(status: WorkflowRunPayload['workflow_run']['status'], conclusion: WorkflowRunPayload['workflow_run']['conclusion']): CiStatus['status'];
//# sourceMappingURL=ci.d.ts.map