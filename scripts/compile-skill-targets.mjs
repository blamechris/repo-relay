#!/usr/bin/env node
// compile-skill-targets.mjs — model-agnostic skill compiler.
//
// The repo-customized install at `.claude/commands/<name>.md` is the
// provider-NEUTRAL source of truth (markdown instructions + $ARGUMENTS). This
// script compiles it into each coding agent's NATIVE custom-command format so
// the same skill is first-party under whichever model you drive:
//
//   claude -> .claude/skills/<name>/SKILL.md        (md + YAML frontmatter; v2.1.x "skills")
//   gemini -> .gemini/commands/<name>.toml          (TOML: prompt + description; {{args}})
//   codex  -> .codex/skills/<name>/SKILL.md         (md + YAML frontmatter; repo-tracked Codex skill)
//   pi     -> ~/.pi/agent/skills/<name>/SKILL.md    (md + YAML frontmatter; user-global, /skill:<name>)
//
// Note the asymmetry: claude/gemini/codex all emit INTO the repo (version-controlled,
// reviewable); `pi` has no repo-local discovery, so it emits to a user-global home
// dir and is opt-in. That is why only `pi` participates in the installed-but-
// unselected hint below.
//
// Targets come from `.claude/skill-profile.md` (a `targets:` line) unless
// overridden with --targets.
//
// Usage:
//   node scripts/compile-skill-targets.mjs [--name <name>] [--targets claude,gemini,codex,pi]
//        [--repo <root>] [--dry-run]
//
// Exit non-zero on emit failure so /skill and CI can gate on it.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

export const ALL_TARGETS = ['claude', 'gemini', 'codex', 'pi']

// Home-dir marker per target whose skills are USER-GLOBAL and opt-in. Only `pi`
// qualifies here: its skills land in `~/.pi/agent/skills/`, not the repo, and it is
// deliberately off the committed default `targets:`, so a Pi contributor can
// silently miss the dev-workflow skills.
//
// `codex` is deliberately NOT in this map, unlike the chroxy compiler this was
// ported from. There, codex emitted to `~/.codex/prompts/`; here it is repo-tracked
// (`.codex/skills/`, #111), so a `~/.codex` home dir says nothing about whether this
// repo's skills are compiled — same reasoning that keeps `gemini` out.
const AGENT_HOME_MARKERS = { pi: '.pi' }

// User-global skill dir per opt-in target, for the "installed but not selected" hint.
const AGENT_SKILL_DIRS = { pi: '~/.pi/agent/skills/' }

/**
 * Detect coding agents installed on this machine (their home dir exists) that are
 * NOT in the selected compile targets. Detection only — it never adds the target,
 * which would write to a home dir the user never asked about; the caller just prints
 * the flag to pass. Returns the unselected-but-present target ids.
 */
export function detectUncompiledAgents(targets, home = homedir()) {
  return Object.entries(AGENT_HOME_MARKERS)
    .filter(([target, dir]) => !targets.includes(target) && existsSync(join(home, dir)))
    .map(([target]) => target)
}

function parseArgs(argv) {
  const out = { repo: process.cwd(), dryRun: false }
  // Require a value after a value-taking flag, with a clear error instead of an
  // `undefined.split` stack trace.
  const need = (i, flag) => {
    if (i + 1 >= argv.length) {
      console.error(`Missing value for ${flag}`)
      process.exit(1)
    }
    return argv[i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--name') out.name = need(i++, a)
    else if (a === '--targets') out.targets = need(i++, a).split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--repo') out.repo = need(i++, a)
    else if (a === '--dry-run') out.dryRun = true
  }
  return out
}

// Read `targets:` from the repo's skill-profile (the profile-driven default).
function targetsFromProfile(repo) {
  const p = join(repo, '.claude/skill-profile.md')
  if (!existsSync(p)) return null
  const m = readFileSync(p, 'utf8').match(/^\s*targets:\s*(.+)$/m)
  if (!m) return null
  // Drop unfilled template placeholders (`<comma-separated agents…>`) so a profile
  // that still carries the placeholder degrades to the `claude` fallback rather than
  // erroring on an "unknown target".
  const list = m[1]
    .replace(/[[\]]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !s.includes('<') && !s.includes('>'))
  return list.length ? list : null
}

// Strip the registry version stamp — it's install metadata, not skill content.
function stripStamp(body) {
  return body.replace(/^<!--\s*skill-templates:.*?-->\s*$/gm, '').replace(/\n{3,}$/g, '\n').trimEnd() + '\n'
}

// Period-bearing abbreviations whose trailing dot must NOT be treated as end of
// sentence. A small deny-list, not a sentence tokenizer — extend only when a real
// skill description trips it (#737: "…session (e.g." shipped as a menu description).
const NON_TERMINAL_ABBREV = /\b(?:e\.g|i\.e|etc|vs|cf)\.$/i

// The 160 cap is a VISIBLE-LENGTH budget for a menu line, so it is measured in
// grapheme clusters, not UTF-16 code units. Slicing by `.length` splits astral
// characters: a bare `desc.slice(0, 157)` cut an emoji in half and emitted a lone
// surrogate into the YAML/TOML `description:` field (chroxy#6261/#6265). Measured
// over a sweep of emoji offsets, the old UTF-16 cut broke 1 offset for a plain
// emoji and 4 for a ZWJ family cluster; the grapheme cut breaks none.
const GRAPHEME_SEG = new Intl.Segmenter('en', { granularity: 'grapheme' })
const toGraphemes = (s) => Array.from(GRAPHEME_SEG.segment(s), (g) => g.segment)

// Index of the first period that genuinely ends a sentence: skips periods that
// close a known abbreviation and periods inside a still-open "(…" parenthetical.
// Returns -1 when no period qualifies (caller falls back to the length cap).
function sentenceEnd(text) {
  const re = /\.(?=\s|$)/g
  let m
  while ((m = re.exec(text)) !== null) {
    const head = text.slice(0, m.index + 1)
    if (NON_TERMINAL_ABBREV.test(head)) continue
    const opens = (head.match(/\(/g) || []).length
    const closes = (head.match(/\)/g) || []).length
    if (opens > closes) continue
    return m.index
  }
  return -1
}

// First sentence of the first non-heading prose PARAGRAPH -> a clean one-line
// description for menus. Accumulate the whole paragraph first (the source's first
// sentence often wraps across several physical lines) so we don't return a dangling
// half-sentence. Capped; ellipsis only when truncated.
export function deriveDescription(body, name) {
  let para = ''
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('---') || line.startsWith('<!--')) {
      if (para) break // blank/heading ends the first prose paragraph
      continue
    }
    para = para ? `${para} ${line}` : line
  }
  if (!para) return `Project skill: /${name}`
  let desc = para.replace(/\s+/g, ' ').trim()
  const dot = sentenceEnd(desc)
  // Measure the dot's position in graphemes — identical to the old UTF-16 `dot < 160`
  // for ASCII, correct for astral text. '.' is its own grapheme, so slicing at
  // `dot + 1` still lands on a cluster boundary.
  if (dot !== -1 && toGraphemes(desc.slice(0, dot)).length < 160) desc = desc.slice(0, dot + 1)
  // Cap at 160 graphemes with an ellipsis — backing up to the last word boundary so
  // the menu line never ends in a word stump ("must le...", #748). Only back up when
  // the 157-grapheme cut actually lands INSIDE a word: if grapheme 157 is already a
  // space, the slice ends on a complete word and trimming would drop a good word
  // (#760 review). A single token longer than the cap has no boundary; keep the hard
  // cut — but cut on a CLUSTER boundary, never mid-cluster.
  const graphemes = toGraphemes(desc)
  if (graphemes.length > 160) {
    let cut = 157
    if (graphemes[157] !== ' ') {
      // mid-word cut → walk back to the last space at or before 157 and drop the stump
      for (let i = 157; i >= 0; i--) {
        if (graphemes[i] === ' ') { cut = i; break }
      }
    }
    const head = graphemes.slice(0, cut).join('').trimEnd()
    desc = (head || graphemes.slice(0, 157).join('')) + '...'
  }
  return desc
}

// Escape a string for a double-quoted YAML/TOML scalar.
function dqEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function yamlDq(s) {
  return '"' + dqEscape(s) + '"'
}

// ---- emitters: (name, body, description, repo) -> { path, content } ----

function emitClaude(name, body, description, repo) {
  return {
    path: join(repo, '.claude/skills', name, 'SKILL.md'),
    content: `---\ndescription: ${yamlDq(description)}\n---\n\n${body}`,
  }
}

function emitGemini(name, body, description, repo) {
  // Always report the path (even on skip) so the caller can clean up a stale
  // artifact from a previous compile.
  const path = join(repo, '.gemini/commands', `${name}.toml`)
  // $ARGUMENTS is the neutral arg token; Gemini uses {{args}}.
  const prompt = body.replace(/\$ARGUMENTS\b/g, '{{args}}')
  // Gemini's prompt engine is active: it interprets {{...}}, !{...} (shell), and
  // @{...} (file injection). A body that contains those sequences literally (e.g.
  // an HTML template's {{TITLE}}, or {{CUSTOMIZE}} docs) would be corrupted. Gemini
  // has no documented brace-escape, so refuse to emit a broken command — skip this
  // skill for Gemini and let the caller log the drop (no silent corruption).
  const otherMustache = prompt.replace(/\{\{args\}\}/g, '').match(/\{\{|!\{|@\{/)
  if (otherMustache) {
    return { path, skip: `gemini: body contains an active template sequence ("${otherMustache[0]}…") that Gemini would interpret; not Gemini-safe` }
  }
  // TOML literal triple-string ('''…''') needs no escaping; bail to a basic
  // string only if the body itself contains ''' (vanishingly rare).
  let promptBlock
  if (!prompt.includes("'''")) {
    promptBlock = `prompt = '''\n${prompt}'''`
  } else {
    const esc = prompt.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')
    promptBlock = `prompt = """\n${esc}"""`
  }
  const descToml = description.includes("'") ? `"${dqEscape(description)}"` : `'${description}'`
  // Warn on positional $N args only when they appear OUTSIDE fenced code blocks —
  // a bash `${1:-…}` inside a ```code``` block is a shell positional, not a Gemini
  // arg-mapping concern, and would be a noisy false positive.
  const prose = prompt.replace(/```[\s\S]*?```/g, '')
  return {
    path,
    content: `description = ${descToml}\n${promptBlock}\n`,
    warn: /\$[1-9]\b/.test(prose) ? `gemini: positional $N args have no Gemini equivalent (only {{args}})` : null,
  }
}

function emitCodex(name, body, description, repo) {
  // Codex skills use the same folder shape as ~/.codex/skills, but emit into
  // the repo so the artifact is reviewable, portable, and installable by any
  // Codex user or agent runner.
  return {
    path: join(repo, '.codex/skills', name, 'SKILL.md'),
    content: `---\nname: ${name}\ndescription: ${yamlDq(description)}\n---\n\n${body}`,
    note: `codex: repo-tracked skill; install by copying/syncing .codex/skills/${name} into ~/.codex/skills when repo-local discovery is unavailable`,
  }
}

export function emitPi(name, body, description) {
  const warns = []
  // Warn on arg tokens only OUTSIDE fenced code blocks (a shell `echo $1` in a
  // ```code``` block is a positional, not a skill-arg concern) — mirrors emitGemini.
  const prose = body.replace(/```[\s\S]*?```/g, '')
  if (/\$ARGUMENTS\b/.test(prose) || /\$[1-9]\b/.test(prose)) {
    warns.push('pi: appends args as "User: <args>" — inline arg tokens ($ARGUMENTS / $N) are NOT substituted')
  }
  // Pi REJECTS a non-conforming name at load (lowercase a-z / 0-9 / single hyphens,
  // ≤64 chars, matching the parent dir) — unlike claude/gemini/codex, which accept
  // anything. Warn rather than silently emit a SKILL.md Pi won't load.
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    warns.push(`pi: skill name "${name}" is not Pi-valid (lowercase a-z, 0-9, single hyphens, ≤64 chars) — Pi will reject it at load`)
  }
  // Quote `name` (like `description`) so the frontmatter is ALWAYS valid YAML even if
  // a source filename carried a YAML-significant char (`:`, `#`, `"`) — an unquoted
  // `name: weird:name` would misparse. A quoted scalar YAML-parses back to the exact
  // string, so Pi's match against the parent directory name still holds (any charset
  // violation is separately surfaced by the warn above).
  return {
    path: join(homedir(), '.pi/agent/skills', name, 'SKILL.md'),
    content: `---\nname: ${yamlDq(name)}\ndescription: ${yamlDq(description)}\n---\n\n${body}`,
    note: `pi: invoke as /skill:${name} (user-global ~/.pi/agent/skills/)`,
    warn: warns.length ? warns.join('; ') : null,
  }
}

const EMITTERS = { claude: emitClaude, gemini: emitGemini, codex: emitCodex, pi: emitPi }

function compileOne(name, srcPath, targets, repo, dryRun) {
  const raw = readFileSync(srcPath, 'utf8')
  const body = stripStamp(raw)
  const description = deriveDescription(body, name)
  const results = []
  for (const t of targets) {
    const emit = EMITTERS[t]
    if (!emit) {
      results.push({ target: t, error: `unknown target "${t}"` })
      continue
    }
    const { path, content, warn, note, skip } = emit(name, body, description, repo)
    if (skip) {
      // Remove any artifact left by a previous compile so a now-unsafe skill
      // can't keep loading a stale/broken native command.
      let removedStale = false
      if (!dryRun && path && existsSync(path)) {
        rmSync(path)
        removedStale = true
      }
      results.push({ target: t, skip, removedStale })
      continue
    }
    if (!dryRun) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
    }
    results.push({ target: t, path, warn, note })
  }
  return { name, description, results }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const repo = args.repo
  const cmdDir = join(repo, '.claude/commands')
  if (!existsSync(cmdDir)) {
    console.error(`No .claude/commands/ in ${repo}`)
    process.exit(1)
  }
  let targets = args.targets || targetsFromProfile(repo) || ['claude']
  const bad = targets.filter((t) => !ALL_TARGETS.includes(t))
  if (bad.length) {
    console.error(`Unknown target(s): ${bad.join(', ')}. Known: ${ALL_TARGETS.join(', ')}`)
    process.exit(1)
  }

  const names = args.name ? [args.name] : readdirSync(cmdDir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
  // `--name` is user-facing; a name with a path separator or `..` would let the
  // emitters write outside the intended dirs (incl. ~/.pi). Reject up front.
  const unsafe = names.filter((n) => /[/\\]/.test(n) || n.split(/[/\\]/).includes('..') || n.includes('..'))
  if (unsafe.length) {
    console.error(`Unsafe skill name(s): ${unsafe.join(', ')} — names must not contain "/", "\\", or "..".`)
    process.exit(1)
  }
  let failed = 0
  let skipped = 0
  console.log(`Compiling ${names.length} skill(s) -> [${targets.join(', ')}]${args.dryRun ? ' (dry-run)' : ''}\n`)
  for (const name of names) {
    const srcPath = join(cmdDir, `${name}.md`)
    if (!existsSync(srcPath)) {
      console.error(`  ${name}: SOURCE MISSING (${srcPath})`)
      failed++
      continue
    }
    const { description, results } = compileOne(name, srcPath, targets, repo, args.dryRun)
    console.log(`  /${name} — ${description.slice(0, 70)}${description.length > 70 ? '…' : ''}`)
    for (const r of results) {
      if (r.error) {
        console.error(`      [${r.target}] ERROR: ${r.error}`)
        failed++
      } else if (r.skip) {
        console.log(`      [${r.target}] SKIPPED — ${r.skip}${r.removedStale ? ' (removed stale artifact)' : ''}`)
        skipped++
      } else {
        const rel = r.path.replace(homedir(), '~').replace(repo + '/', '')
        console.log(`      [${r.target}] ${rel}`)
        if (r.warn) console.log(`         ! ${r.warn}`)
        if (r.note) console.log(`         · ${r.note}`)
      }
    }
  }
  if (failed) {
    console.error(`\n${failed} emit(s) failed.`)
    process.exit(1)
  }
  console.log(`\nDone.${skipped ? ` ${skipped} target(s) skipped (logged above — not emitted).` : ''}`)
  // Hint only — never auto-add the target: that would write into a home dir the
  // user never asked about.
  for (const t of detectUncompiledAgents(targets)) {
    console.log(`\nNote: ${t} looks installed on this machine but is not a selected target, so`)
    console.log(`${AGENT_SKILL_DIRS[t]} has no compiled skills. Add it with --targets ${[...targets, t].join(',')}`)
    console.log(`(or a \`targets:\` line in .claude/skill-profile.md) if you drive this repo with ${t}.`)
  }
}

// Run the CLI only when executed directly — importing this module (e.g. the unit
// test pulling in deriveDescription) must not trigger a compile.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
