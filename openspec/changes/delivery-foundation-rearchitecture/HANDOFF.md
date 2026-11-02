# 当前执行入口：Comet 0.5.1 原生命令与硬门禁

用户已要求使用 Comet 0.5.1；沿原唯一 Change 的 tasks、DAG、合同、状态与台账推进。读取 [执行提示](execution-prompt.md)、[原任务](tasks.md)、[DAG](task-dag.json)、[执行合同](execution-contract.json)、[状态](execution-state.json) 和 [ADR-0023](../../../docs/architecture/adr/0023-comet-051-adoption.md)。

当前源码锁和 toolchain 基线已更新为 0.5.1，项目入口仅用于诊断；0005 已在隔离源码实际应用并构建，上游 smoke 为 244 通过、2 跳过。组合应用、门禁及真实宿主执行仍未获得受管资格，Kt 写入、权限与同 Run 恢复尚未证明。旧 0.5.0 和组件证据仅保留原范围；67 项原子义务仍待登记。

本期保留 39 节点、69 工作包、104 场景和 130 检查身份，实际 38 节点、103 场景、129 required；P5_2/F10 正向另期、NOT-EXERCISED。Minicraft 只作案例，不改游戏。用户最新要求每30分钟汇报；自动审批拒绝创建，定时任务尚未生效；G15 产品权限维护仍属范围。

## OPEN（2026-11-02 架构符合性审核登记，项目所有者裁决项）

- **ADR-0019:37 与 ADR-0021 的权威指针冲突**：ADR-0019 仍称 delivery-architecture.md 为「权威设计」，ADR-0021（command-first，取消常驻角色服务）已改道。两个权威指针同时冻结且指向不同代际——按 AGENTS.md §0「不可逆决策先有 ADR」，取舍（更新 ADR-0019 注记为演进指针 / 出新 ADR 收敛）属项目所有者裁决；本轮仅在 ADR-0019 文末加导航注记，不改决策内容。
- **contracts/probe-profiles/minicraft.yaml 保留裁决**：审核判定其为契约层工作示例（非会话证据）予以保留；若后续要把用例库完全去实例化，此文件随之迁移。

## 2026-11-02 架构符合性审核与深度迭代（本轮 remediation 记录）

多 agent 审核（53 agents：18 审核单元 + 对抗性核查 + 完备性批评；29 条确认违规 + 批评员重立案 2 条）后按四簇修复：A 纯净线大扫除（29 个实例 change 目录、tests/、docs/superpowers/、根目录会话 json、plugin_root 指针全部移出框架线；FRAMEWORK.md 重写为规则式纯净表述；.gitignore 锚定修正使 tracked-but-ignored 714→0）；B 控制平面单一事实源（pre-tool-gate.sh 回退默认与 hooks.yaml 逐字同步、四 hook 脚本补 set -euo pipefail、先红后绿新增两条不变量测试、llmwiki controlPlaneGap 复测写回 RESOLVED）；C provenance 链（evidence.js 移除 shape probe 与死分支恢复纯判定边界声明、官方编译器重锁 v27 包与 compile-manifest（构建字节可复现）、upgrade 测试去机器路径改 env 注入）；D 事实源机械同步（§2/§7 台账对账、知识文档历史标识、overlay 死链注记、doctor 退出码 1→2 修正、registry 证据迁入 change 工件并重指向）。验收门：npm test 全绿 + check.sh 通过 + tracked-but-ignored 归零。

## 2026-11-02（第二批）：sdd-test 实例验证回流固化（R 门收据束构造器 + RUNBOOK 应用先行）

sdd-test 新项目验证实例（minecraft-3d）R 门打通（rev37）后回流 5 项框架缺口，本轮固化：
1. `tools/gate-bundle.mjs`——六门收据束构造器进框架（R 门实证配方参数化：六门 case/skill 映射、
   comet runtime-json 动态解析不硬编码机器路径、delivery-authority 先落盘再 evaluate、
   真实受保护端口本地预校验不过不落盘；--check-only；B-③ 字节确定性提取为纯函数）。
   测试 test/gate-bundle.test.js（5 用例：映射/拒绝语义/B-③/参数纪律/解析器）。
   实证范围如实标注：R 门全流程实证；A/T/P 同配方由验证线复跑交叉验证；V/Kp 形状不符时
   evaluate 拒绝不伪造。
2. RUNBOOK 第 1 步改为应用先行（建目录，不跑 state init）——state init 在 0.5.1 git 根默认
   runtime=sdk 归属内建 classic-full，与第 3 步应用 start 结构性冲突（源码级审计实锤：
   classic-app.js:620 / store.js:116-121）；原 state init 移入陷阱表并附外科手术恢复配方
  （owner/投影/sdk-run 四件套 + marker/checkpoint，cancel/restore 均不释放归属）。
3. RUNBOOK 开始前补 `command -v comet` 兼容检查；drive-journey.sh 启动时同步早失败。
4. 陷阱表 +5 行：owner 冲突外科手术 / portable checkpoint / Runtime-owned field /
   comet not found / 审批词中止（仅退驱动器，重跑续跑）。
5. drive-journey.sh human() 接受确认词集合（approved/同意/y/yes，大小写不敏感）；
   手工 dispatch 段改为如实标注完整请求形状要求（不再给不可复现的残缺配方）。
README 受管交付段同步应用先行。foundation 导出清单 + gate-bundle，基线重冻结。
上游开放问题（登记备裁）：state init 在 0.5.1 的目标用户/legacy 定位；classic owner
「一次绑定永不释放」是否有意；`state forget` 类官方工具提案；comet status 对 app-owned
Run 的展示行为未实测。

## 2026-11-02（第三批）：comet 运行时状态沙箱友好性（COMET_DATA_DIR 文档化）

sdd-test 验证实例追加诉求：沙箱化 agent 每条运行时命令都要宿主终端授权 ~/.comet。
源码级核查（dist/platform/paths/workspace-runtime.js:91-94 + fc() 守卫）结论：
1. 上游官方支持 `COMET_DATA_DIR`（非空绝对路径）替代整个用户级数据根（缺省 ~/.comet），
   workspaceRoot = <dataRoot>/workspaces/<workspace哈希>/runtime。
2. **项目内落点被上游设计禁止**（fc() 守卫「用户级 Runtime 数据根不能位于当前工作区内」）
   ——实例首选方案不可行，scaffold 不提供，按实例允许的最低成本方案走 env + 文档化。
固化：RUNBOOK 新增「沙箱化 agent」节（三条纪律：绝对路径且不可在工作区内；
第 0 步前设好全程固定；跨天旅程勿用易清理 tmp）+ 陷阱表 +1 行（换根后 Run「不见」）。
沙箱实证：临时项目 + COMET_DATA_DIR=scratch，状态落 override（workspaces/1），
全局 ~/.comet/workspaces 122→122 零新增；项目内仅出现 362B 迁移 fence 标记文件（无害）。
验证标准对接：实例侧在纯沙箱（仅项目目录可写 + 授权 scratch）跑 install→archive 全程零拒绝。
