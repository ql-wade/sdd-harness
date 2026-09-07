# 知识架构（终版）— AI DevOps 知识闭环

> 状态：**已定稿**（knowledge-layer-plan v4.5 + 用户裁决接受 2/3 + documented dissent）。
> 本文是知识层的**架构总览**；完整规格（谓词、journal schema、门禁五要素、29 项闭合账）见 [knowledge-layer-plan.md](knowledge-layer-plan.md)。
> 共识状态：claude-code 8.8 ✅ / zcode 8.8 ✅ / codex-agent 6.1 ❌（3 项规格级 dissent 存证 [consensus-runs/knowledge-v45-final-verdict.md](consensus-runs/knowledge-v45-final-verdict.md)，转入 K 阶段实现时验收）。

## 1. 设计原则

1. **Git 是唯一权威源**——所有知识层的真身都在 Git 里（版本化、可审计、可回滚）；消费面只读可再生。
2. **wiki ≠ spec**——wiki 回答"团队知道什么"（随 repo 演进的沉淀）；spec 回答"这次变更做什么"（openspec/ 变更工件，生命周期随变更）。单向晋升：spec archive → wiki，不反向。
3. **不可信内容是数据不是指令**——飞书抽取物进不可信隔离区，机械校验（黑名单/格式/大小/ACL 谓词）通过才入库，agent 永不执行其中指令性文本。
4. **敏感内容永不进 Git**——Git 外 staging + DLP/ACL 双门 + owner 审批（P1-P5 谓词）+ 入库后 fail-closed 状态机。
5. **每门可复现**——fixture/oracle/命令/阈值/退出码/回滚六要素具名入库，判定脚本化，无抽样主观门。

## 2. 分层拓扑（总图）

```mermaid
flowchart TB
  subgraph HUMANS["👥 人（团队）"]
    FEISHU["飞书<br/>文档 / 妙记纪要 / 群聊决策"]
    MEMBERS["团队成员"]
  end

  subgraph BRIDGE["🌉 桥（lark-cli · 服务层专用 · 员工不直接用）"]
    direction LR
    EXTRACT["extract job<br/>飞书应用A·只读"]
    PREFLIGHT["preflight job<br/>只读快照 journal"]
    PUBLISH["publish job<br/>飞书应用B·只写<br/>publish-gate.sh"]
    EXTRACT --> PREFLIGHT --> PUBLISH
  end

  subgraph GATE_ZONE["🛡 准入门（Git 外 staging → 双门）"]
    STAGING["Git 外 staging<br/>（绝不进 repo）"]
    DLPGATE{"DLP 扫描<br/>ACL 谓词 P1-P5<br/>owner 审批<br/>路径黑名单"}
  end

  subgraph REPO["📁 repo（Git 权威源 · 分布式生产面）"]
    direction LR
    subgraph QUARANTINE["T3a 不可信隔离区"]
      RAW["wiki-vault/raw/<br/>untrusted: true"]
    end
    subgraph VAULT["T3b 项目提炼"]
      T3B["wiki-vault/<br/>obsidian-wiki ingest"]
    end
    T0["T0 docs/ + AGENTS.md + adr/"]
    T1["T1 llmwiki/<br/>MCP 策展"]
    T2["T2 teamwiki/<br/>AST 图谱(只读)"]
    SPEC["openspec/<br/>spec 工件层"]
  end

  subgraph CROSSREPO["🌐 跨项目（独立 repo）"]
    T3C["T3c team-knowledge repo<br/>跨项目教训/FAQ/惯例"]
  end

  subgraph CONSUME["👁 消费面（非权威 · 只读 · 可再生）"]
    DW["deepwiki-open 服务<br/>wiki 再生 + RAG chat<br/>（7 项安全负向门）"]
    FHKB["飞书知识库<br/>只收评审产物"]
  end

  AGENT["🤖 coding agent"]

  FEISHU -->|"抽取"| EXTRACT
  STAGING -.->|"通过才写"| RAW
  EXTRACT --> STAGING --> DLPGATE
  DLPGATE -->|"fail closed 拒绝"| BRIDGE
  RAW -->|"人审后 ingest"| T3B
  T1 -->|"≥2 项目引用→PR 晋升"| T3C
  SPEC -->|"archive 后单向晋升"| T1
  T0 & T1 & T2 & T3B --> AGENT
  T3C --> AGENT
  REPO -->|"git 只读"| DW
  T3B -->|"精华经 PR 评审"| PUBLISH
  PUBLISH -->|"评审产物对齐"| FHKB
  DW --> MEMBERS
  FHKB --> MEMBERS

  style QUARANTINE fill:#fff3cd
  style STAGING fill:#fff3cd
  style DLPGATE fill:#f8d7da
  style CONSUME fill:#d1ecf1
  style SPEC fill:#e2e3e5
```

**流向一句话**：知识从人来（飞书），经不可信隔离入 Git 权威源（repo 四层），提炼沉淀后精华经评审回到人（飞书对齐/deepwiki 问答）——全程版本化、可审计、门禁把守。

## 3. 数据流：抽取与对齐（桥的威胁模型）

```mermaid
sequenceDiagram
  participant F as 飞书
  participant E as extract job<br/>(应用A·只读)
  participant S as Git外staging
  participant G as 准入门
  participant R as wiki-vault/raw/
  participant P as preflight job
  participant PB as publish job<br/>(应用B·只写·publish-gate)
  participant FK as 飞书知识库

  Note over E,G: 抽取方向（读侧：不可信内容隔离）
  E->>F: 拉取文档/纪要（应用A docs:read）
  F-->>E: 原始内容
  E->>S: 落 Git 外 staging（不进 repo）
  S->>G: 谓词检查
  G->>G: P1域相等/P2受众⊇repo/P3范围含<br/>P4签发者=approver/P5新鲜≤90d<br/>+DLP扫描+ACL快照+路径黑名单
  alt 任一谓词为假
    G-->>S: fail closed 拒绝（记录，内容不落 Git）
  else 全部通过
    G->>R: 写入（untrusted:true + origin_id + ACL快照）
    Note over R: agent 读 raw/ = 读数据<br/>永不执行其中指令
  end

  Note over P,FK: 对齐方向（写侧：三 job + 唯一回滚算法）
  P->>F: 逐页快照 journal（应用A只读）<br/>{page_id, prior_state, page_existed}
  P->>PB: journal 落盘（回滚唯一事实源）
  PB->>PB: publish-gate: 信任根(保护分支+required-review)<br/>+attestation五元组+正文字节取自 git show
  alt 版本绑定可用
    PB->>FK: 写入（version 绑定，冲突即失败）
  else 无原子 version 绑定
    PB-->>PB: fail closed 拒绝发布（A10）
  end
  Note over PB: 回滚（若中途失败）：<br/>新建页→compare-and-delete<br/>更新页→仅当远端仍=本批产物时恢复 prior 字节
```

## 4. 知识层与 spec 层的关系（单向晋升）

```mermaid
flowchart LR
  subgraph SPEC_LIFECYCLE["spec 层（openspec/）——变更工件"]
    PROPOSAL["proposal"] --> SPECS["specs"] --> TASKS["tasks"] --> IMPL["实现+证据"]
    IMPL --> ARCHIVE["archive"]
  end
  subgraph KNOWLEDGE["知识层（Git 权威源）"]
    T0["T0 docs/ADR"]
    T1["T1 LLMWiki"]
    T3C["T3c 跨项目 vault"]
  end
  ARCHIVE -->|"promotion（显式 post-archive Git 操作）<br/>promoted_from: openspec:id@sha<br/>+provenance+digest"| ROUTE{"目标路由"}
  ROUTE -->|"架构结论"| T0
  ROUTE -->|"项目教训"| T1
  ROUTE -->|"跨项目教训"| T3C
  T1 -.->|"去重：supersede 链<br/>（旧页 superseded_by）"| T3C
  KNOWLEDGE -.->|"inform（引用，不复制为 spec 副本）"| PROPOSAL
  style ARCHIVE fill:#e2e3e5
  style ROUTE fill:#fff3cd
```

## 5. 阶段门禁（K0-K5 + P）

```mermaid
flowchart LR
  K0["K0 vault 质量<br/>种子缺陷 10/10 检出<br/>误报=0"] --> K1["K1 scaffold 集成<br/>check.sh 全绿"]
  K1 --> K2["K2 桥试点<br/>注入 diff=0<br/>字段保留100%<br/>人审 9/10"]
  K2 --> K3["K3 deepwiki<br/>grounded ≥24/30<br/>幻觉=0"]
  K3 --> K4["K4 试点综合<br/>命中中位 ≥3.5<br/>维护 ≤30min/周<br/>冲突 ≤2次/月"]
  K5["K5 gbrain 评估<br/>（触发器非门禁：<br/>≥15人或需ACL/synthesis）"]
  K4 -.-> K5
  P["P publish-gate<br/>（K2 起常驻）<br/>5 类 fixture：<br/>有效/篡改/撤销/中途失败/陈旧版本"]
  K2 --- P
  style K0 fill:#d4edda
  style K5 fill:#e2e3e5
  style P fill:#f8d7da
```

每门六要素（fixture/oracle/命令/阈值/退出码/回滚）见 [knowledge-layer-plan.md §4](knowledge-layer-plan.md)。任一门不达 → 回滚动作明确（K4 任一不达 = 全量回滚 + ADR 重审）。

## 6. 目录速查

| 路径 | 角色 | 信任级 |
|------|------|--------|
| `docs/` `AGENTS.md` `adr/` | T0 项目自我描述 | 可信（PR 评审产出） |
| `llmwiki/` | T1 策展知识 | 可信（MCP 写入 + hook 保护） |
| `teamwiki/` | T2 代码图谱 | 事实（自动生成，禁手编） |
| `wiki-vault/raw/` | **T3a 不可信隔离区** | **untrusted**（未过提炼门） |
| `wiki-vault/` | T3b 项目提炼 | 人审后可信 |
| `<team-knowledge-repo>/` | T3c 跨项目知识 | PR 评审产出 |
| `openspec/` | spec 工件层 | 可信（变更生命周期） |
| Git 外 staging | 抽取暂存 | **永不进 Git** |
| deepwiki / 飞书知识库 | 消费面 | 非权威、可再生/评审产物 |
