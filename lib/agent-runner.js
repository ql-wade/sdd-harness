import fs from 'fs-extra';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

export const VALID_AGENT_RUNNERS = ['auto', 'session', 'claude', 'codex'];

export function resolveAgentRunner(requested = 'auto', {
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  if (!VALID_AGENT_RUNNERS.includes(requested)) {
    throw new Error(`Invalid runner: ${requested}. Expected ${VALID_AGENT_RUNNERS.join('|')}`);
  }
  if (requested !== 'auto') return requested;

  const hasCodexSession = Boolean(env.CODEX_THREAD_ID);
  const hasCodexProject = fs.existsSync(path.join(cwd, '.agents'))
    || fs.existsSync(path.join(cwd, '.codex'));
  if (hasCodexSession || hasCodexProject) return 'session';

  const hasClaudeProject = fs.existsSync(path.join(cwd, '.claude'));
  if (hasClaudeProject) return 'claude';

  return 'session';
}

function defaultFindOnPath() {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(locator, ['codex'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) || null;
}

export function resolveCodexExecutable({
  agentBin,
  env = process.env,
  findOnPath = defaultFindOnPath,
} = {}) {
  if (agentBin) {
    if (!path.isAbsolute(agentBin)) {
      throw new Error('--agent-bin must be an absolute path');
    }
    return fs.existsSync(agentBin) ? agentBin : null;
  }
  if (env.SDD_CODEX_BIN) {
    if (!path.isAbsolute(env.SDD_CODEX_BIN)) {
      throw new Error('SDD_CODEX_BIN must be an absolute path');
    }
    return fs.existsSync(env.SDD_CODEX_BIN) ? env.SDD_CODEX_BIN : null;
  }
  return findOnPath();
}

function safeSegment(value, fallback) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

export async function writeSessionHandoff({
  cwd = process.cwd(),
  runId,
  operation,
  skill,
  prompt,
}) {
  const resolvedRunId = safeSegment(
    runId,
    `session-${new Date().toISOString().replace(/[:.]/g, '-').toLowerCase()}`,
  );
  const resolvedOperation = safeSegment(operation, 'agent-task');
  const handoffPath = path.join(
    cwd,
    '.sdd',
    'runs',
    resolvedRunId,
    `${resolvedOperation}-handoff.md`,
  );
  const skillName = safeSegment(skill, 'sdd-harness');
  const content = `# SDD Harness Session Handoff

- operation: ${resolvedOperation}
- run: ${resolvedRunId}
- project: ${cwd.replaceAll('\\', '/')}
- skill: \`$${skillName}\`
- status: waiting-for-current-agent

## Current Codex action

Invoke \`$${skillName}\` in this conversation, read the current workflow frame and artifacts, then execute the stage contract. After the skill finishes, rerun the relevant \`sdd check\` or \`sdd run\` command.

## Context

${prompt}
`;
  await fs.outputFile(handoffPath, content);
  return { path: handoffPath, runId: resolvedRunId };
}

export async function runCodexPrompt(prompt, {
  cwd = process.cwd(),
  agentBin,
  model,
  timeoutMs = 600000,
  env = process.env,
} = {}) {
  let executable;
  try {
    executable = resolveCodexExecutable({ agentBin, env });
  } catch (error) {
    return { exitCode: 1, error: error.message, timedOut: false, killed: false };
  }
  if (!executable) {
    return {
      exitCode: 1,
      error: 'Codex executable not found. Pass --agent-bin <absolute-path> or set SDD_CODEX_BIN.',
      timedOut: false,
      killed: false,
    };
  }

  const args = ['exec', '--ephemeral', '-C', cwd, '-s', 'workspace-write'];
  if (model) args.push('-m', model);
  args.push('-');

  return new Promise(resolve => {
    const child = spawn(executable, args, {
      cwd,
      env,
      stdio: ['pipe', 'inherit', 'inherit'],
      windowsHide: true,
    });
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      resolve(result);
    };
    const timer = timeoutMs ? setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish({ exitCode: null, killed: true, timedOut: true });
    }, timeoutMs) : null;
    child.on('exit', code => {
      if (timer) clearTimeout(timer);
      finish({ exitCode: code, killed: false, timedOut: false });
    });
    child.on('error', error => {
      if (timer) clearTimeout(timer);
      finish({ exitCode: 1, error: error.message, killed: false, timedOut: false });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}
