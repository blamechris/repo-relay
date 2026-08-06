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
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    // of hanging until the timeout — EOF cancels the wizard: '❌ Setup
    // cancelled.' and exit 1 (#183)
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
    const { code, stdout, stderr } = await run([CLI_PATH, 'init']);
    expect(stdout).toContain('repo-relay Setup');
    expect(stdout).toContain('Enter your Discord bot token');
    expect(stdout + stderr).not.toContain('DISCORD_BOT_TOKEN is required');
    expect(stdout).not.toContain('[repo-relay] Starting...');
    // stdin EOF mid-prompt is a cancellation, not success (#183): a scripted
    // caller must see failure when no workflow file was written
    expect(stdout).toContain('❌ Setup cancelled.');
    expect(code).toBe(1);
  }, IT_TIMEOUT);

  it('still starts the wizard when setup.js is the entry point (repo-relay-init bin)', async () => {
    const { code, stdout } = await run([SETUP_PATH]);
    expect(stdout).toContain('repo-relay Setup');
    // The bot connects with only the unprivileged Guilds intent — Step 1
    // must not tell users to enable privileged intents (#182)
    expect(stdout).toContain('No privileged intents needed');
    expect(stdout).not.toContain('Enable intents');
    // Same EOF-cancel contract via this bin (#183)
    expect(stdout).toContain('❌ Setup cancelled.');
    expect(code).toBe(1);
  }, IT_TIMEOUT);

  it('Esc at the final prompt cancels without writing the workflow file', async () => {
    // The exit guard can't see this path — the wizard runs to completion —
    // so the explicit undefined check after the CI-workflow-name prompt is
    // the only defense (#183): without it, Esc there wrote the workflow file
    // and exited 0. Drives the real wizard over piped stdin, answering each
    // prompt as its message appears, then aborting the last one.
    const wizardCwd = mkdtempSync(join(tmpdir(), 'repo-relay-esc-test-'));
    try {
      const steps = [
        { marker: 'Enter your Discord bot token', reply: 'test-token\n' },
        { marker: 'Enter channel ID for PR notifications', reply: '123\n' },
        { marker: 'Project type', reply: '\n' }, // first choice: library
        { marker: 'Enable review polling', reply: 'n\n' },
        { marker: 'Channel ID for issues', reply: '\n' }, // blank = PR channel
        { marker: 'Channel ID for releases', reply: '\n' },
        { marker: 'Name of your CI workflow', reply: '\x1b' }, // Esc: abort
      ];
      const result = await new Promise<{ code: number | null; stdout: string }>(
        (resolve, reject) => {
          const child = spawn(process.execPath, [SETUP_PATH], {
            cwd: wizardCwd,
            env: { PATH: process.env.PATH },
          });
          let stdout = '';
          let step = 0;
          const killer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`wizard hung at step ${step}; output:\n${stdout}`));
          }, 30_000);
          child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
            // Answer only the prompt we're waiting on: prompts re-renders
            // past prompts on every keystroke, so a plain includes() scan
            // over all steps would double-fire
            while (step < steps.length && stdout.includes(steps[step].marker)) {
              child.stdin.write(steps[step].reply);
              step++;
            }
          });
          child.on('close', (code) => {
            clearTimeout(killer);
            resolve({ code, stdout });
          });
          child.on('error', (err) => {
            clearTimeout(killer);
            reject(err);
          });
        }
      );
      expect(result.stdout).toContain('❌ Setup cancelled.');
      expect(result.stdout).not.toContain('🎉 Done!');
      expect(result.code).toBe(1);
      expect(existsSync(join(wizardCwd, '.github', 'workflows', 'discord-notify.yml'))).toBe(false);
    } finally {
      rmSync(wizardCwd, { recursive: true, force: true });
    }
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
});
