import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const contractPath = path.join(
  repoRoot,
  'templates',
  'sdd-harness',
  'generation-contracts',
  'browser-probe.md',
);

test('code generation consumes a generic browser probeability contract and active profile', () => {
  assert.equal(
    fs.existsSync(contractPath),
    true,
    'browser probe generation contract is missing',
  );

  const contract = fs.readFileSync(contractPath, 'utf8');
  const cli = fs.readFileSync(path.join(repoRoot, 'bin', 'cli.js'), 'utf8');
  const codeSkill = fs.readFileSync(
    path.join(repoRoot, 'templates', 'claude', 'skills', 'sdd-code', 'SKILL.md'),
    'utf8',
  );

  assert.doesNotMatch(contract, /MiniCraft|Three\.js/i);
  assert.match(contract, /__sddProbe/);
  assert.match(contract, /snapshot\(\)/);
  assert.match(contract, /debug DOM/i);
  assert.match(contract, /clientWidth|clientHeight/);
  assert.match(contract, /viewport|external container/i);
  assert.match(cli, /generation-contracts.*browser-probe\.md/s);
  assert.match(cli, /probe-profile/);
  assert.match(codeSkill, /browser-probe\.md/);
});

test('code generation explicitly generates browser probeability regression tests', () => {
  const contract = fs.readFileSync(contractPath, 'utf8');
  const cli = fs.readFileSync(path.join(repoRoot, 'bin', 'cli.js'), 'utf8');
  const codeSkill = fs.readFileSync(
    path.join(repoRoot, 'templates', 'claude', 'skills', 'sdd-code', 'SKILL.md'),
    'utf8',
  );

  assert.match(contract, /automated regression test/i);
  assert.match(contract, /invoke the actual resize/i);
  assert.match(cli, /Browser Probeability Regression Tests/);
  assert.match(cli, /ptyClaude\(testPrompt/);
  assert.match(codeSkill, /resize feedback.*regression test/i);
});

test('code generation blocks when test generation fails or leaves tests unchanged', () => {
  const cli = fs.readFileSync(path.join(repoRoot, 'bin', 'cli.js'), 'utf8');

  assert.match(cli, /import \{ captureTestInventory, evaluateGeneratedTests \}/);
  assert.match(cli, /const beforeTestInventory = await captureTestInventory\(cwd\)/);
  assert.match(cli, /const testGenerationResult = await ptyClaude\(\s*testPrompt/);
  assert.match(cli, /const generationGate = await evaluateGeneratedTests\(/);
  assert.match(cli, /beforeTestInventory/);
  assert.match(cli, /if \(!generationGate\.pass\)/);
  assert.match(cli, /test generation gate failed[\s\S]*process\.exitCode = 2/i);
});

test('code generation runs generated tests and blocks on a non-zero exit', () => {
  const cli = fs.readFileSync(path.join(repoRoot, 'bin', 'cli.js'), 'utf8');

  assert.match(cli, /import \{ runProjectTestGate \} from '\.\.\/lib\/project-test-gate\.js'/);
  assert.match(
    cli,
    /const projectTestGate = runProjectTestGate\(\{ projectDir: cwd, evidenceDir: runsDir \}\)/,
  );
  assert.match(cli, /if \(!projectTestGate\.pass\)/);
  assert.match(cli, /project test gate failed[\s\S]*process\.exitCode = 2/i);
});
