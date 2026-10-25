> 2026-10-20：三方同摘要架构共识已通过，允许分批实施；本文件描述目标，运行启用尚未验收。原92场景与所有权不变。

## Context

现场基线 c42d3ce，OpenSpec 1.3.1，无已有活动变更。既有 ADR-0015 排除编排；历史 Foundation 设计曾评估 TeamAI workflow；本轮用户已确认 TeamAI 只分发、Comet 唯一交付主控候选、目标后默认自动推进。

## Goals / Non-Goals

目标：六环节输入/输出与失败路由明确，状态单写者、证据可信、固定基线、恢复和 CI/CD 闭环。非目标：重造调度器、批量修改技能、首期多服务部署。

## Decisions

采用 [统一设计](../../../docs/architecture/delivery-architecture.md) 与 [ADR-0019](../../../docs/architecture/adr/0019-delivery-foundation.md)。TeamAI 首期只分发，Comet 为唯一交付主控候选，Gate 无 current-stage，Spec Adapter 在 Comet 唯一收尾路径中工作；所选模式和硬门禁接入仍需实证。默认旧 scaffold，实证后显式启用 delivery profile。

## Risks / Trade-offs

- 上游源码与分发包不一致：固定产物与完整性，真实探针。
- 双 Guard/配置覆盖：正反序装配、用户条目保留、单 reconciler，失败 NO-GO。
- 自评伪造证据：受管 Runner/受保护策略；本机模式明确协作信任限制。
- 状态重复或漂移：唯一 owner、关联 ID、旧 attempt 拒绝、恢复读回。
- 旧技能 controller 活跃：profile 切换需显式停用/接管实证，不能仅改文案。

## Breaking Changes

本批仅文档，无 CLI/config/schema 破坏变更。目标 profile 会改变技能调用职责；旧报告经 adapter 兼容，不静默重写。未来 schema 或上游 pin 变化需要显式迁移。

## Migration Plan

Batch 0 文档；Batch 1 固定产物与装配实证；Batch 2 契约/Gate；Batch 3 单任务；Batch 4 CI/CD；Batch 5 团队扩展。详见 tasks.md。启用前保留配置备份和旧入口；停用 profile 不删除历史，外部副作用独立恢复。

## Validation

92 个 Given/When/Then 场景见 specs/delivery-foundation/spec.md。分四层报告：内核/夹具、CLI/装配、真实宿主、业务/CI。结构校验不等于产品 PASS。具体业务试点和环境在 Batch 3 前选择。

## 2026-10-22 修复验收补充

用户授权修订同一计划以关闭7个P1，不扩张控制器/平台/知识源选型。按既有C01、D01–D04、E03–E04和L10–L11落实正式设计前R门、真实独立A/T接纳、单调失效代际以及实际Comet故障恢复；observer必须验证每个required目标/终态读回。原92场景及原任务不增删。新增10个检查强化这些既有要求，并以同产品Run完整交付、归档后恢复、关联维护的真实资源终态为最终oracle。原有纯函数/CLI/fixture保留为支持证据，不能替代跨边界验收。

## 2026-10-24 实施收敛

按用户最新要求执行旧入口退出/防再生及新Comet流程。细化架构见docs/architecture/comet-ai-devops-convergence.md和ADR-0020。追加N01–N12，保留原92场景、任务身份和唯一DAG。新profile0验收，原证据历史保存。知识上下文检索、真实方法/角色、独立审查、平台、Kp→归档→Kt与持续权限维护形成实际链；不把旧测试编舞视为新业务Run。
