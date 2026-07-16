import fs from 'fs-extra';
import crypto from 'node:crypto';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.sdd']);

function toPortablePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function issue(code, message, evidence) {
  return { code, message, evidence };
}

function isSourceFile(filePath) {
  const ext = path.extname(filePath);
  if (!SOURCE_EXTENSIONS.has(ext)) return false;
  if (filePath.endsWith('.d.ts')) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath)) return false;
  return true;
}

function isTestFile(filePath) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

async function walkFiles(dir) {
  if (!await fs.pathExists(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function uniqueNumbers(matches) {
  return [...new Set(matches.map(Number).filter(Number.isFinite))];
}

function extractSourceFileClaims(text) {
  const claims = [];
  const patterns = [
    /src\/?`?\s*(?:仅含|only has|has)\s*(\d+)\s*(?:个)?\s*(?:source\s+)?(?:files?|文件)/giu,
    /actual\s+source\s+files\s*:\s*(\d+)/giu,
    /实际(?:源码|source)?(?:文件)?\s*(?:count|数量)?\s*[:：]\s*(\d+)/giu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) claims.push(match[1]);
  }
  return uniqueNumbers(claims);
}

function extractTestCountClaims(text) {
  const claims = [];
  const patterns = [
    // vitest output format: "Tests 159 passed (159)"
    /tests?\s+(\d+)\s+passed\s*\(\d+\)/giu,
    // explicit total claim: 全套/共/total N case pass
    /(?:全套|共|total)\s*(\d+)\s*个?\s*case\s*(?:全部|全)?\s*pass(?:ed)?/giu,
    /(?:全套|共|total)[^\n]{0,20}(\d+)\s*(?:个)?\s*tests?\s+pass(?:ed)?/giu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) claims.push(match[1]);
  }
  return uniqueNumbers(claims);
}

function parseVitestOutput(output) {
  if (!output) return {};
  const testsMatch = output.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/iu);
  const filesMatch = output.match(/Test\s+Files\s+(\d+)\s+passed\s+\((\d+)\)/iu);
  return {
    testsPassed: testsMatch ? Number(testsMatch[1]) : undefined,
    testFilesPassed: filesMatch ? Number(filesMatch[1]) : undefined,
  };
}

async function readTextIfExists(filePath) {
  if (!await fs.pathExists(filePath)) return '';
  return fs.readFile(filePath, 'utf8');
}

async function sha256IfExists(filePath) {
  if (!filePath || !await fs.pathExists(filePath)) return null;
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function sourceTreeSha256(projectDir) {
  const sourceRoot = path.join(projectDir, 'src');
  const files = (await walkFiles(sourceRoot)).sort();
  const hash = crypto.createHash('sha256');
  for (const filePath of files) {
    hash.update(toPortablePath(path.relative(sourceRoot, filePath)));
    hash.update('\0');
    hash.update(await fs.readFile(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function readPackage(projectDir) {
  const packagePath = path.join(projectDir, 'package.json');
  if (!await fs.pathExists(packagePath)) return {};
  return fs.readJson(packagePath);
}

function hasDependency(pkg, name) {
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

async function resolveChangeDir(projectDir, change) {
  const changesDir = path.join(projectDir, 'openspec', 'changes');
  const directChangeDir = path.join(changesDir, change);
  if (await fs.pathExists(directChangeDir)) return directChangeDir;

  const archiveDir = path.join(changesDir, 'archive');
  if (await fs.pathExists(archiveDir)) {
    const entries = await fs.readdir(archiveDir);
    const archivedEntry = entries.find(
      (entry) => entry === change || entry.endsWith(`-${change}`),
    );
    if (archivedEntry) return path.join(archiveDir, archivedEntry);
  }

  return directChangeDir;
}

export async function auditEvidence({ projectDir, change, run, testOutputPath }) {
  if (!projectDir) throw new Error('projectDir is required');
  if (!change) throw new Error('change is required');

  const runId = run || change;
  const sourceRoot = path.join(projectDir, 'src');
  const sourceTreeFiles = await walkFiles(sourceRoot);
  const sourceFiles = sourceTreeFiles.filter(isSourceFile);
  const testFiles = sourceTreeFiles.filter(isTestFile);
  const changeDir = await resolveChangeDir(projectDir, change);
  const runsDir = path.join(projectDir, '.sdd', 'runs', runId);
  const evidenceFiles = {
    progress: toPortablePath(path.join(changeDir, 'progress.md')),
    review: toPortablePath(path.join(runsDir, 'review-notes.md')),
    testOutput: testOutputPath ? toPortablePath(testOutputPath) : testOutputPath,
  };
  const progress = await readTextIfExists(evidenceFiles.progress);
  const review = await readTextIfExists(evidenceFiles.review);
  const combinedEvidenceText = `${progress}\n${review}`;
  const pkg = await readPackage(projectDir);
  const packageScripts = pkg.scripts ?? {};
  const testOutput = testOutputPath ? await readTextIfExists(testOutputPath) : '';
  const commandOutput = parseVitestOutput(testOutput);
  const issues = [];
  const missingEvidence = [];
  for (const [name, filePath] of Object.entries(evidenceFiles)) {
    if (!filePath || !await fs.pathExists(filePath)) missingEvidence.push(name);
  }
  if (missingEvidence.length > 0) {
    issues.push(issue(
      'EVIDENCE_INPUT_MISSING',
      'Required evidence inputs must exist before the audit can pass.',
      { missing: missingEvidence },
    ));
  }

  const sourceClaims = extractSourceFileClaims(progress);
  const mismatchedSourceClaims = sourceClaims.filter((claim) => claim !== sourceFiles.length);
  if (mismatchedSourceClaims.length > 0) {
    issues.push(issue(
      'CLAIMED_SOURCE_FILE_COUNT_MISMATCH',
      'Markdown evidence claims a source file count that does not match disk.',
      {
        claimed: mismatchedSourceClaims,
        actual: sourceFiles.length,
        sourceRoot,
      },
    ));
  }

  const testCountClaims = extractTestCountClaims(progress);
  if (Number.isFinite(commandOutput.testsPassed)) {
    const mismatchedTestClaims = testCountClaims
      .filter((claim) => claim !== commandOutput.testsPassed);
    if (mismatchedTestClaims.length > 0) {
      issues.push(issue(
        'CLAIMED_TEST_COUNT_MISMATCH',
        'Markdown evidence claims a passed test count that does not match command output.',
        {
          claimed: mismatchedTestClaims,
          actual: commandOutput.testsPassed,
          testOutputPath,
        },
      ));
    }
  }

  if (/(?:无|no)\W*`?tests?`?\W*(?:目录|dir|directory)?/iu.test(progress) && testFiles.length > 0) {
    issues.push(issue(
      'STALE_NO_TESTS_CLAIM',
      'Markdown evidence says tests are missing, but test files exist on disk.',
      { actual: testFiles.length, sourceRoot },
    ));
  }

  if (/(?:无|no)\W*`?vitest`?\W*(?:依赖|dependency)?/iu.test(progress) && hasDependency(pkg, 'vitest')) {
    issues.push(issue(
      'STALE_NO_VITEST_CLAIM',
      'Markdown evidence says vitest is missing, but package.json declares it.',
      { packagePath: path.join(projectDir, 'package.json') },
    ));
  }

  if (/(?:无|no)\W*(?:npm\W*)?test\W*script/iu.test(combinedEvidenceText) && packageScripts.test) {
    issues.push(issue(
      'STALE_NO_TEST_SCRIPT_CLAIM',
      'Markdown evidence says the test script is missing, but package.json declares it.',
      { testScript: packageScripts.test },
    ));
  }

  return {
    schemaVersion: 1,
    projectDir,
    change,
    run: runId,
    pass: issues.length === 0,
    actual: {
      sourceFiles: sourceFiles.length,
      testFiles: testFiles.length,
      packageScripts,
    },
    commandOutput,
    evidenceFiles,
    evidenceSha256: {
      progress: await sha256IfExists(evidenceFiles.progress),
      review: await sha256IfExists(evidenceFiles.review),
      testOutput: await sha256IfExists(evidenceFiles.testOutput),
      packageJson: await sha256IfExists(path.join(projectDir, 'package.json')),
      sourceTree: await sourceTreeSha256(projectDir),
    },
    issues,
  };
}
