/**
 * Release event handler
 */
import { Client } from 'discord.js';
import { StateDb } from '../db/state.js';
import { ChannelConfig } from '../config/channels.js';
export interface ReleaseEventPayload {
    action: 'published' | 'created' | 'edited' | 'deleted';
    release: {
        id: number;
        name: string | null;
        tag_name: string;
        html_url: string;
        author: {
            login: string;
            avatar_url: string;
        };
        body: string | null;
        prerelease: boolean;
        draft: boolean;
        published_at: string;
    };
    repository: {
        full_name: string;
    };
}
export declare function handleReleaseEvent(client: Client, db: StateDb, channelConfig: ChannelConfig, payload: ReleaseEventPayload): Promise<void>;
//# sourceMappingURL=release.d.ts.map