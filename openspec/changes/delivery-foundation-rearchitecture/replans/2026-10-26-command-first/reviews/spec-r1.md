# Command-first 文档／计划独立审查

结论：REQUEST_CHANGES。1 项 P1、2 项 P2。仅判断当前文档能否一致交接；未实施，也没有产品运行通过结论。

审查范围：主检出 `/Users/mac/Code/sdd-harness` 的 AGENTS、基础架构/方法边界、当前命令优先架构、ADR-0021、proposal/design/spec、执行交接、tasks/DAG/execution-contract、infrastructure-tasks 和 amendment。只读源码/文档；未运行产品测试、模型、MCP、Docker，未改计划/锁/状态及用户原有差异。没有遍历无关上游历史。

## P1 — 最终必需检查仍强制旧 Runner 镜像

位置：`openspec/changes/delivery-foundation-rearchitecture/execution-contract.json:3912`，`V_RW_RUNNER_BUILD`，尤其第 3924–3925 行 command/expected；同文件 acceptance_aggregation.scenario_required_checks 的 F01/F02/F05/A09/A19。

事实：检查仍为 required，命令为 `node tools/infra/runner.mjs probe --case current-build-role-isolation --json`，expected 明确要求“真实镜像包含当前完整有序补丁…digest/fingerprint/Node一致”。这不是仅保留一个旧 ID；它要求最终交付仍构建并认证镜像。ADR-0021 §决定4/5/7 与当前架构 §5/6 已取消固定 Runner 镜像强制前置，但该检查进入129项必需分母，且聚合到五个正常功能场景。`revision_precondition` 的通用“先实现/确认command-first oracle”不能替代这个明确的相反 oracle。

影响：接手者即使完整证明原生命令、宿主权限与独立执行，也无法按冻结合同完成；会被迫恢复旧镜像路线，或擅自把未执行检查填PASS。

最小修订：保留检查 ID、required、AC 和原失败历史；直接改写本检查的 command/expected/观察范围为当前实际安装的Comet及补丁身份、原生命令可运行、宿主实际Edit/Shell/MCP权限与独立来源证明。镜像证明只在事前明确选用临时容器作业时附加，不能作为普通命令流程的通用必要条件。随后按同一受控修订更新相关摘要。

## P2 — 机器交接仍宣布已授权执行

位置：`execution-contract.json:4475–4477` 的 `handoff.mode = EXECUTION_AUTHORIZED`、recipient；对照同文件 `plan_only:true`、runtime/monitor 的规划态以及 `HANDOFF-EXECUTION-2026-10-26.md` §7。

事实：当前用户范围是文档/计划；交接要求收到后续实施指令再登记接管/恢复Goal。但机器字段仍称 EXECUTION_AUTHORIZED，且收件者限定“Claude implementation workers under current single migration planner”，与本轮可移交其他Agent及未激活执行的状态不一致。execution-prompt开头确有“planning-only request does not activate this handoff”，所以这不是已观察到的越权启动，而是两种消费路径会得到相反授权状态。

影响：按JSON读取的宿主/接手者可能把计划交付误认为执行授权，或绑定旧planner/工人身份；纯文档交接不够自洽。

最小修订：将机器字段设为明确的规划交接/等待人类实施指令状态；recipient改成后续明确选择的接手Agent，并单独写清activation条件。保留既有暂停Goal和observe-only监督，不能据此恢复或创建执行。

## P2 — I01 的前置条件要求 I01 自己已经资格化

位置：`task-dag.json:625–650` 的 I01.preconditions；`tasks.md:365–380` 的 I01实施范围。

事实：I01负责建立必要资源/现有连接器登记与资格，但其preconditions仍写“I01 registry qualification and component image/source digest/owner/secrets readiness verified”。I01目前明确未执行且不在任何limited_artifact_edges自举例外中。它不只是后继服务的启用门，而是I01自身的派发前置。

影响：严格消费DAG前置的接手者在开始资源盘点/登记之前就必须出示该任务的已完成输出，形成自举阻塞；也容易把无差别镜像/secret准备重新作为所有登记工作的前置。

最小修订：I01的派发前置只保留已确认项目owner/具体范围和只读盘点权限。资源资格完成、实际秘密引用及必要镜像证据作为I01退出条件和对应资源启用前置；下游按实际选用依赖检查，不要求I01先证明自己完成。

## 已确认保留的承重边界

- R/A/T独立；P仅计划；测试自动化、Builder、独立代码审查和V明确分开。共同Guard列明正常、直接transition、next/resume、写入口、archive/completed，不退化成提示词。
- 原Run/锁/事务、单调失效、Kp阻归档、Kt阻completed、未知operation观察后恢复、归档后同Run继续均有明确要求。
- 源权限、目标全受众、内容版本/grant重核，正常3分钟发现/2分钟隔离、故障告警/补偿、R10保全及CI/部署digest/回滚义务仍在。
- DAG中P1_3与P3_2已不依赖I02或所有知识服务；waves把首个真实R→V放在I01/I02之前。宿主缺权限能力应标不支持，无同OS自签防管理员的虚假承诺。
- 退休要求先盘点/保全，删卷和唯一工作区没有被架构简化自动授权；原九文件及用户差异只作保留交接，未触碰。

未检查：未运行产品测试或真实命令链，未认证任何宿主/平台/知识服务；上述结构修订通过也不能代替真实129/103验收。
