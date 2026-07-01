# LLMWiki 结构规范

> SDD Harness 的 LLMWiki 知识库标准结构。遵循 Karpathy LLM Wiki 标准范式 + Google Open Knowledge Format (OKF) v0.1。
> 适用实现：`lucasastorian/llmwiki` MCP、Obsidian vault、或任何 OKF-compatible markdown wiki。

## 1. 概述

LLMWiki 是 SDD Harness 的持久化知识中枢，承担**三大流程**（产品 / 研发 / 测试）的文档存储与**需求→规格→代码→测试**的 traceability 关联。它同时服务 **AI agent**（结构化 frontmatter 精准聚焦）和**人类**（index 层级导航 + backlink 浏览）。

### 规范依据

| 规范 | 版本 | 来源 |
|------|------|------|
| Karpathy LLM Wiki | — | <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f> |
| Open Knowledge Format (OKF) | v0.1 | <https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md> |
| SwarmVault（社区参考实现） | — | <https://github.com/swarmclawai/swarmvault> |

### 与 SDD Harness 的关系

LLMWiki 与 OpenSpec 分工：**spec 全文归 OpenSpec**（可执行验证、进 git），LLMWiki 做**知识视角**（设计/ADR/边界/用例/报告/术语等，以 backlink 引用 OpenSpec spec，不重复存全文）。

## 2. 标准三层架构（Karpathy 范式）

```text
llmwiki/                    ← OKF bundle 根
├── raw/                    ← ① 不可变源文档（human curated，agent 只读）
│   └── *.md, *.pdf, ...   # README、架构文档、已有 wiki、会议纪要、外部文章
│
├── wiki/                   ← ② agent 维护的知识（LLM 完全拥有此层，human 审阅）
│   ├── index.md            # 全局页目录（每页一行：链接 + 摘要 + 元数据）
│   ├── log.md              # 操作日志（ingest / query / lint，按时间 append）
│   │
│   ├── sources/            # [标准分类] 每个 raw source 的摘要页 + 关键提取
│   ├── concepts/           # [标准分类] 跨流程概念页（术语深层解释、架构模式、设计原则）
│   ├── entities/           # [标准分类] 命名实体（人、系统、外部服务、工具）
│   ├── outputs/            # [标准分类] 查询/分析结果归档
│   │
│   ├── product/            # [SDD 扩展] 产品流程知识
│   ├── engineering/        # [SDD 扩展] 研发流程知识（按 domain 组织）
│   ├── testing/            # [SDD 扩展] 测试流程知识
│   └── _shared/            # [SDD 扩展] 横切关联（glossary / traceability / runbooks / releases）
│
└── _schema.md              ← ③ 维护契约（wiki 结构约定 + ingest/query/lint workflow）
```

**三层职责**：

| 层 | 谁拥有 | 谁写入 | 谁读取 | 进 git？ |
|----|--------|--------|--------|---------|
| `raw/` | human | human（拖入源文档） | agent（只读） | 否（可选，大文件/敏感文档不进） |
| `wiki/` | agent | agent（ingest/query/lint 自动维护） | agent + human | 是（知识沉淀要进 git） |
| `_schema.md` | human + agent 共同 | human 初始 + agent 建议修订 | agent（每次操作前读） | 是 |

## 3. 完整目录结构

```text
llmwiki/                              ← OKF bundle 根
├── index.md                          # bundle 根 index（human entry）
├── log.md                            # bundle 根 log（chronological）
│
├── raw/                              # ① 不可变源文档
│   └── ...                           # 各种源文件（md / pdf / 图片）
│
├── wiki/                             # ② agent 维护的知识
│   ├── index.md                      # 全局页目录
│   ├── log.md                        # 操作日志
│   │
│   ├── sources/                      # [标准] raw source 摘要
│   │   ├── _index.md                 # 按 source 名称索引
│   │   └── <source>.md               # 每篇源文档一个摘要页
│   │
│   ├── concepts/                     # [标准] 跨流程概念
│   │   ├── _index.md                 # 按概念分类索引
│   │   └── <concept>.md              # 每篇一个概念（如"事件溯源""幂等性""CQRS"）
│   │
│   ├── entities/                     # [标准] 命名实体
│   │   ├── _index.md                 # 按类型索引（人 / 系统 / 服务 / 工具）
│   │   └── <entity>.md               # 每篇一个实体（如"支付网关""用户服务""消息队列"）
│   │
│   ├── outputs/                      # [标准] 查询/分析归档
│   │   ├── _index.md
│   │   └── <date>-<topic>.md         # 好的 query 回答回落成页
│   │
│   ├── product/                      # [SDD] 产品流程
│   │   ├── _index.md                 # 产品知识目录（按 status / priority 过滤）
│   │   ├── _overview.md              # 产品工作流总览
│   │   ├── requirements/             # 需求文档（REQ-<slug>）
│   │   │   ├── _index.md
│   │   │   └── REQ-*.md
│   │   ├── acceptance-criteria/      # 验收标准（AC-<slug>）
│   │   │   ├── _index.md
│   │   │   └── AC-*.md
│   │   ├── user-stories/             # 用户故事（US-<slug>）
│   │   │   ├── _index.md
│   │   │   └── US-*.md
│   │   ├── prototypes/               # 原型描述
│   │   │   └── _index.md
│   │   ├── market-research/          # 市场调研 / 竞品分析
│   │   │   └── _index.md
│   │   └── decisions/                # 产品决策（PD-<n>）
│   │       └── _index.md
│   │
│   ├── engineering/                  # [SDD] 研发流程：按 domain 组织
│   │   ├── _index.md                 # 全部 domain 目录
│   │   ├── _overview.md              # 系统架构总览
│   │   └── <domain>/                 # 每个 domain 一个目录（对齐 openspec/specs/<domain>/）
│   │       ├── _index.md             # 本 domain 目录
│   │       ├── _overview.md           # ★ agent 核心入口
│   │       ├── designs/              # 架构设计文档
│   │       │   └── _index.md
│   │       ├── adr/                  # 架构决策记录（ADR-<n>）
│   │       │   └── _index.md
│   │       ├── boundaries/           # 接口契约、模块边界
│   │       │   └── _index.md
│   │       ├── apis/                 # API 契约 / 规格
│   │       │   └── _index.md
│   │       ├── code-notes/           # 代码层知识（patterns、坑、migration）
│   │       │   └── _index.md
│   │       └── data/                 # 数据模型 / schema（可选）
│   │           └── _index.md
│   │
│   ├── testing/                      # [SDD] 测试流程
│   │   ├── _index.md                 # 测试知识目录
│   │   ├── _overview.md              # 测试策略总览
│   │   ├── cases/                    # 测试用例（TC-<slug>）
│   │   │   ├── _index.md
│   │   │   └── TC-*.md
│   │   ├── suites/                   # 测试套件（TS-<slug>）
│   │   │   ├── _index.md
│   │   │   └── TS-*.md
│   │   ├── matrices/                 # 测试矩阵（feature × test type）
│   │   │   └── _index.md
│   │   ├── plans/                    # 测试计划
│   │   │   └── _index.md
│   │   ├── reports/                  # 测试报告摘要（CI 链接 + 关键指标）
│   │   │   ├── _index.md
│   │   │   └── log.md                # 按时间 append 的报告条目
│   │   └── regression/               # 回归风险、flaky 候选
│   │       └── _index.md
│   │
│   └── _shared/                      # [SDD] 横切关联
│       ├── _index.md
│       ├── glossary/                 # 术语表（每术语一个 concept）
│       │   ├── _index.md
│       │   └── term-*.md
│       ├── traceability/             # 需求↔spec↔代码↔测试 追溯矩阵
│       │   └── _index.md
│       ├── runbooks/                 # 运维 runbook
│       │   └── _index.md
│       └── releases/                 # 发布记录
│           └── _index.md
│
└── _schema.md                        # ③ 维护契约
```

## 4. 三个标准操作（Karpathy）

| 操作 | 触发条件 | agent 执行步骤 | 产出 |
|------|---------|---------------|------|
| **Ingest** | 新 source 放入 `raw/`；init 首轮注入 | ① 读 source → ② 与 human 讨论关键 takeaway → ③ 写 `wiki/sources/<source>.md` 摘要页 → ④ 更新受影响的 `concepts/` / `entities/` + 三大流程页 → ⑤ 更新各级 `_index.md` → ⑥ 追加 `wiki/log.md`（格式：`## [YYYY-MM-DD] ingest | <source>`） | `sources/` + 更新各层页 + index + log |
| **Query** | 用户或 stage skill 的 agent 提问 | ① 读 `wiki/index.md` 定位相关页 → ② 读详情页合成答案（带 citation，引用 source 文件名） → ③ 若答案有价值，归档到 `wiki/outputs/<date>-<topic>.md`，更新 `_index.md` | 答案 + 可选 `outputs/` 新页 |
| **Lint** | 定期运行（`sdd wiki lint`）；或 ingest 达到阈值后 | ① 检查页面间矛盾（contradiction flag） → ② 检查过时声明（source 已更新但页未同步） → ③ 查孤立页（无 inbound backlink） → ④ 查重要概念缺少页面 → ⑤ 查缺失 cross-reference → ⑥ 建议可补充的 source（如 web search 方向） | lint 报告（写入 `wiki/log.md`），建议修复 |

> **重要**：lint 所有发现均为 **candidate issues for human review**，不做自动修改。lint 依赖 LLM 的语义理解，存在误报和漏报，不可作为 definitive error detection。

## 5. 标准分类说明

| 目录 | 来源 | 内容 | 典型文件 |
|------|------|------|---------|
| `sources/` | Karpathy 标准 | 每个 `raw/` 中的源文档对应一个摘要页。页面包含：关键声明、涉及的概念/实体、与已有知识的一致/冲突标记 | `wiki/sources/architecture-overview.md` |
| `concepts/` | Karpathy 标准 | 跨流程、跨 domain 的概念深层解释（如"认证流程""事件溯源""CQRS""幂等性"）。聚合多 source 的声明，追踪理解演进。**写入规则**：概念有独立知识生命周期 + 跨 domain 价值才放此；仅本 change 上下文有价值的内容放对应流程目录 | `wiki/concepts/event-sourcing.md` |
| `entities/` | Karpathy 标准 | 命名的外部/系统实体。每页记录实体的定义、属性、出现于哪些 source、与其他实体的关系 | `wiki/entities/payment-gateway.md` |
| `outputs/` | Karpathy 标准 | 有价值的 query/分析结果归档。避免好的分析消失在 chat history 里 | `wiki/outputs/2026-06-26-auth-flow-comparison.md` |
| `product/` | SDD 扩展 | 产品流程的全部知识：需求 / AC / 故事 / 原型 / 竞品 / 产品决策 | 见 §6 |
| `engineering/` | SDD 扩展 | 研发流程的全部知识：按 domain 组织，每 domain 含 design / ADR / 边界 / API / code-notes | 见 §6 |
| `testing/` | SDD 扩展 | 测试流程的全部知识：用例 / 套件 / 矩阵 / 计划 / 报告 / 回归 | 见 §6 |
| `_shared/` | SDD 扩展 | 跨三大流程的共享区。**边界**：`_shared/glossary/` = 简短术语定义 + 来源引用；`_shared/traceability/` = backlink 自动派生的追溯矩阵（纯自动，agent 不手写）。**与 `concepts/` 的区分**：`concepts/` 有独立知识生命周期、跨 domain 的深层解释；`_shared/glossary/` 是简短定义。agent 写入时自问："这个概念脱离了本 change 还有价值吗？"有 = `concepts/`，无 = 各自流程目录 | 见 §6 |

## 6. SDD 三大流程扩展

### 6.1 product/ —— 产品流程

| 子目录 | ID 格式 | frontmatter 必填 |
|--------|---------|-----------------|
| `requirements/` | `REQ-<slug>` | `type: requirement`, `status`, `priority`, `related-specs`, `owner` |
| `acceptance-criteria/` | `AC-<slug>` | `type: acceptance-criteria`, `requirement`（backlink → REQ）, `status`, `related-specs` |
| `user-stories/` | `US-<slug>` | `type: user-story`, `persona`, `requirement`（backlink → REQ）, `priority` |
| `decisions/` | `PD-<n>` | `type: product-decision`, `status`, `related-requirements` |

### 6.2 engineering/ —— 研发流程（按 domain 组织）

**为什么按 domain**：agent 进 `engineering/<domain>/_overview.md` 读完 frontmatter 就知道此 domain 的职责、spec 在哪、代码在哪、依赖谁。不用跨 `designs/` `adr/` `boundaries/` 三个平铺目录分别搜。

每个 `<domain>/` 子目录：

| 子目录 | 内容 | frontmatter 必填 |
|--------|------|-----------------|
| `_overview.md` | domain 职责、关键决策（backlink → ADR）、依赖与被依赖关系、spec backlink、code roots、key APIs | `domain`, `spec`, `code_roots`, `depends_on`, `depended_by`, `key_adrs`, `status` |
| `designs/` | 架构设计文档 | `domain`, `type: design`, `status`, `related-adrs` |
| `adr/` | 架构决策记录（`ADR-<n>`，与 `docs/adr/` 可互为镜像） | `type: adr`, `status`, `domain`, `supersedes`, `superseded_by` |
| `boundaries/` | 模块边界、接口契约、对外承诺 | `domain`, `type: boundary`, `contract_with`（依赖的 domain）, `stability` |
| `apis/` | API 契约/规格（REST/GraphQL/gRPC 接口描述） | `domain`, `type: api`, `protocol`, `version`, `stability` |
| `code-notes/` | 代码层知识（patterns、已知坑、migration 记录、重构笔记） | `domain`, `type: code-note`, `code_refs`, `status` |
| `data/` | 数据模型/Schema（ER 图描述、表结构、迁移记录） | `domain`, `type: data-model`, `storage`, `schema_version` |

### 6.3 testing/ —— 测试流程

| 子目录 | ID 格式 | frontmatter 必填 |
|--------|---------|-----------------|
| `cases/` | `TC-<slug>` | `type: test-case`, `spec`, `requirement`, `code`, `suite`, `status`, `priority`, `last_result`, `last_run`, `tags` |
| `suites/` | `TS-<slug>` | `type: test-suite`, `cases[]`, `coverage-area`, `status` |
| `matrices/` | — | `type: test-matrix`, `feature`, `test-types`, `coverage-gaps` |
| `plans/` | — | `type: test-plan`, `scope`, `schedule`, `environment` |
| `reports/log.md` | — | 每条：`## [YYYY-MM-DD] run | <change-id> | pass/fail/skip | CI-link` |
| `regression/` | — | `type: regression-risk`, `related-cases`, `flaky-score`, `last-occurrence` |

### 6.4 _shared/ —— 横切关联

| 子目录 | 内容 |
|--------|------|
| `glossary/` | 术语表（每术语一个 `term-*.md`），frontmatter：`type: glossary-term`, `domain`, `related-terms`, `status`, `source`（首次定义出处的引用） |
| `traceability/` | 需求×spec×代码×测试 的追溯矩阵，由 backlink 自动派生；`/sdd:verify` 用它查 coverage gap |
| `runbooks/` | 运维操作手册 |
| `releases/` | 发布记录（changelog、release note），每条 frontmatter：`type: release`, `version`, `date`, `change-ids` |

## 7. `_overview.md` 约定

每个目录层（product / engineering / engineering 的各 domain / testing）应有一个 `_overview.md`。这是 agent 进入该层的**快速聚焦入口**。

### 示例：`wiki/engineering/auth/_overview.md`

```yaml
domain: auth
type: overview
spec: SPEC-auth
code_roots:
  - src/auth/
  - src/middleware/auth.ts
depends_on: [user]
depended_by: [payment, order]
key_adrs: [ADR-0003, ADR-0010]
key_apis:
  - POST /auth/login
  - GET /auth/session
  - POST /auth/refresh
status: active
last_updated: 2026-06-26
```

agent 读完 frontmatter 即知：职责边界、对应 spec（OpenSpec backlink）、代码在哪、上游依赖谁、下游被谁依赖、关键决策——**不用满库搜**。

### 示例：`wiki/testing/_overview.md`

```yaml
type: overview
area: testing
coverage_target: 80%
test_environments: [dev, staging]
ci_pipeline: https://ci.example.com/project/123
frameworks: [vitest, junit, playwright]
last_full_run: 2026-06-25
```

## 8. 测试用例标准格式（OKF concept）

```yaml
# wiki/testing/cases/TC-login-success.md
type: test-case
id: TC-login-success
title: "登录成功 —— 有效凭据"
spec: SPEC-auth
requirement: REQ-user-auth
ac: AC-login-flow
code: src/auth/login.ts
suite: TS-auth
status: active
priority: P0
tags: [auth, login, smoke, happy-path]
precondition: "用户已在系统注册，账号未锁定"
steps:
  - "POST /auth/login with valid credentials"
  - "期望 200 + session token"
last_result: pass
last_run: 2026-06-26
last_ci: https://ci.example.com/run/456#TC-login-success
```

## 9. `_schema.md` 约定

`_schema.md` 是 agent 维护 wiki 的"操作手册"。agent 每次操作 wiki 前先读此文件。

**必含内容**：

1. **目录结构约定**：wiki 下每个目录的用途、可包含的页面类型
2. **frontmatter 规范**：每种 `type` 的必填/可选字段
3. **命名规范**：ID 格式、文件名 slug 规则、链接格式（`[[path/to/page|Display Text]]`）
4. **Ingest workflow**：step-by-step 指令
5. **Query workflow**：step-by-step 指令（含 citation 格式）
6. **Lint workflow**：检查项清单 + 修复指引
7. **页面模板**：每种 type 的 body 结构（标题层级、必含 section）
8. **链接与引用规范**：何时用 `[[wikilink]]`、何时用 backlink、引用 OpenSpec 的格式
9. **Contradiction 处理**：发现冲突时标记 `contradiction:` frontmatter + 写入 `concepts/` 说明
10. **Git 约定**：`wiki/` 进 git、`raw/` 可选不进

## 10. 关联机制（traceability 链）

通过 frontmatter 字段 + 双向链接 `[[REQ-*]]` / `[[TC-*]]` / `[[SPEC-*]]`，形成完整的追溯链：

```text
REQ-user-auth（产品需求）
  → AC-login-flow（AC，frontmatter: requirement: REQ-user-auth）
    → SPEC-auth（OpenSpec 规格，frontmatter: ac: AC-login-flow）
      → TC-login-success（测试用例，frontmatter: spec: SPEC-auth, code: src/auth/login.ts）
        → 测试报告 log 条目（case: TC-login-success, result: pass, CI link）
```

**实现方式**：

- **frontmatter 字段**：每篇文档 frontmatter 标 `requirement` / `ac` / `spec` / `code` / `case` / `suite` 等字段，值为对方 ID
- **双向链接**：`[[REQ-user-auth]]`、`[[TC-login-success]]`，LLMWiki/Obsidian 的 backlink 自动生成反向追溯
- **`_shared/traceability/_index.md`**：汇总需求×spec×代码×测试 的追溯矩阵，由 backlink 自动派生
- **`/sdd:verify` 用此矩阵查 coverage gap**

## 11. ID 体系

| 类型 | 格式 | 示例 | 对应目录 |
|------|------|------|---------|
| 需求 | `REQ-<slug>` | `REQ-user-auth` | `wiki/product/requirements/` |
| 验收标准 | `AC-<slug>` | `AC-login-flow` | `wiki/product/acceptance-criteria/` |
| 用户故事 | `US-<slug>` | `US-mobile-login` | `wiki/product/user-stories/` |
| 产品决策 | `PD-<n>` | `PD-001` | `wiki/product/decisions/` |
| 规格 | `SPEC-<slug>` | `SPEC-auth` | `openspec/specs/<domain>/`（OpenSpec 域，LLMWiki 做 backlink） |
| 架构决策 | `ADR-<n>` | `ADR-0010` | `wiki/engineering/<domain>/adr/` + `docs/adr/`（双向镜像） |
| 测试用例 | `TC-<slug>` | `TC-login-success` | `wiki/testing/cases/` |
| 测试套件 | `TS-<slug>` | `TS-auth` | `wiki/testing/suites/` |
| 概念 | `<slug>` | `event-sourcing` | `wiki/concepts/` |
| 实体 | `<slug>` | `payment-gateway` | `wiki/entities/` |
| 术语 | `term-<slug>` | `term-idempotency` | `wiki/_shared/glossary/` |

**命名规则**：

- slug 使用 kebab-case（全小写，连字符分隔）
- ID 前缀大写（REQ/AC/US/PD/SPEC/ADR/TC/TS）
- ADR 编号为全局递增数字，跨 domain 不冲突
- TC/TS 的 slug 应体现测试意图（`TC-login-success` 而非 `TC-001`）

## 12. frontmatter 字段参考（YAML）

### 所有页面必填

```yaml
type: <page-type>       # 对应目录分类：requirement / acceptance-criteria / user-story / overview / design / adr / boundary / api / code-note / data-model / test-case / test-suite / test-matrix / test-plan / test-report / regression-risk / concept / entity / glossary-term / source-summary / output
status: active | draft | superseded | deprecated
last_updated: YYYY-MM-DD
tags: []
```

### 按 type 的额外必填/可选字段

| type | 必填 | 可选 |
|------|------|------|
| `requirement` | `status`, `priority` | `related-specs`, `owner`, `related-requirements` |
| `acceptance-criteria` | `requirement`, `status` | `related-specs`, `category` |
| `overview` | `domain`（若在 engineering） | `spec`, `code_roots`, `depends_on`, `depended_by`, `key_adrs`, `key_apis` |
| `design` | `domain`, `status` | `related-adrs`, `diagrams` |
| `adr` | `domain`, `status` | `supersedes`, `superseded_by` |
| `boundary` | `domain`, `contract_with`, `stability` | `related-adrs` |
| `api` | `domain`, `protocol`, `version`, `stability` | `endpoints[]`, `auth_required` |
| `test-case` | `spec`, `requirement`, `code`, `suite`, `priority`, `last_result`, `last_run` | `ac`, `steps[]`, `precondition`, `last_ci` |
| `test-suite` | `cases[]`, `coverage-area` | `status` |
| `concept` | — | `related-concepts`, `related-entities`, `sources[]` |
| `entity` | — | `entity_type`, `related-entities`, `sources[]` |
| `glossary-term` | — | `domain`, `related-terms`, `source`（首次定义出处） |
| `source-summary` | `source_file`（raw/ 中文件名）, `ingest_date` | `key_claims[]`, `contradicts[]`, `supports[]` |
| `output` | `query_date`, `query`（原始问题） | `related-concepts`, `related-entities` |

## 13. 初始化（init）

SDD Harness `init` 的 step 5 负责建 LLMWiki 骨架：

1. 创建 `llmwiki/` 根（OKF bundle）
2. 建 `raw/`（空目录）、`wiki/`（含全部子目录）、`_schema.md`（模板）
3. 在 `wiki/` 下建标准分类（`sources/` / `concepts/` / `entities/` / `outputs/`）+ SDD 三大流程骨架（`product/` / `engineering/` / `testing/` / `_shared/`）
4. 建 `index.md`（根 + wiki）、`log.md`（根 + wiki）
5. 若有首轮注入：把业务 repo README/架构文档灌入 `raw/`，跑首次 ingest 生成 `wiki/sources/` 摘要
6. 配 LLMWiki MCP endpoint

维护命令：

```bash
sdd wiki init       # 重跑 LLMWiki 初始化（建库/重建骨架）
sdd wiki ingest     # 手动触发 ingest（把 raw/ 中新文件写进 wiki）
sdd wiki lint       # 手动触发 lint 检查
```

## 14. 与 OpenSpec 的边界

| | OpenSpec | LLMWiki |
|---|---------|---------|
| 角色 | 规格真相（canonical spec） | 知识视角（knowledge） |
| 内容 | proposal / specs / design / tasks + tracking | 设计/ADR/边界/API/code-notes/用例/报告/术语/概念/实体 |
| 存储 | `openspec/changes/` + `openspec/specs/`（进 git） | `llmwiki/wiki/`（进 git）、`llmwiki/raw/`（可选不进） |
| 验证 | 可执行（OpenSpec CLI 做 spec 验证） | 不可执行（只做 backlink 引用） |
| 关系 | — | 对 `openspec/specs/<domain>/` 做 backlink，不重复存 spec 全文 |

**原则**：LLMWiki 不重复存 spec 全文。spec 全文归 OpenSpec（可验证、进 git）；LLMWiki 通过 `[[SPEC-auth]]` backlink 引用，在 knowledge 层面补充 OpenSpec 无法记录的东西（为什么这样设计、tradeoff 是什么、经历了哪些决策、测试覆盖如何）。
