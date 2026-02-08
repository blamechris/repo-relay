/**
 * Deployment status event handler
 */
import { Client } from 'discord.js';
import { StateDb } from '../db/state.js';
import { ChannelConfig } from '../config/channels.js';
export interface DeploymentStatusPayload {
    action: 'created';
    deployment_status: {
        state: 'success' | 'failure' | 'error' | 'pending' | 'in_progress' | 'queued' | 'inactive';
        description: string | null;
        environment: string;
        target_url: string | null;
        creator: {
            login: string;
            avatar_url: string;
        };
    };
    deployment: {
        id: number;
        ref: string;
        sha: string;
        environment: string;
        description: string | null;
    };
    repository: {
        full_name: string;
    };
}
export declare function handleDeploymentEvent(client: Client, db: StateDb, channelConfig: ChannelConfig, payload: DeploymentStatusPayload): Promise<void>;
//# sourceMappingURL=deployment.d.ts.map