# 当前执行入口：Comet 0.5.1 原生命令与硬门禁

用户已要求使用 Comet 0.5.1；沿原唯一 Change 的 tasks、DAG、合同、状态与台账推进。读取 [执行提示](execution-prompt.md)、[原任务](tasks.md)、[DAG](task-dag.json)、[执行合同](execution-contract.json)、[状态](execution-state.json) 和 [ADR-0023](../../../docs/architecture/adr/0023-comet-051-adoption.md)。

当前源码锁和 toolchain 基线已更新为 0.5.1，项目入口仅用于诊断；0005 已在隔离源码实际应用并构建，上游 smoke 为 244 通过、2 跳过。组合应用、门禁及真实宿主执行仍未获得受管资格，Kt 写入、权限与同 Run 恢复尚未证明。旧 0.5.0 和组件证据仅保留原范围；67 项原子义务仍待登记。

本期保留 39 节点、69 工作包、104 场景和 130 检查身份，实际 38 节点、103 场景、129 required；P5_2/F10 正向另期、NOT-EXERCISED。Minicraft 只作案例，不改游戏。用户最新要求每30分钟汇报；自动审批拒绝创建，定时任务尚未生效；G15 产品权限维护仍属范围。

## OPEN（2026-11-02 架构符合性审核登记，项目所有者裁决项）

- **ADR-0019:37 与 ADR-0021 的权威指针冲突**：ADR-0019 仍称 delivery-architecture.md 为「权威设计」，ADR-0021（command-first，取消常驻角色服务）已改道。两个权威指针同时冻结且指向不同代际——按 AGENTS.md §0「不可逆决策先有 ADR」，取舍（更新 ADR-0019 注记为演进指针 / 出新 ADR 收敛）属项目所有者裁决；本轮仅在 ADR-0019 文末加导航注记，不改决策内容。
- **contracts/probe-profiles/minicraft.yaml 保留裁决**：审核判定其为契约层工作示例（非会话证据）予以保留；若后续要把用例库完全去实例化，此文件随之迁移。

## 2026-11-02 架构符合性审核与深度迭代（本轮 remediation 记录）

多 agent 审核（53 agents：18 审核单元 + 对抗性核查 + 完备性批评；29 条确认违规 + 批评员重立案 2 条）后按四簇修复：A 纯净线大扫除（29 个实例 change 目录、tests/、docs/superpowers/、根目录会话 json、plugin_root 指针全部移出框架线；FRAMEWORK.md 重写为规则式纯净表述；.gitignore 锚定修正使 tracked-but-ignored 714→0）；B 控制平面单一事实源（pre-tool-gate.sh 回退默认与 hooks.yaml 逐字同步、四 hook 脚本补 set -euo pipefail、先红后绿新增两条不变量测试、llmwiki controlPlaneGap 复测写回 RESOLVED）；C provenance 链（evidence.js 移除 shape probe 与死分支恢复纯判定边界声明、官方编译器重锁 v27 包与 compile-manifest（构建字节可复现）、upgrade 测试去机器路径改 env 注入）；D 事实源机械同步（§2/§7 台账对账、知识文档历史标识、overlay 死链注记、doctor 退出码 1→2 修正、registry 证据迁入 change 工件并重指向）。验收门：npm test 全绿 + check.sh 通过 + tracked-but-ignored 归零。
