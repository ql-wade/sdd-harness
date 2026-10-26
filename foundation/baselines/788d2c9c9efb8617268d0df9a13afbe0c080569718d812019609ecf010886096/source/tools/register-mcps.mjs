#!/usr/bin/env node
// register-mcps.mjs — 按 mcp-capabilities.yaml 生成/合并 .mcp.json（幂等）
//
// 只注册 status=ready|degraded 的 MCP；planned 仅存在于能力清单，不注册。
// 生成的 .mcp.json 无绝对路径（npx / ${CLAUDE_PROJECT_DIR} wrapper），可 commit。
// llmwiki 仅在 --with-llmwiki 或 venv 已存在时注册（wrapper 运行时解析路径）。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const withLlmwiki = process.argv.includes('--with-llmwiki');

const capRaw = fs.readFileSync(path.join(ROOT, 'mcp-capabilities.yaml'), 'utf8');

// 最小解析：抓取每个 mcp 块的 name/status
const mcps = [];
for (const m of capRaw.matchAll(/- name: (\S+)\n(?:.*\n)*?    status: (\S+)/g)) {
  mcps.push({ name: m[1], status: m[2] });
}
const statusOf = (name) => mcps.find((m) => m.name === name)?.status;

const mcpJsonPath = path.join(ROOT, '.mcp.json');
let config = {};
if (fs.existsSync(mcpJsonPath)) {
  try { config = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8')); } catch { config = {}; }
}
config.mcpServers = config.mcpServers ?? {};

const registered = [];
const skipped = [];

function add(name, entry) {
  const status = statusOf(name);
  if (status === 'planned') { skipped.push(`${name} (planned, 见 mcp-capabilities.yaml)`); return; }
  // user-local（能力清单 note 声明）不进分发的 .mcp.json——本机 overlay 用户自配
  const block = capRaw.split(`- name: ${name}`)[1]?.split('- name:')[0] ?? '';
  if (/user-local/.test(block)) {
    delete config.mcpServers[name];
    skipped.push(`${name} [${status}, user-local 不分发]`);
    return;
  }
  config.mcpServers[name] = entry;
  registered.push(`${name} [${status}]`);
}

const MCP_PINS = {
  playwright: '@playwright/mcp@0.0.80',
  'chrome-devtools': 'chrome-devtools-mcp@1.8.0',
  github: '@modelcontextprotocol/server-github@2025.4.8',
};

if (statusOf('playwright') === 'ready') {
  add('playwright', { command: 'npx', args: ['-y', MCP_PINS.playwright] });
}
if (statusOf('chrome-devtools') === 'ready') {
  add('chrome-devtools', { command: 'npx', args: ['-y', MCP_PINS['chrome-devtools']] });
}
if (statusOf('github') === 'degraded') {
  add('github', {
    command: 'npx',
    args: ['-y', MCP_PINS.github],
    env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
  });
}

// llmwiki：venv 就绪或显式请求时注册（wrapper 脚本运行时解析 SDD_HOME / LLMWIKI_PYTHON）
const sddHome = process.env.SDD_HOME || path.join(os.homedir(), '.sdd');
const venvPython = path.join(sddHome, 'repos', 'llmwiki', '.venv', 'bin', 'python');
if (withLlmwiki || fs.existsSync(venvPython)) {
  const wrapper = path.join(ROOT, 'tools', 'mcp', 'llmwiki.sh');
  if (!fs.existsSync(wrapper)) {
    skipped.push('llmwiki (wrapper 缺失：tools/mcp/llmwiki.sh)');
  } else {
    config.mcpServers['llmwiki'] = { command: '${CLAUDE_PROJECT_DIR}/tools/mcp/llmwiki.sh', args: [] };
    registered.push('llmwiki [ready, venv 依赖]');
  }
} else {
  skipped.push('llmwiki (未安装 venv；bash tools/bootstrap.sh --with-llmwiki)');
}

// 存量清扫：已在 .mcp.json 但清单标注 user-local 的条目一并剥离（保持分发的 .mcp.json 与清单一致）
for (const name of Object.keys(config.mcpServers)) {
  const block = capRaw.split(`- name: ${name}`)[1]?.split('- name:')[0] ?? '';
  if (/user-local/.test(block)) {
    delete config.mcpServers[name];
    skipped.push(`${name} [存量剥离: user-local]`);
  }
}

fs.writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n');
console.log(`✅ .mcp.json 注册：${registered.join(', ') || '无'}`);
if (skipped.length) console.log(`⏭️  跳过：${skipped.join('; ')}`);
