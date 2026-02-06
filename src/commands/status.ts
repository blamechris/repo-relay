/**
 * /status slash command handler
 *
 * Note: Slash commands require a persistent bot process.
 * This is scaffolding for Phase 5.
 */

import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { safeErrorMessage } from '../utils/errors.js';
import { REPO_NAME_PATTERN } from '../index.js';

interface GitHubPr {
  number: number;
  title: string;
  draft: boolean;
}

interface GitHubIssue {
  pull_request?: { url: string };
}

interface GitHubRelease {
  tag_name: string;
  published_at: string;
}

interface GitHubWorkflowRuns {
  workflow_runs: Array<{
    conclusion: 'success' | 'failure' | 'cancelled' | null;
  }>;
}

export async function handleStatusCommand(
  interaction: ChatInputCommandInteraction,
  githubToken: string,
  repo: string
): Promise<void> {
  if (!REPO_NAME_PATTERN.test(repo)) {
    await interaction.reply('Invalid repository format');
    return;
  }

  await interaction.deferReply();

  try {
    // Fetch open PRs, open issues, and latest release in parallel
    const [prsResponse, issuesResponse, releasesResponse, workflowsResponse] =
      await Promise.all([
        fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`, {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: 'application/vnd.github+json',
          },
        }),
        fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=100`, {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: 'application/vnd.github+json',
          },
        }),
        fetch(`https://api.github.com/repos/${repo}/releases?per_page=1`, {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: 'application/vnd.github+json',
          },
        }),
        fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=5&status=completed`, {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: 'application/vnd.github+json',
          },
        }),
      ]);

    if (!prsResponse.ok || !issuesResponse.ok) {
      throw new Error('Failed to fetch data from GitHub');
    }

    const prs = (await prsResponse.json()) as GitHubPr[];
    const allIssues = (await issuesResponse.json()) as GitHubIssue[];
    const releases = releasesResponse.ok
      ? ((await releasesResponse.json()) as GitHubRelease[])
      : [];
    const workflows = workflowsResponse.ok
      ? ((await workflowsResponse.json()) as GitHubWorkflowRuns)
      : { workflow_runs: [] };

    // Filter out PRs from issues (GitHub includes PRs in issues endpoint)
    const issues = allIssues.filter((i) => !i.pull_request);

    // Calculate stats
    const draftPrs = prs.filter((pr) => pr.draft).length;
    const readyPrs = prs.length - draftPrs;

    // Get latest workflow status
    const latestWorkflow = workflows.workflow_runs?.[0];
    const ciStatus = latestWorkflow
      ? latestWorkflow.conclusion === 'success'
        ? '✅ Passing'
        : latestWorkflow.conclusion === 'failure'
          ? '❌ Failing'
          : '⚪ Unknown'
      : '—';

    // Get latest release
    const latestRelease = releases[0];
    const releaseText = latestRelease
      ? `${latestRelease.tag_name} (${new Date(latestRelease.published_at).toLocaleDateString()})`
      : 'No releases';

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle(`📊 Project Status: ${repo.split('/')[1]}`)
      .addFields(
        {
          name: '🔀 Open PRs',
          value: `${readyPrs} ready, ${draftPrs} draft`,
          inline: true,
        },
        {
          name: '🟢 Open Issues',
          value: `${issues.length}`,
          inline: true,
        },
        {
          name: '🔄 CI Status',
          value: ciStatus,
          inline: true,
        },
        {
          name: '🚀 Latest Release',
          value: releaseText,
          inline: true,
        }
      );

    // Add list of open PRs if any
    if (prs.length > 0 && prs.length <= 5) {
      embed.addFields({
        name: 'Recent PRs',
        value: prs
          .slice(0, 5)
          .map((pr) => {
            const draft = pr.draft ? ' (draft)' : '';
            const title =
              pr.title.length > 40
                ? pr.title.substring(0, 37) + '...'
                : pr.title;
            return `• #${pr.number} ${title}${draft}`;
          })
          .join('\n'),
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[repo-relay] Error fetching status:', safeErrorMessage(error));
    await interaction.editReply('Failed to fetch project status');
  }
}
