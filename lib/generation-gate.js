import fs from 'fs-extra';
import crypto from 'node:crypto';
import path from 'node:path';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.sdd',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

// 最大递归深度 + 单次 walk 文件数上限，防恶意/巨型 repo 触发 DoS
const MAX_DEPTH = 20;
const MAX_TEST_FILES = 10000;
// 并发读文件上限，防 Promise.all 一次 fork 几千个 readFile 耗尽 fd
const READ_CONCURRENCY = 16;

function isTestFile(filePath) {
  const name = path.basename(filePath);
  return /\.(test|spec)\.[cm]?[jt]sx?$/i.test(name)
    || /^test_.*\.py$/i.test(name)
    || /_test\.(py|go)$/i.test(name)
    || /Test\.java$/i.test(name);
}

async function walkTestFiles(rootDir, dir = rootDir, depth = 0) {
  if (depth > MAX_DEPTH) return [];
  if (!await fs.pathExists(dir)) return [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return []; }
  const files = [];

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    // 跳过 symlink：防循环 + 防逃逸到 IGNORED 之外（如 node_modules 软链）
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkTestFiles(rootDir, fullPath, depth + 1));
      if (files.length > MAX_TEST_FILES) return files.slice(0, MAX_TEST_FILES);
    } else if (entry.isFile() && isTestFile(fullPath)) {
      files.push(path.relative(rootDir, fullPath));
      if (files.length >= MAX_TEST_FILES) return files;
    }
  }

  return files;
}

// 有界并发 map：避免一次 Promise.all 成千上万个 readFile
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function captureTestInventory(projectDir) {
  const testFiles = (await walkTestFiles(projectDir)).sort();
  return mapWithConcurrency(testFiles, READ_CONCURRENCY, async (filePath) => ({
    path: filePath,
    sha256: crypto.createHash('sha256')
      .update(await fs.readFile(path.join(projectDir, filePath)))
      .digest('hex'),
  }));
}

export async function evaluateGeneratedTests({
  projectDir,
  generationResult,
  beforeTestInventory,
}) {
  if (generationResult?.timedOut) {
    return { pass: false, reason: 'test generation timed out', testFiles: [] };
  }
  if (generationResult?.exitCode !== 0) {
    return {
      pass: false,
      reason: `test generation exited with code ${generationResult?.exitCode ?? 'unknown'}`,
      testFiles: [],
    };
  }

  const afterTestInventory = await captureTestInventory(projectDir);
  const testFiles = afterTestInventory.map((item) => item.path);
  if (testFiles.length === 0) {
    return {
      pass: false,
      reason: 'test generation produced no test files',
      testFiles,
    };
  }

  if (beforeTestInventory == null) {
    return {
      pass: false,
      reason: 'beforeTestInventory missing — caller must capture inventory before generation to prove tests changed',
      testFiles,
    };
  }

  const beforeByPath = new Map(
    beforeTestInventory.map((item) => [item.path, item.sha256]),
  );
  const changedTestFiles = afterTestInventory
    .filter((item) => beforeByPath.get(item.path) !== item.sha256)
    .map((item) => item.path);
  if (changedTestFiles.length === 0) {
    return {
      pass: false,
      reason: 'test generation did not add or modify test files',
      testFiles,
      changedTestFiles,
    };
  }

  return {
    pass: true,
    reason: null,
    testFiles,
    changedTestFiles,
  };
}
