/**
 * Security alert event handler (Dependabot, secret scanning, code scanning)
 */

import { Client, TextChannel } from 'discord.js';
import { StateDb } from '../db/state.js';
import {
  buildDependabotAlertEmbed,
  buildSecretScanningAlertEmbed,
  buildCodeScanningAlertEmbed,
} from '../embeds/builders.js';
import { getChannelForEvent, ChannelConfig } from '../config/channels.js';
import { withRetry } from '../utils/retry.js';

export interface DependabotAlertPayload {
  action: 'created' | 'dismissed' | 'fixed' | 'auto_dismissed' | 'reintroduced' | 'reopened';
  alert: {
    number: number;
    state: 'open' | 'dismissed' | 'fixed' | 'auto_dismissed';
    dependency: { package: { ecosystem: string; name: string }; scope: string };
    security_advisory: {
      ghsa_id: string;
      cve_id: string | null;
      summary: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
    };
    security_vulnerability: {
      first_patched_version: { identifier: string } | null;
    };
    html_url: string;
  };
  repository: { full_name: string };
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
  repository: { full_name: string };
}

export interface CodeScanningAlertPayload {
  action: 'created' | 'reopened_by_user' | 'closed_by_user' | 'fixed' | 'appeared_in_branch';
  alert: {
    number: number;
    state: 'open' | 'closed' | 'dismissed' | 'fixed';
    rule: { id: string; name: string; severity: 'none' | 'note' | 'warning' | 'error'; description: string };
    tool: { name: string };
    most_recent_instance: {
      location: { path: string; start_line: number };
    };
    html_url: string;
  };
  repository: { full_name: string };
}

export type SecurityAlertPayload =
  | { event: 'dependabot_alert'; payload: DependabotAlertPayload }
  | { event: 'secret_scanning_alert'; payload: SecretScanningAlertPayload }
  | { event: 'code_scanning_alert'; payload: CodeScanningAlertPayload };

export async function handleSecurityAlertEvent(
  client: Client,
  db: StateDb,
  channelConfig: ChannelConfig,
  alertData: SecurityAlertPayload
): Promise<void> {
  const repo = alertData.payload.repository.full_name;
  const alertNumber = alertData.payload.alert.number;

  // Defense-in-depth: skip non-actionable actions (pre-filter should catch these)
  switch (alertData.event) {
    case 'dependabot_alert':
      if (alertData.payload.action !== 'created') return;
      break;
    case 'secret_scanning_alert':
      if (alertData.payload.action !== 'created') return;
      break;
    case 'code_scanning_alert':
      if (alertData.payload.action !== 'created' && alertData.payload.action !== 'appeared_in_branch') return;
      break;
  }

  db.logEvent(repo, alertNumber, `${alertData.event}.${alertData.payload.action}`, alertData.payload);

  const channelId = getChannelForEvent(channelConfig, 'security');
  const channel = await withRetry(() => client.channels.fetch(channelId));
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }

  let embed;
  switch (alertData.event) {
    case 'dependabot_alert':
      embed = buildDependabotAlertEmbed(alertData.payload);
      break;
    case 'secret_scanning_alert':
      embed = buildSecretScanningAlertEmbed(alertData.payload);
      break;
    case 'code_scanning_alert':
      embed = buildCodeScanningAlertEmbed(alertData.payload);
      break;
  }

  await withRetry(() => channel.send({ embeds: [embed] }));
}
