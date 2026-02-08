/**
 * Deployment status event handler
 */
import { TextChannel } from 'discord.js';
import { buildDeploymentEmbed } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
export async function handleDeploymentEvent(client, db, channelConfig, payload) {
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
    const embed = buildDeploymentEmbed(deployment_status.state, deployment_status.environment, deployment.ref, deployment.sha, deployment_status.creator.login, deployment_status.creator.avatar_url, deployment_status.description ?? undefined, deployment_status.target_url ?? undefined);
    await channel.send({ embeds: [embed] });
}
//# sourceMappingURL=deployment.js.map