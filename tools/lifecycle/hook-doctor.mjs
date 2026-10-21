#!/usr/bin/env node
// hook-doctor.mjs — lifecycle hook assembly doctor (delivery-foundation-rearchitecture P4_5).
//
// Layering: hooks.yaml is the single policy source (P1_2-owned — this doctor
// only READS it) and tools/adapters/claude-code.sh is the only compiler. The
// doctor is a validation layer on top of the REAL composition: it runs the
// real adapter into an isolated SDD_TARGET_ROOT (default: a fresh temp dir;
// the live repo config and the plugin cache are never written) and
// cross-checks the hooks.yaml declaration against the generated
// settings.json + hooks/.compiled.env:
//
//   declared but not generated      -> STRUCTURAL_HOOK_GAP (E05: never silent)
//   generated but not declared      -> UNAUTHORIZED_HOOK_GENERATION (越权)
//   same event+command twice        -> DUPLICATE_REGISTRATION (§7.2; plugin
//                                      disposition stays at the plugin entry)
//   event beyond the fixed set      -> HOOK_EVENT_BEYOND_FIXED_SET (§7.3
//                                      capability gap; the adapter refuses it)
//   adapter refused the composition -> ADAPTER_COMPOSITION_FAILED (stderr kept)
//
// Registration division (§7.2) mirrors the adapter's own source marking:
//   plugin  — command references CLAUDE_PLUGIN_ROOT or .claude/plugins/
//   managed — command references hooks/{pre-tool-gate,session-context,stop-reminder}.sh
//   user    — everything else
// Native support (structural composition) and live run (a real host session)
// are reported separately: the structural surface is PROVEN here, the live
// run stays UNVERIFIED — the doctor never drives a host or a plugin runtime.
//
// Usage:
//   node tools/lifecycle/hook-doctor.mjs [--root DIR] [--target-root DIR]
//                                        [--audit-only] [--keep-target] [--json]
// --audit-only skips composition and audits the INSTALLED native view at
// --target-root (default: <root>) as-is — the 原生装配 verification. The
// adapter itself refuses same event/command duplicates at compose time (its
// own §7.2 gate); auditing a composed view with injected duplicates therefore
// requires audit-only. Read-only in every mode.
// Exit codes: 0 = CONSISTENT, 2 = findings (GAPS), 1 = usage/internal error.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Same classification the adapter enforces (§7.2) — keep in lockstep with
// PLUGIN_SOURCE_RE / MANAGED_SCRIPT_RE in tools/adapters/claude-code.sh.
const PLUGIN_SOURCE_RE = /CLAUDE_PLUGIN_ROOT|\.claude\/plugins\//;
const MANAGED_SCRIPT_RE = /hooks\/(pre-tool-gate|session-context|stop-reminder)\.sh/;
// Same fixed event set boundary (§7.3) — keep in lockstep with the adapter.
const FIXED_EVENT_SET = ['PreToolUse', 'SessionStart', 'Stop'];

// --- args -----------------------------------------------------------------

const args = process.argv.slice(2);
let root = REPO_ROOT;
let targetRoot = null;
let keepTarget = false;
let auditOnly = false;
const jsonOut = args.includes('--json');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root') root = path.resolve(args[++i]);
  else if (args[i] === '--target-root') targetRoot = path.resolve(args[++i]);
  else if (args[i] === '--keep-target') keepTarget = true;
  else if (args[i] === '--audit-only') auditOnly = true;
  else if (args[i] === '--json') { /* handled above */ }
  else {
    console.error(`❌ 未知参数: ${args[i]}（支持: --root DIR --target-root DIR --audit-only --keep-target --json）`);
    process.exit(1);
  }
}

const fail = (msg) => { console.error(`❌ ${msg}`); process.exit(1); };

const adapterPath = path.join(root, 'tools', 'adapters', 'claude-code.sh');
fs.existsSync(adapterPath) || fail(`adapter not found at ${adapterPath}`);

// The composition target: explicit, else a fresh temp dir (the live repo is
// never the default target — the doctor writes nothing outside the target).
// audit-only audits the installed view: default target is the repo itself.
let tempTarget = null;
if (!targetRoot) targetRoot = auditOnly ? root : null;
if (!targetRoot) {
  tempTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-doctor-'));
  targetRoot = tempTarget;
}

// --- minimal hooks.yaml parsing (same subset as the adapter's compiler) ----

function parseHooksYaml(text) {
  const policies = [];
  let cur = null;
  let listKey = null;
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('#') || !line.trim()) continue;
    let m = line.match(/^  - id: (.+)$/);
    if (m) { cur = { id: m[1].trim() }; policies.push(cur); listKey = null; continue; }
    if (!cur) continue;
    let matched = false;
    for (const key of ['hook', 'matcher', 'action', 'script']) {
      m = line.match(new RegExp(`^    ${key}: (.+)$`));
      if (m) { cur[key] = m[1].trim(); matched = true; break; }
    }
    if (matched) continue;
    m = line.match(/^    (target|patterns):/);
    if (m) { listKey = m[1]; continue; }
    m = line.match(/^      - "?([^"]+?)"?$/);
    if (m) {
      const key = listKey ?? 'target';
      cur[key] = [...(cur[key] ?? []), m[1]];
    }
  }
  return policies;
}

// --- compose with the REAL adapter -----------------------------------------

const adapterRun = auditOnly
  ? { status: null, stderr: '', stdout: '' }
  : spawnSync('bash', [adapterPath], {
      encoding: 'utf8',
      cwd: root,
      env: { ...process.env, SDD_TARGET_ROOT: targetRoot },
    });

// Source of truth for "declared" = the same file the adapter compiled:
// TARGET_ROOT/hooks.yaml first, fallback to the repo source (adapter parity).
const declaredYamlPath = fs.existsSync(path.join(targetRoot, 'hooks.yaml'))
  ? path.join(targetRoot, 'hooks.yaml')
  : path.join(root, 'hooks.yaml');
fs.existsSync(declaredYamlPath) || fail(`hooks.yaml not found at ${declaredYamlPath}`);
const declared = parseHooksYaml(fs.readFileSync(declaredYamlPath, 'utf8'));

const findings = [];
const push = (code, detail, extra = {}) =>
  findings.push({ code, severity: 'error', detail, ...extra });

let generatedView = null;

if (adapterRun.status !== 0 && !auditOnly) {
  push('ADAPTER_COMPOSITION_FAILED',
    `adapter exited ${adapterRun.status}: ${(adapterRun.stderr || adapterRun.stdout || '').trim().slice(-600)}`,
    { adapterExit: adapterRun.status });
  // Independent of the refusal, name every declared event beyond the fixed set.
  for (const p of declared) {
    if (p.hook && !FIXED_EVENT_SET.includes(p.hook)) {
      push('HOOK_EVENT_BEYOND_FIXED_SET',
        `policy ${p.id} declares hook ${p.hook} outside the adapter fixed event set (${FIXED_EVENT_SET.join(', ')}) — capability gap, not assembled (§7.3)`,
        { policy: p.id, event: p.hook });
    }
  }
} else {
  // --- read the real composition products ----------------------------------
  const settingsPath = path.join(targetRoot, '.claude', 'settings.json');
  const compiledPath = path.join(targetRoot, 'hooks', '.compiled.env');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* no hooks section */ }
  const compiledRaw = fs.existsSync(compiledPath) ? fs.readFileSync(compiledPath, 'utf8') : '';
  const compiled = {};
  for (const line of compiledRaw.split('\n')) {
    const m = line.match(/^([A-Z_]+)='(.*)'$/);
    if (m) compiled[m[1]] = m[2].replace(/'\\''/g, "'");
  }

  const hookSource = (command) =>
    PLUGIN_SOURCE_RE.test(command) ? 'plugin' : (MANAGED_SCRIPT_RE.test(command) ? 'managed' : 'user');

  // Group view: one classified command list per event group.
  const groups = {};
  for (const [group, entries] of Object.entries(settings.hooks ?? {})) {
    groups[group] = { matcher: '', managed: [], plugin: [], user: [] };
    for (const entry of entries ?? []) {
      if (entry && typeof entry === 'object' && entry.matcher && !groups[group].matcher) {
        groups[group].matcher = String(entry.matcher);
      }
      for (const hook of entry?.hooks ?? []) {
        const command = String(hook?.command ?? '');
        groups[group][hookSource(command)].push(command);
      }
    }
  }

  // --- declared -> generated (E05: a gap must be visible, never silent) -----
  for (const p of declared) {
    if (p.hook && !FIXED_EVENT_SET.includes(p.hook)) {
      push('HOOK_EVENT_BEYOND_FIXED_SET',
        `policy ${p.id} declares hook ${p.hook} outside the adapter fixed event set (${FIXED_EVENT_SET.join(', ')}) — capability gap, not assembled (§7.3)`,
        { policy: p.id, event: p.hook });
      continue;
    }
    if (p.action === 'run') {
      const commands = Object.values(groups[p.hook] ?? {}).flat();
      const registered = p.script ? commands.some((c) => c.includes(p.script)) : false;
      if (!registered) {
        push('STRUCTURAL_HOOK_GAP',
          `policy ${p.id} declares script ${p.script} on ${p.hook} but no settings entry registers it — declared but not generated`,
          { policy: p.id, script: p.script, group: p.hook });
      }
    } else if (p.action === 'deny') {
      const emitted = new Set(String(groups.PreToolUse?.matcher ?? '').split('|'));
      for (const part of String(p.matcher ?? '').split('|')) {
        if (part && !emitted.has(part)) {
          push('STRUCTURAL_HOOK_GAP',
            `deny policy ${p.id}: matcher part ${part} missing from the generated PreToolUse matcher — declared but not generated`,
            { policy: p.id, group: 'PreToolUse' });
        }
      }
      const payload = `${compiled.KB_PROTECT_PATHS ?? ''}\n${compiled.DENY_PATTERNS ?? ''}`;
      for (const item of [...(p.target ?? []), ...(p.patterns ?? [])]) {
        if (!payload.includes(item)) {
          push('STRUCTURAL_HOOK_GAP',
            `deny policy ${p.id}: payload item "${item}" is absent from hooks/.compiled.env — declared but not generated`,
            { policy: p.id, group: 'PreToolUse' });
        }
      }
    } else {
      // e.g. action: warn — no compile path in the current adapter.
      push('STRUCTURAL_HOOK_GAP',
        `policy ${p.id}: action ${p.action} has no compile path in the current adapter — declared but not generated`,
        { policy: p.id });
    }
  }

  // --- generated -> declared (managed entries must be traceable) ------------
  for (const [group, info] of Object.entries(groups)) {
    for (const command of info.managed) {
      let traceable = false;
      if (group === 'PreToolUse' && command.includes('hooks/pre-tool-gate.sh')) {
        traceable = declared.some((p) => p.hook === 'PreToolUse' && p.action === 'deny');
      } else if (group === 'SessionStart' || group === 'Stop') {
        traceable = declared.some((p) => p.hook === group && p.action === 'run' && command.includes(p.script));
      }
      if (!traceable) {
        push('UNAUTHORIZED_HOOK_GENERATION',
          `managed command ${command} is registered on ${group} but no hooks.yaml declaration generates it — generated but not declared`,
          { group });
      }
    }
  }

  // --- duplicates (§7.2: same event/command registration) -------------------
  // Two shapes: (a) the exact same normalized command twice in one group;
  // (b) a plugin entry whose command wraps a project managed script that is
  // also registered managed in that group (the adapter's own conflict rule:
  // substring containment — the disposition stays at the plugin entry).
  const normalize = (c) => String(c).trim().replace(/^["'\s]+/, '').replace(/["'\s]+$/, '');
  const managedScript = (c) => MANAGED_SCRIPT_RE.exec(c)?.[0] ?? null;
  for (const [group, info] of Object.entries(groups)) {
    const seen = new Map();
    for (const bucket of ['managed', 'plugin', 'user']) {
      for (const command of info[bucket]) {
        const key = normalize(command);
        seen.set(key, [...(seen.get(key) ?? []), { bucket, command }]);
      }
    }
    for (const [, hits] of seen) {
      if (hits.length < 2) continue;
      const subjects = [...new Set(hits.map((h) => h.bucket))];
      push('DUPLICATE_REGISTRATION',
        `same event+command registered ${hits.length}x on ${group} (subjects: ${subjects.join(', ')}): ${normalize(hits[0].command)}`,
        { group, subjects });
    }
    // Plugin wrapper around a managed script registered in the same group.
    const managedScripts = info.managed.map(managedScript).filter(Boolean);
    for (const pc of info.plugin) {
      const wrapped = managedScripts.find((s) => pc.includes(s));
      if (wrapped) {
        push('DUPLICATE_REGISTRATION',
          `plugin entry ${pc} wraps the project managed script ${wrapped} already registered on ${group} — plugin entry duplicates the project managed command; resolve at the plugin entry (处置权在插件入口)`,
          { group, subjects: ['plugin', 'managed'] });
      }
    }
  }

  generatedView = {
    settingsPath,
    compiledEnvPath: compiledPath,
    groups: Object.fromEntries(Object.entries(groups).map(([g, i]) => [g, {
      matcher: i.matcher, managed: i.managed, plugin: i.plugin, user: i.user,
    }])),
    denyPayload: {
      kbPaths: (compiled.KB_PROTECT_PATHS ?? '').split(':').filter(Boolean),
      denyPatterns: (compiled.DENY_PATTERNS ?? '').split('|').filter(Boolean),
    },
  };
}

const verdict = findings.length === 0 ? 'CONSISTENT' : 'GAPS';
const report = {
  schemaVersion: 1,
  interface: 'LifecycleHookDoctor.v1',
  root,
  target: targetRoot,
  policySource: {
    path: declaredYamlPath,
    declaredCount: declared.length,
    policies: declared.map((p) => ({ id: p.id, hook: p.hook, action: p.action, matcher: p.matcher ?? null, script: p.script ?? null })),
  },
  adapter: {
    command: auditOnly ? 'audit-only (no composition; installed view read as-is)' : `bash tools/adapters/claude-code.sh (SDD_TARGET_ROOT=${targetRoot})`,
    exit: adapterRun.status,
    refused: adapterRun.status != null && adapterRun.status !== 0,
    ...((adapterRun.status ?? 0) !== 0 ? { stderrTail: (adapterRun.stderr || '').trim().slice(-600) } : {}),
  },
  ...(generatedView ? { generated: generatedView } : {}),
  findings,
  verdict,
  nativeSupport: {
    surface: 'settings.json + hooks/.compiled.env composed by the real adapter',
    status: (adapterRun.status === 0 || auditOnly) && findings.length === 0 ? 'PROVEN' : 'NOT_PROVEN',
    note: '结构面组合产物已实证；产物与声明的偏差逐条列出',
  },
  liveRun: {
    status: 'UNVERIFIED',
    note: '未驱动真实 Claude Code 宿主会话/插件运行时；hook 触发、上下文送达与行为遵守由宿主验证承接（UNVERIFIED）',
  },
  pluginCache: {
    modified: false,
    note: '组合只发生在 SDD_TARGET_ROOT 隔离目标；插件缓存路径零读写',
  },
};

if (tempTarget && !keepTarget) fs.rmSync(tempTarget, { recursive: true, force: true });

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`hook-doctor${auditOnly ? ' [audit-only]' : ''}: ${verdict} (declared ${report.policySource.declaredCount} policies, adapter exit ${adapterRun.status})`);
  for (const f of findings) console.log(`  - [${f.code}] ${f.detail}`);
  console.log(`nativeSupport=${report.nativeSupport.status} liveRun=UNVERIFIED pluginCache=untouched target=${targetRoot}`);
}
process.exit(verdict === 'CONSISTENT' ? 0 : 2);
