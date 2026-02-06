/**
 * /issue slash command handler
 *
 * Note: Slash commands require a persistent bot process.
 * This is scaffolding for Phase 5.
 */
import { EmbedBuilder, Colors, } from 'discord.js';
import { safeErrorMessage } from '../utils/errors.js';
import { REPO_NAME_PATTERN } from '../utils/validation.js';
export async function handleIssueCommand(interaction, githubToken, repo) {
    if (!REPO_NAME_PATTERN.test(repo)) {
        await interaction.reply({ content: 'Invalid repository format', ephemeral: true });
        return;
    }
    const issueNumber = interaction.options.getInteger('number', true);
    await interaction.deferReply();
    try {
        const response = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, {
            headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: 'application/vnd.github+json',
            },
        });
        if (!response.ok) {
            if (response.status === 404) {
                await interaction.editReply(`Issue #${issueNumber} not found`);
                return;
            }
            throw new Error(`GitHub API error: ${response.status}`);
        }
        const issue = (await response.json());
        // Check if it's actually a PR (issues API returns PRs too)
        if (issue.pull_request) {
            await interaction.editReply(`#${issueNumber} is a Pull Request, not an Issue. Use \`/pr show ${issueNumber}\` instead.`);
            return;
        }
        const stateEmoji = issue.state === 'open' ? '🟢' : '🟣';
        const stateLabel = issue.state === 'closed' ? ' [CLOSED]' : '';
        const embed = new EmbedBuilder()
            .setColor(issue.state === 'open' ? Colors.Green : Colors.Purple)
            .setTitle(`${stateEmoji} Issue #${issue.number}: ${issue.title}${stateLabel}`)
            .setURL(issue.html_url)
            .setAuthor({
            name: issue.user.login,
            iconURL: issue.user.avatar_url,
            url: issue.user.html_url,
        });
        if (issue.labels && issue.labels.length > 0) {
            embed.addFields({
                name: 'Labels',
                value: issue.labels.map((l) => `\`${l.name}\``).join(' '),
                inline: false,
            });
        }
        if (issue.assignees && issue.assignees.length > 0) {
            embed.addFields({
                name: 'Assignees',
                value: issue.assignees.map((a) => `@${a.login}`).join(', '),
                inline: true,
            });
        }
        if (issue.milestone) {
            embed.addFields({
                name: 'Milestone',
                value: issue.milestone.title,
                inline: true,
            });
        }
        if (issue.body) {
            const truncated = issue.body.length > 300
                ? issue.body.substring(0, 297) + '...'
                : issue.body;
            embed.setDescription(truncated);
        }
        await interaction.editReply({ embeds: [embed] });
    }
    catch (error) {
        console.error('[repo-relay] Error fetching issue:', safeErrorMessage(error));
        await interaction.editReply('Failed to fetch issue information');
    }
}
//# sourceMappingURL=issue.js.map