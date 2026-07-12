import { spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

const STAGE_CAPABILITIES = {
  grill: ['spec-engine', 'agent-host', 'discovery'],
  product: ['product-design'],
  dev: ['spec-engine', 'workflow-executor', 'code-graph'],
  test: ['project-tests', 'knowledge-base'],
  code: ['workflow-executor', 'project-tests'],
  review: ['architecture-review', 'line-review'],
  verify: ['project-tests', 'runtime-probe', 'performance-audit', 'knowledge-base', 'evidence-audit'],
  release: ['deploy'],
  archive: ['spec-engine', 'knowledge-base'],
};

const ADAPTER_HOSTS = [
  { id: 'claude', command: 'claude', root: '.claude' },
  { id: 'codex', command: 'codex', root: '.codex' },
  { id: 'opencode', command: 'opencode', root: '.opencode' },
];

function readyAdapterProvides(projectDir, relativePath) {
  return ADAPTER_HOSTS.some(({ command, root }) => (
    commandExists(command) && pathExists(projectDir, root, relativePath)
  ));
}

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore', timeout: 15000 });
  return result.status === 0;
}

function pathExists(projectDir, ...segments) {
  return fs.pathExistsSync(path.join(projectDir, ...segments));
}

function configuredCommandExists(projectDir, command) {
  if (typeof command !== 'string' || !command.trim()) return false;
  const candidate = command.trim();
  if (path.isAbsolute(candidate)) return fs.pathExistsSync(candidate);
  if (candidate.includes(path.sep)) return fs.pathExistsSync(path.resolve(projectDir, candidate));
  return commandExists(candidate);
}

function hasProjectTests(projectDir) {
  const packagePath = path.join(projectDir, 'package.json');
  if (fs.pathExistsSync(packagePath)) {
    try {
      const pkg = fs.readJsonSync(packagePath);
      if (typeof pkg?.scripts?.test === 'string' && pkg.scripts.test.trim()) return true;
    } catch {}
  }
  return [
    'pyproject.toml',
    'pytest.ini',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
  ].some((name) => pathExists(projectDir, name));
}

function readOverrides(projectDir) {
  const configPath = path.join(projectDir, '.sdd', 'capabilities.json');
  if (!fs.pathExistsSync(configPath)) return {};
  try {
    const parsed = fs.readJsonSync(configPath);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function detectedCapability(id, projectDir) {
  const home = os.homedir();
  switch (id) {
    case 'evidence-audit':
      return true;
    case 'project-tests':
      return hasProjectTests(projectDir);
    case 'spec-engine':
      return commandExists('openspec');
    case 'agent-host':
      return ADAPTER_HOSTS.some(({ command, root }) => (
        commandExists(command) && pathExists(projectDir, root)
      ));
    case 'discovery':
      return readyAdapterProvides(projectDir, path.join('skills', 'sdd-grill'))
        || (commandExists('claude') && pathExists(home, '.claude', 'skills', 'grill-me'));
    case 'product-design':
      return readyAdapterProvides(projectDir, path.join('skills', 'sdd-product'))
        || (commandExists('claude') && pathExists(home, '.claude', 'skills', 'to-prd'));
    case 'workflow-executor':
      return readyAdapterProvides(projectDir, path.join('skills', 'trinity-apply'));
    case 'code-graph': {
      const graphPath = path.join(projectDir, '.understand-anything', 'knowledge-graph.json');
      if (!fs.pathExistsSync(graphPath)) return false;
      try {
        const graph = fs.readJsonSync(graphPath);
        return Array.isArray(graph?.nodes) && graph.nodes.length > 0;
      } catch {
        return false;
      }
    }
    case 'knowledge-base': {
      const mcpPath = path.join(projectDir, '.mcp.json');
      if (!fs.pathExistsSync(mcpPath)) return false;
      try {
        const server = fs.readJsonSync(mcpPath)?.mcpServers?.llmwiki;
        return Boolean(server && configuredCommandExists(projectDir, server.command));
      } catch {
        return false;
      }
    }
    case 'architecture-review':
      return (commandExists('claude') && pathExists(home, '.claude', 'skills', 'superpowers'))
        || readyAdapterProvides(projectDir, path.join('skills', 'sdd-review'));
    case 'line-review':
      return commandExists('ocr', ['llm', 'test']);
    default:
      return false;
  }
}

export function evaluateStageCapabilities({ projectDir, stage }) {
  const required = STAGE_CAPABILITIES[stage];
  if (!required) throw new Error(`unknown stage: ${stage}`);
  const overrides = readOverrides(projectDir);
  const capabilities = required.map((id) => {
    const override = overrides[id];
    if (override?.status === 'not-applicable') {
      if (typeof override.reason === 'string' && override.reason.trim()) {
        return { id, required: true, status: 'not-applicable', reason: override.reason.trim() };
      }
      return { id, required: true, status: 'missing', reason: 'not-applicable requires a reason' };
    }
    const available = detectedCapability(id, projectDir);
    return {
      id,
      required: true,
      status: available ? 'available' : 'missing',
      source: available ? 'detected' : 'not-detected',
    };
  });
  return {
    schemaVersion: 1,
    stage,
    pass: capabilities.every((item) => item.status !== 'missing'),
    capabilities,
  };
}

export function supportedCapabilityStages() {
  return Object.keys(STAGE_CAPABILITIES);
}
