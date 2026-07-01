import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// ============================================================================
// OpenDeepWiki integration — harness 内置的 AI 仓库知识库
// ============================================================================

const SDD_HOME = path.join(os.homedir(), '.sdd');
const COMPOSE_FILE = path.join(SDD_HOME, 'docker-compose.sdd.yml');
const TEMPLATE_FILE = 'docker-compose.sdd.yml';

/**
 * Get the OpenDeepWiki service URL from environment or default.
 */
export function getOpenDeepWikiUrl() {
  return process.env.OPENDEEPWIKI_URL || `http://localhost:${process.env.OPENDEEPWIKI_PORT || 8095}`;
}

/**
 * Check if OpenDeepWiki service is running and healthy.
 */
export function checkOpenDeepWikiHealth() {
  const url = getOpenDeepWikiUrl();
  try {
   const result = execSync(`curl -sf ${url}/health 2>/dev/null`, {
      encoding: 'utf8',
      timeout: 5000,
    });
    // Verify it's actually OpenDeepWiki, not some other service on the same port
    // OpenDeepWiki has /api/mcp endpoint; a plain health check is not enough
    // Verify it's actually OpenDeepWiki, not another service on the same port.
    // Discriminator: /api/mcp returns 400 (exists but needs params), not 404.
    // A proxy/other service returns 404 for unknown paths.
    let isRealOpenDeepWiki = false;
    try {
      const mcpCode = execSync(
        `curl -s -o /dev/null -w "%{http_code}" ${url}/api/mcp 2>/dev/null`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      // 400 = endpoint exists (needs repository param); 200 = valid MCP
      isRealOpenDeepWiki = mcpCode === '400' || mcpCode === '200';
    } catch {}
    return { running: isRealOpenDeepWiki, url, healthy: isRealOpenDeepWiki };
  } catch {
    return { running: false, url, healthy: false };
  }
}

/**
 * Detect GitHub repo from git remote.
 * Returns "owner/repo" or null.
 */
export function detectGitRepo(cwd) {
  try {
    // Try 'origin' first, then any remote
    let remote;
    try {
      remote = execSync('git remote get-url origin', { cwd, encoding: 'utf8' }).trim();
    } catch {
      const remotes = execSync('git remote', { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      if (remotes.length === 0) return null;
      remote = execSync(`git remote get-url ${remotes[0]}`, { cwd, encoding: 'utf8' }).trim();
    }
    const match = remote.match(/github\.com[:/]([^/]+\/[^/\s]+)/);
    if (match) {
      let repo = match[1].replace(/\.git$/, '');
      return repo;
    }
    // Also check for private/self-hosted — return a slug from the URL
    const pathMatch = remote.match(/[:/]([^/]+\/[^/\s]+)$/);
    if (pathMatch) {
      return pathMatch[1].replace(/\.git$/, '');
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Register OpenDeepWiki MCP into project's .mcp.json.
 * Only registers if OpenDeepWiki is running.
 */
export async function registerOpenDeepWikiMCP(cwd) {
  const health = checkOpenDeepWikiHealth();
  if (!health.running) {
    return { registered: false, reason: 'OpenDeepWiki not running' };
  }

  const repo = detectGitRepo(cwd);
  if (!repo) {
    return { registered: false, reason: 'no git remote detected' };
  }

  const mcpConfig = path.join(cwd, '.mcp.json');
  let config = {};
  if (await fs.pathExists(mcpConfig)) {
    try { config = JSON.parse(await fs.readFile(mcpConfig, 'utf8')); } catch {}
  }
  config.mcpServers = config.mcpServers || {};

  const mcpUrl = `${health.url}/api/mcp/${repo}`;
  if (config.mcpServers['opendeepwiki']) {
    return { registered: true, url: mcpUrl, repo, skipped: true };
  }

  config.mcpServers['opendeepwiki'] = {
    type: 'url',
    url: mcpUrl,
  };
  await fs.writeFile(mcpConfig, JSON.stringify(config, null, 2));
  return { registered: true, url: mcpUrl, repo };
}

/**
 * Copy docker-compose.sdd.yml template to ~/.sdd/ if not present.
 */
export async function ensureComposeFile(templatesDir) {
  await fs.ensureDir(SDD_HOME);
  const src = path.join(templatesDir, 'sdd-harness', TEMPLATE_FILE);
  if (await fs.pathExists(src)) {
    // Always overwrite: ensures latest template is used (version may have changed)
    await fs.copy(src, COMPOSE_FILE, { overwrite: true });
  }
}

/**
 * Start OpenDeepWiki via docker compose.
 */
export function startOpenDeepWiki() {
  // Ensure compose file exists
  if (!fs.pathExistsSync(COMPOSE_FILE)) {
    return { success: false, reason: 'docker-compose.sdd.yml not installed. Run sdd init first.' };
  }
  try {
    execSync(`docker compose -f ${COMPOSE_FILE} up -d`, { stdio: 'inherit' });
    return { success: true };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

/**
 * Stop OpenDeepWiki.
 */
export function stopOpenDeepWiki() {
  if (!fs.pathExistsSync(COMPOSE_FILE)) {
    return { success: false, reason: 'docker-compose.sdd.yml not installed' };
  }
  try {
    execSync(`docker compose -f ${COMPOSE_FILE} down`, { stdio: 'inherit' });
    return { success: true };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}
