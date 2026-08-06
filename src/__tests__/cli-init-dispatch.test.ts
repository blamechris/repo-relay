/**
 * Integration tests for the `init` dispatch in cli.ts (#181).
 *
 * `npx blamechris/repo-relay init` runs the `repo-relay` bin (npm picks the
 * bin matching the package name), so cli.js must hand `init` to the setup
 * wizard before any env-var checks. Spawns the committed dist/cli.js — what
 * consumers actually execute; CI's dist-freshness job guarantees it matches
 * src/.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLI_PATH = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const SETUP_PATH = fileURLToPath(new URL('../../dist/setup.js', import.meta.url));

// Must exceed run()'s 30s execFile timeout — vitest's 5s default would kill
// the test first, making the fail-loudly signal branch in run() unreachable
const IT_TIMEOUT = 35_000;

let fixtureDir: string;

function run(
  args: string[],
  file: string = process.execPath
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        timeout: 30_000,
        // Minimal env: the init path must work with no DISCORD_*/GITHUB_* set.
        // (PATH-only env breaks spawns on Windows — SystemRoot/COMSPEC gone —
        // but CI is ubuntu-only, matching cli-best-effort.test.ts.)
        env: { PATH: process.env.PATH },
        cwd: fixtureDir,
      },
      (error, stdout, stderr) => {
        // Signal kills (the 30s timeout) surface as code:null + signal, and
        // spawn failures as a string code — both must fail loudly rather
        // than masquerade as an exit code
        if (error && (error.signal || typeof error.code !== 'number')) {
          return reject(error);
        }
        resolve({ code: (error?.code as number) ?? 0, stdout, stderr });
      }
    );
    // Close stdin so wizard-path children exit at the first prompt instead
    // of hanging until the timeout — EOF makes the event loop drain and node
    // exit 0 mid-prompt (#183), not a clean cancellation
    child.stdin?.end();
  });
}

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'repo-relay-init-test-'));
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('cli init dispatch', () => {
  it('reaches the setup wizard before any env-var checks', async () => {
    const { stdout, stderr } = await run([CLI_PATH, 'init']);
    expect(stdout).toContain('repo-relay Setup');
    expect(stdout).toContain('Enter your Discord bot token');
    expect(stdout + stderr).not.toContain('DISCORD_BOT_TOKEN is required');
    expect(stdout).not.toContain('[repo-relay] Starting...');
    // No exit-code assertion: on stdin EOF the prompts promise never settles,
    // the event loop drains, and node exits 0 mid-prompt — pre-existing
    // wizard behavior (identical via the repo-relay-init bin), tracked as
    // #183 separately from the dispatch this test covers.
  }, IT_TIMEOUT);

  it('still starts the wizard when setup.js is the entry point (repo-relay-init bin)', async () => {
    const { stdout } = await run([SETUP_PATH]);
    expect(stdout).toContain('repo-relay Setup');
    // The bot connects with only the unprivileged Guilds intent — Step 1
    // must not tell users to enable privileged intents (#182)
    expect(stdout).toContain('No privileged intents needed');
    expect(stdout).not.toContain('Enable intents');
  }, IT_TIMEOUT);

  it('still requires env vars on the bare GitHub Actions path', async () => {
    const { code, stdout, stderr } = await run([CLI_PATH]);
    expect(stdout + stderr).toContain('DISCORD_BOT_TOKEN is required');
    expect(stdout).not.toContain('repo-relay Setup');
    expect(code).toBe(1);
  }, IT_TIMEOUT);

  it('does not auto-run the wizard when setup.js is imported', async () => {
    const importer = join(fixtureDir, 'import-setup.mjs');
    writeFileSync(
      importer,
      `await import(${JSON.stringify(pathToFileURL(SETUP_PATH).href)});\nconsole.log('IMPORT_OK');\n`
    );
    const { code, stdout } = await run([importer]);
    expect(stdout).toContain('IMPORT_OK');
    expect(stdout).not.toContain('repo-relay Setup');
    expect(code).toBe(0);
  }, IT_TIMEOUT);

  it('reaches the wizard with the Actions runtime deps unresolvable (#185)', async () => {
    // Module hooks that make the heavy runtime deps fail at resolution: if
    // either wizard path still imported discord.js or better-sqlite3 eagerly
    // (directly or transitively, e.g. via utils/errors.js), the child would
    // crash before the banner prints. register() needs node >= 20.6 — the
    // engines floor.
    const hooks = join(fixtureDir, 'reject-heavy-hooks.mjs');
    writeFileSync(
      hooks,
      `export function resolve(specifier, context, next) {
  if (specifier === 'discord.js' || specifier === 'better-sqlite3') {
    throw new Error('Actions runtime dep loaded on the init path: ' + specifier);
  }
  return next(specifier, context);
}
`
    );
    const registrar = join(fixtureDir, 'reject-heavy.mjs');
    writeFileSync(
      registrar,
      `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(hooks).href)});\n`
    );

    for (const args of [
      ['--import', registrar, CLI_PATH, 'init'], // repo-relay init dispatch
      ['--import', registrar, SETUP_PATH], // standalone repo-relay-init bin
    ]) {
      const { stdout, stderr } = await run(args);
      expect(stderr).not.toContain('Actions runtime dep loaded');
      expect(stdout).toContain('repo-relay Setup');
      expect(stdout).toContain('Enter your Discord bot token');
    }
  }, IT_TIMEOUT);
});
