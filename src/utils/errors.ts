import { DiscordAPIError, DiscordjsError, DiscordjsErrorCodes } from 'discord.js';

/** Extract a safe message from an unknown thrown value. */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * A definitive configuration problem (bad token, missing channel/permissions)
 * that the repo owner must fix — as opposed to transient infrastructure
 * trouble. Under best-effort delivery these still fail the run.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const UNKNOWN_CHANNEL = 10003; // RESTJSONErrorCodes.UnknownChannel

/**
 * Is this a definitive configuration error (vs transient infrastructure)?
 *
 * The config-fatal set is deliberately a closed enumeration: outage shapes
 * are open-ended, and an unclassified transient error tolerated as
 * best-effort is annoying, while an unclassified transient error treated as
 * config would re-create a red X on every PR until the action is patched.
 */
export function isConfigError(error: unknown): boolean {
  if (error instanceof ConfigError) return true;
  // Invalid bot token, rejected by client.login before any request is made
  if (error instanceof DiscordjsError) {
    return error.code === DiscordjsErrorCodes.TokenInvalid;
  }
  // REST-level: malformed request (e.g. non-numeric channel ID), bad auth,
  // no access to the channel, or channel deleted
  if (error instanceof DiscordAPIError) {
    if (error.status === 400 || error.status === 401 || error.status === 403) return true;
    return error.code === UNKNOWN_CHANNEL;
  }
  // Message fallbacks, same pattern as discord-errors.ts: gateway-level auth
  // failures (disallowed intents, close code 4014) surface as plain Errors
  // from @discordjs/ws, and wrapped channel-lookup errors lose their class
  if (error instanceof Error) {
    return /invalid token|disallowed intents|unknown channel/i.test(error.message);
  }
  return false;
}
