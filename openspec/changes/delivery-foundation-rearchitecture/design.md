## Context

2026-10-26用户明确收敛为原生Comet命令、现有Agent宿主技能调用和硬门；六角色常驻服务及其强制资格化退休。旧设计及票已保存于replans/2026-10-26-command-first/before，不能把旧批准改绑到新摘要。

## Goals / Non-Goals

目标：需求、架构、测试设计各自过门，计划/测试自动化/实现/验收分别执行；沿原Run完成项目知识、唯一OpenSpec归档、团队发布与持续权限维护。非目标：重造Agent通信/调度系统、强制角色服务、常驻controller端口或首期Control API。

## Decisions

当前权威为[命令优先架构](../../../docs/architecture/comet-ai-devops-convergence.md)和[ADR-0021](../../../docs/architecture/adr/0021-comet-command-first-no-resident-role-services.md)。此处覆盖旧统一架构中与该决定冲突的部署要求；ADR-0015定位及原单主控、权限、恢复、G15/R10功能边界继续。

- /comet与五个原阶段入口均使用原状态和共同Guard；A/T独立，P只产唯一计划。
- 当前宿主提供真实模型、技能、独立Agent、MCP及权限；不自建app-server transport、签发平台或第二执行队列。
- Docker仅实际依赖，LLMWiki默认stdio MCP，Outline团队知识、deepwiki-open代码Wiki、CodeGraph可选。
- 原始事件/测试/CI/资源回读证明来源；角色名、自写pass或同用户签名不能证明独立。不能强制权限的宿主如实不支持，不假称安全隔离。
- 需求/设计变更使全部下游单调失效。知识正文产出后冻结，输出按原精确check-policy提前声明，不事后排除源码/权限保住旧V。
- Kp在archive之前，Kt在整体completed之前；归档后同Run pending与未知结果先观察原operation。

## Migration Plan

沿原39节点/69工作包，先打通P1_3/P2_4/P2_5/P1_5/P3_2的真实R→V；取消对I02镜像与全部知识栈的先行依赖。随后真实知识与平台/维护恢复。I02改为退休默认六角色部署、保全旧资源与可选临时作业，不删数据；P5_2/F10正向另期不阻本期P5_3。

每项TDD、文件、RED/GREEN和退出条件见tasks.md，依赖见唯一task-dag.json，完整检查见execution-contract.json。保留所有原节点/场景/检查ID和历史失败；改变的是拓扑和合理证明方式，不是删除功能性验收。

## Risks / Trade-offs

- 简化成提示词：所有真实入口共同硬门和实际来源/独立审查必须验证。
- 宿主权限不足：核实际能力，不以角色标签充当权限，不暗中回建六服务。
- 权限撤销/未知写入：保留正常发现3分钟/隔离2分钟目标及故障告警/补偿，既有调度只触发同Comet维护。
- 历史证据漂移：旧镜像、私有SDK及fixture仅原范围复用，新revision重新验收；当前九文件未接纳源差异不能盲目应用两次。

## Validation

104场景身份保留，本期103与129required必须在最终真实Run验证；F10明确NOT-EXERCISED。当前只验证计划和OpenSpec结构，不运行产品测试或原型，不触发新资料外发/知识写/ACL。
