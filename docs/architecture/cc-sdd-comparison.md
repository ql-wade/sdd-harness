# cc-sdd × SDD Harness 全量综合

> 对比日期：2026-06-26。cc-sdd 数据来自 [gotalab/cc-sdd](https://github.com/gotalab/cc-sdd) v3.0.0（main 分支）。
> 用途：识别 SDD Harness 该从 cc-sdd 借鉴的工程化能力，明确自身差异化定位。

## 1. 两者画像

| 维度 | cc-sdd (gotalab) | SDD Harness (我们) |
|------|-----------------|-------------------|
| 成熟度 | v3.0.0 production-ready，3.5k★，429+ commits，30+ 测试 | v0.1.0，fork sdd-cli，刚跑通真实 init |
| 技术栈 | TypeScript monorepo（cli/manifest/plan/resolvers/template） | JavaScript（bin/cli.js + templates） |
| 平台 | 8 agent，13 语言 | 3 平台（Claude Code/OpenCode/Codex） |
| 方法论 | Kiro（.kiro/specs/，EARS，brief/roadmap） | OpenSpec（openspec/changes/，proposal/specs/design/tasks） |
| 工作流 | discovery→spec-init→requirements→design→tasks→impl（6 步，spec→code） | grill→product→dev→test→code→review→verify→release→archive（9 步，闭环） |
| skills | 17 | 10（9 stage + 1 shared） |
| 外部依赖 | 零（纯 TS） | 多（OpenSpec CLI、LLMWiki MCP、open-code-review、Understand-Anything） |

## 2. cc-sdd 更强的地方

- **平台覆盖**：8 agent，每个有 manifest + 测试
- **工程化**：template renderer、plan executor、resolver、30+ 测试
- **多 spec 协调**：`kiro-spec-batch`（roadmap→多 spec 并行 + cross-spec review）
- **discovery 智能路由**：`/kiro-discovery` 自动判断 extend/new/decompose/no-spec
- **steering 文档**：`.kiro/steering/` 持久 AI 指导
- **国际化**：13 语言
- **production battle-tested**

## 3. SDD Harness 真正的差异化（cc-sdd 完全没有）

- **知识闭环**：LLMWiki MCP（已验证真能跑）—— cc-sdd 无
- **治理**：显式 hooks（5 MVP）+ 9 gates + reboot test + artifact ownership —— cc-sdd 隐式
- **多角色**：显式 product（PRD/AC）+ test（用例/矩阵）+ dev —— cc-sdd 单开发者视角
- **release 阶段**：`/sdd:release`（manual/auto/skip + 回滚）—— cc-sdd 到 impl 结束
- **依赖一键装**：`sdd init` 真实装 open-code-review + LLMWiki + MCP 注册 —— cc-sdd 零依赖
- **code graph 集成**：Understand-Anything skills —— cc-sdd 无
- **traceability**：显式 REQ→AC→SPEC→TC→code 链 + backlink —— cc-sdd 隐式

## 4. 已借鉴 cc-sdd 的（ADR-0009）

per-task independent reviewer、auto-debug（2 次拒绝）、boundary discipline（File Structure Plan + `_Boundary_`/`_Depends_`）、learnings propagation、TDD behind feature flag——五项已在 sdd-code/sdd-review 实现。

## 5. 待借鉴（本对比的产出）

| 优先级 | 借鉴项 | 落地 |
|--------|--------|------|
| P0 | discovery 智能路由 | sdd-grill 加路由：extend 既有 / 直接实现 / 新建 / 拆分 |
| P0 | steering 持久指导 | `.sdd/steering/` 目录 + config 注入 |
| P1 | brief.md resume | grill 产出 brief.md，支持 workstream 恢复 |
| P1 | manifest 系统 | 多平台安装改 manifest 驱动（替代硬编码 copy） |
| P2 | kiro-spec-batch | 多 spec 并行 + cross-review |
| P2 | 测试 | cli 的 init/doctor 集成测试 |

## 6. 定位

```
cc-sdd   = 成熟的 spec→code 自治实现器（多平台、零依赖、production-grade）
SDD Harness = 企业级 knowledge→code→knowledge 全闭环治理 wrapper
```

**不是竞品，是互补层**：SDD Harness 的 `/sdd:code` 理论上可内部调 cc-sdd 的 `kiro-impl` 做长跑实现，自己专注 grill/product/test/review/verify/release/archive + 知识/治理。
