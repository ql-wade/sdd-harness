# LLMWiki MCP 集成修复方案（v2 — 纳入 Codex 评审反馈）

## 背景

SDD Harness 的 LLMWiki 集成应在 `lucasastorian/llmwiki` MCP 契约下工作：**LLM 经 MCP `create`/`edit`/`append` 工具写 wiki**，这些工具会同步更新 SQLite 文档表、FTS 索引、引用图、staleness 传播。当前 CLI 有两条路径绕过 MCP 直接落盘，导致产出物对 MCP 的 `search`/`read` 不可见。

## Codex 评审核实的事实

读 [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) `mcp/tools/write.py` 确认：

- 暴露工具：`create` / `edit` / `append` / `read` / `search` / `lint` / `list` / `delete` / `guide`（**无 `write`**）
- `create` 要求 `knowledge_base` / `title` / `content` / `tags`（tags 必填），并执行：
  - `_ensure_wiki_frontmatter` 补 YAML frontmatter
  - `fs.create_document()` 写 SQLite + FTS
  - `_sync_references()` 更新引用图 + `propagate_staleness`
- **直接 `fs.writeFile` 到 `llmwiki/wiki/**` 的文件不进任何索引** → MCP `search` 找不到，等于死文件

## 问题（扩展为两类直接落盘路径）

### 问题 1a：`generateSeedContent`（sdd init / sdd wiki init）

`lib/knowledge-seed.js::generateSeedContent()` 用正则启发式批量写 190 个 wiki 条目，绕过 MCP。

### 问题 1b：`sedimentStage`（sdd run 自动触发）— Codex 发现

`lib/llmwiki-sediment.js::sedimentStage()` 在 `sdd run` stage 推进后自动触发（`bin/cli.js:1335`），用 `fs-extra` 直接写 glossary / requirements / AC / engineering notes / test reports。**同类问题**，v1 方案漏了。

### 问题 2：`sdd-context-mcp` 幽灵依赖

9 个 stage skill 引用 `sdd-context-mcp.build_grill_pack`，但 init 从不注册它，且 `buildPack()` 是 stub。

### 问题 3：MCP 批准 UX 缺失

`.mcp.json` 写了但 Claude Code 首次进入项目需安全批准，sdd init 无提示。

## 修复方案（v2）

### 改动 A：`generateSeedContent` → 只复制源到 `raw/`

**文件**：`bin/cli.js` Step 5（~line 350-394）+ `sdd wiki init`（~line 1430）+ `lib/knowledge-seed.js`

**行为**：
1. 建空骨架（dirs + index.md + log.md）— 保留
2. `discoverKnowledgeSources()` 发现的所有源类型复制到 `raw/`：
   - `docs` / `steering` / `agentDocs` / `specs`（OpenSpec）/ `catalog`（CODEBASE-CATALOG）/ `domainGraph` / `openspecConfig`
   - **不用 `path.basename`**（会撞名，如多个 README.md），改用相对路径 slug：`doc.path.replace(/[/\\]/g, '__').replace(/^\.+/, '')` → `docs__architecture__foo.md`
3. **删除** `generateSeedContent` / `generateIndex` / `extractSummary` / `extractGlossaryTerms` / `categorizeDoc`
4. **保留** `discoverKnowledgeSources` / `findMdFiles`（用于发现）
5. 打印提示：`下一步：sdd wiki ingest 或 session 内用 mcp__llmwiki__create 写 wiki`

### 改动 A2：`sedimentStage` 改为 staging — Codex 新增

**文件**：`lib/llmwiki-sediment.js` + `bin/cli.js:1335`（触发点）

`sedimentStage()` 不能再直接写 `llmwiki/wiki/**`。两种方案：

**A2-1（推荐，轻量）**：sediment 改为写 staging 目录 `llmwiki/.staging/<stage>/`，提示用户/agent 后续经 MCP `create` 提交。
```js
// 改前：fs.writeFile(path.join(wikiDir, '_shared/glossary/term-xxx.md'), ...)
// 改后：fs.writeFile(path.join(stagingDir, 'grill', 'term-xxx.md'), ...)
//      + console.log('📋 staged: llmwiki/.staging/grill/ — 用 mcp__llmwiki__create 提交')
```

**A2-2（重）**：sediment 通过 `ptyClaude` 驱动 claude 调 MCP `create` 提交。慢但全自动。

**推荐 A2-1**：保留 sediment 的"自动捕获 stage 产出"价值，但不污染 MCP 索引。staging 文件后续由 archive 阶段或 agent 经 MCP 提交。

### 改动 B：sdd init 末尾加 MCP 批准提示

**文件**：`bin/cli.js` init 命令末尾

```js
console.log(chalk.yellow('\n⚠️  LLMWiki MCP 需在 Claude Code 内批准'));
console.log(chalk.gray('   重启 Claude Code session，弹窗确认 .mcp.json 的 llmwiki server'));
console.log(chalk.gray('   批准后验证：在 session 内看到 mcp__llmwiki__create / search 工具'));
```

（不写死 `claude mcp approve llmwiki`——Codex 指出该命令未经验证，实际是 session 内弹窗批准）

### 改动 C：sdd-context-mcp 清理（C1 保留，扩展文档范围）

**C1**：删除 `sdd-context-mcp`，knowledge-pack 组装下沉到 sdd-harness skill（§4 已写）。

**全仓引用清理**（Codex 指出 v1 只列 4 个文件不够）：
```bash
rg -l "sdd-context-mcp|build_.*_pack" --type md --type yaml
```
预期需改：`sdd-harness/SKILL.md`、`dependencies.yaml`、`docs/architecture/sdd-harness-workflow-architecture.md`、`docs/sdd-workflow-flowchart.md`、`templates/claude/commands/sdd-grill.md`、`templates/sdd-harness/knowledge-pack.md`、`templates/sdd-harness/mcp-keys.env`、9 个 stage skill 文档。

删除 `mcp/sdd-context-mcp/` 整个目录。

### 改动 D：MCP 工具名修正

全方案文档把 `mcp__llmwiki__write` 改为 `mcp__llmwiki__create` / `edit` / `append` / `search` / `lint`。

## 决策点

1. **A2 选 A2-1（staging）还是 A2-2（ptyClaude 驱动 MCP）？** — 推荐 A2-1
2. **PAV2 worktree 已有的 190 个伪条目 + sediment 产出怎么清理？** — 提供 `sdd wiki init --rebuild`（清空 wiki/ 重建空骨架）+ 迁移脚本 `rm -rf llmwiki/wiki/**/*`（保留 raw/）
3. **保留 `sdd wiki ingest` CLI 命令？** — 保留（ptyClaude 驱动 claude 读 raw/ 写 sources/，是 MCP 不可用时的降级路径）

## 验证（Codex 加强版）

1. `node --test` 全过
2. 干净项目 `sdd init`：
   - `llmwiki/wiki/**` 只有空骨架（index.md / log.md / 子目录），无伪条目
   - `llmwiki/raw/` 含所有源类型，路径用 `__` slug 无撞名
3. `sdd wiki init --rebuild` 行为与 init 一致
4. **MCP 索引回归**：启动 llmwiki MCP，跑 `search(mode="list", path="/wiki/**")`，确认返回空（无 seed 污染）；`read` 一个 raw 文件确认可访问
5. **sediment 回归**：`sdd run grill` 推进后，`llmwiki/.staging/grill/` 有文件，`llmwiki/wiki/**` 仍空
6. **全仓幽灵引用**：`rg "sdd-context-mcp|build_.*_pack"` 返回 0（或仅在标 deprecated 的历史文档里）
7. Claude Code session 内确认 `mcp__llmwiki__create` / `search` 工具可见

## 不在本次范围

- lucasastorian/llmwiki MCP 本身实现（上游）
- A2-2 的 ptyClaude→MCP 自动提交（未来增强）
