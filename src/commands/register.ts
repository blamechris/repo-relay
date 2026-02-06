/**
 * Discord slash command registration
 *
 * This module registers the bot's slash commands with Discord.
 * Run this once when setting up the bot or when commands change.
 */

import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { safeErrorMessage } from '../utils/errors.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('pr')
    .setDescription('Get PR information')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('show')
        .setDescription('Show details for a specific PR')
        .addIntegerOption((option) =>
          option
            .setName('number')
            .setDescription('PR number')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List open PRs')
    ),

  new SlashCommandBuilder()
    .setName('issue')
    .setDescription('Get issue information')
    .addIntegerOption((option) =>
      option
        .setName('number')
        .setDescription('Issue number')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show project health overview'),
];

export async function registerCommands(
  token: string,
  clientId: string,
  guildId?: string
): Promise<void> {
  const rest = new REST().setToken(token);

  const commandsJson = commands.map((cmd) => cmd.toJSON());

  console.log(`[repo-relay] Registering ${commandsJson.length} slash commands...`);

  if (guildId) {
    // Register guild commands (instant, for testing)
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commandsJson,
    });
    console.log(`[repo-relay] Registered commands for guild ${guildId}`);
  } else {
    // Register global commands (takes up to 1 hour to propagate)
    await rest.put(Routes.applicationCommands(clientId), {
      body: commandsJson,
    });
    console.log('[repo-relay] Registered global commands');
  }
}

// CLI for registering commands
if (process.argv[1]?.endsWith('register.ts') || process.argv[1]?.endsWith('register.js')) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !clientId) {
    console.error('DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID are required');
    process.exit(1);
  }

  registerCommands(token, clientId, guildId)
    .then(() => {
      console.log('[repo-relay] Command registration complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[repo-relay] Command registration failed:', safeErrorMessage(error));
      process.exit(1);
    });
}
