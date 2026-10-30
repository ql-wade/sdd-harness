# 执行接管提示（2026-10-29 唯一控制器）

用户已确认旧 Claude 停止并授权本控制器接管；此提示不改变当前 Run、进度或外部权限。接管前已核对可见句柄，继续前再次核对接管者为唯一控制器，核对现有 Claude/Agent 进程与会话、工作区未提交改动、原 Run 和实际文件；不得覆盖、重启或重复派发。用户最新要求每30分钟汇报进度和预计完成时间；自动审批拒绝新建定时任务，当前未生效，不绕过审批；继续人工报告。原架构的 G15 源权限事件与周期核验义务继续保留，实际操作遵循已有资源授权。当前已有 Goal，不创建第二 Goal。

按原 Change 的 `tasks.md`、`task-dag.json`、`execution-contract.json`、`spec-baseline.json` 和 `drift-lock.json` 工作；架构为 `architecture.md`、ADR-0021/0022 与 `docs/architecture/comet-ai-devops-convergence.md`。本候选摘要：plan `765b324e28be0c08ed9080f04ff507617ba89f690509e595d2577d94fdedb5de`；architecture `8d6b82cc36cbb4865a0b9a8e7fcce9d232071d1dda91a1e25ddc6db51a0844b6`；DAG `655b37ca6bad5154ab293b22f59d1238724353e0f1e025c1caf732367ef1cb12`；contract `a470c94bc97da693244cf915e265eb518fba7b696a15b9f05dd265c49ff49362`。接管前必须核对实际全部输入与原始 evidence，并完成独立审查；计划和提示不代表实施或验收通过。

保持原 39 节点、69 工作包、104 场景和 130 检查身份，本期 103 场景与 129 required；F10 正向为另期、NOT-EXERCISED。Minicraft 游戏只作案例，不修改。EC1 原文保留在 `replans/2026-10-29-isolated-candidate/before/EC1-original.md`，返工已映射回原任务。历史三项零匹配假绿保留原证据并在本修订失效，必须运行六项检查的冻结目标集合与原有行为 oracle，并由 `V_RW_COMPLETION_REQUIRED` 的真实 final aggregator 验证其余 128 项、本期场景、同候选/Run 和 F10 处置；exit 0 和组件绿不够。

先完成 P0_1–P0_4 的当前修订独立审核，确保 `plan_guard`、OpenSpec strict、source baseline、用户改动和状态一致。再按 DAG 做 TDD：先修验收器和原生入口；修复 R/A/T 独立准入、真实宿主来源、保守失效和同 Run 恢复；再在真实宿主驱动 R→A→T→P→测试/TDD/独立 review→V，最后 Kp→唯一 OpenSpec 归档→适用 Kt。P3_1 先独立实现和测试构建工件核验器；P1_3 可在该核验器核验独立审查及当前摘要后消费 P2_4 构建工件，但 P2_4 不得在真实正向来源前标接受；VERIFY 不享有该例外。

测试作者不签业务验收；独立 Whitebox 和 Grill 检查同一最终候选、实际 Run、平台/知识权限与中断恢复。任何未验或失败维持未完成。对外发送、知识发布、权限变更、部署和删除不从本提示自动获得额外授权；已消耗的单次授权不得复用。最终结果须包含原始证据、可读状态、适用 OpenSpec 归档和归档后审查；不得以本计划或局部测试冒充交付。

最终校验顺序：先同一候选按依赖执行其他 128 项本期检查，再运行 V_RW_COMPLETION_REQUIRED；先校验其自身真实断言，对 A20/B10 暂排自身并核对其它全部条件，计算本项真实结果后回代，不预写 PASS。F10 单独保留 NOT-EXERCISED。

P3_1 需先将 repair_obligation_bindings 的每项 assertion_id 绑定具体可执行测试、真实来源与证据结构并独立审查、重锁；在此之前不得运行终验。最终聚合必须核对全部 18 个返工任务及当前 67 条原子义务，proof_levels 仅使用现有枚举。

自引用不仅涉及 A20/B10，也涉及 FINAL_RESULTS_DERIVED_FROM_EVIDENCE 与 FINAL_SELF_REFERENCE_RESOLVED；聚合时直接检查这两项当前原始断言及来源，再计算自身真实结果并回填，不能事先填写通过。

仅 current_delivery_scope.maintenance_checks 可使用关联维护 Run；必须核验实际维护记录的 originRunId、knowledgeIds、linkedReceipt 和 operationKey，绑定原产品 Run、最终候选和真实来源，不能把维护 Run 当第二主控。

V_N09/V_N12 的主身份保持产品 Run，可按合同引用已验证的 V_POST_DELIVERY_PERMISSIONS 关联维护证据；不能将任意普通检查的主身份换成维护 Run。

维护 operationKey 与原发布 operation 是不同身份：通过 linkedReceipt 核验原发布及目标，再分别验证维护操作和幂等；不得要求两者相等或接受空字段。

P3_1 先交独立复核的验收器 construction artifact，P2_4/P1_3/P3_2 在限定依赖边下建设；P3_1 不提前 ACCEPTED。各任务完成后，由唯一控制器组织 P3_1 登记全部义务并独立复核、重锁，VERIFY 不享有 construction 例外。

P4_3 先交独立复核的汇总器 construction artifact，P5_1 可按限定边建设；登记测试定义/来源 schema 与最终业务证明分开，最终候选只在 VERIFY 验证。

VERIFY 可在 P3_1/P4_3 达到合同中可机器核验的 PREVERIFY_IMPLEMENTATION_READY 后启动；该状态非 construction artifact、业务 PASS 或最终交付。其余依赖仍按合同完成，最终由 VERIFY 核验真实同 Run 证据。

P3_1 可在独立复审并主控复验当前 P2_1 TAP construction artifact 后开始验收器建设；P2_1 单调失效仍 OPEN，须权威 Comet 代际接线后关闭，VERIFY 不享有例外。

P2_2 可在独立复核及主控复验 P2_1 当前 TAP 工件后仅做隔离建设；P1_6 可在当前版本/方法快照经复核后仅做隔离方法建设。两父任务不因此通过，P2_4 对 P1_1 的完整依赖与 VERIFY 真实验收不变。

用户 2026-10-29 指定目标 Comet 0.5.1；依据 ADR-0023 和当前唯一 DAG 重新验证版本与补丁。保留 0.5.0 原始证据但不继承新版运行通过。官方 Classic 引用 Superpowers，必须验证受控替换实际执行 Matt；0005 已在隔离 0.5.1 源码实际应用与构建，上游 smoke 244 通过、2 跳过；不能省略 Kt 写入、同 Run 恢复及真源权限验证。停止旧版 worker，核对其句柄后恢复建设。

版本锁与 toolchain-baseline.json 已切至 0.5.1，诊断版 --version 读回 0.5.1；method-profile-manifest.json 的供应元数据已对齐 0.5.1；真实方法调用和受控替换仍须验证。隔离构建和版本输出均不证明受管运行资格。

P1_2 负责用户指南的事实修订：当前仅诊断、init/状态推进拒绝、直调 SDK 绕行未关闭；五阶段是待验证的目标。候选集成前须重新核对指南及命令源码摘要；此提示不新增执行或外部授权。

P2_4 可在独立重审当前 P1_1 d6 供给及 P1_6 方法资产、并分别满足 P2_3/P3_1 前置后，仅进行隔离建设；这不传递解锁 P1_3/P2_5，不启动真实 Run，VERIFY 无 construction 例外。

P1_2←P2_4 仅供私有隔离环境离线冷导出及恢复验证；消费前按当前合同独立重审精确的 8e730833… 官方包、编译清单、源码和证据。不得安装到真实项目、启动产品 Run、发布或扩大授权；不接受 P2_4/P3_1、不向 P1_3 传递资格。该候选变更重锁后旧 5 条边及 P0_1–P0_4 规划审核均需重新核验，未激活不得消费。

私有离线验证不得读取或输出凭据和业务资料原件；真实 MCP 环境未资格化时仅使用合成 fixture，真实材料保持未验。所有旧节点与全局准入均为历史并等待新合同逐边重审。
