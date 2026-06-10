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
        /** Reviewer's relationship to the repository (per webhook payload docs). */
        author_association: 'OWNER' | 'MEMBER' | 'COLLABORATOR' | 'CONTRIBUTOR' | 'FIRST_TIME_CONTRIBUTOR' | 'FIRST_TIMER' | 'MANNEQUIN' | 'NONE';
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
/**
 * Associations whose `commented` reviews are cascade noise (#13, #146):
 * replying to inline review comments fires another pull_request_review event
 * with state 'commented'. Keyed on author_association so the filter works on
 * both personal repos (OWNER) and org-owned repos (MEMBER/COLLABORATOR),
 * where the old repo-owner login comparison never matched a human reviewer.
 */
export declare const CASCADE_REVIEW_ASSOCIATIONS: ReadonlySet<string>;
export declare function handleReviewEvent(client: Client, db: StateDb, channelConfig: ChannelConfig, payload: PrReviewPayload): Promise<void>;
//# sourceMappingURL=review.d.ts.map