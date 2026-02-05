/**
 * Discord embed builders for various notification types
 */
import { EmbedBuilder, Colors } from 'discord.js';
export function buildPrEmbed(pr, ci, reviews) {
    const emoji = getPrEmoji(pr.state, pr.draft);
    const stateLabel = getPrStateLabel(pr.state, pr.draft);
    const embed = new EmbedBuilder()
        .setColor(getPrColor(pr.state, pr.draft))
        .setTitle(`${emoji} PR #${pr.number}: ${pr.title}${stateLabel}`)
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
export function buildIssueEmbed(number, title, url, author, authorAvatar, state, labels, body) {
    const emoji = state === 'open' ? '🟢' : '🟣';
    const stateLabel = state === 'closed' ? ' [CLOSED]' : '';
    const embed = new EmbedBuilder()
        .setColor(state === 'open' ? Colors.Green : Colors.Purple)
        .setTitle(`${emoji} Issue #${number}: ${title}${stateLabel}`)
        .setURL(url)
        .setAuthor({
        name: author,
        iconURL: authorAvatar,
    });
    if (labels.length > 0) {
        embed.addFields({
            name: 'Labels',
            value: labels.map((l) => `\`${l}\``).join(' '),
            inline: false,
        });
    }
    if (body && body.length > 0) {
        const truncated = body.length > 200 ? body.substring(0, 197) + '...' : body;
        embed.setDescription(truncated);
    }
    return embed;
}
export function buildReleaseEmbed(name, tagName, url, author, authorAvatar, body, prerelease) {
    const emoji = prerelease ? '🧪' : '🚀';
    const label = prerelease ? ' [PRE-RELEASE]' : '';
    const embed = new EmbedBuilder()
        .setColor(prerelease ? Colors.Yellow : Colors.Blue)
        .setTitle(`${emoji} Release: ${name}${label}`)
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
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
//# sourceMappingURL=builders.js.map