## Why

原目标是由Comet命令流程和知识设施完成团队AI DevOps。旧实施把职责分工扩成六个常驻角色服务、固定Runner镜像和自建Agent通信/签发前置，真实纵向闭环迟迟未接通。用户于2026-10-26明确要求收敛；后续用户目标要求完成实施并验证。

## What Changes

- 同一Comet Classic原生命令/Run/Guard连接现有Agent宿主技能、独立审查和实际工具，不重建Agent执行循环。
- 从默认交付路线退休六角色常驻部署及其镜像/OS身份/自建RPC前置。Docker只保留必要知识依赖或确需的临时作业。
- R/A/T独立门、P只做计划、测试自动化/TDD/审查/Whitebox分离；Kp阻归档、Kt阻完成，权限/平台/恢复义务保持。
- 修订原tasks/DAG/contract/源码基线，保留39节点、30父任务、69工作包、104场景及130检查身份；本期129/103，F10正向另期。

## Capabilities

### New Capabilities
- `delivery-foundation`: 原生阶段命令、硬门、知识与平台闭环、可信执行和恢复。

### Modified Capabilities

无；基础scaffold定位不变。本Change内的拓扑/证明方式按ADR-0021修订。

## Non-goals

本轮不修改 Minicraft 游戏；不擅自升级已批准的 Comet 0.5.0，不新增跨机器 Control API、消息队列、模型网关、统一 secret 服务或阶段账本。对外发送、真实发布、权限或数据删除遵循已有授权，不由本候选自动授予。

## Impact

当前架构以docs/architecture/comet-ai-devops-convergence.md与ADR-0021为准。旧ADR/票/报告及待集成代码原样保全，旧PASS不认证新流程；主检出已有未接纳九文件差异和用户改动不得覆盖。具体依赖改动、接口替换和处置在replans/2026-10-26-command-first/amendment.json。

## Success Metrics

计划结构、OpenSpec strict 与独立文档审查只判断计划质量。实施完成要求最终候选同Run的129required/103场景、真实宿主与平台/知识终态、独立Whitebox/Grill和唯一Comet收尾，不以本次文档检查为通过。

2026-10-29 返工依据 ADR-0022 已批准的 0.5.0，沿同一 Change 和任务身份补足试点实证缺陷；Minicraft 游戏不修改，F10 正向仍另期。
