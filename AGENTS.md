# AI Coding Scaffold（本仓库）开发约束

> 仓库级 Coding Agent 入口，遵守 [AGENTS.md 开放标准](https://agents.md)。
> 本文件是 scaffold 项目自身的实例化规则；给团队用的填空骨架见
> [AGENTS-template](docs/agent/AGENTS-template.md)。指令冲突时：当前用户明确要求 >
> 最近 `AGENTS.md` > 父级逐层回溯 > 本文件。

## 0. 指令语义

- 开始任务前先读取本文件；修改子目录时同时读取该路径下最近的 `AGENTS.md`。
- 本文件是活文档：命令、目录职责或架构变化时，在同一变更中更新它。
- 只修改与当前目标直接相关的文件；不重排、不覆盖用户已有改动。

## 1. 项目目标与仓库范围

本仓库是**团队 AI coding 项目的 scaffold**：统一规则入口 + 方法论技能 + hooks 控制平面 + MCP 能力清单 + 验证工具。不规定工作流（ADR-0015）。

- `AGENTS.md` / `CLAUDE.md -> AGENTS.md`：规则入口（CLAUDE.md 只是兼容软链，check 强制）
- `docs/agent/`：技能触发矩阵、任务交接模板、AGENTS 填空模板
- `.agents/skills/`：vendored 技能快照（必须为真实目录，禁止符号链接——可移植性红线）
- `hooks.yaml` + `hooks/`：控制平面策略源与脚本实现
- `mcp-capabilities.yaml` / `.mcp.json`：MCP 能力唯一事实源 + 注册产物（无绝对路径、版本 pin）
- `openspec/`：变更工件
- `bin/cli.js` + `lib/` + `contracts/`：验证工具薄 CLI 与 gate/audit 机械证据库
- `tools/`：bootstrap、CC adapter、MCP 注册器
- non-goals：基础层不引入工作流编排/阶段状态机；经 ADR-0019 评审的可选 delivery profile 仅接入 Comet 原控制器，禁止第二主控；不在技能正文里写项目约束；不提交本地产物（`.claude/`、`.sdd/` 等）

## 2. 开始任务前必须读取

1. `README.md`：定位与快速开始
2. `docs/architecture/scaffold-architecture.md`：权威架构（分层、决策、迁移）
3. `docs/architecture/adr/`：不可逆决策（尤其 ADR-0015）
4. `docs/agent/skill-architecture.md`：触发矩阵与验证层分工

文档与代码不一致时，先说明冲突并通过 ADR 固化决定，不默默选边。

### 当前交付实施

- 实施目标：[Comet流程与知识收敛架构](docs/architecture/comet-ai-devops-convergence.md)，沿用ADR-0019单主控边界，实施细化见[ADR-0020](docs/architecture/adr/0020-comet-command-knowledge-convergence.md)，命令优先收敛（取消六角色常驻服务/Runner镜像/私有RPC前置）见[ADR-0021](docs/architecture/adr/0021-comet-command-first-no-resident-role-services.md)。
- 执行和恢复先读当前Change的[HANDOFF](openspec/changes/delivery-foundation-rearchitecture/HANDOFF.md)，任务只消费同一[清单](openspec/changes/delivery-foundation-rearchitecture/tasks.md)与DAG；按实际资格和独立证据接纳，文档不宣称运行就绪。
- 方法快照保持原样。当前profile绑定Comet原Run；TeamAI只分发。基础scaffold职责保留，历史蓝图仅供演进对照，不能作为当前阶段命令/知识库路由。

### 局部 AGENTS.md 索引

- `.agents/skills/AGENTS.md`：技能层约束（不改技能正文、不加品牌前缀、升级走显式替换）

## 3. 环境、构建与验证命令

```bash
npm install                 # 依赖（node >=18）
npm test                    # gate/audit + adapter 装配级回归套件
bash scripts/check.sh       # 提交前总入口：规则层 + 技能层 + 回归 + YAML/JSON
bash tools/bootstrap.sh     # hooks 落地 + 技能软链 + MCP 注册（幂等）
```

验证失败的修复必须改根因，不允许通过放宽断言转绿。adapter/hooks 是控制平面：
改动后必须同时验证"脚本行为"与"settings.json 装配"（matcher 注册），二者缺一即是
共识评审 F-HOOKS-001 的复刻。

## 4. 事实来源与目录所有权

| 内容 | 事实来源 | 变更要求 |
| --- | --- | --- |
| 控制平面策略 | `hooks.yaml` | 策略只在这里定义；adapter 是编译器，产物（.compiled.env）不手改 |
| MCP 能力 | `mcp-capabilities.yaml` | ready/degraded/planned 三态如实标注；注册器据此生成 .mcp.json |
| 技能正文 | 上游（mattpocock/obra）| 不修改 vendored 快照；升级 = 显式替换 + skill-check |
| 架构决策 | `docs/architecture/adr/` | 不可逆决策必须先有 ADR |
| 变更工件 | `openspec/changes/<change-id>/` | 高风险变更先提案后实施 |
| MCP 供应链 | `tools/register-mcps.mjs` 的 MCP_PINS + bootstrap 的 commit/pip pin | 禁止 @latest / HEAD / 浮动版本 |

领域硬规则：所有相对路径符号链接必须从其所在目录可解析（`.claude/skills/* -> ../../.agents/...`）；分发内容不得引用 `$HOME` 或机器特定路径。

## 5. 编码和接口约定

- Node ESM（`"type": "module"`），依赖最少化（chalk/commander/fs-extra），不加未使用依赖。
- CLI 退出码契约：`0` 通过 / `1` 输入无效 / `2` 验证不通过；机器可读输出用 `--json`。
- shell 脚本一律 `set -euo pipefail`；生成"将被 source 的文件"时值必须强制单引号（事故 2026-09-03）。
- 安全姿态：deny 门 fail closed（解析器缺失/输入不可解析都拦截）；提权路径（如 ingest 的 skip-permissions）必须在代码内如实声明风险面。
- 测试污染红线：测试不得向 `.claude/settings.json` 等活配置残留状态；需要写入的必须在 finally 恢复。

## 6. 任务执行循环

1. **理解**：确认目标、范围、事实来源和明确不做的内容。
2. **风险判断**：按[触发矩阵](docs/agent/skill-architecture.md)选择技能与验证深度。
3. **计划**：跨模块/高风险任务创建 `openspec/changes/<change-id>/`。
4. **实施**：优先更新契约/测试边界，再实现；改动小而可审查。
5. **验证**：窄检查 + `bash scripts/check.sh`；失败就修复或如实记录。
6. **交接**：改动文件、真实执行的命令与结果、未验证项、风险（模板见 [task-template](docs/agent/task-template.md)）。

## 7. 高风险与安全红线

- 控制平面（hooks/adapter/settings.json）：改动必须有装配级验证（不是只测脚本）。
- 供应链：依赖升级必须显式改 pin 并注明验证方式。
- 不可逆决策（定位、分层、删除既有能力）：先写 ADR。
- 不执行破坏性命令模式演示时，使用拼接构造载荷，避免活 hook 自触（实证：会拦）。
- 外部副作用操作未经明确授权只做静态验证。

## 8. 交接格式

普通任务用 [task-template](docs/agent/task-template.md)；高风险任务用 `openspec/changes/<change-id>/`。最终消息至少包含：目标与完成范围、关键改动文件及事实来源、真实执行的验证命令和结果、未验证项与需人工确认事项。

不要把 agent 的隐式记忆、模型名称、内部提示词或未验证的推理写入项目文件。
