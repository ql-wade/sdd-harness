# AI DevOps 总体架构（权威总纲）

> 状态：**权威总纲**。本文定义整个 AI DevOps 架构——人机边界、交付生命周期（12 环节）、设施分层（五层 + 双引擎）、门禁与证据链。知识闭环是其中一个环节的深化视图（环节 11-12），详见 [knowledge-architecture.md](knowledge-architecture.md)。
> 原则（继承 ADR-0015）：**映射而非编排**。scaffold 提供每个环节的能力、门禁与人机边界；不规定阶段顺序，不造状态机。团队按变更风险裁剪环节。
> 文档矩阵：横向分层 [scaffold-architecture.md](scaffold-architecture.md) ｜ 知识环节深化 [knowledge-architecture.md](knowledge-architecture.md) ｜ 演进对齐+图集 [architecture-blueprint.md](architecture-blueprint.md) ｜ 知识规格 [knowledge-layer-plan.md](knowledge-layer-plan.md) ｜ 分发层方案 [teamai-integration-plan.md](teamai-integration-plan.md)

## 0. 总架构图

三个正交维度构成整体：**交付生命周期**（横轴：变更从需求到知识沉淀）× **设施分层**（纵轴：所有环节共享的设施）× **人机边界**（贯穿：门禁自动化 + 人审点）。

```mermaid
flowchart TB
  subgraph LIFECYCLE["🔄 交付生命周期（12 环节，按风险裁剪）"]
    direction LR
    L1["1-2 需求澄清<br/>→产品定义"]
    L2["3-4 架构设计<br/>→变更提案"]
    L3["5-6 任务分解<br/>→TDD 实现"]
    L4["7-8 评审<br/>→测试验证"]
    L5["9-10 CI<br/>→CD"]
    L6["11-12 归档沉淀<br/>→知识对齐"]
    L1 --> L2 --> L3 --> L4 --> L5 --> L6
  end

  subgraph INFRA["🏗 设施分层（全环节共享）"]
    direction TB
    subgraph RULES["约定层"]
      AGENTS["AGENTS.md 单一规则入口<br/>+ CLAUDE.md 软链"]
    end
    subgraph SKILLS["技能层（5 方法论）"]
      S_G["grill-me 质询"]
      S_W["whitebox-verify 三模式验证"]
      S_P["planner 并行计划"]
      S_C["consensus 全票评审"]
    end
    subgraph CONTROL["控制平面"]
      HOOKS["hooks.yaml → adapter<br/>deny fail-closed"]
    end
    subgraph VERIFY["验证层（机械证据）"]
      GATES["gate/audit 六件套<br/>sha256 证据链"]
    end
    subgraph TOOLS["工具层"]
      MCPS["MCP 能力清单<br/>（诚实三态）"]
    end
  end

  subgraph ENGINES["⚡ 双引擎"]
    DIST["分发引擎<br/>teamai-cli（9-agent）<br/>hooks/MCP/skills reconcile"]
    KNOW["知识引擎<br/>四层生产 + 消费面 + 飞书桥<br/>（环节 11-12 深化）"]
  end

  HUMAN["👤 人：必审点（不可逆/发布/架构决策/对齐内容）"]
  AGENT_L["🤖 coding agent：起草+执行，门禁不得绕过"]

  AGENT_L -->|"调用"| SKILLS
  AGENT_L -->|"被拦截"| CONTROL
  CONTROL -->|"fail-closed"| AGENT_L
  LIFECYCLE -->|"每环节用"| INFRA
  DIST -->|"pull 分发"| INFRA
  KNOW <-->|"recall 上下文 / 沉淀产物"| LIFECYCLE
  HUMAN -.->|"审批闸"| L2
  HUMAN -.->|"放行闸"| L4
  HUMAN -.->|"发布闸"| L5
  HUMAN -.->|"对齐闸"| L6
```

**一句话总纲**：agent 在门禁护栏内沿生命周期推进变更，人在四个闸口决策，双引擎（分发+知识）让每次交付的设施保持同步、经验持续积累——**信任来自证据，不来自汇报**。

## 0.1 知识环节在整个架构中的位置

知识不是独立系统，而是生命周期的**回流环**（环节 11-12）+ 全环节的**上下文源**（环节 1 的 recall）：

```mermaid
flowchart LR
  subgraph DELIVERY["交付主线（环节 1-10）"]
    A["澄清→定义"] --> B["设计→提案"] --> C["分解→实现"] --> D["评审→验证"] --> E["CI→CD"]
  end
  subgraph KNOWLOOP["知识闭环（环节 11-12 + 上下文源）"]
    direction TB
    RECALL["⬆ recall：澄清/设计/实现<br/>各环节查团队知识（T0-T3 + 飞书抽取）"]
    SINK["⬇ 沉淀：archive 晋升 + 摩擦经验<br/>+ 飞书对齐（评审产物）"]
    TIER["四层生产面（Git 权威源）<br/>+ deepwiki/飞书 消费面"]
    SINK --> TIER --> RECALL
  end
  E -->|"交付完成 → 沉淀"| SINK
  RECALL -->|"上下文注入"| A
  RECALL --> B
  RECALL --> C
  style KNOWLOOP fill:#e8f5e9
```

## 0.2 人机分工三原则

| 类型 | 归属 | 例 |
|------|------|----|
| **不可逆 / 外部副作用 / 红线** | **人**（必审点） | 删库、生产发布、架构不可逆决策、写飞书对齐内容 |
| **机械可验证** | **门禁自动化**（agent 不得绕过） | 测试全绿、证据 sha256 绑定、probe 契约、check.sh |
| **判断性** | **agent 起草 + 人审** | PRD、设计、review 结论、知识提炼 |

## 1. 环节 × 能力 × 门禁 × 人决策点

| # | 环节 | agent 能力（已有=✅ / 规划=⏳） | 门禁与证据 | 人决策点 |
|---|------|------------------------------|-----------|---------|
| 1 | **需求澄清**（Intake） | ✅ grill-me 质询（一次一问消除歧义）＋⏳ 知识层 recall（v3：vault/teamwiki/飞书抽取） | findings 落盘（事实来源+未决问题+owner） | 范围与非目标拍板 |
| 2 | **产品定义**（PRD/AC） | ✅ grill-me（AC 可测性质询）＋产品文档模板（task-template 族） | AC 给定/当/则可测；non-goals 必填 | 优先级与取舍 |
| 3 | **架构设计**（Design/ADR） | ✅ **consensus 三方评审**（不可逆决策全票门）＋openspec proposal 工件 | ADR 落盘；跨模块须 openspec change | **不可逆决策批准** |
| 4 | **变更提案**（Change） | ✅ openspec `changes/<id>/`（proposal/specs/design/tasks） | 高风险先提案后实施（AGENTS §7） | 批准进入实施 |
| 5 | **任务分解**（Planning） | ✅ claude-parallel-tdd-planner（context pack/DAG/RED-GREEN ledger） | CONFIRM_ALIGNMENT 前禁改产品代码 | 计划确认 |
| 6 | **实现**（Code/TDD） | ✅ whitebox-verify（Slice 模式）＋hooks 控制平面（越界拦截/danger deny） | ✅ generation-gate（用例编写完整性：前后清单比对）；✅ test-gate（sha256 证据绑定） | — |
| 7 | **评审**（Review） | ✅ consensus 三方（架构/spec 对照）＋行级 review（ocr 类工具， degraded 按项目） | verdict + ✅ evidence-audit（声明与磁盘/命令输出一致） | **拒绝/放行**；2 拡触发返工 |
| 8 | **测试与验证**（Verify） | ✅ whitebox-verify（Journey：终态业务 oracle，No GREEN without closure）＋probe（UI/运行时证据） | ✅ probe 证据契约（debug 泄漏/布局/状态迁移）；✅ deliverable-audit | — |
| 9 | **集成**（CI） | ✅ check.sh 总门（规则/技能/回归/YAML）＋GitHub Actions | 全绿；⏳ teamai ci extract-mr（MR 知识回流） | — |
| 10 | **发布**（CD） | release 三模式（manual/auto/skip）——模式由项目自定 | 回滚路径 + 最新 verify 证据仍绑定（workflow-audit） | **发布批准**（manual 模式） |
| 11 | **归档与沉淀**（Archive） | ✅ openspec archive＋⏳ spec→wiki promotion（单向晋升）＋⏳ teamwiki 摩擦沉淀（详图见 knowledge-architecture） | 归档完成；晋升带 provenance | — |
| 12 | **知识对齐**（横切） | ⏳ lark-cli 服务层桥（飞书↔repo，评审产物才外推；三 job 流水线）＋⏳ deepwiki 集中消费（详图见 knowledge-architecture） | 路由矩阵；P1-P5 审批谓词 + fail-closed | 对齐内容批准 |

## 2. 角色视图（同一映射，按人组织）

| 角色 | 驱动环节 | 核心能力组合 | 主要产出 |
|------|---------|-------------|---------|
| **产品** | 1→2 | grill-me + 知识 recall | PRD、AC、non-goals |
| **架构** | 3→4 | consensus 评审 + openspec + ADR | 设计、ADR、变更提案 |
| **研发** | 5→6 | planner + TDD + hooks 边界 | DAG 计划、代码+测试+证据 |
| **测试** | 7→8 | whitebox Journey + probe + 三 audit | 验证报告、终态证据 |
| **平台/DevOps** | 9→10 + scaffold 维护 | check.sh/CI + release + bootstrap | 绿流水线、可回滚发布、scaffold 升级 |
| **知识 curator**（可轮值） | 11→12 | archive + promotion + lark 桥 | 团队知识库、飞书对齐页 |

角色是**能力组合的视角**，不是组织岗位强制——一人可兼多角色，一个环节可多人介入。

## 3. 风险分级裁剪（环节按需组合）

| 变更风险 | 必经环节 | 可跳过 |
|---------|---------|--------|
| 单文件低风险 | 6（TDD）+9（CI） | 1-5、7-8、11 |
| 标准多文件 | 1、4-9 | 2-3 视情况 |
| 跨模块/高风险 | **全环节**（3 必须 consensus 全票） | 无 |
| 不可逆（数据/定位/安全） | 全环节 + ADR + 人工双重审 | 无 |

裁剪由执行 agent 按触发矩阵（[skill-architecture.md](../agent/skill-architecture.md)）判断，**门禁不可裁剪**——跳过环节=不产生对应工件，不等于伪造通过。

## 4. 效果杠杆（为什么这样组合）

1. **澄清前置**（1-2）：grill-me 消歧的成本是返工成本的 1/10——问题在 findings 里暴露，不在 review 里爆炸。
2. **计划显式化**（5）：DAG + RED/GREEN ledger 让并行实现不漂移；CONFIRM_ALIGNMENT 是第二道人闸。
3. **证据链闭环**（6-8-10）：test-gate sha256 → probe 契约 → evidence-audit → workflow-audit——每个"通过"都可机械复核，agent 无法口头宣称完成。这是 AI DevOps 与传统 DevOps 的本质差异：**信任来自证据不来自汇报**。
4. **评审对抗性**（3/7）：consensus 全票 + 行级 review 双层——多数票和平均分不能放行，分歧必须被证据关闭。
5. **知识回流**（11-12）：每次变更的长期结论晋升 wiki、摩擦经验自动沉淀、飞书双向对齐——交付过程同时是团队资产的积累过程。
6. **门禁即护栏**（横切）：hooks 在 agent 运行时拦（fail-closed），check 在提交时拦（全绿才过），CI 在合并时拦（第三层）——三层拦截互为冗余。

## 5. 与现有架构的关系（文档矩阵）

| 文档 | 视角 | 与本文关系 |
|------|------|-----------|
| [scaffold-architecture.md](scaffold-architecture.md) | 横向：设施五层分层 | 本文纵轴的展开 |
| [knowledge-architecture.md](knowledge-architecture.md) | 知识环节（11-12）深化 | 本文回流环的详图 |
| [architecture-blueprint.md](architecture-blueprint.md) | 演进对齐 + 图集 | 原始 9-stage → 本架构的映射与证据时序图 |
| [knowledge-layer-plan.md](knowledge-layer-plan.md) | 知识规格（谓词/schema/门禁） | 知识环节的可执行规格 |
| [teamai-integration-plan.md](teamai-integration-plan.md) | 分发引擎方案 | 双引擎之一的实施计划 |

- 本文不新增工具：所有 ✅ 项已在仓库，⏳ 项挂靠 knowledge-layer-plan（K0-K5）与 teamai-integration-plan（P0-P3）。
- 触发矩阵（skill-architecture.md）是本文环节视图在"任务粒度"的投影；两文档以触发矩阵为操作入口、本文为全景索引。
- 新增环节能力时：先过本表对应环节的门禁定义，再进触发矩阵——防能力漂移。
