import fs from 'fs-extra';
import crypto from 'node:crypto';
import path from 'node:path';
import { sourceTreeSha256 } from './evidence-audit.js';

function failure(gate, reason) {
  return { gate, reason };
}

function projectDirFromRunsDir(runsDir) {
  return path.resolve(runsDir, '..', '..', '..');
}

function resolveReportEvidencePath(report, runsDir) {
  if (typeof report?.evidencePath !== 'string' || report.evidencePath.trim() === '') {
    return undefined;
  }
  const evidencePath = report.evidencePath.trim();
  if (path.isAbsolute(evidencePath)) return path.resolve(evidencePath);
  return path.resolve(projectDirFromRunsDir(runsDir), evidencePath);
}

async function canonicalExistingPath(filePath) {
  if (!filePath) return undefined;
  if (await fs.pathExists(filePath)) return fs.realpath(filePath);
  return filePath;
}

async function sha256File(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function sha256IfExists(filePath) {
  if (!filePath || !await fs.pathExists(filePath)) return null;
  return sha256File(filePath);
}

async function resolveChangeDir(runsDir) {
  const projectDir = projectDirFromRunsDir(runsDir);
  const runId = path.basename(path.resolve(runsDir));
  const directChangeDir = path.join(projectDir, 'openspec', 'changes', runId);
  if (await fs.pathExists(directChangeDir)) return directChangeDir;

  const archiveDir = path.join(projectDir, 'openspec', 'changes', 'archive');
  if (!await fs.pathExists(archiveDir)) return directChangeDir;
  const archivedEntry = (await fs.readdir(archiveDir))
    .find((entry) => entry === runId || entry.endsWith(`-${runId}`));
  return archivedEntry ? path.join(archiveDir, archivedEntry) : directChangeDir;
}

export async function evaluateStageAdvanceGate({ stage, runsDir }) {
  const reviewRequiredStages = new Set(['review', 'verify', 'release', 'archive']);
  const verifyRequiredStages = new Set(['verify', 'release', 'archive']);

  if (reviewRequiredStages.has(stage)) {
    const reviewPath = path.join(runsDir, 'review-notes.md');
    if (!await fs.pathExists(reviewPath)) {
      return {
        pass: false,
        failures: [failure('review', 'review-notes.md is missing')],
      };
    }
    const review = await fs.readFile(reviewPath, 'utf8');
    const verdicts = [...review.matchAll(
      /^\s*\*{0,2}(?:Superpowers\s+)?verdict\s*:\s*(ready|needs-fix|rejected)\*{0,2}\s*$/gim,
    )].map((match) => match[1].toLowerCase());
    if (verdicts.at(-1) !== 'ready') {
      return {
        pass: false,
        failures: [failure('review', 'Superpowers verdict is not ready')],
      };
    }
  }

  if (new Set(['release', 'archive']).has(stage)) {
    const changeDir = await resolveChangeDir(runsDir);
    const tasksPath = path.join(changeDir, 'tasks.md');
    if (!await fs.pathExists(tasksPath)) {
      return {
        pass: false,
        failures: [failure('tasks', 'tasks.md is missing')],
      };
    }
    const tasks = await fs.readFile(tasksPath, 'utf8');
    const incompleteTasks = [...tasks.matchAll(/^\s*-\s+\[ \]\s+.+$/gim)];
    if (incompleteTasks.length > 0) {
      return {
        pass: false,
        failures: [failure('tasks', `${incompleteTasks.length} task(s) are incomplete`)],
      };
    }
  }

  if (verifyRequiredStages.has(stage)) {
    const reportPath = path.join(runsDir, 'probe-report.json');
    if (!await fs.pathExists(reportPath)) {
      return {
        pass: false,
        failures: [failure('verify', 'probe-report.json is missing')],
      };
    }
    let report;
    try {
      report = await fs.readJson(reportPath);
    } catch {
      return {
        pass: false,
        failures: [failure('verify', 'probe-report.json is invalid')],
      };
    }
    if (report?.pass !== true) {
      return {
        pass: false,
        failures: [failure('verify', 'probe report did not pass')],
      };
    }
    const expectedProjectDir = await canonicalExistingPath(projectDirFromRunsDir(runsDir));
    const actualProjectDir = typeof report?.projectDir === 'string' && report.projectDir.trim()
      ? await canonicalExistingPath(path.resolve(report.projectDir.trim()))
      : undefined;
    if (actualProjectDir !== expectedProjectDir) {
      return {
        pass: false,
        failures: [
          failure(
            'verify',
            `probe project mismatch: expected ${expectedProjectDir}, got ${actualProjectDir || 'none'}`,
          ),
        ],
      };
    }
    const expectedEvidencePath = await canonicalExistingPath(path.resolve(runsDir, 'probe-evidence.json'));
    if (!expectedEvidencePath || !await fs.pathExists(expectedEvidencePath)) {
      return {
        pass: false,
        failures: [failure('verify', 'probe-evidence.json is missing')],
      };
    }
    const actualEvidencePath = await canonicalExistingPath(resolveReportEvidencePath(report, runsDir));
    if (actualEvidencePath !== expectedEvidencePath) {
      return {
        pass: false,
        failures: [
          failure(
            'verify',
            `probe evidence mismatch: expected ${expectedEvidencePath}, got ${actualEvidencePath || 'none'}`,
          ),
        ],
      };
    }
    const actualEvidenceSha256 = await sha256File(expectedEvidencePath);
    if (report?.evidenceSha256 !== actualEvidenceSha256) {
      return {
        pass: false,
        failures: [
          failure(
            'verify',
            `probe evidence SHA-256 mismatch: expected ${actualEvidenceSha256}, got ${report?.evidenceSha256 || 'none'}`,
          ),
        ],
      };
    }
    const profilePath = path.join(runsDir, 'probe-profile');
    if (await fs.pathExists(profilePath)) {
      const expectedProfile = (await fs.readFile(profilePath, 'utf8')).trim();
      if (expectedProfile && report?.profile !== expectedProfile) {
        return {
          pass: false,
          failures: [
            failure(
              'verify',
              `probe report profile mismatch: expected ${expectedProfile}, got ${report?.profile || 'none'}`,
            ),
          ],
        };
      }
    }

    const auditPath = path.join(runsDir, 'evidence-audit-report.json');
    if (!await fs.pathExists(auditPath)) {
      return {
        pass: false,
        failures: [failure('verify', 'evidence-audit-report.json is missing')],
      };
    }
    let audit;
    try {
      audit = await fs.readJson(auditPath);
    } catch {
      return {
        pass: false,
        failures: [failure('verify', 'evidence-audit-report.json is invalid')],
      };
    }
    if (audit?.pass !== true) {
      return {
        pass: false,
        failures: [failure('verify', 'evidence audit report did not pass')],
      };
    }
    const actualAuditProjectDir = typeof audit?.projectDir === 'string' && audit.projectDir.trim()
      ? await canonicalExistingPath(path.resolve(audit.projectDir.trim()))
      : undefined;
    if (actualAuditProjectDir !== expectedProjectDir) {
      return {
        pass: false,
        failures: [
          failure(
            'verify',
            `evidence audit project mismatch: expected ${expectedProjectDir}, got ${actualAuditProjectDir || 'none'}`,
          ),
        ],
      };
    }
    const expectedRun = path.basename(path.resolve(runsDir));
    if (audit?.run !== expectedRun) {
      return {
        pass: false,
        failures: [
          failure(
            'verify',
            `evidence audit run mismatch: expected ${expectedRun}, got ${audit?.run || 'none'}`,
          ),
        ],
      };
    }
    for (const name of ['progress', 'review', 'testOutput']) {
      const evidenceFile = audit?.evidenceFiles?.[name];
      if (!evidenceFile || !await fs.pathExists(evidenceFile)) {
        return {
          pass: false,
          failures: [
            failure('verify', `evidence audit input ${name} is missing`),
          ],
        };
      }
      const actualSha256 = await sha256IfExists(evidenceFile);
      if (audit?.evidenceSha256?.[name] !== actualSha256) {
        return {
          pass: false,
          failures: [
            failure(
              'verify',
              `evidence audit SHA-256 mismatch for ${name}: expected ${actualSha256 || 'missing'}, got ${audit?.evidenceSha256?.[name] || 'none'}`,
            ),
          ],
        };
      }
    }
    const diskEvidenceSha256 = {
      packageJson: await sha256IfExists(path.join(expectedProjectDir, 'package.json')),
      sourceTree: await sourceTreeSha256(expectedProjectDir),
    };
    for (const [name, actualSha256] of Object.entries(diskEvidenceSha256)) {
      if (audit?.evidenceSha256?.[name] !== actualSha256) {
        return {
          pass: false,
          failures: [
            failure(
              'verify',
              `evidence audit SHA-256 mismatch for ${name}: expected ${actualSha256 || 'missing'}, got ${audit?.evidenceSha256?.[name] || 'none'}`,
            ),
          ],
        };
      }
    }
  }

  return { pass: true, failures: [] };
}
