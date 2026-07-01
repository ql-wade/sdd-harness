import fs from 'fs-extra';
import path from 'node:path';

/**
 * Deliverable Audit — 按 stage 核定产出完整性。
 *
 * 设计理念（借鉴 goal-loop-wizard "每一步产出都要核定"）：
 *   每个 stage 的 skill 定义了"应该产出什么"，但实际执行时 agent 会跳过。
 *   本模块把"设计要求"固化为可程序化检查的规则，让 harness 自动发现 gap。
 *
 * 分两类检查：
 *   required  — 缺失即 fail（硬性产出）
 *   expected  — 缺失仅 warn（推荐产出，MVP 可合理跳过）
 */

// ── 产出规则 ──────────────────────────────────────────────

const REQUIRED = 'required';
const EXPECTED = 'expected';

/**
 * @typedef {Object} DeliverableRule
 * @property {string} stage
 * @property {string} id        — 稳定标识符（如 AC_SPLIT）
 * @property {string} severity  — 'required' | 'expected'
 * @property {string} describe  — 人可读描述
 * @property {function} check   — async ({projectDir, changeDir, runsDir, wikiDir}) => {pass:boolean, detail?:string}
 */

const rules = [
  // ── Grill ────────────────────────────────────────────
  {
    stage: 'grill',
    id: 'FINDINGS_EXISTS',
    severity: REQUIRED,
    describe: 'findings.md 存在且非空',
    async check({ changeDir }) {
      const p = path.join(changeDir, 'findings.md');
      if (!await fs.pathExists(p)) return { pass: false, detail: 'findings.md 不存在' };
      const stat = await fs.stat(p);
      return { pass: stat.size > 50, detail: stat.size > 50 ? undefined : `文件过小 (${stat.size}B)` };
    },
  },
  {
    stage: 'grill',
    id: 'ADR_ARCHIVED',
    severity: EXPECTED,
    describe: 'findings.md 中的 ADR 候选已归档到 wiki/product/decisions/',
    async check({ changeDir, wikiDir }) {
      const findings = await readText(path.join(changeDir, 'findings.md'));
      if (!findings) return { pass: true, detail: '无 findings.md，跳过' };
      const adrMatches = findings.match(/ADR[-\s]?(\d{1,3})/gi) || [];
      const adrIds = new Set(adrMatches.map(m => m.match(/\d+/)[0]));
      const adrCount = adrIds.size;
      if (adrCount === 0) return { pass: true, detail: '无 ADR 候选' };
      const decisionsDir = path.join(wikiDir, 'product', 'decisions');
      const files = await safeReaddir(decisionsDir);
      return {
        pass: files.length >= adrCount,
        detail: `findings 声明 ${adrCount} 个 ADR, wiki/product/decisions/ 有 ${files.length} 个文件`,
      };
    },
  },

  // ── Product ──────────────────────────────────────────
  {
    stage: 'product',
    id: 'PROPOSAL_EXISTS',
    severity: REQUIRED,
    describe: 'proposal.md (PRD) 存在且非空',
    async check({ changeDir }) {
      return checkFileNonEmpty(path.join(changeDir, 'proposal.md'), 'proposal.md');
    },
  },
  {
    stage: 'product',
    id: 'AC_EXISTS',
    severity: REQUIRED,
    describe: 'acceptance-criteria.md 存在且非空',
    async check({ changeDir }) {
      return checkFileNonEmpty(path.join(changeDir, 'acceptance-criteria.md'), 'acceptance-criteria.md');
    },
  },
  {
    stage: 'product',
    id: 'AC_SPLIT',
    severity: EXPECTED,
    describe: 'AC 已拆分到 wiki/product/acceptance-criteria/AC-*.md',
    async check({ changeDir, wikiDir }) {
      const acFile = await readText(path.join(changeDir, 'acceptance-criteria.md'));
      if (!acFile) return { pass: true, detail: '无 AC 文件，跳过' };
      const acDir = path.join(wikiDir, 'product', 'acceptance-criteria');
      const files = await safeReaddir(acDir);
      const acFiles = files.filter(f => /^AC-.*\.md$/i.test(f));
      return {
        pass: acFiles.length > 0,
        detail: `wiki/product/acceptance-criteria/ 下有 ${acFiles.length} 个 AC-*.md 文件`,
      };
    },
  },

  // ── Dev ──────────────────────────────────────────────
  {
    stage: 'dev',
    id: 'DESIGN_EXISTS',
    severity: REQUIRED,
    describe: 'design.md 存在且含 boundary 注解',
    async check({ changeDir }) {
      const design = await readText(path.join(changeDir, 'design.md'));
      if (!design) return { pass: false, detail: 'design.md 不存在' };
      const hasBoundary = /boundar|依赖|layer|层/i.test(design);
      return { pass: hasBoundary, detail: hasBoundary ? undefined : 'design.md 缺少 boundary/层注解' };
    },
  },
  {
    stage: 'dev',
    id: 'TASKS_EXISTS',
    severity: REQUIRED,
    describe: 'tasks.md 存在',
    async check({ changeDir }) {
      return checkFileExists(path.join(changeDir, 'tasks.md'), 'tasks.md');
    },
  },
  {
    stage: 'dev',
    id: 'SPECS_EXIST',
    severity: REQUIRED,
    describe: 'specs/ 目录下至少有 1 个 spec delta',
    async check({ changeDir }) {
      const specsDir = path.join(changeDir, 'specs');
      if (!await fs.pathExists(specsDir)) return { pass: false, detail: 'specs/ 目录不存在' };
      const entries = await safeReaddir(specsDir);
      const specFiles = [];
      for (const entry of entries) {
        const sub = path.join(specsDir, entry);
        if ((await fs.stat(sub)).isDirectory()) {
          const subs = await safeReaddir(sub);
          specFiles.push(...subs.filter(f => f.endsWith('.md')));
        }
      }
      return { pass: specFiles.length > 0, detail: `${specFiles.length} 个 spec delta` };
    },
  },

  // ── Test ─────────────────────────────────────────────
  {
    stage: 'test',
    id: 'TEST_CASES_WRITTEN',
    severity: REQUIRED,
    describe: 'wiki/testing/cases/ 下至少有 1 个 TC-*.md',
    async check({ wikiDir }) {
      const casesDir = path.join(wikiDir, 'testing', 'cases');
      const files = await safeReaddir(casesDir);
      const tcFiles = files.filter(f => /^TC-.*\.md$/i.test(f));
      return { pass: tcFiles.length > 0, detail: `${tcFiles.length} 个 TC-*.md` };
    },
  },
  {
    stage: 'test',
    id: 'TEST_MATRIX_EXISTS',
    severity: EXPECTED,
    describe: 'wiki/testing/matrices/test-matrix.md 存在',
    async check({ wikiDir }) {
      return checkFileExists(
        path.join(wikiDir, 'testing', 'matrices', 'test-matrix.md'),
        'test-matrix.md',
      );
    },
  },

  // ── Review ───────────────────────────────────────────
  {
    stage: 'review',
    id: 'REVIEW_NOTES_EXISTS',
    severity: REQUIRED,
    describe: 'review-notes.md 存在且含 verdict',
    async check({ runsDir }) {
      const review = await readText(path.join(runsDir, 'review-notes.md'));
      if (!review) return { pass: false, detail: 'review-notes.md 不存在' };
      const hasVerdict = /verdict\s*:/i.test(review);
      return { pass: hasVerdict, detail: hasVerdict ? undefined : 'review-notes.md 缺少 verdict' };
    },
  },
  {
    stage: 'review',
    id: 'LEARNINGS_PROPAGATED',
    severity: EXPECTED,
    describe: 'review learnings 已传播到 findings.md',
    async check({ changeDir, runsDir }) {
      const review = await readText(path.join(runsDir, 'review-notes.md'));
      if (!review) return { pass: true, detail: '无 review-notes.md' };
      // 检查 review 中是否有 OCR/learning 标记
      const hasLearnings = /OCR|learning|教训|经验/i.test(review);
      if (!hasLearnings) return { pass: true, detail: 'review 无 learnings 标记' };
      // 检查 findings.md 是否已追加 review 内容
      const findings = await readText(path.join(changeDir, 'findings.md'));
      if (!findings) return { pass: false, detail: 'findings.md 不存在' };
      const findingsHasLearnings = /review|OCR|learning/i.test(findings.slice(-500));
      return {
        pass: findingsHasLearnings,
        detail: findingsHasLearnings ? undefined : 'findings.md 未追加 review learnings',
      };
    },
  },

  // ── Verify ───────────────────────────────────────────
  {
    stage: 'verify',
    id: 'PROBE_REPORT_EXISTS',
    severity: REQUIRED,
    describe: 'probe-report.json 存在且 pass=true',
    async check({ runsDir }) {
      const report = await readJson(path.join(runsDir, 'probe-report.json'));
      if (!report) return { pass: false, detail: 'probe-report.json 不存在或无效' };
      return { pass: report.pass === true, detail: `pass=${report.pass}` };
    },
  },
  {
    stage: 'verify',
    id: 'EVIDENCE_AUDIT_EXISTS',
    severity: REQUIRED,
    describe: 'evidence-audit-report.json 存在且 pass=true',
    async check({ runsDir }) {
      const report = await readJson(path.join(runsDir, 'evidence-audit-report.json'));
      if (!report) return { pass: false, detail: 'evidence-audit-report.json 不存在或无效' };
      return { pass: report.pass === true, detail: `pass=${report.pass}` };
    },
  },

  // ── Release ──────────────────────────────────────────
  {
    stage: 'release',
    id: 'RELEASE_NOTE_EXISTS',
    severity: EXPECTED,
    describe: 'release note / changelog 已产出',
    async check({ changeDir, runsDir }) {
      // 检查 changes 目录或 runs 目录下是否有 release 相关文件
      const candidates = [
        path.join(changeDir, 'RELEASE_NOTE.md'),
        path.join(changeDir, 'CHANGELOG.md'),
        path.join(changeDir, 'release-note.md'),
        path.join(runsDir, 'release-note.md'),
      ];
      for (const c of candidates) {
        if (await fs.pathExists(c)) return { pass: true };
      }
      // release skip 模式：检查 workflow-frame 中是否有 skip 标记
      const wf = await readText(path.join(runsDir, 'workflow-frame.yaml'));
      if (wf && /release.*skip|skip.*release|no.deploy|mode:\s*skip/i.test(wf)) {
        return { pass: true, detail: 'release skipped (documented)' };
      }
      return { pass: false, detail: '无 release note 且无 skip 标记' };
    },
  },

  // ── Archive ──────────────────────────────────────────
  {
    stage: 'archive',
    id: 'SPEC_PROMOTED',
    severity: REQUIRED,
    describe: 'spec 已提升到 openspec/specs/',
    async check({ projectDir, changeDir }) {
      const changeSpecsDir = path.join(changeDir, 'specs');
      const globalSpecsDir = path.join(projectDir, 'openspec', 'specs');
      const changeModules = await safeReaddir(changeSpecsDir);
      const globalModules = await safeReaddir(globalSpecsDir);
      const promoted = changeModules.filter(m => globalModules.includes(m));
      return {
        pass: promoted.length >= changeModules.length && changeModules.length > 0,
        detail: `${promoted.length}/${changeModules.length} 模块已提升`,
      };
    },
  },
  {
    stage: 'archive',
    id: 'CONCEPTS_EXTRACTED',
    severity: EXPECTED,
    describe: 'LLMWiki concepts/ 已提取（跨域概念定义）',
    async check({ wikiDir }) {
      const conceptsDir = path.join(wikiDir, 'concepts');
      const files = await safeReaddir(conceptsDir);
      return { pass: files.length > 0, detail: `${files.length} 个 concept 文件` };
    },
  },
  {
    stage: 'archive',
    id: 'ENTITIES_EXTRACTED',
    severity: EXPECTED,
    describe: 'LLMWiki entities/ 已提取（实体关系图谱）',
    async check({ wikiDir }) {
      const entitiesDir = path.join(wikiDir, 'entities');
      const files = await safeReaddir(entitiesDir);
      return { pass: files.length > 0, detail: `${files.length} 个 entity 文件` };
    },
  },
  {
    stage: 'archive',
    id: 'TRACEABILITY_MATRIX',
    severity: EXPECTED,
    describe: 'wiki/_shared/traceability/ 已生成可追溯矩阵',
    async check({ wikiDir }) {
      const traceDir = path.join(wikiDir, '_shared', 'traceability');
      const files = await safeReaddir(traceDir);
      return { pass: files.length > 0, detail: `${files.length} 个 traceability 文件` };
    },
  },
];

// ── 核心审计函数 ────────────────────────────────────────────

/**
 * @param {Object} opts
 * @param {string} opts.projectDir  — 项目根目录
 * @param {string} opts.run         — .sdd/runs/<run> ID
 * @param {string} [opts.stage]     — 只检查指定 stage（不传则检查所有已完成的 stage）
 */
export async function auditDeliverables({ projectDir, run, stage }) {
  const runsDir = path.join(projectDir, '.sdd', 'runs', run);
  const wfPath = path.join(runsDir, 'workflow-frame.yaml');

  // 解析 changeDir（可能是活跃或已归档）
  const directChangeDir = path.join(projectDir, 'openspec', 'changes', run);
  const archiveBase = path.join(projectDir, 'openspec', 'changes', 'archive');
  let changeDir = directChangeDir;
  if (!await fs.pathExists(changeDir) && await fs.pathExists(archiveBase)) {
    const entries = await safeReaddir(archiveBase);
    const match = entries.find(e => e === run || e.endsWith(`-${run}`));
    if (match) changeDir = path.join(archiveBase, match);
  }

  const wikiDir = path.join(projectDir, 'llmwiki', 'wiki');

  // 确定要检查的 stages
  const stagesToCheck = stage
    ? [stage]
    : inferCompletedStages(await readText(wfPath));

  const results = [];
  for (const rule of rules) {
    if (!stagesToCheck.includes(rule.stage)) continue;
    const ctx = { projectDir, changeDir, runsDir, wikiDir };
    try {
      const r = await rule.check(ctx);
      results.push({
        stage: rule.stage,
        id: rule.id,
        severity: rule.severity,
        describe: rule.describe,
        pass: r.pass,
        detail: r.detail || null,
      });
    } catch (err) {
      results.push({
        stage: rule.stage,
        id: rule.id,
        severity: rule.severity,
        describe: rule.describe,
        pass: false,
        detail: `check error: ${err.message}`,
      });
    }
  }

  const requiredFail = results.filter(r => r.severity === REQUIRED && !r.pass);
  const expectedFail = results.filter(r => r.severity === EXPECTED && !r.pass);

  return {
    schemaVersion: 1,
    projectDir,
    run,
    stage: stage || 'all',
    checkedStages: stagesToCheck,
    totalRules: results.length,
    pass: requiredFail.length === 0,
    requiredFailures: requiredFail,
    expectedFailures: expectedFail,
    results,
  };
}

// ── 辅助函数 ────────────────────────────────────────────────

const STAGE_ORDER = ['grill', 'product', 'dev', 'test', 'code', 'review', 'verify', 'release', 'archive'];

function inferCompletedStages(wfText) {
  if (!wfText) return STAGE_ORDER;
  const match = wfText.match(/^\s*current:\s*(\w+)\s*$/m);
  if (!match) return STAGE_ORDER;
  const currentIdx = STAGE_ORDER.indexOf(match[1]);
  if (currentIdx === -1) return STAGE_ORDER;
  return STAGE_ORDER.slice(0, currentIdx + 1);
}

async function readText(filePath) {
  if (!filePath || !await fs.pathExists(filePath)) return null;
  return fs.readFile(filePath, 'utf8');
}

async function readJson(filePath) {
  if (!filePath || !await fs.pathExists(filePath)) return null;
  try { return fs.readJson(filePath); } catch { return null; }
}

async function safeReaddir(dirPath) {
  if (!dirPath || !await fs.pathExists(dirPath)) return [];
  return fs.readdir(dirPath);
}

async function checkFileExists(filePath, label) {
  if (!await fs.pathExists(filePath)) return { pass: false, detail: `${label} 不存在` };
  return { pass: true };
}

async function checkFileNonEmpty(filePath, label) {
  if (!await fs.pathExists(filePath)) return { pass: false, detail: `${label} 不存在` };
  const stat = await fs.stat(filePath);
  return { pass: stat.size > 50, detail: stat.size > 50 ? undefined : `${label} 过小 (${stat.size}B)` };
}
