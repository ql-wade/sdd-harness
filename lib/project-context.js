import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';

// ============================================================================
// 项目类型检测 — 根据 manifest 文件判断技术栈
// ============================================================================

/**
 * Detect project type from manifest files.
 * Returns { type, manifest, testCmd, buildCmd, sourceDirs } or null.
 */
export function detectProjectType(cwd) {
  const checks = [
    { type: 'node',    file: 'package.json',    testCmd: 'npm test',       buildCmd: 'npm run build',   sourceDirs: ['src'] },
    { type: 'python',  file: 'pyproject.toml',   testCmd: 'pytest',         buildCmd: 'pip install -e .', sourceDirs: ['src', 'app'] },
    { type: 'python',  file: 'setup.py',         testCmd: 'pytest',         buildCmd: 'pip install .',   sourceDirs: ['src', 'app'] },
    { type: 'rust',    file: 'Cargo.toml',       testCmd: 'cargo test',     buildCmd: 'cargo build',     sourceDirs: ['src'] },
    { type: 'go',      file: 'go.mod',           testCmd: 'go test ./...',  buildCmd: 'go build',        sourceDirs: ['.'] },
    { type: 'java-mvn', file: 'pom.xml',         testCmd: 'mvn test',        buildCmd: 'mvn package -DskipTests', sourceDirs: ['src/main/java'] },
    { type: 'java-gradle', file: 'build.gradle',    testCmd: 'gradle test',  buildCmd: 'gradle build',   sourceDirs: ['src/main/java'] },
    { type: 'java-gradle', file: 'build.gradle.kts', testCmd: 'gradle test', buildCmd: 'gradle build',   sourceDirs: ['src/main/java'] },
  ];
  for (const c of checks) {
    if (fs.pathExistsSync(path.join(cwd, c.file))) return c;
  }
  return null;
}

/**
 * Detect monorepo layout — multiple manifests in subdirectories.
 */
export function detectMonorepo(cwd) {
  const dirs = fs.readdirSync(cwd, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
    .map(d => d.name);
  const manifests = [];
  for (const dir of dirs) {
    const sub = detectProjectType(path.join(cwd, dir));
    if (sub) manifests.push({ dir, ...sub, sourceDirs: sub.sourceDirs.map(s => path.join(dir, s)) });
  }
  return manifests.length >= 2 ? manifests : [];
}

/**
 * Get source directories for code file counting.
 * For monorepos, returns nested paths; for single projects, checks
 * `sourceDirs` from manifest detection first, then falls back to common dirs.
 */
export function getSourceDirs(cwd) {
  // Check monorepo first
  const mono = detectMonorepo(cwd);
  if (mono.length >= 2) return mono.flatMap(m => m.sourceDirs);

  const project = detectProjectType(cwd);
  if (project) return project.sourceDirs;

  // Fallback: scan common top-level source directories
  const candidates = ['src', 'lib', 'app', 'packages', 'internal', 'cmd'];
  const existing = candidates
    .map(d => ({ dir: d, abs: path.join(cwd, d) }))
    .filter(({ abs }) => fs.pathExistsSync(abs));
  if (existing.length > 0) return existing.map(e => e.dir);

  return ['src']; // last resort
}

/**
 * Get real source file count using detected source dirs.
 */
export function countSourceFiles(cwd, sourceDirs) {
  const dirs = sourceDirs || getSourceDirs(cwd);
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.rb', '.cs']);
  const ignored = new Set(['.git', '.sdd', 'build', 'coverage', 'dist', 'node_modules', 'target']);
  const countIn = (dir) => {
    if (!fs.pathExistsSync(dir)) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) count += countIn(fullPath);
      else if (entry.isFile() && extensions.has(path.extname(entry.name))) count++;
    }
    return count;
  };
  let total = 0;
  for (const dir of dirs) {
    total += countIn(path.resolve(cwd, dir));
  }
  return total;
}

// ============================================================================
// Knowledge-graph freshness check
// ============================================================================

/**
 * Check if knowledge-graph is stale by comparing meta.json commit hash
 * against current HEAD.
 * Returns { stale, reason, metaCommit, currentCommit }
 */
export function checkGraphFreshness(cwd) {
  const metaPath = path.join(cwd, '.understand-anything', 'meta.json');
  const graphPath = path.join(cwd, '.understand-anything', 'knowledge-graph.json');

  if (!fs.pathExistsSync(metaPath)) {
    return { stale: false, reason: 'no meta.json' };
  }
  if (!fs.pathExistsSync(graphPath)) {
    return { stale: false, reason: 'no graph' };
  }

  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {
    return { stale: false, reason: 'meta.json unreadable' };
  }

  const metaCommit = meta.gitCommitHash;
  if (!metaCommit) {
    return { stale: false, reason: 'no commit hash in meta.json' };
  }

  let currentCommit;
  try {
    currentCommit = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
  } catch {
    return { stale: false, reason: 'not a git repo' };
  }

  const metaShort = metaCommit.slice(0, 7);
  const currentShort = currentCommit.slice(0, 7);
  if (currentShort === metaShort) {
    return { stale: false, metaCommit, currentCommit };
  }

  return {
    stale: true,
    reason: `graph built on ${metaShort}, HEAD is ${currentShort}`,
    metaCommit,
    currentCommit,
  };
}

/**
 * Count orphan nodes — nodes referencing paths that no longer exist on disk.
 * Uses sampling for performance (max 200 nodes checked).
 */
export function countOrphanNodes(cwd, maxCheck = 200) {
  const graphPath = path.join(cwd, '.understand-anything', 'knowledge-graph.json');
  if (!fs.pathExistsSync(graphPath)) return null;

  let g;
  try { g = JSON.parse(fs.readFileSync(graphPath, 'utf8')); } catch { return null; }
  if (!g.nodes || g.nodes.length === 0) return null;

  const nodes = g.nodes;
  const sample = nodes.length > maxCheck
    ? nodes.filter((_, i) => i % Math.ceil(nodes.length / maxCheck) === 0)
    : nodes;

  let orphans = 0;
  const orphanPrefixes = new Map(); // prefix → count

  for (const n of sample) {
    const id = n.id || '';
    const match = id.match(/^(?:file|class|function|export|component|module):(.+?)$/);
    if (!match) continue;
    let filePath = match[1];

    // Strip line numbers and suffixes
    filePath = filePath.replace(/:\d+(:\d+)?$/, '');
    filePath = filePath.replace(/^\/+/, '');

    if (!fs.pathExistsSync(path.join(cwd, filePath))) {
      orphans++;
      const prefix = filePath.split('/')[0] || filePath;
      orphanPrefixes.set(prefix, (orphanPrefixes.get(prefix) || 0) + 1);
    }
  }

  return {
    sampled: sample.length,
    orphans,
    orphanRatio: sample.length > 0 ? (orphans / sample.length) : 0,
    topOrphanPrefixes: [...orphanPrefixes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([prefix, count]) => ({ prefix, count })),
  };
}

/**
 * Comprehensive graph health check used by both doctor and init.
 * Returns { existence, freshness, orphans, issues[] }
 */
export function graphHealthCheck(cwd) {
  const graphPath = path.join(cwd, '.understand-anything', 'knowledge-graph.json');
  const issues = [];

  // Existence
  if (!fs.pathExistsSync(graphPath)) {
    return { existence: 'missing', freshness: null, orphans: null, issues: ['knowledge-graph.json not found'] };
  }

  let g;
  try { g = JSON.parse(fs.readFileSync(graphPath, 'utf8')); } catch {
    return { existence: 'corrupt', freshness: null, orphans: null, issues: ['knowledge-graph.json is not valid JSON'] };
  }

  const hasNodes = g.nodes && g.nodes.length > 0;
  if (!hasNodes) {
    return { existence: 'placeholder', freshness: null, orphans: null, issues: ['knowledge-graph.json has 0 nodes (placeholder)'] };
  }

  // Freshness (commit hash)
  const fresh = checkGraphFreshness(cwd);
  if (fresh.stale) {
    issues.push(`knowledge-graph is stale: ${fresh.reason}. Run /understand to regenerate.`);
  }

  // Orphan nodes
  const orphan = countOrphanNodes(cwd);
  if (orphan && orphan.orphanRatio > 0.2) {
    const pct = Math.round(orphan.orphanRatio * 100);
    issues.push(
      `~${pct}% of sampled nodes (${orphan.orphans}/${orphan.sampled}) reference deleted paths. ` +
      `Top prefixes: ${orphan.topOrphanPrefixes.map(p => `${p.prefix}(${p.count})`).join(', ')}. ` +
      'Run /understand to regenerate.'
    );
  }

  // Layer health
  if (g.layers && g.layers.length > 0) {
    const deadLayers = g.layers.filter(l => {
      const nodes = l.nodes || [];
      const nc = Array.isArray(nodes) ? nodes.length : (l.node_count || 0);
      return nc === 0;
    });
    if (deadLayers.length === g.layers.length && g.layers.length > 0) {
      issues.push(
        `All ${g.layers.length} layers have 0 nodes — graph was generated by an outdated version. ` +
        'Run /understand to regenerate.'
      );
    } else if (deadLayers.length > 0) {
      issues.push(`${deadLayers.length}/${g.layers.length} layers have 0 nodes.`);
    }
  }

  return {
    existence: 'ok',
    nodeCount: g.nodes.length,
    edgeCount: (g.edges || []).length,
    layerCount: (g.layers || []).length,
    freshness: fresh,
    orphans: orphan,
    issues,
  };
}
