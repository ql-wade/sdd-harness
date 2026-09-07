# 知识架构方案 v3：分布式 wiki × 集中式服务 × 飞书对齐

> 状态：**v3**——融合架构输入（分布式 obsidian-wiki / 集中式 deepwiki / 服务层 lark-cli；wiki 与 spec 分离），并吸收共识评审 v2 轮的三方 findings。
> 调研：[ar9av/obsidian-wiki](https://github.com/ar9av/obsidian-wiki)（3,364★，活跃，Karpathy 模式）、[AsyncFuncAI/deepwiki-open](https://github.com/AsyncFuncAI/deepwiki-open)（自托管 RAG wiki 生成服务）、[larksuite/cli](https://github.com/larksuite/cli)（飞书官方 CLI，200+ 命令 26 skills，MIT）、gbrain（升级路径）、teamai teamwiki（ADR-0018）、LLMWiki（已集成）。
> ⚠️ 自报基准声明：所有厂商自测数据（LongMemEval 93.19%、44%→83% 等）仅作选型参考，不作验收输入。

## 0. 总架构：生产面 × 消费面 × 桥

```text
知识生产面（分布式，随 repo，Git 版本化）        知识消费面（集中式，服务层）
┌ T0 repo wiki    docs/ + AGENTS.md + ADR       ┌ deepwiki-open 服务（自动生成 repo wiki
├ T1 curated wiki LLMWiki MCP（单项目策展）       │   + chat 问答，自托管，支持 Ollama 本地）
├ T2 auto graph   teamai teamwiki（AST 图谱）     ├ 飞书知识库（人侧团队对齐/分享）
└ T3 team vault   obsidian-wiki vault            └ teamai dashboard（试点）
   （per-repo 分布式；跨项目=独立 team-knowledge repo）

桥（服务层专用——员工日常不直接用）：
  lark-cli（飞书官方）：
    抽取  飞书文档/妙记纪要/群聊决策 → repo wiki 的 raw/ 源（知识入口）
    对齐  vault 精华（经 PR 评审）→ 飞书知识库（团队人侧消费）

spec 面（与知识层显式分离）：openspec/（变更工件：proposal/specs/tasks）
  ——知识层回答"团队知道什么"；spec 层回答"这次变更做什么、怎么验"。
  wiki 是原始输入的提炼沉淀（随 repo 演进）；spec 是 coding 的直接指导（随变更生命周期）。
  spec 归档后其长期结论经 promotion 进 wiki（单向，见 D3）。
```

**方向流**：原始输入（飞书文档/会议/群聊）→ lark-cli 服务层抽取 → repo `wiki-raw/` → obsidian-wiki ingest 提炼（compile-not-accumulate）→ vault/docs → 精华经 PR 评审推回飞书对齐。知识从人来，回人去，中间在 repo 里版本化、可审计。

## 1. 各层选型与定位

| 层 | 工具 | 定位 | 供应链 | 状态 |
|----|------|------|--------|------|
| T0 | （已有） | 项目自我描述 | — | ready |
| T1 | LLMWiki MCP | 单项目策展知识（索引检索，agent 主用） | commit pin 已有 | ready |
| T2 | teamai teamwiki | 代码图谱+摩擦经验，自动只读 | ADR-0018 P3 | planned |
| T3 | obsidian-wiki | **per-repo vault**（原始输入→提炼）；跨项目=独立 team-knowledge repo | pip version+sha256 pin | 本方案 K1 起 degraded |
| 集中 | deepwiki-open | 服务端自动生成 repo wiki + RAG chat，团队浏览/问答；支持私有 repo、Ollama 全本地 | docker 镜像 pin | degraded（需服务端） |
| 桥 | lark-cli | 服务层飞书抽取/对齐（**非员工层**）；最小 scope、dry-run、JSON 契约 | npm pin | degraded（需飞书 OAuth 应用） |
| 升级 | gbrain | 权限隔离/synthesis/gap（company brain 三能力） | — | planned，触发条件显式 |

## 2. 决策（继承 v2 修订 + v3 新增）

- **D1**：T3 选 obsidian-wiki 模式（Git-native/零服务端/Karpathy 同源）；gbrain planned。
- **D2（CLI-only，零技能注入）**：不软链不激活上游 39 技能；bootstrap 只装 CLI（pip `==版本 --require-hashes`）；agent 经 AGENTS 指引直用 CLI 命令；不创建包装技能。
- **D3（路由矩阵 + 单向晋升）**：canonical-source 规则（每类知识唯一权威层）：

| 知识类型 | 权威层 |
|---------|--------|
| 项目约定/架构/ADR | T0 docs/ |
| 项目术语/单项目教训 | T1 LLMWiki |
| 代码结构/依赖 | T2 teamwiki |
| 跨项目教训/FAQ/惯例 | T3 vault |
| 飞书原生协作内容（会议/群聊决策） | 飞书（源头）；抽取副本进 raw/，provenance 指回 |
| 敏感/权限隔离知识 | 不入任何层（deferred gbrain） |

  晋升：LLMWiki ≥2 项目引用的教训 → PR 提升 vault 页（`promoted_from` + `provenance`），原页 `superseded_by`；**spec 归档 → wiki**：openspec archive 时其长期结论（设计取舍/踩坑）由 archive 流程提炼进对应层（单向，spec 不反向吸收 wiki）。
- **D4（写路径威胁模型）**：vault/repo wiki 写入=git 文件写，PR 评审即授权；`kb-write-protection` 仅守 `llmwiki/wiki/**`（索引完整性），语义不变；hooks 零变更。
- **D5（v3 新增：lark-cli 服务层纪律）**：仅服务/CI 场景调用（bootstrap 不默认装给员工）；专用飞书应用凭证走 env（`${LARK_APP_ID}/${LARK_APP_SECRET}`，不入 git）；最小 scope（docs:read/wiki:write 按需）；所有副作用命令先 `--dry-run`；抽取方向默认只读飞书，对齐方向写飞书须经 PR 评审产物（不直接推未评审内容）。lark-cli 自述的注入/越权风险面如实继承其安全文档。
- **D6（v3 新增：deepwiki 定位）**：只读消费面——从 git repo 自动生成 wiki 供浏览/问答，**不作为知识权威源**（生成物不入 git，服务端可再生）；生成配置（embedder/model）pin 进部署 compose；与 T0-T3 无写路径交叉，零冲突。

## 3. 阶段（量化门槛 + 回滚）

| 阶段 | 内容 | 验收门 |
|------|------|--------|
| **K0** 模式+质量 | obsidian-wiki pin 安装；**种子缺陷 vault** 测 lint/dedup 成色（预埋断链/孤儿/矛盾，检出 100% 才过）；多机 clone 无状态残留 | 种子 100% 检出；零服务端实证 |
| **K1** 分布式集成 | bootstrap `--with-wiki-vault`（digest pin）；AGENTS-template 路由矩阵+spec 分离声明；能力清单：obsidian-wiki=degraded、gbrain=planned | check.sh 绿；触发矩阵含 vault 行 |
| **K2** 桥试点（lark-cli） | 服务层：飞书 1 个知识库文档域 → raw/ 抽取 pipeline；vault 精华页 → 飞书对齐（评审后）；全程 dry-run→执行两步 | 抽取 round-trip 语义无损（抽样人审）；scope 最小化实证 |
| **K3** 集中式试点（deepwiki） | 部署（docker pin，Ollama 本地 embedder 可选）；接入 2-3 个 repo；团队问答试用 | 生成 wiki 与 T0/T3 抽查一致性 ≥80%（无凭空内容）；服务端无外网 LLM 依赖（或如实声明） |
| **K4** 试点综合 | 2 项目 × 4 周：摩擦经验+FAQ 全链路（飞书→raw→vault→对齐） | 检索命中 ≥60%（主观评分）；周维护 ≤30min；git 冲突 ≤2 次/月；任一不达 → 卸载验证 + ADR 重审 |
| **K5** gbrain 评估（可选） | 触发：≥15 人或需 ACL/synthesis | 独立 ADR + 独立评审 |

## 4. 风险（v3）

- obsidian-wiki 自述 early——K0 种子门槛实测成色
- lark-cli 副作用面（写飞书）——D5 纪律 + dry-run + 评审产物；凭证泄露=飞书越权，env 管理入 runbook
- deepwiki 生成质量依赖 embedder/LLM 配置——K3 一致性抽查门槛；生成物不当权威源
- 多写者 git 冲突——K4 计数，≥3 次/月回滚
- 三消费面（vault/deepwiki/飞书）内容漂移——canonical-source 在 repo（T0-T3），deepwiki 再生、飞书只收评审产物；漂移检测入 vault lint 周期（K4 观察）
