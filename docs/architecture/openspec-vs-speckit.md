# OpenSpec vs Spec Kit 架构对比与路径选择

> 目的：搞清楚两者冲突在哪、各自覆盖什么、SDD Harness 应该怎么定位。
> 状态：讨论稿，待用户确认方向后执行。

## 一、两者各自覆盖什么

### OpenSpec（Fission-AI，我们当前用的）

```
openspec/changes/<change-id>/
├── proposal.md        # 为什么做
├── specs/             # 做什么（requirements + scenarios）
├── design.md          # 怎么做
├── tasks.md           # 做哪些
├── task_plan.md       # Trinity tracking
├── findings.md        # durable findings
├── progress.md        # execution log
└── delta-log.md       # spec/design/task changes

openspec/specs/<domain>/spec.md  ← accepted truth（archive 后）

CLI: openspec（brew install openspec）
Skills: trinity-new / continue / apply / verify / archive
```

**OpenSpec 独有**：双层 truth（active change + accepted domain spec）、Trinity 五段生命周期、tracking 文件（task_plan/findings/progress/delta-log）、domain registry。

### Spec Kit（GitHub 官方）

```
specs/<feature-id>/
├── spec.md            # 需求 + user stories
├── plan.md            # 技术规划
├── tasks.md           # 任务分解（含 [P] 并行标记）
├── constitution.md    # 项目治理原则（.specify/memory/）
├── contracts/          # API spec、SignalR spec
├── data-model.md
├── research.md
└── quickstart.md

CLI: specify（uv tool install）
Commands: /speckit.constitution / specify / plan / tasks / implement / converge / clarify / analyze / checklist
```

**Spec Kit 独有**：Constitution、Converge（spec↔code 收敛）、Clarify（结构化追问）、Checklist（"英文单元测试"）、Extensions/Presets/Bundles 模块化、30+ agent 覆盖、brownfield 支持、skills mode。

### 重叠区域

| 能力 | OpenSpec | Spec Kit |
|------|---------|---------|
| spec 目录 | `openspec/changes/` + `openspec/specs/` | `specs/` + `.specify/` |
| spec 格式 | proposal + specs + design + tasks | spec + plan + tasks + constitution |
| CLI | `openspec` | `specify` |
| 命令 | `/trinity:*` | `/speckit.*` |
| 生命周期 | new→continue→apply→verify→archive | specify→plan→tasks→implement→converge |
| 任务追踪 | task_plan.md + progress.md | tasks.md（含 [P] 并行 + checkpoint） |
| 多 agent | Claude/OpenCode/Codex（3 个） | 30+ |
| 分支管理 | Trinity 创建分支 | 自动创建 `001-feature-name` 分支 |

**结论：它们是竞品，不是互补品。** 同一层（spec engine），同一个项目里只能选一个。

## 二、SDD Harness 在哪一层

当前 SDD Harness **横跨两层**：

```
Spec Engine 层（OpenSpec）         Governance 层（SDD Harness 自建）
├── spec 格式                     ├── hooks（5 个）
├── 生命周期（Trinity）           ├── stage-metrics（10 阶段）
├── CLI（openspec）              ├── function e2e（__sdd 钩子）
└── 目录结构                     ├── preview 验证
                                  ├── LLMWiki 知识闭环
                                  ├── open-code-review
                                  └── release/archive
```

**问题**：SDD Harness 和 OpenSpec 是绑定的——9 个 stage skill 封装 Trinity，stage-metrics 验 OpenSpec 产出，hooks 读 OpenSpec 目录。换 spec engine = 重绑。

## 三、三条路径

### 路径 A：留 OpenSpec，自己补缺失

把 Spec Kit 的 Converge / Constitution / Checklist 用 OpenSpec 格式重写。

```
工作量：
  + sdd-converge skill（对比 openspec/changes/<id>/specs/ vs src/）
  + constitution.md → 替代 steering.md
  + sdd-checklist skill（生成 spec 质量检查清单）
  ≈ 3 个新 skill + 模板调整

优点：不重写已有 29 skills / 9 commands / 5 hooks
缺点：Converge/Constitution 是重新发明（Spec Kit 已有现成的）
```

### 路径 B：换 Spec Kit 作底座

弃 OpenSpec + Trinity + sdd-cli fork。Fork Spec Kit，重建 SDD Harness governance 层。

```
工作量：
  - 删 OpenSpec 目录结构 / Trinity skills / openspec CLI 依赖
  + 9 stage skill 改为 Spec Kit extension 格式
  + stage-metrics 适配 Spec Kit 产出（spec.md / plan.md / tasks.md）
  + 双层 truth 作为 Spec Kit extension 补
  ≈ 全部 9 skills 重写 + cli.js 大改

优点：Converge/Constitution/Clarify/30+ agent/Extensions 全部现成
缺点：大规模重写，丢失已有实证（MiniCraft 验证全基于 OpenSpec）
```

### 路径 C：SDD Harness 退为纯 Governance Layer

SDD Harness 不拥有 spec engine。用户自选（OpenSpec 或 Spec Kit），SDD Harness 只管治理。

```
spec engine（用户选）
├── OpenSpec 或 Spec Kit
└── 管 spec 格式 + 生命周期 + CLI

governance layer（SDD Harness）
├── hooks（不绑 spec engine）
├── stage-metrics（适配选定的 spec engine）
├── function e2e
├── LLMWiki 知识闭环
└── preview 验证
```

```
工作量：
  + 解耦：stage-metrics 不硬绑 openspec/changes/ 路径（改为 configurable）
  + hooks 不读 openspec/ 目录（改为读 .sdd/ 自有状态）
  + sdd run/fill/check 适配两种 spec engine 的产出
  ≈ 中等改动（解耦 + 适配层）

优点：用户可选 spec engine；SDD Harness 聚焦治理（它的真价值）
缺点：两种 spec engine 的适配增加复杂度
```

## 四、我的判断

**路径 A 最务实**。理由：

1. OpenSpec 已经经过 MiniCraft 8 轮实证——换底座（路径 B）风险大
2. Spec Kit 的三个杀手级模式（Converge / Constitution / Checklist）**不依赖 Spec Kit 的 spec 格式**——它们是方法论，可以在 OpenSpec 上重写
3. 路径 C 的解耦有价值但增加复杂度，当前阶段不值得

**SDD Harness 的真价值不在 spec engine 层，在 governance 层**（hooks + metrics + e2e + knowledge loop）。路径 A 让我们继续在 governance 层深耕，同时补 spec engine 层的缺失模式。

## 五、待讨论

1. 你认同路径 A（留 OpenSpec 补缺失）吗？还是倾向 B/C？
2. Converge（spec↔code 收敛）是你最想要的吗？还是 Constitution？
3. 有没有第四条路我没看到的？
