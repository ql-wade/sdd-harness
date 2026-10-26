# Command-first 原计划独立复审 R2

结论：APPROVE（规划与交接静态范围）。原R1报告保留，未覆盖。

基线：/Users/mac/Code/sdd-harness 当前command-first-v1 bundle。仅静态复审R1修订，不签产品或宿主资格。

## R1问题处置

- P1 V_RW_RUNNER_BUILD：已关闭。保留原ID/AC，改用F05观察入口；expected要求当前实际Comet/方法版本、宿主执行来源、工具/路径/只读权限和控制写拒绝，默认零常驻角色；明确无Docker可执行普通命令，仅选临时容器作业才验证其镜像。仍PLANNED/NOT_VERIFIED，禁止旧probe/fixture充抵。
- P1交接授权与controller：已关闭。contract.handoff.mode改为PLAN_ONLY_EXECUTION_PREPARED，portable接手者须随后获得实施指令并登记唯一控制器；controller_override不再绑定旧root。execution-prompt顶部明确项目约束优先、规划不得派工/Goal/模型/MCP/资源清理，复用原state/ledger/Goal/监督，实际归档只走Comet。
- P2 I01文字自前置及全组件资格：已关闭。I01只要求可读登记信息/owner提供的标识，自身建立必要资格；I02先盘点保全，其余Infra只验证本组件实际域的登记与动作授权，镜像仅实际部署依赖适用。

V_COMET_NATIVE改C07入口和源确改时的额外构建要求、V_I02_METHOD_STATE_SCOPE改合法node测试入口，均仍须实施/核实新oracle后实际执行；本次没有把新命令写入视为通过。

## 实际静态核验

1. 原plan_guard返回 {"valid":true,"handoff_ready":true,"issues":[]}。
2. before-manifest 69份长度/SHA256仍逐项匹配，保全未变。
3. before/current 39节点集合及各节点工作包清单完全一致，共69工作包；130 check ID顺序相同；104场景，current_required 129，F10保留另期NOT-EXERCISED处置。
4. P3_2递归前置没有任何I01–I08；R1已确认无环/ownership序列，R2只改变Infra文字前置，没有重加业务阻塞边。
5. architecture、DAG、contract原始SHA256与锁一致，prompt包含同一四摘要；plan_guard验证计划规范化摘要。
6. R1对旧失败/WIP、独立Whitebox/Grill/Comet收尾、外发许可消耗、删除数据/资源写边界的保留结论继续有效。

## 非阻塞维护建议

execution-contract.json中V_COMET_NATIVE的availability仍名为EXISTS_REQUIRES_CURRENT_VERIFIED_BUILD_AND_PINNED_NODE，note仍写“现有CLI已支持这两个选项；必须先重建/校验当前完整manifest”。它们属于旧build命令元数据；当前expected已明确仅源码确改才额外构建，故不再构成R1的mandatory-image阻塞。后续同域修改时应改为当前入口适用的availability/note，避免接手者误读。

## 未验证及风险

没有运行npm/product tests、实际产品CLI/model/MCP/Docker、凭据访问或网络写；未修改repo、锁、状态或Goal。只在/private/tmp生成本报告。

APPROVE只表示这份原计划可交给后继按明确实施指令执行；真实命令接线、宿主来源/权限、知识发布/恢复和最终129/103仍全部需要当前候选的实际独立证据。
