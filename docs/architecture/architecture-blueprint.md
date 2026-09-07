# 架构蓝图：原始架构对齐 + 全景图集

> 状态：权威。本文完成两件事：① grill 对齐原始 SDD Harness 架构与当前 Scaffold 架构（每个原始构件的去向与理由）；② 汇总全景架构图（mermaid）。
> 事实来源：[ADR-0008..0015](adr/)（原始决策链）、[scaffold-architecture.md](scaffold-architecture.md)（当前分层）、[ai-devops-architecture.md](ai-devops-architecture.md)（交付视图）、[knowledge-layer-plan.md](knowledge-layer-plan.md)（知识拓扑）。

## 1. Grill 对齐：原始架构 → 当前架构

原始架构（SDD Harness v0.1）= **9-stage 状态机 + Core/Adapter 分层 + 5 hooks 治理 + 9 gates 证据 + LLMWiki 知识闭环**。逐构件对齐：

| 原始构件 | 原始职责 | 去向 | 理由（grill 结论） |
|---------|---------|------|-------------------|
| 9-stage 状态机（`sdd run` CLI 编排） | grill→product→dev→test→code→review→verify→release→archive 线性推进 | **降维**：环节保留为 [AI DevOps 参考视图](ai-devops-architecture.md) 12 环节（映射而非编排，ADR-0015） | 工作流是流程意见不是设施；线性状态机强制所有变更走同一流程，与风险分级裁剪冲突。门禁保留为可组合的机械证据，顺序由团队按风险定 |
| Core 平台中立层 | CLI/状态/artifact 只依赖 Node+Git | **替换**：分发职责移交 teamai-cli（ADR-0018，9-agent 现成适配）；Core 的"最少依赖"原则保留（依赖仅 chalk/commander/fs-extra） | 自建 adapter 矩阵成本高；teamai 已是成熟实现。P0 组合幂等验证为闸门 |
| Adapter（CC reference + codex/opencode preview） | 各平台落地 commands/skills/hooks | **收缩再扩展**：自建 CC adapter（deny 编译器）保留 + teamai 承接多 agent 分发 | CC adapter 的 deny 语义编译（fail-closed/matcher 并集）是 teamai 没有的安全能力，保留；技能/MCP 分发是 teamai 强项，移交 |
| 9 个 stage skills 薄壳 | 各阶段触发 sdd-harness 公共 skill | **删除**：触发矩阵（任务类型→技能→产出）替代 | 薄壳=间接层无增量；矩阵直连任务与方法，维护面小 |
| Trinity 引擎（new/continue/apply/verify/archive） | OpenSpec 变更生命周期包装 | **删除**：直接用 OpenSpec 原生 opsx:* | 与上游重复；包装层漂移（曾发生 grill-with-docs 幽灵依赖） |
| workflow-frame.yaml / run 状态 | .sdd/runs/ 运行时状态 | **删除**：openspec/changes/ 工件 + lib audit 承载 | 双状态源易漂移；证据绑定（sha256）比自报状态可信 |
| 5 hooks 治理（stage 越界拦截等） | PreToolUse/SessionStart/Stop | **保留并强化**：hooks.yaml 单一策略源 + adapter 编译 + deny fail-closed + matcher 并集断言（共识评审 F-HOOKS-001 修复后） | 原方向正确；实现升级为策略即配置、装配级验证 |
| 9 gates + evidence（probe/test-output/sha256） | 阶段准入验证 | **保留并强化**：lib/ gate/audit 六件套 + 41 回归测试 | 机械证据是 AI DevOps 的信任根基（用户裁决：测试编写与验证必需） |
| knowledge-pack 组装 + sdd-context-mcp | 每阶段上下文包 | **删除**（stub 已清）；知识检索由知识层 v3 承接 | stub 依赖教训（诚实性原则）；recall（teamai）+ vault（obsidian-wiki）+ LLMWiki 分层覆盖 |
| LLMWiki 知识闭环 | raw→ingest→wiki + 沉淀 | **保留并升级**：成为知识层 v3 的 T1（策展层），闭环扩展为 生产面×消费面×桥（v3） | 方向正确但单层不够；v3 补分布式 vault/集中式 deepwiki/飞书桥 |
| understand-anything 代码图谱 | sdd graph 生成 knowledge-graph | **删除**（本地数据已清）；T2 由 teamwiki（AST 双轨）承接 | 单点工具+调度复杂；teamai import 内置且随分发层免费获得 |

**对齐结论**：原始架构的**三根支柱全部存活**——hooks 控制（强化）、gate 证据（强化）、LLMWiki 知识（升级为四层）；**被删除的都是编排与包装**（状态机、薄壳、Trinity、双状态源）。演化方向 = 从"规定怎么走"到"保证走得对"。

## 2. 全景架构图

### 2.1 演进映射图

```mermaid
flowchart LR
  subgraph ORIG["原始架构 SDD Harness v0.1（已归档）"]
    direction TB
    O1["9-stage 状态机<br/>(sdd run CLI 编排)"]
    O2["Core 平台中立层<br/>+ CC/Adapter"]
    O3["9 个 stage skills 薄壳<br/>+ Trinity 引擎"]
    O4["5 hooks 治理<br/>(stage 越界拦截)"]
    O5["9 gates + evidence<br/>(probe/test/sha256)"]
    O6["LLMWiki 知识闭环<br/>+ knowledge-pack"]
  end
  subgraph NOW["当前架构 Scaffold v0.2.x"]
    direction TB
    N1["交付参考视图：12 环节<br/>(映射而非编排)"]
    N2["teamai 分发层（P0 闸门）<br/>+ 自建 CC deny adapter"]
    N3["触发矩阵 + 5 方法论技能"]
    N4["hooks.yaml 策略源<br/>deny fail-closed + 装配验证"]
    N5["lib/ gate-audit 六件套<br/>41 回归测试"]
    N6["知识层 v3：四档 + 生产×消费×桥"]
  end
  O1 -->|"降维：环节保留,状态机删除"| N1
  O2 -->|"分发移交 teamai,deny 编译保留"| N2
  O3 -->|"删除:矩阵直连任务与方法"| N3
  O4 -->|"强化:策略即配置+断言"| N4
  O5 -->|"强化:证据链不可伪造"| N5
  O6 -->|"升级:单层→四层拓扑"| N6
```

### 2.2 目标架构总图（横切五层 + 两个引擎）

```mermaid
flowchart TB
  subgraph DELIVERY["交付生命周期（参考视图,不编排）"]
    LIFECYCLE["12 环节 × 6 角色 × 风险裁剪<br/>见 ai-devops-architecture.md"]
  end
  subgraph L5["约定层"]
    AGENTS["AGENTS.md 单一规则入口<br/>CLAUDE.md 软链兼容"]
  end
  subgraph L4["协作层"]
    MATRIX["触发矩阵 docs/agent/<br/>任务→技能→必须产出"]
  end
  subgraph L3["技能层 .agents/skills/"]
    S1["grill-me+grilling 质询"]
    S2["whitebox-verify 三模式验证"]
    S3["parallel-tdd-planner 计划"]
    S4["consensus-review 全票评审"]
  end
  subgraph L2["控制平面"]
    HOOKS["hooks.yaml 策略源"] --> ADPTR["CC adapter 编译器"]
    ADPTR --> GATE["pre-tool-gate deny fail-closed"]
    ADPTR --> SETTINGS["settings.json + .compiled.env"]
  end
  subgraph L1["验证层"]
    GATES["lib/ gate-audit 六件套<br/>generation/test-gate/probe/<br/>deliverable/evidence/workflow"]
    CHECK["check.sh 总门 + CI"]
  end
  subgraph DIST["分发层（teamai, P0 闸门）"]
    TEAMAI["teamai-cli@pin<br/>9-agent hooks/MCP/skills reconcile"]
  end
  subgraph KNOW["知识层 v3"]
    direction LR
    KP["生产面(分布式): T0 docs / T1 LLMWiki /<br/>T2 teamwiki / T3 vault"]
    KC["消费面(集中): deepwiki(只读再生) / 飞书"]
    KB["桥: lark-cli 服务层<br/>抽取 raw/ + 评审后对齐"]
    KP <-->|"promotion 单向晋升"| KB <--> KC
  end
  LIFECYCLE --> MATRIX
  MATRIX --> L3
  L3 -->|调用| GATES
  AGENTS --> MATRIX
  HOOKS -.运行时拦截.-> L3
  CHECK -->|提交门| GATES
  TEAMAI -->|pull 分发| L3
  TEAMAI -->|pull 分发| L2
  KP -.recall 上下文.-> MATRIX
```

### 2.3 交付生命周期图（12 环节 + 门禁 + 人闸）

```mermaid
flowchart TB
  I["1 需求澄清<br/>grill-me + 知识 recall"] --> P["2 产品定义<br/>PRD/AC 质询"]
  P --> A["3 架构设计<br/>consensus 全票门"]
  A --> C["4 变更提案<br/>openspec change"]
  C --> PL["5 任务分解<br/>planner DAG+CONFIRM"]
  PL --> CO["6 实现 TDD<br/>hooks 边界拦截"]
  CO --> R["7 评审<br/>三方 consensus + 行级"]
  R --> V["8 测试验证<br/>Journey 终态 oracle"]
  V --> CI["9 集成 CI<br/>check.sh 全绿"]
  CI --> CD["10 发布 CD<br/>回滚路径+证据绑定"]
  CD --> AR["11 归档沉淀<br/>spec→wiki 晋升"]
  AR --> KS["12 知识对齐<br/>lark 桥(评审产物)"]
  KS -.回路.-> I
  G1["✅generation-gate 用例完整性"] -.门.-> CO
  G2["✅test-gate sha256 证据"] -.门.-> CO
  G3["✅evidence-audit 声明-磁盘一致"] -.门.-> R
  G4["✅probe 证据契约"] -.门.-> V
  G5["✅workflow-audit 状态-证据绑定"] -.门.-> CD
  H1["👤 范围拍板"] -.人闸.-> I
  H2["👤 不可逆决策批准"] -.人闸.-> A
  H3["👤 计划确认"] -.人闸.-> PL
  H4["👤 拒绝/放行"] -.人闸.-> R
  H5["👤 发布批准"] -.人闸.-> CD
  style G1 fill:#e8f5e9
  style G2 fill:#e8f5e9
  style G3 fill:#e8f5e9
  style G4 fill:#e8f5e9
  style G5 fill:#e8f5e9
```

### 2.4 知识层拓扑图（v3）

```mermaid
flowchart LR
  subgraph HUMAN["人（团队）"]
    FEISHU["飞书<br/>文档/妙记纪要/群聊决策"]
    PEOPLE["成员（人读为主）"]
  end
  subgraph REPO["repo（分布式生产面, Git 权威源）"]
    RAW["wiki-raw/ 原始输入"]
    T0["T0 docs/+ADR"]
    T1["T1 LLMWiki 策展"]
    T2["T2 teamwiki AST 图谱"]
    T3["T3 vault obsidian-wiki"]
    SPEC["openspec/ spec 工件层<br/>(独立于知识层)"]
  end
  subgraph CENTRAL["集中消费面（只读,非权威）"]
    DW["deepwiki-open 服务<br/>wiki 再生 + RAG chat"]
    FHKB["飞书知识库<br/>对齐页"]
  end
  FEISHU -->|"lark-cli 服务层抽取<br/>provenance 指回"| RAW
  RAW -->|"obsidian-wiki ingest<br/>提炼 compile"| T3
  T1 -->|"≥2 项目引用→PR 晋升<br/>promoted_from"| T3
  SPEC -->|"archive 时长期结论<br/>单向提炼"| T1
  T3 -->|"精华经 PR 评审<br/>对齐(未评审不推)"| FHKB
  REPO -->|"git 只读,可再生"| DW
  DW --> PEOPLE
  FHKB --> PEOPLE
  T1 -->|MCP 检索| AGENTQ["coding agent"]
  T2 -->|recall| AGENTQ
  T3 -->|CLI 检索| AGENTQ
  style SPEC fill:#fff3e0
  style DW fill:#e3f2fd
  style FHKB fill:#e3f2fd
```

### 2.5 证据链时序（一次变更的信任流）

```mermaid
sequenceDiagram
  participant Dev as 研发(agent)
  participant Hook as hooks 控制平面
  participant Gate as lib/ 验证层
  participant CI as check+CI
  participant Art as openspec 工件
  Dev->>Hook: 写代码/跑命令
  Hook-->>Dev: 越界/danger 即拦(exit2 fail-closed)
  Dev->>Gate: generation-capture(前清单)
  Dev->>Gate: TDD 生成测试
  Gate->>Gate: generation-evaluate 用例完整性
  Dev->>Gate: test-gate 跑测试
  Gate-->>Art: sha256 绑定证据(output+report)
  Dev->>Gate: probe 运行时证据
  Gate->>Gate: probe 契约校验(debug泄漏/布局/状态迁移)
  Dev->>Art: evidence 声明(progress/review)
  Gate->>Gate: evidence-audit 声明↔磁盘↔命令输出
  Dev->>CI: 提交
  CI->>Gate: check.sh 全量门
  CI->>Gate: workflow-audit 状态↔证据绑定
  CI-->>Dev: 全绿=可合并(证据可机械复核)
```

## 3. 图集索引

| 图 | 用途 |
|----|------|
| 2.1 演进映射 | 对齐原始/当前，回答"为什么这样演化" |
| 2.2 目标总图 | 新人入门总览；分层 + 双引擎（分发/知识）关系 |
| 2.3 生命周期 | 团队裁剪流程的参照（门禁/人闸标注） |
| 2.4 知识拓扑 | 知识流向与权威源边界（写操作必经 PR/raw） |
| 2.5 证据时序 | 验证层如何构成不可伪造的信任链 |
