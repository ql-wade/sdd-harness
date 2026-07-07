#!/usr/bin/env node
/**
 * sdd-context-mcp — SDD Harness 的 context pack 聚合 MCP
 *
 * 5 个 tool，每个对应一个 SDD 阶段，产出 knowledge-pack.md
 *
 * 数据源优先级: OpenSpec > LLMWiki > git diff > Understand-Anything > DeepWiki
 * 冲突: 高优先级覆盖，冲突标记在 knowledge-pack 末尾 ## Conflicts 段
 * 新鲜度(MVP): 每次全量重建，不做增量缓存
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs-extra';
import path from 'node:path';

// run_id 白名单：防 path traversal（../../etc 逃逸）
const RUN_ID_RE = /^[a-zA-Z0-9_-]+$/;
function validateRunId(runId) {
  if (!runId || typeof runId !== 'string' || !RUN_ID_RE.test(runId)) {
    throw new Error(`Invalid run_id: ${runId}`);
  }
}

const server = new Server(
  { name: 'sdd-context-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// ============================================================
// Tool definitions
// ============================================================

const tools = [
  {
    name: 'build_grill_pack',
    description: '为 /sdd:grill 阶段组装 context pack。聚合 LLMWiki glossary、Understand-Anything graph、DeepWiki pages、OpenSpec 已有 specs。',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'change-id' },
        user_intent: { type: 'string', description: '用户输入的变更描述' },
        project_dir: { type: 'string', description: '业务 repo 根目录' }
      },
      required: ['run_id', 'project_dir']
    }
  },
  {
    name: 'build_dev_pack',
    description: '为 /sdd:dev 阶段组装 context pack。聚合 proposal、AC、code graph、已有 specs。',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        project_dir: { type: 'string' }
      },
      required: ['run_id', 'project_dir']
    }
  },
  {
    name: 'build_test_pack',
    description: '为 /sdd:test 阶段组装 context pack。聚合 OpenSpec scenarios、AC、已有 LLMWiki 用例。',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        project_dir: { type: 'string' }
      },
      required: ['run_id', 'project_dir']
    }
  },
  {
    name: 'build_code_pack',
    description: '为 /sdd:code 阶段组装 context pack。聚合 tasks、design boundary plan、findings learnings。',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        project_dir: { type: 'string' }
      },
      required: ['run_id', 'project_dir']
    }
  },
  {
    name: 'build_verify_pack',
    description: '为 /sdd:verify 阶段组装 context pack。聚合 review-notes、测试结果、spec coverage。',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        project_dir: { type: 'string' }
      },
      required: ['run_id', 'project_dir']
    }
  }
];

// ============================================================
// Source readers
// ============================================================

// 从所有源聚合数据，按优先级处理冲突
async function buildPack(runId, phase, projectDir) {
  const pack = {
    run_id: runId,
    phase: phase,
    timestamp: new Date().toISOString(),
    product_context: { wiki_pages: [], glossary_terms: [], open_questions: [] },
    code_context: { understand_graph_commit: '', related_nodes: [], layers: [], impact_paths: [] },
    repo_narrative: { deepwiki_pages: [], gitmcp_docs: [] },
    test_context: { existing_cases: [], regression_risks: [] },
    openspec_context: { active_change: runId, related_changes: [] },
    evidence: { sources: [] },
    conflicts: []
  };

  // 优先级: OpenSpec > LLMWiki > git diff > Understand-Anything > DeepWiki

  // 1. OpenSpec (最高优先级)
  // 读 openspec/changes/<runId>/ 下的 proposal/specs/design/tasks
  // 读 openspec/specs/ 下已有 specs

  // 2. LLMWiki
  // 查询 LLMWiki MCP: product/ / engineering/ / testing/ / _shared/glossary/

  // 3. Git diff
  // git diff --stat / git log 最近变更

  // 4. Understand-Anything
  // 读 .understand-anything/knowledge-graph.json

  // 5. DeepWiki / GitMCP (最低优先级)
  // 查询外部 repo 文档

  return pack;
}

// ============================================================
// MCP handlers
// ============================================================

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!tools.find(t => t.name === name)) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const pack = await buildPack(args.run_id, name.replace('build_', '').replace('_pack', ''), args.project_dir);

  // 写入 knowledge-pack.md
  validateRunId(args.run_id);
  if (!args.project_dir || typeof args.project_dir !== 'string') {
    throw new Error('Missing or invalid project_dir');
  }
  const packPath = path.join(args.project_dir, '.sdd', 'runs', args.run_id, 'knowledge-pack.md');
  await fs.ensureDir(path.dirname(packPath));

  // 生成 markdown（使用模板格式）
  const md = generateMarkdown(pack);
  await fs.writeFile(packPath, md, 'utf-8');

  return {
    content: [{ type: 'text', text: `knowledge-pack.md written to ${packPath}` }],
    structuredContent: pack
  };
});

function generateMarkdown(pack) {
  return `# Knowledge Pack: ${pack.run_id}

> 阶段: ${pack.phase} | 生成时间: ${pack.timestamp}

## 产品上下文
<!-- LLMWiki product/ + glossary -->

## 代码上下文
<!-- Understand-Anything graph -->

## 测试上下文
<!-- LLMWiki testing/cases/ -->

## OpenSpec 上下文
<!-- Active change + related -->

## 冲突 / 注意事项
${pack.conflicts.length > 0 ? pack.conflicts.map(c => `- ${c}`).join('\n') : '无'}
`;
}

// ============================================================
// Start
// ============================================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
