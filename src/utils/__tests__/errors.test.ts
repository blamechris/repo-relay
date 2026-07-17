import { describe, it, expect } from 'vitest';
import { DiscordAPIError, DiscordjsError, DiscordjsErrorCodes } from 'discord.js';
import { ConfigError, isConfigError, safeErrorMessage } from '../errors.js';

describe('safeErrorMessage', () => {
  it('returns .message for Error instances', () => {
    const err = new Error('something broke');
    expect(safeErrorMessage(err)).toBe('something broke');
  });

  it('does not return the stack trace', () => {
    const err = new Error('oops');
    const result = safeErrorMessage(err);
    expect(result).not.toContain('at ');
    expect(result).toBe('oops');
  });

  it('returns the string itself for string errors', () => {
    expect(safeErrorMessage('plain string')).toBe('plain string');
  });

  it('returns "null" for null', () => {
    expect(safeErrorMessage(null)).toBe('null');
  });

  it('returns "undefined" for undefined', () => {
    expect(safeErrorMessage(undefined)).toBe('undefined');
  });

  it('returns stringified object for plain objects', () => {
    expect(safeErrorMessage({ key: 'value' })).toBe('[object Object]');
  });
});

describe('ConfigError', () => {
  it('is an Error with name ConfigError', () => {
    const err = new ConfigError('bad config');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ConfigError');
    expect(err.message).toBe('bad config');
  });
});

describe('isConfigError', () => {
  function makeApiError(status: number, code = 0): DiscordAPIError {
    return new DiscordAPIError(
      { code, message: 'api error' },
      code,
      status,
      'GET',
      '/test',
      { body: undefined, files: undefined }
    );
  }

  it('classifies ConfigError instances as config', () => {
    expect(isConfigError(new ConfigError('Missing Discord permissions in 1 channel(s)'))).toBe(true);
  });

  it('classifies an invalid token (DiscordjsError TokenInvalid) as config', () => {
    expect(isConfigError(new DiscordjsError(DiscordjsErrorCodes.TokenInvalid))).toBe(true);
  });

  it('classifies REST 400/401/403 as config', () => {
    expect(isConfigError(makeApiError(400))).toBe(true); // e.g. malformed channel ID
    expect(isConfigError(makeApiError(401))).toBe(true);
    expect(isConfigError(makeApiError(403, 50001))).toBe(true); // Missing Access
  });

  it('classifies Unknown Channel (10003) as config', () => {
    expect(isConfigError(makeApiError(404, 10003))).toBe(true);
  });

  it('classifies gateway auth failures by message (plain Errors from @discordjs/ws)', () => {
    expect(isConfigError(new Error('Used disallowed intents'))).toBe(true);
    expect(isConfigError(new Error('An invalid token was provided.'))).toBe(true);
  });

  it('classifies wrapped Unknown Channel errors by message', () => {
    expect(isConfigError(new Error('Unknown Channel'))).toBe(true);
  });

  it('classifies non-TokenInvalid DiscordjsError intent failures via the message fallback', () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- pinning the fall-through for the deprecated code path
    expect(isConfigError(new DiscordjsError(DiscordjsErrorCodes.DisallowedIntents))).toBe(true);
  });

  it('does NOT classify Discord 5xx as config', () => {
    expect(isConfigError(makeApiError(500))).toBe(false);
    expect(isConfigError(makeApiError(503))).toBe(false);
  });

  it('does NOT classify other 404s (e.g. Unknown Message) as config', () => {
    expect(isConfigError(makeApiError(404, 10008))).toBe(false);
  });

  it('does NOT classify network/timeout/session errors as config', () => {
    expect(isConfigError(new Error('Internal Server Error'))).toBe(false);
    expect(isConfigError(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }))).toBe(false);
    expect(isConfigError(new Error('Discord ready event not received within 60s'))).toBe(false);
    expect(isConfigError(new Error('Session limit exhausted. Resets at 2026-01-01T00:00:00Z'))).toBe(false);
  });

  it('does NOT classify non-Error values as config', () => {
    expect(isConfigError('string error')).toBe(false);
    expect(isConfigError(null)).toBe(false);
    expect(isConfigError(undefined)).toBe(false);
  });
});
