/**
 * Discord embed builders for various notification types
 */
import { EmbedBuilder, Colors } from 'discord.js';
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
    return embed;
}
export function buildPushReply(commitCount, author, sha, compareUrl) {
    const shaShort = sha.substring(0, 7);
    const link = compareUrl ? `[${shaShort}](${compareUrl})` : shaShort;
    const plural = commitCount === 1 ? 'commit' : 'commits';
    return `📤 Push: ${commitCount} ${plural} by @${author} (${link})`;
}
export function buildCiReply(ci) {
    const status = getCiStatusText(ci);
    return `🔄 CI: ${status}`;
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
export function buildMergedReply(mergedBy) {
    const byText = mergedBy ? ` by @${mergedBy}` : '';
    return `🎉 Merged to main${byText}!`;
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
            value: issue.labels.map((l) => `\`${l}\``).join(' '),
            inline: false,
        });
    }
    if (issue.body && issue.body.length > 0) {
        const truncated = issue.body.length > 200 ? issue.body.substring(0, 197) + '...' : issue.body;
        embed.setDescription(truncated);
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
        const truncated = body.length > 500 ? body.substring(0, 497) + '...' : body;
        embed.setDescription(truncated);
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
        const truncated = description.length > 500 ? description.substring(0, 497) + '...' : description;
        embed.setDescription(truncated);
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
        return `\`${sha}\` ${firstLine}`;
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
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
//# sourceMappingURL=builders.js.map