import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordAPIError } from 'discord.js';
import { withRetry } from '../retry.js';

function makeDiscordError(status: number): DiscordAPIError {
  return new DiscordAPIError(
    { code: 0, message: 'Server Error' },
    0,
    status,
    'POST',
    '/test',
    { body: undefined, files: undefined }
  );
}

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(makeDiscordError(500))
      .mockResolvedValue('recovered');

    const promise = withRetry(fn, 3, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('uses exponential backoff delays', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(makeDiscordError(502))
      .mockRejectedValueOnce(makeDiscordError(503))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, 3, 1000);

    // First retry after 1000ms (1000 * 2^0)
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    // After 1000ms total, second attempt fires
    expect(fn).toHaveBeenCalledTimes(2);

    // Second retry after 2000ms (1000 * 2^1)
    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect(result).toBe('ok');
  });

  it('throws after max retries exhausted', async () => {
    const error = makeDiscordError(500);
    const fn = vi.fn().mockRejectedValue(error);

    const promise = withRetry(fn, 3, 1000).catch((e) => e);

    // Advance through all retry delays: 1000 + 2000 + 4000
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);

    const result = await promise;
    expect(result).toBe(error);
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('does not retry 4xx errors', async () => {
    const error = makeDiscordError(404);
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-Discord errors', async () => {
    const error = new Error('network failure');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('logs retry attempts', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fn = vi.fn()
      .mockRejectedValueOnce(makeDiscordError(500))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, 3, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(logSpy).toHaveBeenCalledWith(
      '[repo-relay] Discord API error, retrying in 1000ms (attempt 1/3)...'
    );
  });
});
