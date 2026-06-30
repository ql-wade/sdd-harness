# SDD Harness 使用教程

> 从零开始，用一个真实项目跑通 9 阶段 spec-driven 开发工作流。

## 前置条件

| 依赖 | 版本 | 用途 |
|---|---|---|
| Node.js | >= 18 | 运行 CLI |
| Python | >= 3.11 | LLMWiki MCP |
| Claude Code / OpenCode / Codex | 最新 | AI agent 执行各阶段 |
| 项目本身 | — | 你要开发的代码仓库 |

## 第 0 步：安装

```bash
# 全局安装（或 npx）
npm install -g sdd-harness

# 验证
sdd --version
```

## 第 1 步：初始化项目

在你的项目根目录执行：

```bash
cd /path/to/your-project
sdd init
```

这一步会：
- 创建 `.sdd/` 目录（工作流运行时状态）
- 创建 `openspec/` 目录（变更提案 + spec 管理）
- 创建 `llmwiki/` 目录（知识库）
- 安装 `.claude/commands/sdd-*.md`（9 个 slash command）
- 安装 `.claude/skills/sdd-*/`（9 个 stage skill + harness 公共 skill）
- 安装 `.claude/hooks/`（5 个治理 hook）
- 安装 `.claude/settings.json`（hook 注册）

验证安装：

```bash
sdd doctor
```

输出应该全绿。如果有缺失，`sdd doctor --fix` 自动修复。

## 第 2 步：理解工作流

SDD Harness 是一个 9 阶段流水线，每个阶段有明确的角色、命令、产出和 gate：

```
grill → product → dev → test → code → review → verify → release → archive
 澄清    产品草案   工程spec  测试矩阵  实现    独立审查  交付验证   部署    归档
```

两种执行方式：
- **Slash command**（推荐）：在 Claude Code 中输入 `/sdd:grill`、`/sdd:product` 等
- **CLI**：`sdd run grill --goal "..."`、`sdd run product` 等

## 第 3 步：启动变更 — Grill（澄清）

### 方式 A：Slash command

```
/sdd:grill "做一个浏览器贪吃蛇游戏"
```

### 方式 B：CLI

```bash
sdd run grill --goal "做一个浏览器贪吃蛇游戏" --slug snake-game
```

### 产出

| 文件 | 内容 |
|---|---|
| `openspec/changes/snake-game/findings.md` | 术语定义、边界、冲突、ADR 候选 |
| `openspec/changes/snake-game/brief.md` | 变更简述 + 路由决策 |

### 检查达标

```bash
sdd check grill
```

## 第 4 步：产品草案 — Product

```
/sdd:product
```

或 CLI：

```bash
sdd run product --change snake-game
```

### 产出

| 文件 | 内容 |
|---|---|
| `proposal.md` | PRD：用户、问题、范围、非目标、指标 |
| `acceptance-criteria.md` | AC：GIVEN/WHEN/THEN 格式 |
| `functional-test-draft.yaml` | 功能测试草案：happy/edge/error 场景 |

## 第 5 步：工程 Spec — Dev

```
/sdd:dev
```

### 产出

| 文件 | 内容 |
|---|---|
| `design.md` | 架构设计、File Structure Plan、boundary 注解 |
| `specs/<module>/spec.md` | 各模块 spec delta |
| `tasks.md` | 任务清单（- [ ] 格式） |

## 第 6 步：测试矩阵 — Test

```
/sdd:test
```

### 产出

| 文件 | 内容 |
|---|---|
| `llmwiki/wiki/testing/cases/TC-*.md` | 测试用例（带 frontmatter） |
| `llmwiki/wiki/testing/matrices/test-matrix.md` | 覆盖矩阵 |

## 第 7 步：实现 — Code

```
/sdd:code
```

或逐任务：

```
/sdd:code T1
```

### 自动化模式

```bash
# harness 自动调 claude -p 生成代码（TDD 红→绿）
sdd fill code --change snake-game
```

### 产出

| 文件 | 内容 |
|---|---|
| `src/` | 实现代码 |
| `tests/` 或 `src/**/*.test.ts` | 测试文件 |
| `progress.md` | 实现进度记录 |

### Hook 保护

此阶段写入 `src/` 时，`pre-tool-gate.sh` hook 允许通过。如果在非 code 阶段写 `src/`，会被 exit 2 拦截。

## 第 8 步：独立审查 — Review

```
/sdd:review
```

### 产出

| 文件 | 内容 |
|---|---|
| `.sdd/runs/<id>/review-notes.md` | verdict（ready/needs-fix）+ OCR triage |

### Gate 检查

review 阶段的产出必须满足：
- `review-notes.md` 存在
- 最新 verdict = `ready`

否则无法推进到 verify。

## 第 9 步：交付验证 — Verify

```
/sdd:verify
```

### 三个子检查

#### 9.1 Probe（功能 e2e）

```bash
# 通过 Playwright/浏览器采集运行时证据
# harness 验证状态转移断言
sdd probe --project . --evidence .sdd/runs/<id>/probe-evidence.json --profile <profile>
```

#### 9.2 Evidence Audit（证据审计）

```bash
# 交叉验证 progress.md 声明 vs 磁盘实际 vs 命令输出
sdd evidence-audit --project . --run <id>
```

#### 9.3 Deliverable Audit（产出核定）

```bash
# 检查每个阶段的产出是否完整
sdd deliverable-audit --project . --run <id>
```

### 产出

| 文件 | 内容 |
|---|---|
| `probe-evidence.json` | 浏览器运行时证据（状态转移断言） |
| `probe-report.json` | 探针报告（pass + SHA-256 绑定） |
| `evidence-audit-report.json` | 证据审计报告（pass + SHA-256 链） |

### Gate 检查

verify 阶段必须满足：
- `probe-report.json` pass=true
- `evidence-audit-report.json` pass=true
- SHA-256 证据链完整
- projectDir 绑定一致

## 第 10 步：补全产出（关键步骤）

verify 之后、release 之前，运行产出补全：

```bash
# 自动修复确定性 gap（ADR 归档、AC 拆分、learnings 传播等）
sdd fill-deliverables --project . --run <id>
```

输出示例：

```
🔧 SDD Deliverable Auto-Fix

   Gaps found: 5

  ✅ [grill/ADR_ARCHIVED] 提取 4 个 ADR → wiki/product/decisions/
  ✅ [product/AC_SPLIT] 拆分 8 个 AC → wiki/product/acceptance-criteria/
  ✅ [review/LEARNINGS_PROPAGATED] review learnings 已追加到 findings.md
  ✅ [archive/TRACEABILITY_MATRIX] 生成 traceability matrix
  🤖 [archive/CONCEPTS_EXTRACTED] 需要语义理解，由 sdd:archive skill → LLMWiki MCP 执行

   4 auto-fixed, 1 need LLM
```

标记为 `🤖 need LLM` 的项（concepts、entities）需要在 archive 阶段由 agent 语义提取。

## 第 11 步：部署 — Release

```
/sdd:release --mode skip
```

三种模式：
- `manual`：产出 deploy checklist
- `automated`：触发 deploy pipeline
- `skip`：跳过部署（纯 spec/文档/重构）

### 产出

| 文件 | 内容 |
|---|---|
| `RELEASE_NOTE.md` | 测试结果 + 性能基线 + 变更目标 |

## 第 12 步：归档与知识沉淀 — Archive

```
/sdd:archive
```

这一步做四件事：

1. **Spec 提升**：`openspec/changes/<id>/specs/` → `openspec/specs/`（持久化）
2. **变更归档**：`openspec/changes/<id>/` → `openspec/changes/archive/<date>-<id>/`
3. **LLMWiki writeback**：concepts/entities/backlink（语义提取，由 agent 执行）
4. **收口**：workflow-frame 标记 completed

### 最终验证

```bash
# 1. 工作流审计
sdd workflow-audit --project . --run <id> --json

# 2. 产出审计
sdd deliverable-audit --project . --run <id> --json

# 两个都 pass=true，0 issues，工作流完成。
```

## 常用命令速查

| 命令 | 用途 |
|---|---|
| `sdd init` | 初始化项目 |
| `sdd doctor` | 诊断健康状态 |
| `sdd run <stage>` | 驱动一个阶段 |
| `sdd check <stage>` | 检查阶段产出达标 |
| `sdd fill <stage>` | LLM 自动生成阶段内容 |
| `sdd workflow-audit` | 审计工作流 gate 状态 |
| `sdd deliverable-audit` | 审计产出完整性 |
| `sdd fill-deliverables` | 自动补全产出 gap |
| `sdd probe` | 验证浏览器运行时证据 |
| `sdd evidence-audit` | 审计证据真实性 |
| `sdd graph` | 刷新代码知识图谱 |
| `sdd wiki init` | 初始化 LLMWiki |
| `sdd wiki ingest` | 摄入 raw 源到 wiki |

## Hook 行为说明

| Hook | 触发时机 | 行为 |
|---|---|---|
| `session-start.sh` | session 启动 | 注入 active-run + stage + goal |
| `pre-tool-gate.sh` | 每次 Write/Edit/Bash | 非 code/review 阶段写 `src/` → exit 2 拦截 |
| `stop-gate.sh` | session 结束 | gate failed → exit 2 阻止结束 |
| `pre-compact-save.sh` | context 压缩前 | 提醒 flush progress/findings |
| `subagent-stop-contract.sh` | subagent 返回 | 检测输出契约（domain/artifact 字段） |

绕过 hook（紧急情况）：

```bash
touch .sdd/hooks/bypass
```

## 项目目录结构

```
your-project/
├── .sdd/
│   ├── active-run                    # 当前活跃变更 ID
│   ├── runs/<change-id>/
│   │   ├── workflow-frame.yaml       # 工作流状态机
│   │   ├── review-notes.md           # 审查产出
│   │   ├── probe-evidence.json       # 运行时证据
│   │   ├── probe-report.json         # 探针报告
│   │   └── evidence-audit-report.json
│   ├── steering/project.md           # 项目级指导
│   └── hooks/                        # hook 脚本
├── openspec/
│   ├── changes/
│   │   ├── <change-id>/              # 活跃变更
│   │   └── archive/
│   │       └── <date>-<change-id>/   # 已归档变更
│   └── specs/                        # 提升后的持久 spec
├── llmwiki/
│   └── wiki/
│       ├── concepts/                 # 跨域概念定义
│       ├── entities/                 # 实体关系图谱
│       ├── engineering/              # 工程笔记
│       ├── product/                  # 需求/AC/决策
│       ├── testing/                  # 测试用例/矩阵
│       └── _shared/                  # glossary/traceability
├── src/                              # 项目源码
├── .claude/
│   ├── commands/sdd-*.md             # 9 个 slash command
│   ├── skills/sdd-*/                 # 9 个 stage skill
│   ├── hooks/                        # 5 个治理 hook
│   └── settings.json                 # hook 注册
└── package.json
```
