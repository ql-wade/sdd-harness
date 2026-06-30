import fs from 'fs-extra';
import path from 'node:path';
import { auditDeliverables } from './deliverable-audit.js';

/**
 * Deliverable Fixer — 自动补全 deliverable-audit 发现的 expected gap。
 *
 * 设计理念：形成"发现 gap → 自动补全 → 重新验证"闭环。
 * 不依赖 agent 自觉执行 skill 文档中的要求——harness 自动做。
 *
 * 策略：对每个 expected gap，尝试确定性补全（解析 + 提取 + 写文件）。
 * 如果无法自动化（如 entities 需要语义理解），标记为 needs-manual。
 */

/**
 * @param {Object} opts — 同 auditDeliverables
 * @returns {Object} { fixed: [], manual: [], report }
 */
export async function fixDeliverables({ projectDir, run, stage }) {
  const audit = await auditDeliverables({ projectDir, run, stage });

  const runsDir = path.join(projectDir, '.sdd', 'runs', run);
  const directChangeDir = path.join(projectDir, 'openspec', 'changes', run);
  const archiveBase = path.join(projectDir, 'openspec', 'changes', 'archive');
  let changeDir = directChangeDir;
  if (!await fs.pathExists(changeDir) && await fs.pathExists(archiveBase)) {
    const entries = await fs.readdir(archiveBase);
    const match = entries.find(e => e === run || e.endsWith(`-${run}`));
    if (match) changeDir = path.join(archiveBase, match);
  }
  const wikiDir = path.join(projectDir, 'llmwiki', 'wiki');

  const ctx = { projectDir, changeDir, runsDir, wikiDir };
  const fixed = [];
  const manual = [];

  for (const failure of audit.expectedFailures) {
    const fixer = FIXERS[failure.id];
    if (!fixer) {
      manual.push({ ...failure, reason: '无自动修复器' });
      continue;
    }
    try {
      const result = await fixer(ctx);
      if (result.fixed) {
        fixed.push({ ...failure, action: result.action });
      } else {
        manual.push({ ...failure, reason: result.reason });
      }
    } catch (err) {
      manual.push({ ...failure, reason: `fix error: ${err.message}` });
    }
  }

  return {
    schemaVersion: 1,
    projectDir,
    run,
    stage: stage || 'all',
    totalGaps: audit.expectedFailures.length,
    fixedCount: fixed.length,
    manualCount: manual.length,
    fixed,
    manual,
  };
}

// ── 自动修复器 ──────────────────────────────────────────────

const FIXERS = {

  /**
   * ADR_ARCHIVED: 从 findings.md 提取 ADR 段落 → wiki/product/decisions/ADR-*.md
   */
  async ADR_ARCHIVED({ changeDir, wikiDir }) {
    const findings = await readText(path.join(changeDir, 'findings.md'));
    if (!findings) return { fixed: false, reason: 'findings.md 不存在' };

    const adrSection = extractSection(findings, /ADR|决策记录|Decision/i);
    if (!adrSection) return { fixed: false, reason: 'findings.md 无 ADR 段落' };

    // 提取每个 ADR-xxx 条目
    const adrBlocks = adrSection.split(/(?=-\s\*?\*?ADR[-\s]?\d)/).filter(s => /ADR[-\s]?\d/i.test(s));
    if (adrBlocks.length === 0) return { fixed: false, reason: '未找到 ADR-xxx 条目' };

    const decisionsDir = path.join(wikiDir, 'product', 'decisions');
    await fs.ensureDir(decisionsDir);

    let count = 0;
    for (const block of adrBlocks) {
      const idMatch = block.match(/ADR[-\s]?(\d+)/i);
      if (!idMatch) continue;
      const id = `ADR-${idMatch[1].padStart(3, '0')}`;
      const filePath = path.join(decisionsDir, `${id}.md`);
      if (!await fs.pathExists(filePath)) {
        await fs.writeFile(filePath, formatAdrWiki(id, block.trim()));
        count++;
      }
    }
    return count > 0
      ? { fixed: true, action: `提取 ${count} 个 ADR → wiki/product/decisions/` }
      : { fixed: false, reason: 'ADR 已全部归档（无新增）' };
  },

  /**
   * AC_SPLIT: 从 acceptance-criteria.md 拆分 AC 条目 → wiki/product/acceptance-criteria/AC-*.md
   */
  async AC_SPLIT({ changeDir, wikiDir }) {
    const acContent = await readText(path.join(changeDir, 'acceptance-criteria.md'));
    if (!acContent) return { fixed: false, reason: 'acceptance-criteria.md 不存在' };

    // 匹配 ## AC-xxx 或 ### AC-xxx 或 AC-N: 格式
    const acBlocks = acContent.split(/(?=^#{1,3}\s*AC[-\s]?\d|^AC[-\s]?\d+:)/m)
      .filter(s => /AC[-\s]?\d/i.test(s));
    if (acBlocks.length === 0) return { fixed: false, reason: '未找到 AC-xxx 条目' };

    const acDir = path.join(wikiDir, 'product', 'acceptance-criteria');
    await fs.ensureDir(acDir);

    let count = 0;
    for (const block of acBlocks) {
      const idMatch = block.match(/AC[-\s]?(\d+)/i);
      if (!idMatch) continue;
      const id = `AC-${idMatch[1].padStart(2, '0')}`;
      const filePath = path.join(acDir, `${id}.md`);
      if (!await fs.pathExists(filePath)) {
        await fs.writeFile(filePath, formatAcWiki(id, block.trim()));
        count++;
      }
    }
    return count > 0
      ? { fixed: true, action: `拆分 ${count} 个 AC → wiki/product/acceptance-criteria/` }
      : { fixed: false, reason: 'AC 已全部拆分（无新增）' };
  },

  /**
   * LEARNINGS_PROPAGATED: 从 review-notes.md 提取 learnings → 追加到 findings.md
   */
  async LEARNINGS_PROPAGATED({ changeDir, runsDir }) {
    const review = await readText(path.join(runsDir, 'review-notes.md'));
    if (!review) return { fixed: false, reason: 'review-notes.md 不存在' };

    const learnings = extractSection(review, /OCR|learning|教训|经验|triage/i);
    if (!learnings) return { fixed: false, reason: 'review-notes.md 无 learnings 段落' };

    const findingsPath = path.join(changeDir, 'findings.md');
    const findings = await readText(findingsPath);
    if (!findings) return { fixed: false, reason: 'findings.md 不存在' };

    // 检查是否已追加
    if (/## .*Review Learnings/i.test(findings.slice(-800))) {
      return { fixed: false, reason: 'learnings 已传播（无重复追加）' };
    }

    const appendText = `\n\n---\n\n## Review Learnings（从 review-notes.md 传播）\n\n${learnings.trim()}\n`;
    await fs.appendFile(findingsPath, appendText);
    return { fixed: true, action: 'review learnings 已追加到 findings.md' };
  },

  /**
   * RELEASE_NOTE_EXISTS: 从 progress.md 生成 release note
   */
  async RELEASE_NOTE_EXISTS({ changeDir, runsDir }) {
    const progress = await readText(path.join(changeDir, 'progress.md'));
    if (!progress) return { fixed: false, reason: 'progress.md 不存在' };

    // 提取测试结果和性能基线
    const testMatch = progress.match(/(\d+)\s*(?:个\s*)?case\s*(?:全部\s*)?pass|Tests\s+(\d+)\s+passed/i);
    const perfMatch = progress.match(/FPS[^:]*:\s*(\d+)/i);
    const memMatch = progress.match(/[Mm]emory[^:]*:\s*([\d.]+)\s*MB/i);

    const sections = ['# Release Note', ''];
    if (testMatch) sections.push(`## 测试\n- ${testMatch[1] || testMatch[2]} 个 case 全部通过`);
    if (perfMatch) sections.push(`## 性能\n- FPS: ${perfMatch[1]}`);
    if (memMatch) sections.push(`- Memory delta: ${memMatch[1]} MB`);
    sections.push('');

    const wf = await readText(path.join(runsDir, 'workflow-frame.yaml'));
    const goalMatch = wf?.match(/goal:\s*"([^"]*)"/);
    if (goalMatch) sections.push(`## 变更目标\n${goalMatch[1]}`);

    const releasePath = path.join(changeDir, 'RELEASE_NOTE.md');
    await fs.writeFile(releasePath, sections.join('\n'));
    return { fixed: true, action: '从 progress.md 生成 RELEASE_NOTE.md' };
  },

  /**
   * CONCEPTS_EXTRACTED: 从 findings.md glossary 提取概念 → wiki/concepts/
   */
  async CONCEPTS_EXTRACTED({ changeDir, wikiDir }) {
    const findings = await readText(path.join(changeDir, 'findings.md'));
    if (!findings) return { fixed: false, reason: 'findings.md 不存在' };

    const glossary = extractSection(findings, /术语|Glossary|概念/i);
    if (!glossary) return { fixed: false, reason: 'findings.md 无术语段落' };

    // 提取 "- **Term**: definition" 或 "- Term: definition" 格式
    // 约束：term 长度 2-40 字符，排除 Non-goal / ADR 行（它们有自己的修复器）
    const terms = glossary.matchAll(/^-\s+\*?\*?([^:*\n]{2,40})\*?\*?\s*:\s*(.+)$/gm);
    const conceptsDir = path.join(wikiDir, 'concepts');
    await fs.ensureDir(conceptsDir);

    let count = 0;
    for (const match of terms) {
      const term = match[1].trim();
      const definition = match[2].trim();
      // 跳过 Non-goal / ADR 行（由各自修复器处理）
      if (/non.?goal|adr|❌/i.test(term)) continue;
      // term 不应包含换行或 Markdown header 标记
      if (/[\n#]/.test(term)) continue;
      const slug = term.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!slug) continue;
      // slug 不应超过 60 字符（防止整段文本变成 slug）
      if (slug.length > 60) continue;
      const filePath = path.join(conceptsDir, `${slug}.md`);
      if (!await fs.pathExists(filePath)) {
        await fs.writeFile(filePath, formatConceptWiki(term, definition));
        count++;
      }
    }
    return count > 0
      ? { fixed: true, action: `提取 ${count} 个概念 → wiki/concepts/` }
      : { fixed: false, reason: '未找到可提取的术语条目' };
  },

  /**
   * ENTITIES_EXTRACTED: 需要 LLM 语义理解，标记为 manual
   */
  async ENTITIES_EXTRACTED() {
    return {
      fixed: false,
      reason: 'entity 提取需要语义理解，建议在 sdd:archive 阶段由 agent 手动执行',
    };
  },

  /**
   * TRACEABILITY_MATRIX: 交叉引用 TC ↔ REQ ↔ spec → wiki/_shared/traceability/
   */
  async TRACEABILITY_MATRIX({ changeDir, wikiDir }) {
    const tcDir = path.join(wikiDir, 'testing', 'cases');
    const reqDir = path.join(wikiDir, 'product', 'requirements');
    const specsDir = path.join(changeDir, 'specs');

    const tcs = (await safeReaddir(tcDir)).filter(f => /^TC-.*\.md$/i.test(f));
    const reqs = (await safeReaddir(reqDir)).filter(f => /^REQ-.*\.md$/i.test(f));
    const specModules = await safeReaddir(specsDir);

    if (tcs.length === 0 && reqs.length === 0) {
      return { fixed: false, reason: '无 TC/REQ 文件，无法生成 traceability' };
    }

    // 生成简单的交叉引用矩阵
    const lines = [
      '# Traceability Matrix',
      '',
      '> 自动生成：TC ↔ REQ ↔ Spec 模块交叉引用',
      '',
      '| Test Case | Requirement | Spec Module |',
      '|---|---|---|',
    ];

    for (const tc of tcs) {
      const tcName = tc.replace(/\.md$/i, '');
      // 尝试从 TC 文件内容匹配 spec/req 关键词
      const tcContent = await readText(path.join(tcDir, tc)) || '';
      const matchedReq = reqs.find(r => {
        const reqName = r.replace(/\.md$/i, '').replace(/^REQ-/, '');
        return tcContent.toLowerCase().includes(reqName.toLowerCase());
      }) || '';
      const matchedSpec = specModules.find(m =>
        tcContent.toLowerCase().includes(m.toLowerCase())
      ) || '';
      lines.push(`| ${tcName} | ${matchedReq || '—'} | ${matchedSpec || '—'} |`);
    }

    // 添加没有 TC 匹配的 REQ
    for (const req of reqs) {
      const reqName = req.replace(/\.md$/i, '');
      const hasTc = lines.some(l => l.includes(reqName));
      if (!hasTc) lines.push(`| — | ${reqName} | — |`);
    }

    const traceDir = path.join(wikiDir, '_shared', 'traceability');
    await fs.ensureDir(traceDir);
    await fs.writeFile(path.join(traceDir, 'matrix.md'), lines.join('\n') + '\n');

    return { fixed: true, action: `生成 traceability matrix（${tcs.length} TC × ${reqs.length} REQ × ${specModules.length} spec）` };
  },
};

// ── 辅助函数 ────────────────────────────────────────────────

function extractSection(text, headerPattern) {
  if (!text) return null;
  const lines = text.split('\n');
  let start = -1;
  let headerLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    if (headerPattern.test(lines[i])) {
      start = i;
      headerLevel = (lines[i].match(/^#+/) || [''])[0].length;
      break;
    }
  }
  if (start === -1) return null;
  // If the match is not a markdown header (headerLevel === 0), it's a plain text
  // line (e.g. a blockquote with keywords). Don't return the whole file —
  // find the nearest enclosing ## header instead.
  if (headerLevel === 0) {
    // Walk backward to find the nearest ## header
    for (let i = start - 1; i >= 0; i--) {
      const m = lines[i].match(/^(#+)/);
      if (m) { start = i; headerLevel = m[1].length; break; }
    }
    if (headerLevel === 0) return null; // no enclosing header
  }
  const end = headerLevel > 0
    ? lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${headerLevel}}\\s`).test(l))
    : lines.length;
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

function formatAdrWiki(id, content) {
  return `---\ntype: adr\nslug: ${id}\n---\n\n# ${id}\n\n${content}\n`;
}

function formatAcWiki(id, content) {
  return `---\ntype: acceptance-criterion\nslug: ${id}\n---\n\n${content}\n`;
}

function formatConceptWiki(term, definition) {
  const slug = term.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `---\ntype: concept\nslug: ${slug}\nterm: ${term}\n---\n\n# ${term}\n\n${definition}\n`;
}

async function readText(filePath) {
  if (!filePath || !await fs.pathExists(filePath)) return null;
  return fs.readFile(filePath, 'utf8');
}

async function safeReaddir(dirPath) {
  if (!dirPath || !await fs.pathExists(dirPath)) return [];
  return fs.readdir(dirPath);
}
