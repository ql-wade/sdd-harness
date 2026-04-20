# sdd-ql-workflow

> SDD (Skill-Driven Development) CLI — 一键初始化 Trinity Workflow v2

基于 OpenSpec 的规范驱动开发工具。通过 **Skills** 控制 AI 注意力，**追踪文件** 持久化上下文，**Schema** 驱动工作流。

---

## 安装

```bash
npx sdd-ql-workflow init          # 自动检测平台，双平台安装
npx sdd-ql-workflow init --dry-run # 预览，不写文件
```

前置依赖：[planning-with-files](https://github.com/OthmanAdi/planning-with-files)、[superpowers](https://github.com/obra/superpowers)（需提前安装到对应平台 skills 目录）。

---

## 快速开始

```bash
# 1. 在项目根目录初始化
npx sdd-ql-workflow init

# 2. 告诉 AI 创建变更
# Claude Code: /sdd-new "feature-x"
# OpenCode:    直接说 "执行 trinity-new 创建 feature-x"

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
  --platform <name>     claude | opencode | both（默认自动检测）
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

> **OpenCode 用户注意**：`/` 开头的命令可能被命令面板拦截。用自然语言触发更可靠，例如"执行 trinity-apply"。

---

## 架构：Skills > Commands

```
┌──────────────────────────────────────────────────┐
│  Skills（核心逻辑）                                │
│  .claude/skills/trinity-*/  或  .opencode/skills/ │
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
| `findings.md` | 技术发现、架构决策 |
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
└── .opencode/                            # OpenCode（如果检测到）
    ├── skills/trinity-*/
    └── commands/sdd-*.md
```

---

## 平台支持

| 平台 | Skills | Commands | 检测标识 |
|------|--------|----------|---------|
| Claude Code | `.claude/skills/` | `.claude/commands/` | `.claude/` 目录存在 |
| OpenCode | `.opencode/skills/` | `.opencode/commands/` | `.opencode/` 目录存在 |
| 双平台 | 两者都安装 | 两者都安装 | 默认 |

---

## 开发

```bash
cd packages/sdd-cli && npm install
node bin/cli.js init --dry-run    # 本地测试
node bin/cli.js doctor            # 健康检查
```

## License

MIT
