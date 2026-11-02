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

## 2026-11-02（第四批）：A 门 handoff 协议缺口 + gate-bundle 三 bug 回纳（sdd-test r2 交叉验证）

R 门交叉验证成功（rev14 用 gate-bundle.mjs 复跑通过）；实例回流三 bug 与一个 A 门硬卡点：
- gate-bundle 回纳：①默认 clock=Date.now 立即求值为数字（应为函数引用 Date.now）——补默认路径回归；
  ②身份必须走官方 loadWorkflowApplication（readOnly，cometDist 从 runtime-json 上溯 3 级）——
  application.json 无 contentHash 字段，静默 undefined 使 verifyGateInputs 恒 false；
  生产路径 loader 失败响亮报错，opts.identity 仅供测试注入；③host.claude 定位器 sessionPath
  用完整转录路径（HOME/.claude/projects/<slug>/<session>.jsonl），commandDigest 须对应真实命令（args.hostCommand）。
- A 门协议缺口固化（classic-sdk-design.js:88-117 源码实锤：官方 handoff 执行器 outcome 自动携带
  sourceEvidence + requirementsEvidence 双回执；allowDesignDocumentChanges 仅在
  proposal.sourceEvidence&&proposal.requirementsEvidence 时开启）：
  RUNBOOK A 门要点 + tools/design-handoff.mjs（手工 handoff 生成器，导入运行时
  handoffSourceHash/classicOpenEvidenceReceipt 补齐双回执，杜绝字节锁死）。
- **合法续行（回答实例①，classic-sdk-design.js:41 运行时原文）**：
  `comet state revise-design <change> --expected-revision <rev>` → propose → approve →
  design 循环重放（handoff 重录时官方执行器带双回执）。前置：先修 design.md frontmatter
  comet_change 与 change 名一致（handoff 之前定稿）。不废弃 Run。
上游开放问题追加：design handoff outcome 契约（双回执必带）应写进官方 skill/RUNBOOK 上游文案。

## 2026-11-02（第五批）：gate-bundle bug#4 严重修复（authority 按门合并）+ kind 对齐 gate.js

sdd-test r3 实证严重 bug：gate-bundle 单条目覆盖 delivery-authority.json → 丢前面门签发
secret → outcome sweep 重准录先前门收据 FORGED_COLLECTION → 整个 Run 卡死（多门必踩，r3 已 cancel）。
修复：authority 文件改 {runId, environment, entries:[{runId, gate, secret, actionDigest, ...}]}
按门合并——本门同 gate+actionDigest 替换自身、他门条目原样保留；admissionOptionsFor 原生支持
entries 选择（lib/adapters/comet-host-ports.js 注释与实现早已双形状兼容，无需改动）。
另：GATE_DEFAULTS kind 对齐 lib/delivery/gate.js review.kind 硬约束——A=grill-exact-unanimous-consensus
（:239，原自造值被 evaluate 拒绝，实例已实证）、T=independent-test-design-review（:235）、
P=plan-unique-review（:245）；R 原本就对（:242）；V/Kp 无硬约束保留类比缺省。
回归 +2：双门序列（R→A→R secret 原样保留→同门重跑替换不增长）、kind 映射对齐断言。全套 8/8。
RUNBOOK gate-bundle 段补「authority 按门合并，勿手改单条目」警示。

## 2026-11-02（第六批）：app-owned Run 的 design 修订续行缺口（bug#5，上游波次）

sdd-test r4 实证：design.evidence 受理后共识评审触发 design.md 修订 → A outcome sweep
按已录 contentHash 重验拒绝（classic-sdk-application.js:835 无条件相等）→ 三条路全死：
①state revise-design 被 app-owned 组合检查拒；②invalidate-evidence 报 EVIDENCE_WAIT_RESOLVED；
③重交 outcome 旧哈希固化。runtime 操作面穷举（19 个 op）无一可重开已解决证据等待；
revise-wait 仅作用 pending proposal 确认等待。allowDesignDocumentChanges 分支
（classic-handoff.js:363-375）只豁免 handoff 上下文核对中的 design.md 哈希，不触及证据绑定。
步骤顺序属上游内建 comet-classic-full 工作流（consensus 在 evidence 后），scaffold 包不定义排序。
结论：0.5.1 app-owned 无合法修订重证路径 = 上游缺口。RUNBOOK A 门固化时序纪律
（design.md 冻结点 = design.evidence 提交时刻；共识迭代做在提交之前）。
上游修复请求（三项，与 state forget 同批）：design 证据重开 op；sweep 在 handoff 双回执时
采用 allowDesignDocumentChanges 口径比较；composition 步序调整（consensus 先于 evidence）。
r4 处置建议已答复实例：r4 无在手 claim 弃 Run 成本低，推荐 r5 按 evidence-last 时序重跑
（预审迭代定稿 → evidence=定稿签名 → 正式 consensus 全票 → A 束一次过）。
