# SDD Harness 缝合架构升级（对标 3 个最佳实践框架）

> 来源：Spec Kit (GitHub, 118k) + Compound Engineering (Every Inc, 23k) + BMAD-METHOD (50k) + claude-code-best-practice
> 定位：缝合架构大师——取各家最强模式，融合进 SDD Harness

## 一、各家最强模式（学什么）

### Spec Kit（GitHub 官方 spec-driven）

| 模式 | 它怎么做 | 我们有没有 | 缝合价值 |
|------|---------|-----------|---------|
| **Constitution** | `/speckit.constitution` — 项目治理原则在 spec 之前建立，引导所有后续决策 | ⚠️ 有 steering 但不是"宪法级" | ★★★ |
| **Clarify** | `/speckit.clarify` — 结构化、覆盖率驱动的逐项追问，记录到 Clarifications 段 | ⚠️ 有 grill 但非结构化覆盖 | ★★☆ |
| **Converge** | `/speckit.converge` — 评估代码 vs spec/plan/tasks 的偏差，补剩余任务 | ❌ 完全缺失 | ★★★ |
| **Extensions/Presets/Bundles** | 模块化定制：Extension 加命令、Preset 改模板、Bundle 按角色打包 | ❌ 静态模板 | ★★☆ |
| **Checklist** | `/speckit.checklist` — "英文单元测试"——验证 spec 完整性/清晰度/一致性 | ❌ 只验存在性 | ★★☆ |
| **Skills mode** | `--integration codex --skills` — 以 skill 而非 slash command 安装 | ⚠️ 有 skill 但 init 用命令模式 | ★★☆ |
| **Brownfield 支持** | Evolving Specs guide — 存在项目迭代 | ❌ 只支持 greenfield | ★☆☆ |

### Compound Engineering（Every Inc）

| 模式 | 它怎么做 | 我们有没有 | 缝合价值 |
|------|---------|-----------|---------|
| **Plugin 组合** | 每个能力独立安装，像积木拼装 | ❌ 整包安装 | ★★☆ |
| **Orchestrator pattern** | 一个协调器派发多个专职 agent | ⚠️ sdd-harness 是协调器但单线程 | ★★☆ |
| **Ralph 循环** | Anthropic 官方循环插件——自动重试+改进 | ⚠️ 有 goal-loop 但非 CC 原生 | ★☆☆ |

### BMAD-METHOD（角色化）

| 模式 | 它怎么做 | 我们有没有 | 缝合价值 |
|------|---------|-----------|---------|
| **角色化 Agent** | Product Manager / Architect / Developer / QA / DevOps 各有独立 agent 定义 | ❌ 9 stage 但无角色 agent | ★★★ |
| **Scrum-master 协调** | 角色间有协调 agent 管理交接 | ⚠️ sdd-harness 做协调但非角色化 | ★★☆ |

---

## 二、缝合方案（6 个升级，优先级排序）

### S-1：Constitution 替代 Steering（★★★ 从 Spec Kit）

**现状**：`steering/project.md` 是技术栈声明，不是治理原则。
**缝合**：升级为 `.sdd/constitution.md`——项目宪法，在 spec 之前建立，约束所有阶段决策。

```yaml
# .sdd/constitution.md
## 治理原则
- spec 是真相，代码是实现（非反过来）
- 每个变更必须经 9 阶段闭环
- 测试是 verify 的证据，不是 code 的附属品
- review 在 verify 之前（先审代码质量再验交付完整性）

## 技术约束
- 语言/框架/构建工具（从 steering 合并）
- 代码规范
- 禁止项

## 决策过滤器
- 遇到冲突时：OpenSpec > PRD > 代码实现
- 不可逆决策需 ADR
```

`sdd init` 时引导用户写 constitution（而非只填 steering）。每阶段 agent 读 constitution 作为决策过滤器。

### S-2：Converge 阶段（★★★ 从 Spec Kit，补缺失的反馈环）

**现状**：9 阶段是线性的（grill→archive）。如果实现偏离 spec，没有机制检测。
**缝合**：加 `/sdd:converge`——评估代码 vs spec 的偏差，补剩余任务。

```
/sdd:converge
  → 读 openspec/changes/<id>/specs/ + tasks.md
  → 对比 src/ 实际代码
  → 列偏差清单 + 追加任务到 tasks.md
  → 可以在 code 和 review 之间，或 verify 之后跑
```

这补了 harness 最缺的**反馈环**——spec 驱动开发不是一次性 spec→code，而是 spec→code→converge→修正 spec 或 code→直到收敛。

### S-3：角色化 Agent（★★★ 从 BMAD-METHOD）

**现状**：9 个 stage skill 是流程角色，不是人角色。
**缝合**：加 `.claude/agents/` 角色定义——每个角色有独立 agent 文件。

```
.claude/agents/
├── sdd-pm.md          # 产品经理：写 PRD/AC
├── sdd-architect.md   # 架构师：写 spec/design
├── sdd-developer.md   # 开发者：写 code
├── sdd-qa.md          # QA：写 test/verify
└── sdd-reviewer.md    # 审查员：review 阶段
```

`sdd fill product` → Task 工具派发 `sdd-pm` agent（带 grill findings context）。agent 产出 PRD/AC，符合角色视角。比现在"通用 agent 按阶段切角色"更真实。

### S-4：Extensions/Presets 系统（★★ 从 Spec Kit）

**现状**：模板静态 copy，一次性。
**缝合**：模板解析改为优先级栈。

```
优先级（高→低）：
1. 项目本地覆盖（.sdd/templates/overrides/）
2. Preset（.sdd/presets/）
3. Extension（.sdd/extensions/）
4. 核心（sdd-harness 自带）
```

`sdd preset add react-strict` → 装 React 严格模式 preset（覆盖 design.md 模板加 React 特定 boundary 约束）。不同项目可以装不同 preset 而不改 harness 核心。

### S-5：Converge 驱动的 Brownfield 支持（★ 从 Spec Kit）

**现状**：只支持 greenfield（init → grill → archive）。
**缝合**：`sdd converge --existing`——扫描已有代码库，逆向生成 spec/design/tasks，然后走正常 9 阶段补缺口。

### S-6：Checklist 生成（★★ 从 Spec Kit "英文单元测试"）

**现状**：stage-metrics 验存在性（grep count），不验内容质量。
**缝合**：`/sdd:checklist`——为每个阶段生成"质量检查清单"，验证 spec 完整性/清晰度/一致性。比 grep 更深入。

---

## 三、最优 3 个立即做

| # | 缝合 | 来源 | 工作量 | 理由 |
|---|------|------|--------|------|
| **S-1** | Constitution | Spec Kit | 小（改 steering→constitution） | 治理原则升级 |
| **S-2** | Converge | Spec Kit | 中（加 1 阶段 + skill） | 补最缺的反馈环 |
| **S-3** | 角色化 Agent | BMAD | 中（加 5 agent 定义） | 从流程角色到人角色 |

### 立即执行 S-1（最小改动，最大架构提升）

把 steering 升级为 constitution：
- `sdd init` 时引导写 `.sdd/constitution.md`（而非只填 steering）
- 内容 = 治理原则 + 技术约束 + 决策过滤器
- 每阶段 fill 命令把 constitution 作为 context 注入（决策依据）
- `.claude/rules/sdd-harness.md` = constitution 精简版（CC 原生注入）

要我现在执行 S-1（constitution）+ S-2（converge）吗？这两个补了 harness 最缺的两个洞：治理根基 + 反馈环。
