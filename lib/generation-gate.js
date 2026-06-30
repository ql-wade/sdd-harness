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

function isTestFile(filePath) {
  const name = path.basename(filePath);
  return /\.(test|spec)\.[cm]?[jt]sx?$/i.test(name)
    || /^test_.*\.py$/i.test(name)
    || /_test\.(py|go)$/i.test(name)
    || /Test\.java$/i.test(name);
}

async function walkTestFiles(rootDir, dir = rootDir) {
  if (!await fs.pathExists(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkTestFiles(rootDir, fullPath));
    } else if (entry.isFile() && isTestFile(fullPath)) {
      files.push(path.relative(rootDir, fullPath));
    }
  }

  return files;
}

export async function captureTestInventory(projectDir) {
  const testFiles = (await walkTestFiles(projectDir)).sort();
  return Promise.all(testFiles.map(async (filePath) => ({
    path: filePath,
    sha256: crypto.createHash('sha256')
      .update(await fs.readFile(path.join(projectDir, filePath)))
      .digest('hex'),
  })));
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

  const beforeByPath = new Map(
    (beforeTestInventory ?? []).map((item) => [item.path, item.sha256]),
  );
  const changedTestFiles = afterTestInventory
    .filter((item) => beforeByPath.get(item.path) !== item.sha256)
    .map((item) => item.path);
  if (beforeTestInventory && changedTestFiles.length === 0) {
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
