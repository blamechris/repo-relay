/**
 * Deployment status event handler
 */

import { Client, TextChannel } from 'discord.js';
import { StateDb } from '../db/state.js';
import { buildDeploymentEmbed } from '../embeds/builders.js';
import { getChannelForEvent, ChannelConfig } from '../config/channels.js';

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

export async function handleDeploymentEvent(
  client: Client,
  db: StateDb,
  channelConfig: ChannelConfig,
  payload: DeploymentStatusPayload
): Promise<void> {
  const { deployment_status, deployment, repository } = payload;
  const repo = repository.full_name;

  // Only notify for terminal states
  const terminalStates = ['success', 'failure', 'error'];
  if (!terminalStates.includes(deployment_status.state)) {
    return;
  }

  const channelId = getChannelForEvent(channelConfig, 'deployment');
  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }

  db.logEvent(repo, null, `deployment_status.${deployment_status.state}`, payload);

  const embed = buildDeploymentEmbed(
    deployment_status.state,
    deployment_status.environment,
    deployment.ref,
    deployment.sha,
    deployment_status.creator.login,
    deployment_status.creator.avatar_url,
    deployment_status.description ?? undefined,
    deployment_status.target_url ?? undefined
  );

  await channel.send({ embeds: [embed] });
}
