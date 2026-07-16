import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';

function persistEvidence(result, evidenceDir) {
  if (!evidenceDir) return result;
  fs.ensureDirSync(evidenceDir);
  const outputPath = path.join(evidenceDir, 'code-test-output.txt');
  const reportPath = path.join(evidenceDir, 'code-test-report.json');
  fs.writeFileSync(outputPath, result.output ?? '');
  const outputSha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(outputPath))
    .digest('hex');
  fs.writeJsonSync(reportPath, {
    schemaVersion: 1,
    pass: result.pass,
    command: result.command,
    exitCode: result.exitCode,
    reason: result.reason,
    outputPath,
    outputSha256,
  });
  return {
    ...result,
    evidence: {
      outputPath,
      reportPath,
      outputSha256,
    },
  };
}

function detectTestCommand(projectDir) {
  const packagePath = path.join(projectDir, 'package.json');
  if (fs.existsSync(packagePath)) {
    try {
      const pkg = fs.readJsonSync(packagePath);
      if (pkg.scripts?.test) return { command: 'npm', args: ['test'] };
    } catch {}
  }
  if (fs.existsSync(path.join(projectDir, 'pyproject.toml'))) {
    return { command: 'python3', args: ['-m', 'pytest'] };
  }
  if (fs.existsSync(path.join(projectDir, 'Cargo.toml'))) {
    return { command: 'cargo', args: ['test'] };
  }
  if (fs.existsSync(path.join(projectDir, 'go.mod'))) {
    return { command: 'go', args: ['test', './...'] };
  }
  if (fs.existsSync(path.join(projectDir, 'pom.xml'))) {
    return { command: 'mvn', args: ['test'] };
  }
  return null;
}

export function runProjectTestGate({ projectDir, evidenceDir, timeoutMs = 120000 }) {
  const detected = detectTestCommand(projectDir);
  if (!detected) {
    return persistEvidence({
      pass: false,
      command: null,
      exitCode: null,
      output: '',
      reason: 'no supported project test command found',
    }, evidenceDir);
  }

  const command = [detected.command, ...detected.args].join(' ');
  const executable = process.platform === 'win32'
    ? (process.env.ComSpec || 'cmd.exe')
    : detected.command;
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', command]
    : detected.args;
  const result = spawnSync(executable, args, {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const exitCode = result.status ?? 1;
  if (result.error) {
    return persistEvidence({
      pass: false,
      command,
      exitCode,
      output,
      reason: result.error.code === 'ETIMEDOUT'
        ? 'project test command timed out'
        : `project test command failed to start: ${result.error.message}`,
    }, evidenceDir);
  }

  return persistEvidence({
    pass: exitCode === 0,
    command,
    exitCode,
    output,
    reason: exitCode === 0 ? null : `project test command exited with code ${exitCode}`,
  }, evidenceDir);
}
