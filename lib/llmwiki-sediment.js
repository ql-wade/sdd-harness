import fs from 'fs-extra';
import path from 'path';

// ============================================================================
// Stage → LLMWiki 沉淀（staging 模式，v2 修正）
//
// 产出物写到 llmwiki/.staging/<stage>/，不直接进 llmwiki/wiki/。
// 原因：lucasastorian/llmwiki MCP 的 create/edit/append 工具会同步写
// SQLite + FTS + 引用图。CLI 直接落盘 wiki/ 会绕过索引，导致
// mcp__llmwiki__search 找不到这些文件。staging 让"自动捕获 stage 产出"
// 价值保留，但 wiki/ 索引保持干净——由 agent 经 MCP 提交 staging 内容。
//
// 提交方式：archive 阶段或 agent 在 session 内读 .staging/ → 调 mcp__llmwiki__create
// ============================================================================

/**
 * Sediment a completed stage's artifacts into staging (NOT wiki/).
 * Called by sdd run after stage advance succeeds.
 */
export async function sedimentStage(changeId, stage, cwd) {
  const stagingDir = path.join(cwd, 'llmwiki', '.staging', stage);
  const wikiDir = path.join(cwd, 'llmwiki', 'wiki');  // 仅 read-count 用
  const changesDir = path.join(cwd, 'openspec', 'changes', changeId);
  const runsDir = path.join(cwd, '.sdd', 'runs', changeId);
  const today = new Date().toISOString().slice(0, 10);
  const results = [];

  // Check changes dir exists
  if (!await fs.pathExists(changesDir)) return { sediments: [], skipped: true };

  switch (stage) {
    case 'grill':
      results.push(await sedimentGlossary(changesDir, stagingDir, today));
      break;
    case 'product':
      results.push(await sedimentRequirements(changesDir, stagingDir, today));
      results.push(await sedimentAC(changesDir, stagingDir, today));
      break;
    case 'dev':
      results.push(await sedimentDesign(changesDir, stagingDir, today));
      break;
    case 'test':
      results.push(await sedimentTestCases(wikiDir));  // read-only count
      break;
    case 'code':
      results.push(await sedimentCodeNotes(changesDir, stagingDir, today));
      break;
    case 'review':
      results.push(await sedimentReview(runsDir, stagingDir, today));
      break;
    case 'verify':
      results.push(await sedimentVerify(changesDir, stagingDir, today));
      break;
    case 'archive':
      results.push(await sedimentArchive(changesDir));  // read-only count
      break;
    default:
      // release, etc. — no sediment
      break;
  }

  // Update llmwiki log + 提示 staging
  const logPath = path.join(cwd, 'llmwiki', 'log.md');
  const sedimentsWritten = results.filter(r => r && r.written).map(r => r.path);
  if (sedimentsWritten.length > 0) {
    await fs.appendFile(logPath,
      `\n## [sediment→staging] ${today} | ${stage} | ${changeId}\n` +
      sedimentsWritten.map(s => `- ${path.relative(cwd, s)}`).join('\n') +
      `\n- ⚠️ staged，需经 mcp__llmwiki__create 提交后才进索引\n`
    );
  }

  return { sediments: sedimentsWritten, skipped: false, stagingDir };
}

async function safeRead(filePath) {
  try { return await fs.readFile(filePath, 'utf8'); } catch { return null; }
}

async function writeIfMissing(wikiPath, content) {
  // Only sediment if content is substantive (not empty scaffold)
  if (!content || content.trim().length < 20) return { written: false };
  await fs.ensureDir(path.dirname(wikiPath));
  if (!await fs.pathExists(wikiPath)) {
    await fs.writeFile(wikiPath, content);
    return { written: true, path: wikiPath };
  }
  return { written: false };
}

// ── grill → glossary ──────────────────────────────────────────────────────────
async function sedimentGlossary(changesDir, wikiDir, today) {
  const findings = await safeRead(path.join(changesDir, 'findings.md'));
  if (!findings) return { written: false };

  // Extract **bold** terms from findings
  const terms = [...findings.matchAll(/\*\*([^*]{2,60})\*\*/g)]
    .map(m => m[1].trim())
    .filter(t => !t.includes('|') && !t.match(/^\d/));
  if (terms.length === 0) return { written: false };

  const glossaryPath = path.join(wikiDir, '_shared', 'glossary', `terms-${today}.md`);
  const content = `---
type: glossary
source: openspec/changes
ingest_date: ${today}
---
# Glossary Terms (auto-sedimented from grill)

${terms.map(t => `- **${t}**`).join('\n')}
`;
  return writeIfMissing(glossaryPath, content);
}

// ── product → requirements + AC ───────────────────────────────────────────────
async function sedimentRequirements(changesDir, wikiDir, today) {
  const proposal = await safeRead(path.join(changesDir, 'proposal.md'));
  if (!proposal) return { written: false };
  const reqPath = path.join(wikiDir, 'product', 'requirements', `REQ-${today}.md`);
  const content = `---
type: requirement
source: ../../openspec/changes
ingest_date: ${today}
---
${proposal.slice(0, 500)}
`;
  return writeIfMissing(reqPath, content);
}

async function sedimentAC(changesDir, wikiDir, today) {
  const ac = await safeRead(path.join(changesDir, 'acceptance-criteria.md'));
  if (!ac) return { written: false };
  const acPath = path.join(wikiDir, 'product', 'acceptance-criteria', `AC-${today}.md`);
  const content = `---
type: acceptance-criteria
source: ../../openspec/changes
ingest_date: ${today}
---
${ac.slice(0, 500)}
`;
  return writeIfMissing(acPath, content);
}

// ── dev → design notes ────────────────────────────────────────────────────────
async function sedimentDesign(changesDir, wikiDir, today) {
  const design = await safeRead(path.join(changesDir, 'design.md'));
  if (!design) return { written: false };
  const engPath = path.join(wikiDir, 'engineering', `EN-${today}.md`);
  const content = `---
type: engineering-note
source: ../../openspec/changes
ingest_date: ${today}
---
${design.slice(0, 500)}
`;
  return writeIfMissing(engPath, content);
}

// ── test → test cases (read-only count of wiki/testing/cases/, no write) ──────
async function sedimentTestCases(wikiDir) {
  const casesDir = path.join(wikiDir, 'testing', 'cases');
  if (!await fs.pathExists(casesDir)) return { written: false };
  const count = (await fs.readdir(casesDir).catch(() => [])).filter(f => f.endsWith('.md')).length;
  return { written: count > 0, path: casesDir };
}

// ── code → progress notes ─────────────────────────────────────────────────────
async function sedimentCodeNotes(changesDir, wikiDir, today) {
  const progress = await safeRead(path.join(changesDir, 'progress.md'));
  if (!progress) return { written: false };
  const engPath = path.join(wikiDir, 'engineering', `EN-code-${today}.md`);
  const content = `---
type: engineering-note
source: ../../openspec/changes
ingest_date: ${today}
stage: code
---
${progress.slice(0, 500)}
`;
  return writeIfMissing(engPath, content);
}

// ── review → learnings ────────────────────────────────────────────────────────
async function sedimentReview(runsDir, wikiDir, today) {
  const review = await safeRead(path.join(runsDir, 'review-notes.md'));
  if (!review) return { written: false };
  const engPath = path.join(wikiDir, 'engineering', `EN-review-${today}.md`);
  const content = `---
type: engineering-note
source: ../../../.sdd/runs
ingest_date: ${today}
stage: review
---
${review.slice(0, 500)}
`;
  return writeIfMissing(engPath, content);
}

// ── verify → evidence summary ─────────────────────────────────────────────────
async function sedimentVerify(changesDir, wikiDir, today) {
  const progress = await safeRead(path.join(changesDir, 'progress.md'));
  if (!progress) return { written: false };
  // Only sediment verify entries from progress
  const verifySection = progress.match(/\[verify\][\s\S]*$/)?.[0];
  if (!verifySection) return { written: false };
  const testPath = path.join(wikiDir, 'testing', 'reports', `RPT-${today}.md`);
  const content = `---
type: test-report
source: ../../openspec/changes
ingest_date: ${today}
stage: verify
---
${verifySection.slice(0, 500)}
`;
  return writeIfMissing(testPath, content);
}

// ── archive → read-only check of promoted specs (no write) ────────────────────
async function sedimentArchive(changesDir) {
  const specsDir = path.join(changesDir, '..', '..', 'specs');
  if (!await fs.pathExists(specsDir)) return { written: false };
  const specCount = (await fs.readdir(specsDir).catch(() => [])).length;
  return { written: specCount > 0, path: specsDir };
}
