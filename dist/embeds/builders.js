/**
 * Discord embed builders for various notification types
 */
import { EmbedBuilder, Colors, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
export function buildPrEmbed(pr, ci, reviews) {
    const emoji = getPrEmoji(pr.state, pr.draft);
    const stateLabel = getPrStateLabel(pr.state, pr.draft);
    const embed = new EmbedBuilder()
        .setColor(getPrColor(pr.state, pr.draft))
        .setTitle(truncateTitle(`${emoji} PR #${pr.number}: ${pr.title}${stateLabel}`))
        .setURL(pr.url)
        .setAuthor({
        name: pr.author,
        iconURL: pr.authorAvatar,
        url: pr.authorUrl,
    })
        .addFields({
        name: 'Branch',
        value: `\`${pr.branch}\` → \`${pr.baseBranch}\``,
        inline: true,
    }, {
        name: 'Changes',
        value: `${pr.changedFiles} files (+${pr.additions}, -${pr.deletions})`,
        inline: true,
    })
        .setTimestamp(new Date(pr.createdAt));
    // Add reviews section
    const reviewLines = [];
    if (reviews) {
        const copilotStatus = reviews.copilot === 'reviewed'
            ? `✅ Reviewed (${reviews.copilotComments ?? 0} comments)`
            : '⏳ Pending';
        reviewLines.push(`• Copilot: ${copilotStatus}`);
        const agentStatus = getAgentReviewStatus(reviews.agentReview);
        reviewLines.push(`• Agent Review: ${agentStatus}`);
    }
    else {
        reviewLines.push('• Copilot: ⏳ Pending');
        reviewLines.push('• Agent Review: ⏳ Pending');
    }
    embed.addFields({
        name: '📋 Reviews',
        value: reviewLines.join('\n'),
        inline: false,
    });
    // Add CI section
    const ciStatus = ci ? getCiStatusText(ci) : '⏳ Pending';
    embed.addFields({
        name: '🔄 CI',
        value: ciStatus,
        inline: false,
    });
    // Add merged info if applicable
    if (pr.state === 'merged' && pr.mergedAt) {
        embed.addFields({
            name: 'Merged',
            value: `${pr.mergedBy ? `by @${pr.mergedBy} ` : ''}on ${new Date(pr.mergedAt).toLocaleString()}`,
            inline: false,
        });
    }
    // Encode state metadata in footer for recovery
    const repo = extractRepoFromUrl(pr.url);
    if (repo) {
        const footerData = {
            type: 'pr',
            pr: pr.number,
            repo,
            ci: ci?.status ?? 'pending',
            copilot: reviews?.copilot ?? 'pending',
            copilotComments: reviews?.copilotComments,
            agent: reviews?.agentReview ?? 'pending',
        };
        embed.setFooter({ text: encodeFooter(footerData) });
    }
    return embed;
}
export function buildPrComponents(prUrl, ciUrl) {
    const row = new ActionRowBuilder();
    row.addComponents(new ButtonBuilder().setLabel('View PR').setStyle(ButtonStyle.Link).setURL(prUrl), new ButtonBuilder().setLabel('View Diff').setStyle(ButtonStyle.Link).setURL(`${prUrl}/files`));
    if (ciUrl) {
        row.addComponents(new ButtonBuilder().setLabel('View CI').setStyle(ButtonStyle.Link).setURL(ciUrl));
    }
    return row;
}
export function buildPushReply(author, sha, compareUrl) {
    const shaShort = sha.substring(0, 7);
    const link = compareUrl ? `[${shaShort}](${compareUrl})` : shaShort;
    return `📤 Push by @${author} (${link})`;
}
export function buildCiReply(ci) {
    const status = getCiStatusText(ci);
    return `🔄 CI: ${status}`;
}
const MESSAGE_LIMIT = 2000; // Discord message content hard cap
export function buildCiFailureReply(ci, failedSteps) {
    const base = buildCiReply(ci);
    if (failedSteps.length === 0)
        return base;
    const maxDisplay = 5;
    const maxNameLength = 80; // matrix job names can be arbitrarily long
    const lines = failedSteps.slice(0, maxDisplay).map(s => `• \`${truncateDescription(s.jobName, maxNameLength)}\` > \`${truncateDescription(s.stepName, maxNameLength)}\``);
    if (failedSteps.length > maxDisplay) {
        lines.push(`...and ${failedSteps.length - maxDisplay} more`);
    }
    const reply = `${base}\n**Failed steps:**\n${lines.join('\n')}`;
    // Belt-and-suspenders: never exceed the message limit regardless of inputs
    return reply.length > MESSAGE_LIMIT ? reply.substring(0, MESSAGE_LIMIT - 1) + '…' : reply;
}
export function buildReviewReply(type, status, comments, url) {
    if (type === 'copilot') {
        const commentText = comments ? ` (${comments} comments)` : '';
        return `🤖 Copilot reviewed${commentText}`;
    }
    else {
        const statusEmoji = status === 'approved' ? '✅' : '⚠️';
        const link = url ? ` [View](${url})` : '';
        return `🔍 Agent review: ${statusEmoji} ${capitalize(status)}${link}`;
    }
}
export function buildMergedReply(mergedBy, baseBranch) {
    const byText = mergedBy ? ` by @${mergedBy}` : '';
    return `🎉 Merged to ${baseBranch ?? 'main'}${byText}!`;
}
export function buildClosedReply(closedBy) {
    const byText = closedBy ? ` by @${closedBy}` : '';
    return `🚫 Closed without merging${byText}`;
}
export function buildIssueEmbed(issue) {
    const emoji = issue.state === 'open' ? '🟢' : '🟣';
    const stateLabel = getIssueStateLabel(issue.state, issue.stateReason);
    const embed = new EmbedBuilder()
        .setColor(issue.state === 'open' ? Colors.Green : Colors.Purple)
        .setTitle(truncateTitle(`${emoji} Issue #${issue.number}: ${issue.title}${stateLabel}`))
        .setURL(issue.url)
        .setAuthor({
        name: issue.author,
        iconURL: issue.authorAvatar,
    })
        .setTimestamp(new Date(issue.createdAt));
    if (issue.labels.length > 0) {
        embed.addFields({
            name: 'Labels',
            value: formatLabelsField(issue.labels),
            inline: false,
        });
    }
    if (issue.body && issue.body.length > 0) {
        embed.setDescription(truncateDescription(issue.body, 200));
    }
    // Encode state metadata in footer for recovery
    const repo = extractRepoFromUrl(issue.url);
    if (repo) {
        const footerData = {
            type: 'issue',
            issue: issue.number,
            repo,
        };
        embed.setFooter({ text: encodeFooter(footerData) });
    }
    return embed;
}
export function buildIssueClosedReply(closedBy, stateReason) {
    const byText = closedBy ? ` by @${closedBy}` : '';
    if (stateReason === 'not_planned') {
        return `🟣 Closed as not planned${byText}`;
    }
    return `🟣 Closed${byText}`;
}
export function buildIssueReopenedReply(reopenedBy) {
    const byText = reopenedBy ? ` by @${reopenedBy}` : '';
    return `🟢 Reopened${byText}`;
}
export function buildReleaseEmbed(name, tagName, url, author, authorAvatar, body, prerelease) {
    const emoji = prerelease ? '🧪' : '🚀';
    const label = prerelease ? ' [PRE-RELEASE]' : '';
    const embed = new EmbedBuilder()
        .setColor(prerelease ? Colors.Yellow : Colors.Blue)
        .setTitle(truncateTitle(`${emoji} Release: ${name}${label}`))
        .setURL(url)
        .setAuthor({
        name: author,
        iconURL: authorAvatar,
    })
        .addFields({
        name: 'Tag',
        value: `\`${tagName}\``,
        inline: true,
    });
    if (body && body.length > 0) {
        embed.setDescription(truncateDescription(body, 500));
    }
    return embed;
}
export function buildDeploymentEmbed(state, environment, ref, sha, author, authorAvatar, description, targetUrl) {
    const isSuccess = state === 'success';
    const isFailure = state === 'failure' || state === 'error';
    const emoji = isSuccess ? '🚀' : isFailure ? '❌' : '🔄';
    const title = isSuccess
        ? `${emoji} Deployed to ${environment}`
        : isFailure
            ? `${emoji} Deploy Failed: ${environment}`
            : `${emoji} Deploying to ${environment}`;
    const color = isSuccess ? Colors.Green : isFailure ? Colors.Red : Colors.Yellow;
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(truncateTitle(title))
        .setAuthor({
        name: author,
        iconURL: authorAvatar,
    })
        .addFields({ name: 'Environment', value: environment, inline: true }, { name: 'Ref', value: `\`${ref}\``, inline: true }, { name: 'Commit', value: `\`${sha.substring(0, 7)}\``, inline: true }, { name: 'Status', value: capitalize(state), inline: true });
    if (description) {
        embed.setDescription(truncateDescription(description, 500));
    }
    if (targetUrl) {
        embed.setURL(targetUrl);
    }
    return embed;
}
export function buildPushEmbed(branch, commits, sender, senderAvatar, compareUrl) {
    const maxDisplay = 5;
    const commitLines = commits.slice(0, maxDisplay).map(c => {
        const sha = c.id.substring(0, 7);
        const firstLine = c.message.split('\n')[0];
        const truncated = firstLine.length > 100 ? firstLine.substring(0, 97) + '...' : firstLine;
        return `\`${sha}\` ${truncated}`;
    });
    if (commits.length > maxDisplay) {
        commitLines.push(`and ${commits.length - maxDisplay} more...`);
    }
    return new EmbedBuilder()
        .setColor(Colors.Yellow)
        .setTitle(truncateTitle(`📤 Push to ${branch}`))
        .setAuthor({ name: sender, iconURL: senderAvatar })
        .setDescription(commitLines.join('\n'))
        .addFields({ name: 'Compare', value: `[View changes](${compareUrl})`, inline: false });
}
export function buildForcePushEmbed(branch, beforeSha, afterSha, sender, senderAvatar, compareUrl) {
    return new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(truncateTitle(`⚠️ Force Push to ${branch}`))
        .setAuthor({ name: sender, iconURL: senderAvatar })
        .addFields({ name: 'Before', value: `\`${beforeSha.substring(0, 7)}\``, inline: true }, { name: 'After', value: `\`${afterSha.substring(0, 7)}\``, inline: true }, { name: 'Compare', value: `[View changes](${compareUrl})`, inline: false });
}
// Security alert embeds
const SEVERITY_COLORS = {
    critical: 0x8B0000,
    high: Colors.Red,
    error: Colors.Red,
    medium: Colors.Yellow,
    warning: Colors.Yellow,
    low: Colors.Grey,
    note: Colors.Grey,
    none: Colors.Grey,
};
export function buildDependabotAlertEmbed(payload) {
    const { alert } = payload;
    const severity = alert.security_advisory.severity;
    const pkg = alert.dependency.package.name;
    const fixVersion = alert.security_vulnerability.first_patched_version?.identifier;
    const embed = new EmbedBuilder()
        .setColor(SEVERITY_COLORS[severity] ?? Colors.Grey)
        .setTitle(truncateTitle(`🔓 Dependabot: ${capitalize(severity)} vulnerability in ${pkg}`))
        .setURL(alert.html_url)
        .setDescription(alert.security_advisory.summary)
        .addFields({ name: 'Severity', value: capitalize(severity), inline: true }, { name: 'Package', value: `\`${pkg}\` (${alert.dependency.package.ecosystem})`, inline: true });
    if (alert.security_advisory.cve_id) {
        embed.addFields({ name: 'CVE', value: alert.security_advisory.cve_id, inline: true });
    }
    embed.addFields({
        name: 'Fix Available',
        value: fixVersion ? `Upgrade to \`${fixVersion}\`` : 'No fix available',
        inline: true,
    });
    return embed;
}
export function buildSecretScanningAlertEmbed(payload) {
    const { alert } = payload;
    const bypassValue = alert.push_protection_bypassed === true
        ? '⚠️ Bypassed'
        : alert.push_protection_bypassed === false
            ? '✅ Active'
            : '—';
    return new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle(truncateTitle(`🔑 Secret Detected: ${alert.secret_type_display_name}`))
        .setURL(alert.html_url)
        .addFields({ name: 'Secret Type', value: alert.secret_type_display_name, inline: true }, { name: 'Push Protection', value: bypassValue, inline: true });
}
export function buildCodeScanningAlertEmbed(payload) {
    const { alert } = payload;
    const severity = alert.rule.severity;
    const location = alert.most_recent_instance.location;
    return new EmbedBuilder()
        .setColor(SEVERITY_COLORS[severity] ?? Colors.Grey)
        .setTitle(truncateTitle(`🔍 Code Scanning: ${alert.rule.name}`))
        .setURL(alert.html_url)
        .setDescription(truncateDescription(alert.rule.description, 200))
        .addFields({ name: 'Rule', value: `\`${alert.rule.id}\``, inline: true }, { name: 'Severity', value: capitalize(severity), inline: true }, { name: 'Tool', value: alert.tool.name, inline: true }, { name: 'Location', value: `\`${location.path}:${location.start_line}\``, inline: true });
}
// Helper functions
function getPrEmoji(state, draft) {
    if (draft)
        return '📝';
    switch (state) {
        case 'open':
            return '🔀';
        case 'merged':
            return '✅';
        case 'closed':
            return '🚫';
    }
}
function getPrStateLabel(state, draft) {
    if (draft)
        return ' [DRAFT]';
    if (state === 'merged')
        return ' [MERGED]';
    if (state === 'closed')
        return ' [CLOSED]';
    return '';
}
function getPrColor(state, draft) {
    if (draft)
        return Colors.Grey;
    switch (state) {
        case 'open':
            return Colors.Green;
        case 'merged':
            return Colors.Purple;
        case 'closed':
            return Colors.Red;
    }
}
function getAgentReviewStatus(status) {
    switch (status) {
        case 'approved':
            return '✅ Approved';
        case 'changes_requested':
            return '⚠️ Changes Requested';
        case 'pending':
            return '⏳ Pending';
        case 'none':
            return '—';
    }
}
function getCiStatusText(ci) {
    const name = ci.workflowName ? ` (${ci.workflowName})` : '';
    const link = ci.url ? ` [View](${ci.url})` : '';
    switch (ci.status) {
        case 'pending':
            return `⏳ Pending${name}`;
        case 'running':
            return `🔄 Running...${name}${link}`;
        case 'success':
            return `✅ Passed${name}${link}`;
        case 'failure':
            return `❌ Failed${name}${link}`;
        case 'cancelled':
            return `⚪ Cancelled${name}`;
    }
}
function getIssueStateLabel(state, stateReason) {
    if (state === 'closed') {
        return stateReason === 'not_planned' ? ' [NOT PLANNED]' : ' [CLOSED]';
    }
    return '';
}
function truncateTitle(title) {
    return title.length > 256 ? title.substring(0, 255) + '…' : title;
}
const THREAD_NAME_LIMIT = 100; // Discord hard cap — exceeding it is an API 400
/**
 * Build a thread name that fits Discord's 100-char limit. The prefix length
 * varies with the entity number, so the title budget must be computed from
 * the full name — truncating the title alone overflows for large numbers.
 */
export function buildThreadName(kind, number, title) {
    const prefix = `${kind} #${number}: `;
    const room = THREAD_NAME_LIMIT - prefix.length;
    const fitted = title.length > room ? title.substring(0, Math.max(room - 1, 0)) + '…' : title;
    // Unconditional clamp: an absurdly large entity number could leave no room
    return (prefix + fitted).substring(0, THREAD_NAME_LIMIT);
}
const FIELD_VALUE_LIMIT = 1024; // Discord embed field value hard cap
/** Join backtick-wrapped labels, capping at the field limit with a "+N more" tail. */
function formatLabelsField(labels) {
    const parts = [];
    let length = 0;
    for (let i = 0; i < labels.length; i++) {
        const piece = `\`${labels[i]}\``;
        // Reserve room for the separator and the actual "+N more" tail
        const tail = `+${labels.length - i} more`;
        const reserve = i < labels.length - 1 ? tail.length + 1 : 0;
        if (length + piece.length + 1 + reserve > FIELD_VALUE_LIMIT) {
            parts.push(tail);
            break;
        }
        parts.push(piece);
        length += piece.length + 1;
    }
    // Unconditional clamp — the cap must hold for any inputs
    const joined = parts.join(' ');
    return joined.length > FIELD_VALUE_LIMIT ? joined.substring(0, FIELD_VALUE_LIMIT) : joined;
}
function truncateDescription(text, maxLength) {
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
}
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
export function extractRepoFromUrl(url) {
    const match = url.match(/github\.com\/([^/]+\/[^/]+)\//);
    return match ? match[1] : null;
}
// Footer metadata for state recovery
const FOOTER_PREFIX = 'repo-relay:v1:';
function encodeFooter(data) {
    return `${FOOTER_PREFIX}${JSON.stringify(data)}`;
}
export function parseFooterMetadata(footerText) {
    if (!footerText.startsWith(FOOTER_PREFIX))
        return null;
    try {
        return JSON.parse(footerText.slice(FOOTER_PREFIX.length));
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=builders.js.map