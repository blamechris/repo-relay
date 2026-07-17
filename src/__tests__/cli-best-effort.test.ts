/**
 * Integration tests for the best_effort CLI path (#171).
 *
 * Spawns the committed dist/cli.js (what consumers actually execute — CI's
 * dist-freshness job guarantees it matches src/) with DNS stubbed to fail,
 * producing a deterministic transient infrastructure error without touching
 * the network. Config-error classification is unit-tested in
 * utils/__tests__/errors.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const CLI_PATH = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

const KILL_DNS = `
import dns from 'node:dns'
const err = () => Object.assign(new Error('getaddrinfo ENOTFOUND discord.com'), { code: 'ENOTFOUND', syscall: 'getaddrinfo' })
const failCb = (...args) => { const cb = args[args.length - 1]; process.nextTick(() => cb(err())) }
dns.lookup = failCb
dns.promises.lookup = async () => { throw err() }
dns.resolve = failCb
dns.resolve4 = failCb
dns.resolve6 = failCb
`;

const EVENT = JSON.stringify({
  action: 'opened',
  pull_request: {
    number: 1,
    title: 't',
    html_url: 'https://example.com',
    user: { login: 'u' },
    head: { ref: 'h', sha: 'abc' },
    base: { ref: 'main' },
    draft: false,
  },
  repository: { full_name: 'blamechris/best-effort-test' },
});

let fixtureDir: string;

function runCli(bestEffort: string | undefined): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['--import', pathToFileURL(join(fixtureDir, 'kill-dns.mjs')).href, CLI_PATH],
      {
        timeout: 60_000,
        env: {
          PATH: process.env.PATH,
          DISCORD_BOT_TOKEN: 'faketoken',
          DISCORD_CHANNEL_PRS: '123',
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: join(fixtureDir, 'event.json'),
          STATE_DIR: join(fixtureDir, 'state'),
          ...(bestEffort !== undefined ? { REPO_RELAY_BEST_EFFORT: bestEffort } : {}),
        },
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error); // spawn failure, not exit code
        resolve({ code: error ? (error.code as number) : 0, stdout, stderr });
      }
    );
  });
}

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'repo-relay-best-effort-'));
  writeFileSync(join(fixtureDir, 'kill-dns.mjs'), KILL_DNS);
  writeFileSync(join(fixtureDir, 'event.json'), EVENT);
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('cli best-effort delivery (transient infrastructure failure)', () => {
  it('exits 0 with a ::warning:: annotation when REPO_RELAY_BEST_EFFORT=true', async () => {
    const { code, stdout } = await runCli('true');
    expect(code).toBe(0);
    expect(stdout).toContain('::warning::');
    expect(stdout).toContain('Notification not delivered (best-effort)');
  }, 90_000);

  it("accepts '1' as truthy", async () => {
    const { code, stdout } = await runCli('1');
    expect(code).toBe(0);
    expect(stdout).toContain('::warning::');
  }, 90_000);

  it('exits 1 with an ERROR when best_effort is unset (default unchanged)', async () => {
    const { code, stdout, stderr } = await runCli(undefined);
    expect(code).toBe(1);
    expect(stdout + stderr).toContain('[repo-relay] ERROR:');
    expect(stdout).not.toContain('::warning::');
  }, 90_000);

  it("exits 1 when best_effort is 'false'", async () => {
    const { code } = await runCli('false');
    expect(code).toBe(1);
  }, 90_000);
});
