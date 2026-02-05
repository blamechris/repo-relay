/**
 * Discord slash command registration
 *
 * This module registers the bot's slash commands with Discord.
 * Run this once when setting up the bot or when commands change.
 */
export declare const commands: (import("discord.js").SlashCommandOptionsOnlyBuilder | import("discord.js").SlashCommandSubcommandsOnlyBuilder)[];
export declare function registerCommands(token: string, clientId: string, guildId?: string): Promise<void>;
//# sourceMappingURL=register.d.ts.map