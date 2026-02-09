/**
 * Deployment status event handler
 */
import { TextChannel } from 'discord.js';
import { buildDeploymentEmbed } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
import { withRetry } from '../utils/retry.js';
const TERMINAL_STATES = new Set(['success', 'failure', 'error']);
export async function handleDeploymentEvent(client, db, channelConfig, payload) {
    const { deployment_status, repository } = payload;
    const { ref, sha } = payload.deployment;
    const repo = repository.full_name;
    // Only notify for terminal states
    if (!TERMINAL_STATES.has(deployment_status.state)) {
        return;
    }
    const channelId = getChannelForEvent(channelConfig, 'deployment');
    const channel = await withRetry(() => client.channels.fetch(channelId));
    if (!channel || !(channel instanceof TextChannel)) {
        throw new Error(`Channel ${channelId} not found or not a text channel`);
    }
    db.logEvent(repo, null, `deployment_status.${deployment_status.state}`, payload);
    const embed = buildDeploymentEmbed(deployment_status.state, deployment_status.environment, ref, sha, deployment_status.creator.login, deployment_status.creator.avatar_url, deployment_status.description ?? undefined, deployment_status.target_url ?? undefined);
    await withRetry(() => channel.send({ embeds: [embed] }));
}
//# sourceMappingURL=deployment.js.map