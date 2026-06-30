import fs from 'fs-extra';
import crypto from 'node:crypto';
import path from 'node:path';

const DEFAULT_TOLERANCE = 1.1;
const DEBUG_MARKERS = ['__pyramid_result', '__voxel_scan'];

function issue(code, message, evidence) {
  return { code, message, evidence };
}

function exceeds(actual, expected, tolerance = DEFAULT_TOLERANCE) {
  return Number(actual) > Number(expected) * tolerance;
}

function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function vectorDistance(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
    return undefined;
  }
  if (!before.every(isFiniteNumber) || !after.every(isFiniteNumber)) return undefined;
  return Math.sqrt(before
    .map((value, index) => Number(after[index]) - Number(value))
    .reduce((sum, delta) => sum + delta ** 2, 0));
}

function evaluateStateTransition(transition) {
  if (transition?.assertion === 'delta') {
    const before = Number(transition.before);
    const after = Number(transition.after);
    const expected = Number(transition.expected);
    if (![before, after, expected].every(Number.isFinite)) {
      return {
        pass: false,
        actual: undefined,
        reason: 'delta transition requires numeric before, after, and expected values',
      };
    }
    const actual = after - before;
    return {
      pass: actual === expected,
      actual,
      reason: `expected delta ${expected}, got ${actual}`,
    };
  }

  if (transition?.assertion === 'vector-distance>=') {
    const actual = vectorDistance(transition.before, transition.after);
    const threshold = Number(transition.threshold);
    if (!Number.isFinite(actual) || !Number.isFinite(threshold)) {
      return {
        pass: false,
        actual,
        reason: 'vector-distance transition requires numeric before/after arrays and threshold',
      };
    }
    return {
      pass: actual >= threshold,
      actual,
      reason: `expected distance >= ${threshold}, got ${actual}`,
    };
  }

  return {
    pass: false,
    actual: undefined,
    reason: `unsupported transition assertion: ${transition?.assertion ?? 'missing'}`,
  };
}

async function collectSourceFiles(root) {
  const files = [];
  const ignoredDirs = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.sdd']);
  const allowedExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.html']);

  async function walk(dir) {
    if (!await fs.pathExists(dir)) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoredDirs.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (
        entry.isFile()
        && allowedExtensions.has(path.extname(entry.name))
        && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
      ) {
        files.push(fullPath);
      }
    }
  }

  await walk(root);
  return files;
}

async function findCanvasResizeFeedback(projectDir) {
  const sourceRoots = [
    path.join(projectDir, 'src'),
    path.join(projectDir, 'app'),
    path.join(projectDir, 'pages'),
  ];
  const files = [];
  for (const root of sourceRoots) files.push(...await collectSourceFiles(root));

  const findings = [];
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8').catch(() => '');
    if (
      /setSize\s*\(/.test(content)
      && /client(?:Width|Height)/.test(content)
      && /renderer|ctx\.renderer|WebGLRenderer/.test(content)
    ) {
      // Three.js setSize(width, height, updateStyle):
      //   updateStyle=false (3rd arg) does NOT write canvas CSS, so reading
      //   clientWidth/Height and writing only the drawing buffer cannot form a
      //   feedback loop. Only flag when ALL setSize calls lack the false guard.
      const setSizeCalls = content.match(/setSize\s*\([^)]*\)/g) || [];
      const unsafeCalls = setSizeCalls.filter((call) => !/\bfalse\s*\)\s*$/.test(call));
      if (unsafeCalls.length > 0) findings.push(path.relative(projectDir, file));
    }
  }
  return [...new Set(findings)].sort();
}

async function findSourceDebugMarkers(projectDir) {
  const sourceRoots = [
    path.join(projectDir, 'src'),
    path.join(projectDir, 'app'),
    path.join(projectDir, 'pages'),
  ];
  const files = [];
  for (const root of sourceRoots) files.push(...await collectSourceFiles(root));
  const findings = [];
  const ids = new Set();
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8').catch(() => '');
    const markers = DEBUG_MARKERS.filter((marker) => content.includes(marker));
    if (markers.length > 0) {
      findings.push(path.relative(projectDir, file));
      for (const marker of markers) ids.add(marker);
    }
  }
  return { files: findings.sort(), ids: [...ids].sort() };
}

async function findObservationAdapter(projectDir, adapter) {
  if (!adapter) return [];
  const tokens = adapter.split('.').filter(Boolean);
  const sourceRoots = [
    path.join(projectDir, 'src'),
    path.join(projectDir, 'app'),
    path.join(projectDir, 'pages'),
  ];
  const files = [];
  for (const root of sourceRoots) files.push(...await collectSourceFiles(root));
  const matches = [];
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8').catch(() => '');
    if (tokens.every((token) => content.includes(token))) {
      matches.push(path.relative(projectDir, file));
    }
  }
  return matches.sort();
}

function assertProbeEvidence(evidence) {
  const page = evidence?.page;
  const viewport = page?.viewport;
  const documentSize = page?.document;
  const canvas = page?.canvas;
  const requiredNumbers = [
    ['page.viewport.width', viewport?.width],
    ['page.viewport.height', viewport?.height],
    ['page.viewport.devicePixelRatio', viewport?.devicePixelRatio],
    ['page.document.scrollWidth', documentSize?.scrollWidth],
    ['page.document.scrollHeight', documentSize?.scrollHeight],
    ['page.canvas.clientWidth', canvas?.clientWidth],
    ['page.canvas.clientHeight', canvas?.clientHeight],
    ['page.canvas.bufferWidth', canvas?.bufferWidth],
    ['page.canvas.bufferHeight', canvas?.bufferHeight],
  ];
  const missing = requiredNumbers
    .filter(([, value]) => !isPositiveNumber(value))
    .map(([name]) => name);

  if (evidence?.schemaVersion !== 1) missing.push('schemaVersion=1');
  if (!evidence?.capturedAt || Number.isNaN(Date.parse(evidence.capturedAt))) {
    missing.push('capturedAt');
  }
  if (!Array.isArray(page?.debugDomIds)) missing.push('page.debugDomIds[]');
  if (!Array.isArray(page?.consoleErrors)) missing.push('page.consoleErrors[]');
  if (!evidence?.interactions || Object.keys(evidence.interactions).length === 0) {
    missing.push('interactions');
  }
  if (!evidence?.commands || Object.keys(evidence.commands).length === 0) {
    missing.push('commands');
  }
  for (const [name, exitCode] of Object.entries(evidence?.commands ?? {})) {
    if (!Number.isInteger(exitCode)) {
      missing.push(`commands.${name}=integer exit code`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Probe evidence is incomplete: ${missing.join(', ')}`);
  }
}

export async function validateProbe({
  projectDir,
  evidencePath,
  requiredInteractions = [],
  transitionContracts = {},
  observationAdapter,
}) {
  const evidenceBytes = await fs.readFile(evidencePath);
  const evidenceSha256 = crypto.createHash('sha256').update(evidenceBytes).digest('hex');
  const evidence = JSON.parse(evidenceBytes.toString('utf8'));
  assertProbeEvidence(evidence);
  const indexPath = path.join(projectDir, 'index.html');
  const indexHtml = await fs.readFile(indexPath, 'utf8').catch(() => '');
  const resizeFeedbackFiles = await findCanvasResizeFeedback(projectDir);
  const sourceDebugMarkers = await findSourceDebugMarkers(projectDir);
  const observationAdapterFiles = await findObservationAdapter(projectDir, observationAdapter);
  const issues = [];
  const page = evidence.page ?? {};
  const viewport = page.viewport ?? {};
  const documentSize = page.document ?? {};
  const canvas = page.canvas ?? {};
  const adapterObservation = page.observationAdapter;
  const dpr = Number(viewport.devicePixelRatio) || 1;

  const leakedDebugIds = new Set(page.debugDomIds ?? []);
  for (const marker of DEBUG_MARKERS) {
    if (indexHtml.includes(marker)) leakedDebugIds.add(marker);
  }
  for (const marker of sourceDebugMarkers.ids) leakedDebugIds.add(marker);
  if (leakedDebugIds.size > 0) {
    issues.push(issue(
      'DEBUG_DOM_LEAK',
      'Probe-only DOM markers leaked into the rendered application.',
      {
        ids: [...leakedDebugIds].sort(),
        files: sourceDebugMarkers.files,
      },
    ));
  }

  if (resizeFeedbackFiles.length > 0) {
    issues.push(issue(
      'CANVAS_RESIZE_FEEDBACK_LOOP',
      'Renderer resize code reads the canvas client size and writes it back via setSize, which can amplify runaway layout.',
      { files: resizeFeedbackFiles },
    ));
  }

  if (observationAdapter && observationAdapterFiles.length === 0) {
    issues.push(issue(
      'MISSING_PROBE_OBSERVATION_ADAPTER',
      'Project source does not provide the observation adapter required by the probe profile.',
      { adapter: observationAdapter },
    ));
  }

  if (
    observationAdapter
    && (
      adapterObservation?.name !== observationAdapter
      || adapterObservation?.available !== true
      || adapterObservation?.snapshot === null
      || typeof adapterObservation?.snapshot !== 'object'
    )
  ) {
    issues.push(issue(
      'PROBE_OBSERVATION_ADAPTER_UNAVAILABLE',
      'Browser evidence did not prove that the profile observation adapter is callable.',
      { expected: observationAdapter, observed: adapterObservation ?? null },
    ));
  }

  if (
    exceeds(documentSize.scrollWidth, viewport.width)
    || exceeds(documentSize.scrollHeight, viewport.height)
  ) {
    issues.push(issue(
      'DOCUMENT_OVERFLOW',
      'Document dimensions exceed the viewport tolerance.',
      { viewport, document: documentSize, tolerance: DEFAULT_TOLERANCE },
    ));
  }

  if (
    exceeds(canvas.clientWidth, viewport.width)
    || exceeds(canvas.clientHeight, viewport.height)
  ) {
    issues.push(issue(
      'CANVAS_LAYOUT_EXCEEDS_VIEWPORT',
      'Canvas layout dimensions exceed the viewport tolerance.',
      { viewport, canvas, tolerance: DEFAULT_TOLERANCE },
    ));
  }

  if (
    exceeds(canvas.bufferWidth, Number(viewport.width) * dpr)
    || exceeds(canvas.bufferHeight, Number(viewport.height) * dpr)
  ) {
    issues.push(issue(
      'CANVAS_BUFFER_EXCEEDS_DPR',
      'Canvas pixel buffer exceeds the viewport multiplied by devicePixelRatio.',
      { dpr, canvas, tolerance: DEFAULT_TOLERANCE },
    ));
  }

  if ((page.consoleErrors ?? []).length > 0) {
    issues.push(issue(
      'CONSOLE_ERRORS',
      'Browser console contains errors.',
      { errors: page.consoleErrors },
    ));
  }

  for (const [name, status] of Object.entries(evidence.interactions ?? {})) {
    if (status !== 'pass') {
      issues.push(issue(
        'INTERACTION_FAILED',
        `Interaction "${name}" did not pass.`,
        { interaction: name, status },
      ));
    }
  }

  const missingRequiredInteractions = requiredInteractions
    .filter((name) => !Object.prototype.hasOwnProperty.call(evidence.interactions ?? {}, name));
  if (missingRequiredInteractions.length > 0) {
    issues.push(issue(
      'REQUIRED_INTERACTION_MISSING',
      'Probe profile requires interactions that are not present in evidence.',
      {
        missing: missingRequiredInteractions,
        required: requiredInteractions,
        present: Object.keys(evidence.interactions ?? {}).sort(),
      },
    ));
  }

  const transitions = evidence.stateTransitions;
  if (!Array.isArray(transitions) || transitions.length === 0) {
    issues.push(issue(
      'MISSING_STATE_TRANSITIONS',
      'Interaction pass/fail labels must be backed by before/after state-transition evidence.',
      { interactions: Object.keys(evidence.interactions ?? {}) },
    ));
  } else {
    const transitionNames = new Set(transitions
      .map((transition) => transition?.name)
      .filter((name) => typeof name === 'string' && name.length > 0));
    const missingRequiredTransitions = requiredInteractions
      .filter((name) => !transitionNames.has(name));
    if (missingRequiredTransitions.length > 0) {
      issues.push(issue(
        'REQUIRED_INTERACTION_TRANSITION_MISSING',
        'Probe profile requires state-transition proof for every required interaction.',
        {
          missing: missingRequiredTransitions,
          required: requiredInteractions,
          transitions: [...transitionNames].sort(),
        },
      ));
    }
    const missingTransitions = Object.entries(evidence.interactions ?? {})
      .filter(([, status]) => status === 'pass')
      .map(([name]) => name)
      .filter((name) => !transitionNames.has(name));
    if (missingTransitions.length > 0) {
      issues.push(issue(
        'MISSING_INTERACTION_TRANSITION',
        'Every passing interaction must have a matching state transition with the same name.',
        { missing: missingTransitions, transitions: [...transitionNames].sort() },
      ));
    }

    for (const [name, contract] of Object.entries(transitionContracts)) {
      const transition = transitions.find((candidate) => candidate?.name === name);
      if (!transition) continue;
      const reasons = [];
      if (transition.assertion !== contract?.assertion) {
        reasons.push(`expected assertion ${contract?.assertion}, got ${transition.assertion}`);
      } else if (
        contract.assertion === 'delta'
        && Number(transition.expected) !== Number(contract.expected)
      ) {
        reasons.push(`expected delta contract ${contract.expected}, got ${transition.expected}`);
      } else if (
        contract.assertion === 'vector-distance>='
        && Number(transition.threshold) < Number(contract.minimumThreshold)
      ) {
        reasons.push(
          `expected threshold >= ${contract.minimumThreshold}, got ${transition.threshold}`,
        );
      }
      if (reasons.length > 0) {
        issues.push(issue(
          'STATE_TRANSITION_CONTRACT_MISMATCH',
          `State transition "${name}" does not match the probe profile contract.`,
          { interaction: name, contract, transition, reasons },
        ));
      }
    }

    for (const transition of transitions) {
      const result = evaluateStateTransition(transition);
      if (!result.pass) {
        issues.push(issue(
          'STATE_TRANSITION_FAILED',
          `State transition "${transition?.name ?? 'unnamed'}" did not satisfy ${transition?.assertion ?? 'its assertion'}.`,
          { transition, actual: result.actual, reason: result.reason },
        ));
      }
    }
  }

  for (const [name, exitCode] of Object.entries(evidence.commands ?? {})) {
    if (exitCode !== 0) {
      issues.push(issue(
        'COMMAND_FAILED',
        `Command "${name}" exited non-zero.`,
        { command: name, exitCode },
      ));
    }
  }

  return {
    schemaVersion: 1,
    projectDir,
    evidencePath,
    evidenceSha256,
    pass: issues.length === 0,
    issues,
  };
}
