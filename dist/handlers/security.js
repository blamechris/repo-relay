/**
 * Security alert event handler (Dependabot, secret scanning, code scanning)
 */
import { TextChannel } from 'discord.js';
import { buildDependabotAlertEmbed, buildSecretScanningAlertEmbed, buildCodeScanningAlertEmbed, } from '../embeds/builders.js';
import { getChannelForEvent } from '../config/channels.js';
import { withRetry } from '../utils/retry.js';
export async function handleSecurityAlertEvent(client, db, channelConfig, alertData) {
    const repo = alertData.payload.repository.full_name;
    const alertNumber = alertData.payload.alert.number;
    // Log all security events for audit trail, including skipped actions
    db.logEvent(repo, alertNumber, `${alertData.event}.${alertData.payload.action}`, alertData.payload);
    // Defense-in-depth: skip non-actionable actions (pre-filter should catch these)
    switch (alertData.event) {
        case 'dependabot_alert':
            if (alertData.payload.action !== 'created')
                return;
            break;
        case 'secret_scanning_alert':
            if (alertData.payload.action !== 'created')
                return;
            break;
        case 'code_scanning_alert':
            if (alertData.payload.action !== 'created' && alertData.payload.action !== 'appeared_in_branch')
                return;
            break;
    }
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
//# sourceMappingURL=security.js.map