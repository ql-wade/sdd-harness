import fs from 'fs-extra';
import path from 'node:path';

function quote(value) {
  return JSON.stringify(String(value));
}

function replaceSectionArray(content, key, value) {
  const pattern = new RegExp(`^(\\s{2}${key}:)\\s*.*$`, 'm');
  const line = `  ${key}: ${JSON.stringify(value)}`;
  if (pattern.test(content)) return content.replace(pattern, line);
  if (/^artifacts:\s*$/m.test(content)) {
    const artifactsStart = content.search(/^artifacts:\s*$/m);
    const afterStart = content.indexOf('\n', artifactsStart);
    const nextTopLevel = content.slice(afterStart + 1).search(/^[^\s].*$/m);
    const insertAt = nextTopLevel === -1
      ? content.length
      : afterStart + 1 + nextTopLevel;
    return `${content.slice(0, insertAt).trimEnd()}\n${line}\n${content.slice(insertAt)}`;
  }
  if (/^gates:\s*$/m.test(content)) {
    return content.replace(/^gates:\s*$/m, `artifacts:\n${line}\ngates:`);
  }
  return `${content.trimEnd()}\nartifacts:\n${line}\n`;
}

function parseInlineArray(content, key) {
  const match = content.match(new RegExp(`^\\s{2}${key}:\\s*(\\[[^\\n]*\\])\\s*$`, 'm'));
  if (!match) return [];
  try {
    const value = JSON.parse(match[1]);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function replaceNestedScalar(content, key, value) {
  const pattern = new RegExp(`^(\\s{2}${key}:)\\s*.*$`, 'm');
  return pattern.test(content)
    ? content.replace(pattern, `  ${key}: ${value}`)
    : content;
}

function setTopLevelScalar(content, key, value) {
  const pattern = new RegExp(`^${key}:\\s*.*$`, 'm');
  const line = `${key}: ${value}`;
  return pattern.test(content)
    ? content.replace(pattern, line)
    : `${content.trimEnd()}\n${line}\n`;
}

function appendHistory(content, entry) {
  const lines = [
    `    - from: ${quote(entry.from)}`,
    `      to: ${quote(entry.to)}`,
    `      at: ${quote(entry.at)}`,
    `      reason: ${quote(entry.reason)}`,
  ].join('\n');

  if (/^  history:\s*\[\]\s*$/m.test(content)) {
    return content.replace(/^  history:\s*\[\]\s*$/m, `  history:\n${lines}`);
  }

  const historyStart = content.search(/^  history:\s*$/m);
  if (historyStart === -1) {
    return content.replace(/^(  current:\s*.*)$/m, `$1\n  history:\n${lines}`);
  }

  const afterStart = content.indexOf('\n', historyStart);
  const nextTopLevel = content.slice(afterStart + 1).search(/^[^\s].*$/m);
  const insertAt = nextTopLevel === -1
    ? content.length
    : afterStart + 1 + nextTopLevel;
  return `${content.slice(0, insertAt).trimEnd()}\n${lines}\n${content.slice(insertAt)}`;
}

async function atomicWrite(filePath, content) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(tempPath, content);
  await fs.rename(tempPath, filePath);
}

export async function setWorkflowGateStatus(workflowPath, status) {
  const current = await fs.readFile(workflowPath, 'utf8');
  await atomicWrite(workflowPath, replaceNestedScalar(current, 'status', status));
}

export async function advanceWorkflowFrame({
  workflowPath,
  from,
  to,
  requiredArtifacts = [],
  producedArtifacts = [],
  reason,
  at = new Date().toISOString(),
  fields = {},
}) {
  let content = await fs.readFile(workflowPath, 'utf8');
  const produced = [
    ...new Set([...parseInlineArray(content, 'produced'), ...producedArtifacts]),
  ];
  content = replaceNestedScalar(content, 'current', to);
  content = appendHistory(content, { from, to, at, reason });
  content = replaceSectionArray(content, 'required', requiredArtifacts);
  content = replaceSectionArray(content, 'produced', produced);
  content = replaceNestedScalar(content, 'status', 'passed');
  for (const [key, value] of Object.entries(fields)) {
    content = setTopLevelScalar(
      content,
      key,
      typeof value === 'string' && value !== 'skip' ? quote(value) : value,
    );
  }
  await atomicWrite(workflowPath, content);
}

export async function completeWorkflowFrame({
  workflowPath,
  completedAt = new Date().toISOString(),
}) {
  let content = await fs.readFile(workflowPath, 'utf8');
  content = replaceNestedScalar(content, 'status', 'passed');
  content = setTopLevelScalar(content, 'run_status', 'completed');
  content = setTopLevelScalar(content, 'completed_at', quote(completedAt));
  await atomicWrite(workflowPath, content);
}

export async function clearActiveRunIfMatches(activeRunFile, changeId) {
  if (!await fs.pathExists(activeRunFile)) return false;
  const active = (await fs.readFile(activeRunFile, 'utf8')).trim();
  if (active !== changeId) return false;
  await fs.remove(activeRunFile);
  return true;
}
