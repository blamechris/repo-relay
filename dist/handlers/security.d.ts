/**
 * Security alert event handler (Dependabot, secret scanning, code scanning)
 */
import { Client } from 'discord.js';
import { StateDb } from '../db/state.js';
import { ChannelConfig } from '../config/channels.js';
export interface DependabotAlertPayload {
    action: 'created' | 'dismissed' | 'fixed' | 'auto_dismissed' | 'reintroduced' | 'reopened';
    alert: {
        number: number;
        state: 'open' | 'dismissed' | 'fixed' | 'auto_dismissed';
        dependency: {
            package: {
                ecosystem: string;
                name: string;
            };
            scope: string;
        };
        security_advisory: {
            ghsa_id: string;
            cve_id: string | null;
            summary: string;
            severity: 'low' | 'medium' | 'high' | 'critical';
        };
        security_vulnerability: {
            first_patched_version: {
                identifier: string;
            } | null;
        };
        html_url: string;
    };
    repository: {
        full_name: string;
    };
}
export interface SecretScanningAlertPayload {
    action: 'created' | 'resolved' | 'reopened' | 'revoked';
    alert: {
        number: number;
        state: 'open' | 'resolved';
        secret_type: string;
        secret_type_display_name: string;
        html_url: string;
        push_protection_bypassed: boolean | null;
        resolution: string | null;
    };
    repository: {
        full_name: string;
    };
}
export interface CodeScanningAlertPayload {
    action: 'created' | 'reopened_by_user' | 'closed_by_user' | 'fixed' | 'appeared_in_branch';
    alert: {
        number: number;
        state: 'open' | 'closed' | 'dismissed' | 'fixed';
        rule: {
            id: string;
            name: string;
            severity: 'none' | 'note' | 'warning' | 'error';
            description: string;
        };
        tool: {
            name: string;
        };
        most_recent_instance: {
            location: {
                path: string;
                start_line: number;
            };
        };
        html_url: string;
    };
    repository: {
        full_name: string;
    };
}
export type SecurityAlertPayload = {
    event: 'dependabot_alert';
    payload: DependabotAlertPayload;
} | {
    event: 'secret_scanning_alert';
    payload: SecretScanningAlertPayload;
} | {
    event: 'code_scanning_alert';
    payload: CodeScanningAlertPayload;
};
export declare function handleSecurityAlertEvent(client: Client, db: StateDb, channelConfig: ChannelConfig, alertData: SecurityAlertPayload): Promise<void>;
//# sourceMappingURL=security.d.ts.map