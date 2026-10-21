import { createHash } from 'node:crypto';
import fs from 'fs-extra';
import path from 'path';

// ============================================================================
// Knowledge Seed — 扫描项目已有知识源，复制到 llmwiki/raw/ 待 LLM 经 MCP ingest
//
// 契约（v2 修正）：本模块只做"发现 + 复制"，不写 wiki/ 内容。
// wiki/ 内容由 LLM 通过 lucasastorian/llmwiki MCP 的 create/edit/append 工具写
// （这些工具同步更新 SQLite + FTS + 引用图）。CLI 直接写 wiki/ 会绕过索引，
// 导致 mcp__llmwiki__search 找不到——所以旧版的 generateSeedContent 已删除。
// ============================================================================

// 最大递归深度 + 文件数上限，防恶意/巨型目录触发栈溢出或 OOM
const KS_MAX_DEPTH = 20;
const KS_MAX_FILES = 5000;

/**
 * Scan project for existing knowledge sources.
 * Returns categorized list of source files (read-only, no writes).
 */
export function discoverKnowledgeSources(cwd) {
  const sources = {
    docs: [],
    specs: [],
    steering: [],
    catalog: null,
    domainGraph: null,
    agentDocs: [],
    openspecConfig: null,
  };

  // 1. Architecture/engineering docs
  const docDirs = ['docs', 'doc', 'documentation'];
  for (const d of docDirs) {
    const dir = path.join(cwd, d);
    if (fs.pathExistsSync(dir)) {
      const files = findMdFiles(dir);
      for (const f of files) {
        sources.docs.push({
          path: path.relative(cwd, f),
          title: extractTitle(f) || path.basename(f, '.md'),
          category: categorizeDoc(f),
        });
      }
      break; // only first matching dir
    }
  }

  // 2. OpenSpec specs (promoted domain specs)
  const specsDir = path.join(cwd, 'openspec', 'specs');
  if (fs.existsSync(specsDir) && fs.statSync(specsDir).isDirectory()) {
    let entries;
    try { entries = fs.readdirSync(specsDir, { withFileTypes: true }); }
    catch { entries = []; }
    for (const e of entries) {
      if (e.isDirectory()) {
        // Check if it has spec.md
        const specMd = path.join(specsDir, e.name, 'spec.md');
        if (fs.pathExistsSync(specMd)) {
          sources.specs.push({
            path: `openspec/specs/${e.name}/spec.md`,
            title: e.name,
            category: 'domain-spec',
          });
        }
      } else if (e.name.endsWith('.md')) {
        sources.specs.push({
          path: `openspec/specs/${e.name}`,
          title: path.basename(e.name, '.md'),
          category: 'domain-spec',
        });
      }
    }
  }

  // 3. Steering / project docs (CLAUDE.md, AGENTS.md, README.md)
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'README.md']) {
    const full = path.join(cwd, f);
    if (fs.pathExistsSync(full)) {
      sources.steering.push({
        path: f,
        title: f.replace('.md', ''),
        category: 'project-root',
      });
    }
  }

  // 4. CODEBASE-CATALOG from Understand-Anything（可选输入，adopter 自备；生成器已随 ADR-0015 移除）
  const catalog = path.join(cwd, '.understand-anything', 'CODEBASE-CATALOG.md');
  if (fs.pathExistsSync(catalog)) {
    sources.catalog = { path: '.understand-anything/CODEBASE-CATALOG.md', lines: countLines(catalog) };
  }

  // 5. Domain graph
  const domainGraph = path.join(cwd, '.understand-anything', 'domain-graph.json');
  if (fs.pathExistsSync(domainGraph)) {
    sources.domainGraph = { path: '.understand-anything/domain-graph.json' };
  }

  // 6. OpenSpec project config
  const osConfig = path.join(cwd, 'openspec', 'project.md');
  if (fs.pathExistsSync(osConfig)) {
    sources.openspecConfig = { path: 'openspec/project.md' };
  }

  // 7. Agent docs (.agents/, .claude/ instructions)
  for (const d of ['.agents', '.claude']) {
    const dir = path.join(cwd, d);
    if (fs.pathExistsSync(dir)) {
      const files = findMdFiles(dir);
      for (const f of files) {
        sources.agentDocs.push({
          path: path.relative(cwd, f),
          title: extractTitle(f) || path.basename(f, '.md'),
        });
      }
      break;
    }
  }

  return sources;
}

/**
 * Copy all discovered knowledge sources into llmwiki/raw/ for later LLM ingest.
*
 * Uses slug filenames (relative path → `docs__architecture__foo.md`) to avoid
 * basename collisions (e.g. multiple README.md). raw/ files are the input for
 * `sdd wiki ingest` or session-side `mcp__llmwiki__create`.
 *
 * Returns { copied: number, files: [{path, source}] }.
 */
export async function copySourcesToRaw(cwd, wikiHome, sources) {
  const rawDir = path.join(wikiHome, 'raw');
  await fs.ensureDir(rawDir);
  const files = [];
  const seenSlugs = new Set();

  // Collect all source paths (singletons like catalog/domainGraph/openspecConfig
  // plus arrays docs/specs/steering/agentDocs) — covers all discoverKnowledgeSources output
  const all = [
    ...sources.docs,
    ...sources.specs,
    ...sources.steering,
    ...sources.agentDocs,
  ];
  if (sources.catalog) all.push({ path: sources.catalog.path });
  if (sources.domainGraph) all.push({ path: sources.domainGraph.path });
  if (sources.openspecConfig) all.push({ path: sources.openspecConfig.path });

  for (const src of all) {
    if (!src?.path) continue;
    const srcAbs = path.join(cwd, src.path);
    if (!fs.pathExistsSync(srcAbs)) continue;
    // Slug: relative path with / → __，避免 basename 撞名（多个 README.md）
    const slug = src.path
      .replace(/^\.+\/?/, '')            // 去前导 ./ 或 ../
      .replace(/[/\\]+/g, '__')           // 路径分隔符 → __
      .replace(/[^a-zA-Z0-9._\-]/g, '_'); // 其他非法字符 → _
    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    const dest = path.join(rawDir, slug);
    if (!fs.pathExistsSync(dest)) {
      await fs.copy(srcAbs, dest);
      files.push({ path: `raw/${slug}`, source: src.path });
    }
  }

  return { copied: files.length, files };
}

// ============================================================================
// Helpers (read-only, used by discoverKnowledgeSources)
// ============================================================================

function findMdFiles(dir) {
  const results = [];
  const walk = (d, depth) => {
    if (depth > KS_MAX_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;  // 防 symlink 循环
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
        walk(path.join(d, e.name), depth + 1);
        if (results.length >= KS_MAX_FILES) return;
      } else if (e.isFile() && e.name.endsWith('.md')) {
        results.push(path.join(d, e.name));
        if (results.length >= KS_MAX_FILES) return;
      }
    }
  };
  walk(dir, 0);
  return results.sort();
}

function extractTitle(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8').slice(0, 500);
    // First H1
    const match = content.match(/^#\s+(.+)$/m);
    if (match) return match[1].trim();
    // YAML frontmatter title
    const fmMatch = content.match(/^title:\s*["']?(.+?)["']?$/m);
    if (fmMatch) return fmMatch[1].trim();
  } catch {}
  return null;
}

function categorizeDoc(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.includes('architecture') || name.includes('design')) return 'architecture';
  if (name.includes('agent') || name.includes('runtime')) return 'runtime';
  if (name.includes('mcp') || name.includes('tool')) return 'tooling';
  if (name.includes('skill')) return 'skill-system';
  if (name.includes('file') || name.includes('workspace')) return 'filesystem';
  if (name.includes('security') || name.includes('blacklist')) return 'security';
  if (name.includes('higress') || name.includes('nacos') || name.includes('docker')) return 'infrastructure';
  if (name.includes('handoff') || name.includes('todo')) return 'planning';
  return 'general';
}

function countLines(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').split('\n').length;
  } catch {
    return 0;
  }
}

// ============================================================================
// Required project knowledge (E01, Knowledge.Closeout.v1 Kp) — task P4_4
//
// The R06 closeout strategy requires the project knowledge obligation to be
// judged BEFORE the spec archive: a required entry missing from the canonical
// wiki (or drifted from the frozen candidate digest) blocks closeout and the
// report NAMES the entry. Applicability is a decision with a recorded basis —
// a bare "not applicable" (不能自填无更新) never satisfies an entry.
// ============================================================================

const SHA256_RE = /^[a-f0-9]{64}$/;
const KNOWLEDGE_CHANNELS = ['llmwiki', 'outline'];

export class KnowledgeSeedError extends Error {
  constructor(message, details = []) {
    super(`${message}${details.length > 0 ? `: ${details.join('; ')}` : ''}`);
    this.name = 'KnowledgeSeedError';
    this.details = details;
  }
}

// The required-knowledge manifest. Entry shape:
//   { capability, digest (sha256 of the frozen candidate content), source
//     (repo-relative provenance), channel ('llmwiki' project knowledge |
//     'outline' team publication), applicable?, applicabilityBasis? }
export function defineRequiredKnowledge(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new KnowledgeSeedError('defineRequiredKnowledge requires a non-empty entries array');
  }
  const errors = [];
  const normalized = entries.map((entry, index) => {
    const at = `entries[${index}]`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${at}: must be an object`);
      return null;
    }
    if (typeof entry.capability !== 'string' || entry.capability.length === 0) errors.push(`${at}.capability: required non-empty string`);
    if (typeof entry.digest !== 'string' || !SHA256_RE.test(entry.digest)) errors.push(`${at}.digest: required sha256 hex digest of the frozen candidate content`);
    if (typeof entry.source !== 'string' || entry.source.length === 0) errors.push(`${at}.source: required provenance for the required knowledge`);
    if (!KNOWLEDGE_CHANNELS.includes(entry.channel)) errors.push(`${at}.channel: must be one of ${KNOWLEDGE_CHANNELS.join(', ')}`);
    if (entry.applicable === false && (typeof entry.applicabilityBasis !== 'string' || entry.applicabilityBasis.length === 0)) {
      errors.push(`${at}.applicabilityBasis: a not-applicable decision requires a recorded basis (KG0: 不能自填无更新)`);
    }
    if (errors.length > 0) return null;
    return Object.freeze({
      capability: entry.capability,
      digest: entry.digest,
      source: entry.source,
      channel: entry.channel,
      applicable: entry.applicable === false ? false : true,
      ...(entry.applicabilityBasis ? { applicabilityBasis: entry.applicabilityBasis } : {}),
    });
  });
  if (errors.length > 0) throw new KnowledgeSeedError('invalid required-knowledge manifest', errors);
  return Object.freeze(normalized);
}

// Walk the canonical wiki directory and collect curated knowledge entries:
// a markdown file whose frontmatter declares `capability:` is one, and its
// bytes are the independent readback digest.
const WIKI_MAX_DEPTH = 12;

export function readWikiKnowledgeEntries(wikiDir) {
  const entries = [];
  if (!wikiDir || !fs.existsSync(wikiDir)) return entries;
  const walk = (dir, depth) => {
    if (depth > WIKI_MAX_DEPTH) return;
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names.sort()) {
      const abs = path.join(dir, name);
      let stat;
      try { stat = fs.statSync(abs); } catch { continue; }
      if (stat.isDirectory()) {
        if (name.startsWith('.') || name === 'node_modules' || name === 'raw' || name === 'staging') continue;
        walk(abs, depth + 1);
      } else if (name.endsWith('.md')) {
        const text = fs.readFileSync(abs, 'utf8');
        const capability = text.match(/^capability:\s*(.+?)\s*$/m);
        if (!capability) continue;
        const source = text.match(/^source:\s*(.+?)\s*$/m);
        entries.push({
          file: path.relative(wikiDir, abs),
          capability: capability[1],
          digest: cryptoHashFile(abs),
          ...(source ? { source: source[1] } : {}),
        });
      }
    }
  };
  walk(wikiDir, 0);
  return entries;
}

function cryptoHashFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// The Kp judgment: every required llmwiki-channel entry must exist in the
// canonical wiki with the frozen candidate digest (and a non-contradicting
// provenance). Every missing/mismatched entry is NAMED in the result.
export function evaluateRequiredKnowledge({ required, wikiDir }) {
  const wikiEntries = readWikiKnowledgeEntries(wikiDir);
  const satisfied = [];
  const missing = [];
  const inapplicable = [];
  let checked = 0;
  for (const entry of required ?? []) {
    if (entry.applicable === false) {
      inapplicable.push({ capability: entry.capability, basis: entry.applicabilityBasis });
      continue;
    }
    checked += 1;
    const candidates = wikiEntries.filter((wiki) => wiki.capability === entry.capability);
    if (candidates.length === 0) {
      missing.push({ capability: entry.capability, reason: 'NO_WIKI_ENTRY', expected: entry.digest });
      continue;
    }
    const candidate = candidates[0];
    if (candidate.digest !== entry.digest) {
      missing.push({ capability: entry.capability, reason: 'KNOWLEDGE_DIGEST_MISMATCH', expected: entry.digest, observed: candidate.digest, file: candidate.file });
      continue;
    }
    if (entry.source && candidate.source && candidate.source !== entry.source) {
      missing.push({ capability: entry.capability, reason: 'KNOWLEDGE_SOURCE_MISMATCH', expected: entry.source, observed: candidate.source, file: candidate.file });
      continue;
    }
    satisfied.push({ capability: entry.capability, file: candidate.file, digest: candidate.digest });
  }
  return { ok: missing.length === 0, satisfied, missing, inapplicable, checked };
}
