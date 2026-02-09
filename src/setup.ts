#!/usr/bin/env node
/**
 * Interactive setup wizard for repo-relay
 *
 * Usage: npx blamechris/repo-relay init
 */

import prompts from 'prompts';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { safeErrorMessage } from './utils/errors.js';
import { buildWorkflowTemplate, type ProjectFeatures } from './setup/workflow-template.js';

const PROJECT_TYPES: Record<'library' | 'webapp' | 'app' | 'minimal', ProjectFeatures> = {
  library: { issues: true,  releases: true,  deployments: false, reviewPolling: false },
  webapp:  { issues: true,  releases: false, deployments: false, reviewPolling: false },
  app:     { issues: true,  releases: false, deployments: true,  reviewPolling: false },
  minimal: { issues: false, releases: false, deployments: false, reviewPolling: false },
};

function getRepoUrl(): string | null {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    // Convert git@github.com:owner/repo.git or https://github.com/owner/repo.git to owner/repo
    const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    return match ? match[1].replace(/\.git$/, '') : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log('\n🚀 \x1b[1mrepo-relay Setup\x1b[0m\n');

  // Step 1: Discord Bot Token
  console.log('\x1b[36mStep 1: Discord Bot Token\x1b[0m');
  console.log('────────────────────────────────────────');
  console.log('1. Go to https://discord.com/developers/applications');
  console.log('2. Create new application → Bot → Reset Token');
  console.log('3. Enable intents: Message Content Intent, Server Members Intent');
  console.log('4. Copy the token\n');

  const { botToken } = await prompts({
    type: 'password',
    name: 'botToken',
    message: 'Enter your Discord bot token:',
    validate: (value: string) => value.length > 0 || 'Bot token is required',
  });

  if (!botToken) {
    console.log('\n❌ Setup cancelled.\n');
    process.exit(1);
  }

  // Step 2: PR Channel
  console.log('\n\x1b[36mStep 2: PR Notifications Channel\x1b[0m');
  console.log('────────────────────────────────────────');
  console.log('1. Enable Developer Mode in Discord (Settings → Advanced)');
  console.log('2. Right-click your notifications channel → Copy ID\n');

  const { channelPrs } = await prompts({
    type: 'text',
    name: 'channelPrs',
    message: 'Enter channel ID for PR notifications:',
    validate: (value: string) => /^\d+$/.test(value) || 'Channel ID must be a number',
  });

  if (!channelPrs) {
    console.log('\n❌ Setup cancelled.\n');
    process.exit(1);
  }

  // Step 3: Project Type
  console.log('\n\x1b[36mStep 3: Project Type\x1b[0m');
  console.log('────────────────────────────────────────');
  console.log('Choose a template to configure which events trigger notifications.\n');

  const { projectType } = await prompts({
    type: 'select',
    name: 'projectType',
    message: 'Project type:',
    choices: [
      { title: 'Library / Package', description: 'PRs, CI, reviews, issues, releases', value: 'library' },
      { title: 'Web App / Backend', description: 'PRs, CI, reviews, issues', value: 'webapp' },
      { title: 'App / Service', description: 'PRs, CI, reviews, issues, deployments', value: 'app' },
      { title: 'Minimal', description: 'PRs, CI, reviews only', value: 'minimal' },
      { title: 'Custom', description: 'Choose individual features', value: 'custom' },
    ],
  });

  if (projectType === undefined) {
    console.log('\n❌ Setup cancelled.\n');
    process.exit(1);
  }

  // Determine features
  let features: ProjectFeatures;

  if (projectType === 'custom') {
    const { customFeatures } = await prompts({
      type: 'multiselect',
      name: 'customFeatures',
      message: 'Select additional features:',
      // Issues pre-selected: most projects benefit from issue tracking
      choices: [
        { title: 'Issue notifications', value: 'issues', selected: true },
        { title: 'Release notifications', value: 'releases' },
        { title: 'Deployment notifications', value: 'deployments' },
        { title: 'Review polling (every 5 min)', value: 'reviewPolling' },
      ],
    });

    if (!customFeatures) {
      console.log('\n❌ Setup cancelled.\n');
      process.exit(1);
    }

    features = {
      issues: (customFeatures as string[]).includes('issues'),
      releases: (customFeatures as string[]).includes('releases'),
      deployments: (customFeatures as string[]).includes('deployments'),
      reviewPolling: (customFeatures as string[]).includes('reviewPolling'),
    };
  } else {
    features = PROJECT_TYPES[projectType as keyof typeof PROJECT_TYPES];
  }

  // Review polling opt-in (for non-custom types; custom includes it in multiselect)
  if (projectType !== 'custom') {
    const { enablePolling } = await prompts({
      type: 'confirm',
      name: 'enablePolling',
      message: 'Enable review polling? (catches Copilot reviews within ~5 min; best with self-hosted runner since ephemeral runners lose state)',
      initial: false,
    });

    if (enablePolling) {
      features = { ...features, reviewPolling: true };
    }
  }

  // Step 4: Channel IDs for enabled features
  let channelIssues = '';
  let channelReleases = '';
  let channelDeployments = '';

  if (features.issues || features.releases || features.deployments) {
    console.log('\n\x1b[36mStep 4: Additional Channels (optional)\x1b[0m');
    console.log('────────────────────────────────────────');
    console.log('Leave blank to use the PR channel for all notifications.\n');

    if (features.issues) {
      const result = await prompts({
        type: 'text',
        name: 'channelIssues',
        message: 'Channel ID for issues (blank = use PR channel):',
        validate: (value: string) => value === '' || /^\d+$/.test(value) || 'Must be a number or blank',
      });
      if (!result || result.channelIssues === undefined) {
        console.log('\n❌ Setup cancelled.\n');
        process.exit(1);
      }
      channelIssues = result.channelIssues ?? '';
    }

    if (features.releases) {
      const result = await prompts({
        type: 'text',
        name: 'channelReleases',
        message: 'Channel ID for releases (blank = use PR channel):',
        validate: (value: string) => value === '' || /^\d+$/.test(value) || 'Must be a number or blank',
      });
      if (!result || result.channelReleases === undefined) {
        console.log('\n❌ Setup cancelled.\n');
        process.exit(1);
      }
      channelReleases = result.channelReleases ?? '';
    }

    if (features.deployments) {
      const result = await prompts({
        type: 'text',
        name: 'channelDeployments',
        message: 'Channel ID for deployments (blank = use PR channel):',
        validate: (value: string) => value === '' || /^\d+$/.test(value) || 'Must be a number or blank',
      });
      if (!result || result.channelDeployments === undefined) {
        console.log('\n❌ Setup cancelled.\n');
        process.exit(1);
      }
      channelDeployments = result.channelDeployments ?? '';
    }
  }

  // Step 5: CI Workflow name
  const stepNum = (features.issues || features.releases || features.deployments) ? 5 : 4;
  console.log(`\n\x1b[36mStep ${stepNum}: CI Workflow Name\x1b[0m`);
  console.log('────────────────────────────────────────');
  console.log('This is the name of your CI workflow (for tracking CI status).\n');

  const { ciWorkflow } = await prompts({
    type: 'text',
    name: 'ciWorkflow',
    message: 'Name of your CI workflow:',
    initial: 'CI',
    validate: (value: string) => /["\\]|\n|\r/.test(value)
      ? 'Workflow name cannot contain quotes, backslashes, or newlines'
      : true,
  });

  // Create workflow file
  const workflowDir = join(process.cwd(), '.github', 'workflows');
  const workflowPath = join(workflowDir, 'discord-notify.yml');

  if (!existsSync(workflowDir)) {
    mkdirSync(workflowDir, { recursive: true });
  }

  if (existsSync(workflowPath)) {
    const { overwrite } = await prompts({
      type: 'confirm',
      name: 'overwrite',
      message: 'discord-notify.yml already exists. Overwrite?',
      initial: false,
    });

    if (!overwrite) {
      console.log('\n❌ Setup cancelled.\n');
      process.exit(1);
    }
  }

  writeFileSync(workflowPath, buildWorkflowTemplate(ciWorkflow || 'CI', features));
  console.log('\n✅ Created .github/workflows/discord-notify.yml\n');

  // Final instructions
  const repoUrl = getRepoUrl();
  const secretsUrl = repoUrl
    ? `https://github.com/${repoUrl}/settings/secrets/actions`
    : 'https://github.com/<owner>/<repo>/settings/secrets/actions';

  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│ \x1b[33m⚠️  FINAL STEP: Add secrets to GitHub\x1b[0m                        │');
  console.log('│                                                             │');
  console.log(`│ Go to: \x1b[4m${secretsUrl}\x1b[0m`);
  console.log('│                                                             │');
  console.log('│ Add these repository secrets:                               │');
  console.log(`│   \x1b[1mDISCORD_BOT_TOKEN\x1b[0m   = ${botToken.substring(0, 10)}...`);
  console.log(`│   \x1b[1mDISCORD_CHANNEL_PRS\x1b[0m = ${channelPrs}`);
  if (features.issues && channelIssues) {
    console.log(`│   \x1b[1mDISCORD_CHANNEL_ISSUES\x1b[0m = ${channelIssues}`);
  }
  if (features.releases && channelReleases) {
    console.log(`│   \x1b[1mDISCORD_CHANNEL_RELEASES\x1b[0m = ${channelReleases}`);
  }
  if (features.deployments && channelDeployments) {
    console.log(`│   \x1b[1mDISCORD_CHANNEL_DEPLOYMENTS\x1b[0m = ${channelDeployments}`);
  }
  console.log('└─────────────────────────────────────────────────────────────┘');

  console.log('\n🎉 Done! Commit and push to enable Discord notifications.\n');
}

main().catch((error) => {
  console.error('Error:', safeErrorMessage(error));
  process.exit(1);
});
