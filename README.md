# sdd-ql-workflow

> SDD (Skill-Driven Development) CLI — 一键初始化 Trinity Workflow v2

基于 OpenSpec 的规范驱动开发工具。通过 **Skills** 控制 AI 注意力，**追踪文件** 持久化上下文，**Schema** 驱动工作流。

---

## 安装

```bash
npx sdd-ql-workflow init          # 自动检测平台；未检测到时安装全部支持平台
npx sdd-ql-workflow init --dry-run # 预览，不写文件
```

前置依赖：

| 依赖 | 安装方式 | 说明 |
|------|---------|------|
| [OpenSpec CLI](https://github.com/Fission-AI/OpenSpec) | `brew install openspec` | 工作流引擎，Skills 调用它管理变更状态 |
| [planning-with-files](https://github.com/OthmanAdi/planning-with-files) | 克隆到 `~/.claude/skills/`、`~/.opencode/skills/` 或 `~/.codex/skills/` | 上下文追踪文件管理 |
| [superpowers](https://github.com/obra/superpowers) | 克隆到 `~/.claude/skills/`、`~/.opencode/skills/` 或 `~/.codex/skills/` | 专业开发技能集 |

---

## 快速开始

```bash
# 1. 在项目根目录初始化
npx sdd-ql-workflow init

# 2. 告诉 AI 创建变更
# Claude Code: /sdd-new "feature-x"
# OpenCode:    直接说 "执行 trinity-new 创建 feature-x"
# Codex:       直接说 "使用 trinity-new 创建 feature-x"

# 3. AI 自动执行完整工作流
# /trinity:continue → /trinity:apply → /trinity:verify → /trinity:archive
```

---

## CLI 命令

### `init` — 初始化工作流

```bash
sdd init [options]

Options:
  -f, --force           覆盖已存在文件
  --platform <name>     claude | opencode | codex | both | all（默认自动检测）
  --dry-run             预览模式，不写文件
  --skip-schema         跳过 openspec schema
  --skip-skills         跳过 skills
  --skip-commands       跳过 commands
```

### `cleanup` — 清理旧文件

```bash
sdd cleanup             # 删除 hybrid-*.md、opsx-*.md 等旧命令
sdd cleanup --dry-run   # 预览
```

### `doctor` — 诊断工作流健康度

```bash
sdd doctor              # 检查 schema、skills、commands、openspec CLI
```

### `list` — 列出可用命令

```bash
sdd list
```

---

## Trinity 工作流命令

这些命令由 **Skills** 驱动，Commands（sdd-*.md）只是可选的快捷入口：

| 触发方式 | 说明 |
|---------|------|
| `/trinity:new "描述"` | 创建新变更（带追踪） |
| `/trinity:continue` | 继续下一个 artifact |
| `/trinity:apply` | 执行任务（3-Strike 错误处理） |
| `/trinity:verify` | 验证实现 |
| `/trinity:archive` | 归档变更 |
| `/trinity:ff "描述"` | 快速流程（一键 proposal→tasks） |

> **OpenCode/Codex 用户注意**：`/` 开头的命令可能不可用或被命令面板拦截。用自然语言触发更可靠，例如"执行 trinity-apply"。

---

## 架构：Skills > Commands

```
┌──────────────────────────────────────────────────┐
│  Skills（核心逻辑）                                │
│  .claude/skills/、.opencode/skills/ 或 .codex/skills/ │
│  每个 skill 包含完整的三段式流程：                  │
│    1. planning-with-files → 读取上下文             │
│    2. openspec CLI        → 管理变更状态           │
│    3. planning-with-files → 更新追踪文件           │
├──────────────────────────────────────────────────┤
│  Commands（可选快捷入口）                           │
│  .claude/commands/sdd-*.md                        │
│  薄别名，描述如何触发对应的 skill                    │
│  可删除，不影响 skill 功能                          │
└──────────────────────────────────────────────────┘
```

### 追踪文件（Agent 的上下文锚点）

每个变更在 `openspec/changes/{change-id}/` 下维护：

| 文件 | 职责 |
|------|------|
| `task_plan.md` | 阶段、目标、进度 |
| `findings.md` | 技术发现、架构决策 (ADR) |
| `progress.md` | 操作日志 |
| `delta-log.md` | Specs 变更记录 |

Agent 随时读取这些文件，知道"在哪、做过什么、为什么、下一步"。

### Profile 模式

| 模式 | 适用场景 | 流程 |
|------|---------|------|
| Quick | Bug Fix、单文件 | proposal → tasks → apply |
| Core | 新功能、多文件 | proposal → specs → design → tasks → apply |
| Expanded | 跨模块重构 | 全流程 + verify |

---

## 生成的文件结构

```
your-project/
├── openspec/
│   ├── config.yaml                       # OpenSpec 配置
│   ├── schemas/trinity-workflow-v2/      # Schema + 模板
│   ├── specs/                            # 持久化规格
│   └── changes/                          # 活跃变更（含追踪文件）
├── .claude/                              # Claude Code（如果检测到）
│   ├── skills/trinity-*/                 # 7 个 Trinity skills
│   └── commands/sdd-*.md                 # 4 个快捷命令
├── .opencode/                            # OpenCode（如果检测到）
│   ├── skills/trinity-*/
│   └── commands/sdd-*.md
└── .codex/                               # Codex（如果检测到）
    └── skills/trinity-*/
```

---

## 平台支持

| 平台 | Skills | Commands | 检测标识 |
|------|--------|----------|---------|
| Claude Code | `.claude/skills/` | `.claude/commands/` | `.claude/` 目录存在 |
| OpenCode | `.opencode/skills/` | `.opencode/commands/` | `.opencode/` 目录存在 |
| Codex | `.codex/skills/` | 不适用 | `.codex/` 目录存在 |
| both | Claude Code + OpenCode | 两者都安装 | 兼容旧用法 |
| all | 三个平台都安装 | Claude Code + OpenCode commands | 未检测到平台目录时默认 |

---

## 核心设计哲学：模板零技术栈假设

### 设计原则

sdd-cli 的产出物模板遵循 OpenSpec 官方的 **spec-driven design** 哲学：

> **模板 = 纯结构骨架（零技术栈假设），项目身份 = config.yaml context**

这意味着：
- **模板不包含任何语言/框架特定内容**（无 TypeScript interface、无 React Component、无 npm/pnpm）
- **所有技术栈信息通过 `config.yaml` 的 `context` 字段注入**
- **同一套模板适用于 Python/Go/Rust/Java/TS 等任何项目**

### 为什么这样设计？

官方 OpenSpec 的 prompt 组装顺序为：

```
1. <project_context>    ← config.yaml context（全局身份）
2. <rules>              ← config.yaml rules.<artifact-id>
3. <dependencies>       ← 已完成的产出物路径
4. <instruction>        ← schema.yaml artifacts[].instruction（AI 指导）
5. <template>           ← templates/*.md 原文（字面注入 AI prompt）
6. <output>             ← schema.yaml artifacts[].generates（输出路径）
```

**第 5 步的 template 是字面文本**——它直接成为 AI 输入的一部分。如果模板里写了 `interface EntityName {}`，AI 就会在任何项目中看到 TypeScript 代码，即使目标是 Python 项目。

因此：
- ✅ 模板只定义**结构**（标题层级、章节名称、占位符）
- ❌ 模板不包含**实现细节**（代码示例、框架引用、构建工具）

---

## 配置文件详解

### config.yaml 区块定义

| 区块 | 必填 | 职责 | 典型内容 |
|------|------|------|---------|
| `schema` | ✅ | 引用哪个工作流 Schema | `trinity-workflow-v2` |
| `contextFiles` | ❌ | 额外上下文文件声明 | `openspec/project.md` 等 |
| `context` | ⚠️ 建议 | **项目身份**——语言、框架、编码规范 | 技术栈、代码风格、领域术语 |
| `rules` | ❌ | 按 artifact 类型约束输出质量 | 字数限制、格式要求、覆盖范围 |
| `trinity` | ❌ | Trinity Skills 映射 | 触发词、skill 文件路径 |
| `tracking` | ❌ | 追踪文件配置 | 文件名列表、自动更新开关 |
| `profiles` | ❌ | Profile 模式定义 | quick/core/expanded 及自动选择规则 |

#### `context` 字段详解（最重要）

这是整个系统的**唯一技术栈注入点**。AI 在生成所有产出物时都会读取此字段。

```yaml
context: |
  语言：中文（简体）。所有产出物必须用简体中文撰写。
  
  Tech stack: Python 3.11 / vnpy 3.0 / PostgreSQL
  代码规范: snake_case 命名、type hints 必须、docstring 用 Google Style
  测试框架: pytest + pytest-asyncio
  构建工具: ruff lint + ruff format
```

**最佳实践**：
- 控制在 **50 行以内**（官方上限 50KB，但越长越稀释注意力）
- 只写**项目特有**信息，不写通用工作流说明（那些属于 schema.yaml）
- 每次切换项目时**必须修改此字段**

#### `rules` 字段详解

按 artifact ID 精细控制输出质量：

```yaml
rules:
  proposal:
    - 字数控制在 500 字以内
    - 必须包含 Non-goals 章节
  specs:
    - 使用 Given/When/Then Gherkin 格式
    - 覆盖 Happy Path、Edge Cases、Error Cases
  tasks:
    - 每个任务 2-5 分钟可完成
    - 每个任务有明确的验证步骤
```

### schema.yaml 区块定义

| 区块 | 职责 | 与 config.yaml 的关系 |
|------|------|---------------------|
| `artifacts[]` | 定义每个产出物的元数据 | `rules.<id>` 约束其输出质量 |
| `artifacts[].instruction` | AI 生成该产出物的指导 | 叠加在 `<template>` 之上 |
| `artifacts[].template` | 引用 templates/ 下的模板文件 | **纯结构骨架，零技术栈** |
| `artifacts[].requires` | 声明依赖关系（DAG） | 控制 workflow 执行顺序 |
| `artifacts[].generates` | 输出文件路径 | 支持 glob 如 `specs/**/*.md` |
| `tracking` | 追踪层配置 | 与 config.yaml `tracking` 协同 |
| `profiles` | Profile 模式 | 与 config.yaml `profiles` 协同 |
| `apply` | 执行阶段配置 | 依赖 tasks artifact |
| `verify` | 验证维度定义 | 三维验证：completeness/correctness/coherence |
| `archive` | 归档流程 | 合并 delta specs、移动变更目录 |
| `threeStrike` | 错误升级协议 | 3 次失败后升级给用户 |

### templates/ 目录（4 个产出物模板）

| 文件 | 行数 | 结构 | 占位符 |
|------|------|------|--------|
| `proposal.md` | ~20 行 | Why / What Changes / Capabilities / Impact | `{{change-name}}`, `{{date}}` |
| `design.md` | ~25 行 | Context / Goals / Non-Goals / Decisions / Risks | 同上 |
| `spec.md` | ~20 行 | ADDED Requirements / Gherkin Scenarios | `{{capability-name}}` |
| `tasks.md` | ~10 行 | Phase 分组 / Checkbox 任务列表 | 同上 |

**关键特征**：
- 无任何 `interface`、`class`、`function` 代码片段
- 无任何框架引用（Redux/Express/Koa/FastAPI...）
- 无任何构建工具引用（npm/pnpm/poetry/cargo...）
- 只使用 Markdown 标题层级和 HTML 注释占位符

### Prompt 数据流总览

```
用户输入: "/trinity:new 用户认证功能"
          │
          ▼
    ┌─────────────┐
    │ Skill 加载   │ ← trinity-new/SKILL.md
    │ (三段式流程)  │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐     ┌──────────────┐
    │ planning-with-│────▸│ task_plan.md  │
    │ files 读取    │     │ findings.md   │
    └─────────────┘     │ progress.md   │
                         └──────────────┘
           │
           ▼
    ┌─────────────────────────────────────┐
    │ OpenSpec Prompt Assembly            │
    │                                     │
    │  1. config.yaml.context  ◄── 项目身份│
    │  2. config.yaml.rules.proposal      │
    │  3. (无依赖，proposal 是第一个)      │
    │  4. schema.instruction (proposal)   │
    │  5. templates/proposal.md ◄── 纯结构 │
    │  6. → openspec/changes/{id}/proposal.md │
    └─────────────────────────────────────┘
           │
           ▼
    AI 生成 proposal.md
           │
           ▼
    /trinity:continue → specs → design → tasks ...
    （每步重复上述 Prompt Assembly 流程）
```

---

## 定制指南

### 场景 1：切换项目技术栈

只需修改 `config.yaml` 的 `context` 字段：

```yaml
# 原来（Python 项目）
context: |
  Tech stack: Python 3.11 / vnpy 3.0
  代码规范: snake_case

# 改为（Rust 项目）
context: |
  Tech stack: Rust 1.75 / Axum 0.7 / SQLx
  代码规范: snake_case, clippy strict, no unwrap()
```

**不需要修改任何模板文件**。

### 场景 2：增加新的 artifact 类型

在 `schema.yaml` 的 `artifacts` 数组中添加新条目，并在 `templates/` 下创建对应模板。

### 场景 3：调整验证标准

修改 `schema.yaml` 的 `verify.dimensions`，或覆写 `config.yaml.rules.verify`。

### 场景 4：自定义 Profile

在 `config.yaml.profiles` 中添加新 profile，或在 `schema.yaml.profiles` 中定义默认值。

---

## 开发

```bash
cd sdd-cli && npm install
node bin/cli.js init --dry-run    # 本地测试
node bin/cli.js doctor            # 健康检查
```

## License

MIT
