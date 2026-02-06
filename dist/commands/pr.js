/**
 * /pr slash command handler
 *
 * Note: Slash commands require a persistent bot process.
 * This is scaffolding for Phase 5.
 */
import { EmbedBuilder, Colors, } from 'discord.js';
import { safeErrorMessage } from '../utils/errors.js';
import { REPO_NAME_PATTERN } from '../utils/validation.js';
export async function handlePrCommand(interaction, githubToken, repo) {
    if (!REPO_NAME_PATTERN.test(repo)) {
        await interaction.reply({ content: 'Invalid repository format', ephemeral: true });
        return;
    }
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
        case 'show':
            await handlePrShow(interaction, githubToken, repo);
            break;
        case 'list':
            await handlePrList(interaction, githubToken, repo);
            break;
    }
}
async function handlePrShow(interaction, githubToken, repo) {
    const prNumber = interaction.options.getInteger('number', true);
    await interaction.deferReply();
    try {
        const response = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
            headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: 'application/vnd.github+json',
            },
        });
        if (!response.ok) {
            if (response.status === 404) {
                await interaction.editReply(`PR #${prNumber} not found`);
                return;
            }
            throw new Error(`GitHub API error: ${response.status}`);
        }
        const pr = (await response.json());
        const stateEmoji = pr.merged ? '✅' : pr.state === 'open' ? '🔀' : '🚫';
        const stateLabel = pr.merged
            ? '[MERGED]'
            : pr.state === 'closed'
                ? '[CLOSED]'
                : pr.draft
                    ? '[DRAFT]'
                    : '';
        const embed = new EmbedBuilder()
            .setColor(pr.merged
            ? Colors.Purple
            : pr.state === 'open'
                ? Colors.Green
                : Colors.Red)
            .setTitle(`${stateEmoji} PR #${pr.number}: ${pr.title} ${stateLabel}`)
            .setURL(pr.html_url)
            .setAuthor({
            name: pr.user.login,
            iconURL: pr.user.avatar_url,
            url: pr.user.html_url,
        })
            .addFields({
            name: 'Branch',
            value: `\`${pr.head.ref}\` → \`${pr.base.ref}\``,
            inline: true,
        }, {
            name: 'Changes',
            value: `${pr.changed_files} files (+${pr.additions}, -${pr.deletions})`,
            inline: true,
        });
        if (pr.body) {
            const truncated = pr.body.length > 200 ? pr.body.substring(0, 197) + '...' : pr.body;
            embed.setDescription(truncated);
        }
        await interaction.editReply({ embeds: [embed] });
    }
    catch (error) {
        console.error('[repo-relay] Error fetching PR:', safeErrorMessage(error));
        await interaction.editReply('Failed to fetch PR information');
    }
}
async function handlePrList(interaction, githubToken, repo) {
    await interaction.deferReply();
    try {
        const response = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=10`, {
            headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: 'application/vnd.github+json',
            },
        });
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }
        const prs = (await response.json());
        if (prs.length === 0) {
            await interaction.editReply('No open PRs');
            return;
        }
        const embed = new EmbedBuilder()
            .setColor(Colors.Green)
            .setTitle(`🔀 Open PRs (${prs.length})`)
            .setDescription(prs
            .map((pr) => {
            const draft = pr.draft ? ' (draft)' : '';
            return `• **#${pr.number}** ${pr.title}${draft} - @${pr.user.login}`;
        })
            .join('\n'));
        await interaction.editReply({ embeds: [embed] });
    }
    catch (error) {
        console.error('[repo-relay] Error fetching PRs:', safeErrorMessage(error));
        await interaction.editReply('Failed to fetch PRs');
    }
}
//# sourceMappingURL=pr.js.map