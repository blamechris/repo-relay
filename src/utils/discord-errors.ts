/**
 * Discord error classification helpers.
 *
 * Error-code checks are primary (stable across discord.js versions); the
 * message-substring fallbacks tolerate wrapped errors and keep behavior
 * consistent for callers that surface plain Errors.
 */

import { DiscordAPIError, DiscordjsError, DiscordjsErrorCodes } from 'discord.js';
import { ConfigError } from './errors.js';

const UNKNOWN_CHANNEL = 10003; // RESTJSONErrorCodes.UnknownChannel
const UNKNOWN_MESSAGE = 10008; // RESTJSONErrorCodes.UnknownMessage
const THREAD_ALREADY_CREATED = 160004; // RESTJSONErrorCodes.ThreadAlreadyCreatedForThisMessage

/**
 * Is this a definitive configuration error (vs transient infrastructure)?
 *
 * The config-fatal set is deliberately a closed enumeration: outage shapes
 * are open-ended, and an unclassified transient error tolerated as
 * best-effort is annoying, while an unclassified transient error treated as
 * config would re-create a red X on every PR until the action is patched.
 *
 * Lives here rather than errors.ts because it needs the discord.js error
 * classes — errors.ts stays dependency-free for the setup wizard (#185).
 */
export function isConfigError(error: unknown): boolean {
  if (error instanceof ConfigError) return true;
  // Invalid bot token, rejected by client.login before any request is made.
  // No early return for other DiscordjsError codes — they fall through to
  // the message check below (e.g. DisallowedIntents)
  if (error instanceof DiscordjsError && error.code === DiscordjsErrorCodes.TokenInvalid) {
    return true;
  }
  // REST-level: malformed request (e.g. non-numeric channel ID), bad auth,
  // no access to the channel, or channel deleted
  if (error instanceof DiscordAPIError) {
    if (error.status === 400 || error.status === 401 || error.status === 403) return true;
    return error.code === UNKNOWN_CHANNEL;
  }
  // Message fallbacks, same pattern as the helpers below: gateway-level auth
  // failures (disallowed intents, close code 4014) surface as plain Errors
  // from @discordjs/ws ('Used disallowed intents'), discord.js's own intent
  // error says 'Privileged intent...', and wrapped channel-lookup errors
  // lose their class
  if (error instanceof Error) {
    return /invalid token|disallowed intents|privileged intent|unknown channel/i.test(error.message);
  }
  return false;
}

/** The referenced message no longer exists on Discord (stale DB entry). */
export function isUnknownMessageError(error: unknown): boolean {
  if (error instanceof DiscordAPIError && error.code === UNKNOWN_MESSAGE) return true;
  return error instanceof Error && error.message.includes('Unknown Message');
}

/** startThread was called on a message that already has a (possibly archived) thread. */
export function isThreadAlreadyCreatedError(error: unknown): boolean {
  if (error instanceof DiscordAPIError && error.code === THREAD_ALREADY_CREATED) return true;
  return error instanceof Error && error.message.includes('already been created for this message');
}
