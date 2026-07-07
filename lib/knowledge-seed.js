import fs from 'fs-extra';
import path from 'path';

// ============================================================================
// Knowledge Seed — 扫描项目已有知识源，生成 LLMWiki seed index
// 不调用 LLM；只做确定性提取（文件发现 + frontmatter + 摘要行）
// ============================================================================

/**
 * Scan project for existing knowledge sources.
 * Returns categorized list of source files.
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

  // 4. CODEBASE-CATALOG from Understand-Anything
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
 * Generate seed content for LLMWiki based on discovered sources.
 * Creates index.md, glossary seed, and engineering knowledge entries.
 */
export function generateSeedContent(cwd, sources) {
  const today = new Date().toISOString().slice(0, 10);
  const wikiDir = path.join(cwd, 'llmwiki');
  fs.ensureDirSync(wikiDir);  // 先确保 wikiDir 存在，否则后续 writeFileSync(index.md) 会 ENOENT
  const results = { files: [], skipped: 0 };

  // --- index.md ---
  const indexPath = path.join(wikiDir, 'index.md');
  const indexContent = generateIndex(sources, today);
  fs.writeFileSync(indexPath, indexContent);
  results.files.push({ path: 'llmwiki/index.md', action: 'seeded' });

  // --- wiki/engineering/ seed: one entry per architecture doc ---
  const engDir = path.join(wikiDir, 'wiki', 'engineering');
  fs.ensureDirSync(engDir);
  for (const doc of sources.docs) {
    const slug = doc.title.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().slice(0, 50);
    const engFile = path.join(engDir, `EN-${slug}.md`);
    if (!fs.pathExistsSync(engFile)) {
      const summary = extractSummary(path.join(cwd, doc.path));
      fs.writeFileSync(engFile, `---
type: engineering-note
source: ../../${doc.path}
ingest_date: ${today}
category: ${doc.category}
---
# ${doc.title}

${summary}

→ Full doc: [${doc.path}](../../../${doc.path})
`);
      results.files.push({ path: `llmwiki/wiki/engineering/EN-${slug}.md`, action: 'seeded' });
    } else {
      results.skipped++;
    }
  }

  // --- wiki/_shared/glossary/ seed from CODEBASE-CATALOG ---
  if (sources.catalog) {
    const glossaryDir = path.join(wikiDir, 'wiki', '_shared', 'glossary');
    fs.ensureDirSync(glossaryDir);
    const glossaryPath = path.join(glossaryDir, 'project-glossary.md');
    if (!fs.pathExistsSync(glossaryPath)) {
      const terms = extractGlossaryTerms(path.join(cwd, sources.catalog.path));
      fs.writeFileSync(glossaryPath, `---
type: glossary
source: ../../../${sources.catalog.path}
ingest_date: ${today}
---
# Project Glossary (auto-seeded from CODEBASE-CATALOG)

${terms}

→ Full catalog: [CODEBASE-CATALOG.md](../../../${sources.catalog.path})
`);
      results.files.push({ path: 'llmwiki/wiki/_shared/glossary/project-glossary.md', action: 'seeded' });
    } else {
      results.skipped++;
    }
  }

  // --- wiki/_shared/traceability/ seed: spec → doc mapping ---
  if (sources.specs.length > 0) {
    const traceDir = path.join(wikiDir, 'wiki', '_shared', 'traceability');
    fs.ensureDirSync(traceDir);
    const tracePath = path.join(traceDir, 'spec-inventory.md');
    const specList = sources.specs.map(s => `- [${s.title}](../../../${s.path})`).join('\n');
    fs.writeFileSync(tracePath, `---
type: traceability-map
ingest_date: ${today}
---
# OpenSpec Inventory (auto-seeded)

${sources.specs.length} domain specs discovered:

${specList}
`);
    results.files.push({ path: 'llmwiki/wiki/_shared/traceability/spec-inventory.md', action: 'seeded' });
  }

  // --- log.md update ---
  const logPath = path.join(wikiDir, 'log.md');
  const logEntry = `\n## [seed] ${today} | knowledge-seed\n- docs: ${sources.docs.length}\n- specs: ${sources.specs.length}\n- steering: ${sources.steering.length}\n- catalog: ${sources.catalog ? 'yes' : 'no'}\n- agent docs: ${sources.agentDocs.length}\n- seeded files: ${results.files.length}, skipped: ${results.skipped}\n`;
  fs.appendFileSync(logPath, logEntry);

  return results;
}

// ============================================================================
// Helpers
// ============================================================================

// 最大递归深度 + 文件数上限，防恶意/巨型目录触发栈溢出或 OOM
const KS_MAX_DEPTH = 20;
const KS_MAX_FILES = 5000;

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

function extractSummary(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Find first paragraph after first heading (skip frontmatter)
    const lines = content.split('\n');
    let inFrontmatter = false;
    let afterFirstHeading = false;
    let summary = '';
    for (const line of lines) {
      if (line.trim() === '---' && !inFrontmatter && summary === '') {
        inFrontmatter = true;
        continue;
      }
      if (line.trim() === '---' && inFrontmatter) {
        inFrontmatter = false;
        continue;
      }
      if (inFrontmatter) continue;
      if (line.startsWith('#')) {
        if (afterFirstHeading) continue;
        afterFirstHeading = true;
        continue;
      }
      if (afterFirstHeading && line.trim() && !line.startsWith('|') && !line.startsWith('```')) {
        summary += line + '\n';
        if (summary.length > 300) break;
      }
    }
    return summary.trim() || '(no summary extracted)';
  } catch {
    return '(unable to read)';
  }
}

function countLines(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').split('\n').length;
  } catch {
    return 0;
  }
}

function extractGlossaryTerms(catalogPath) {
  try {
    const content = fs.readFileSync(catalogPath, 'utf8');
    // Extract bold terms (common in catalogs: **Term**: description)
    const terms = [];
    const matches = content.matchAll(/\*\*([^*]{2,50})\*\*/g);
    const seen = new Set();
    for (const m of matches) {
      const term = m[1].trim();
      if (!seen.has(term.toLowerCase()) && !term.includes('|') && !term.match(/^\d/)) {
        seen.add(term.toLowerCase());
        terms.push(`- **${term}**`);
        if (terms.length >= 30) break;
      }
    }
    return terms.length > 0 ? terms.join('\n') : '(no terms extracted from catalog)';
  } catch {
    return '(unable to extract)';
  }
}

function generateIndex(sources, today) {
  const sections = [];

  sections.push(`# LLMWiki Index — PAV2 Knowledge Base\n`);
  sections.push(`Auto-seeded on ${today} from project knowledge sources.\n`);

  // Steering
  if (sources.steering.length > 0) {
    sections.push('## Project Steering');
    for (const s of sources.steering) {
      sections.push(`- [${s.title}](../${s.path})`);
    }
    sections.push('');
  }

  // Engineering docs
  if (sources.docs.length > 0) {
    sections.push(`## Engineering Knowledge (${sources.docs.length} docs)`);
    const byCategory = {};
    for (const d of sources.docs) {
      if (!byCategory[d.category]) byCategory[d.category] = [];
      byCategory[d.category].push(d);
    }
    for (const [cat, docs] of Object.entries(byCategory)) {
      sections.push(`### ${cat} (${docs.length})`);
      for (const d of docs) {
        sections.push(`- [${d.title}](../${d.path})`);
      }
      sections.push('');
    }
  }

  // Domain specs
  if (sources.specs.length > 0) {
    sections.push(`## Domain Specs (${sources.specs.length})`);
    sections.push('→ Full inventory: [_shared/traceability/spec-inventory.md](wiki/_shared/traceability/spec-inventory.md)\n');
  }

  // Catalog
  if (sources.catalog) {
    sections.push('## Code Analysis');
    sections.push(`- [CODEBASE-CATALOG](${sources.catalog.path}) (${sources.catalog.lines} lines)`);
    if (sources.domainGraph) {
      sections.push(`- [Domain Graph](${sources.domainGraph.path})`);
    }
    sections.push('');
  }

  // Testing
  sections.push('## Testing');
  sections.push('- [Test Matrix](wiki/testing/matrices/test-matrix.md)');
  sections.push('- [Test Cases](wiki/testing/cases/)\n');

  sections.push('---');
  sections.push('To enrich: `sdd wiki ingest` (LLM-powered summaries) or manually add to raw/');

  return sections.join('\n');
}
