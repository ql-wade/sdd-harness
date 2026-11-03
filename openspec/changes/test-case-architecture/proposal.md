# 提案 v2.1：测试用例领域架构（feature map + 人读用例库 + 知识库纳管 + 按门工件契约）

> 状态：v2.1（首轮三席 22 条 findings 已修订；二轮席1 8 条 findings 已修订，见
> consensus-round2-progress.md；二轮席2/席3 评审中）
> 评审记录：首轮三席结论与修订对照见本目录 consensus-round1.md（实存，提交于 c2e4832；
> 二轮席1 的 find 未命中属误报，盘上与 git 双证）；二轮席1 8 条处置见
> consensus-round2-progress.md
> 提案人：主会话（sdd-harness 框架侧）；触发：sdd-test 验证实例 r6/r7 T 门实证回流 + 项目所有者架构对齐
> 关联：delivery-foundation-rearchitecture（父 change）、ADR-0020（知识栈）、ADR-0023（comet 0.5.1）、
>       test-authoring v1.1.0 domain-cases 约定、whitebox-verify v2.6 交接协议

## Why（为什么做）

sdd-test 验证实例六门实测暴露 T 门四个结构性缺口（r6/r7 实证，三席首轮独立核实全部属实）：
1. **人读用例层缺失**：T 门产物只有机器契约，唯一「case」是元判定（c1=「设计充分性」），
   真实用例（TC-01..16）以散文嵌在 oracle 字段——人类无法阅读、执行、评审测试设计
   （项目所有者裁决：测试用例须借鉴领域设计、与 whitebox-verify 同款编写范式、
   有 feature map 指导、入知识库纳管）。
2. **真工件未被门束绑定**：T 束只绑定元判定契约哈希，tests/test-pack.json（16 条结构化
   用例）不在 artifactRefs 内——pack 可在 T 门后漂移而不被 sweep 察觉。
3. **跨构造轮次载荷漂移**：手工多脚本流水线下束/outcome/authority 三方来自不同构造轮次
   （r7 实证：盘上束↔authority 配对一致、outcome 独一值，第 4 次同族事故）——构造必须
   原子化进框架工具。
4. **按门工件契约缺失**：gate-bundle 把 R 门配方（inputs=proposal）套给所有门，各门主工件
   无声明、无强制；且 r7 实际过 T 的构造载荷来自**未回流提交的本地工具变体**（已提交工具
   今天无法通过 T 门）——构造漂移本身即需本变更回流。

## What Changes（做什么）

### 1. 三层用例结构（正本/草稿快照分离 + archive 晋升）

```
tests/domain-cases/                 # ① 活库正本（git 唯一事实源，跨变更维护，不随 archive 走）
├── features.md                     #    特性登记表（机读格式见下）
├── domain-cases.config.json        #    投影配置（basis 路径、Journey 维度十键、checks、cleanup）
├── <domain>.md                     #    领域用例（domain-cases/v1 约定，人读全字段，Maintenance 源）
├── tests/test-pack.json            #    投影产物（正本侧，含 feature 覆盖矩阵——TestPack 附加
│                                    #    字段，schema-kernel unknownFields 默认容忍）
└── tests/test-contract.json        #    投影产物（契约视图）
openspec/changes/<change>/
├── domain-cases.draft.md           # ② 本变更新用例草稿（T 门评审对象）
└── tests/                          #    ② 的投影产物随变更目录 archive 冻结为证据
.sdd/delivery/gates/t/              # ③ 判定快照（T 门束绑定对象，固定 change 无关路径）
├── receipt-bundle.json             #    束
├── test-pack.snapshot.json         #    判定时 pack 快照（gate-bundle 构造时从正本拷贝）
└── test-contract.snapshot.json     #    判定时 contract 快照（同上）
```

**职责分离（首轮 blocker 的设计裁决）**：sweep 钉的是**冻结的已判快照**（③，固定
change 无关路径——archive 后不被 changeDir 映射搬走，回溯语义稳定）；**活库**（①②）
由编译期强制（覆盖 + 基线互证 + 晋升纪律）治理。两者不混：sweep 回答「当时判了什么」，
编译器回答「现在是什么」。

**config 层显式入图**：domain-cases.config.json 是编译器硬依赖（无 config 即拒），
归①正本侧；`comet-host-ports.js verifyDomainAutomation` 默认读 `<changeDir>/tests/
domain-cases.md + domain-cases.config.json` 的路径耦合在本变更内同步（变更内文件命名
保持既有默认，正本位置走 run input override 或 host-ports 路径参数，实施②③时一并对齐）。

**变更期实际路径策略**：变更内草稿与投影文件命名**保持 comet-host-ports 既有默认**
（`<changeDir>/tests/domain-cases.md` + `domain-cases.config.json`——`verifyDomainAutomation`
的读取锚点，:159-160）；`tests/domain-cases/` 正本位置对变更内投影走 `run.input.domainCases`
override 接线（运行时原生字段，无需改 comet）。三层结构图中的 `domain-cases.draft.md` 为
正本侧草稿的示意名，实际文件名以默认锚点为准。

**字段事实源声明**：用例字段集以 domain-cases/v1 约定（.agents/skills/test-authoring/
references/domain-cases.md + lib/delivery/domain-cases.js）为唯一事实源；`Requirement IDs`
为必填单值字段且须引用 config.basis 条目——两阶段绑定的实现 = 变更期在 config.basis 登记
**proposal 派生的 requirement 条目**（Requirement IDs 指向它），晋升时该条目随 spec 合并
重写为正式 spec 需求绑定；若此建模仍需约定语义微调，走技能快照显式替换流程（列为本提案
前置，见实施顺序 step 0，**必做非条件**）。

### 2. 按门工件契约（三层强制：编译期 + 构造期 + record 期 sweep）

| 门 | 必绑主工件（构造期缺件即拒） | review.kind（对齐 gate.js 硬约束） |
|---|---|---|
| R | proposal.md | requirements-scope-confirmation（:242） |
| A | design.md | grill-exact-unanimous-consensus（:239） |
| **T** | **三 ref 快照（束 + pack 快照 + contract 快照）** | independent-test-design-review（:235） |
| P | task-dag.json 快照 | plan-unique-review（:245） |
| V | verification 三件套（具体形状待实证） | （无硬约束，args.kind 可覆盖） |
| Kp | closeout（具体形状待实证） | （同上） |

**强制分三层，各司其职**：
- **编译期**（活库治理）：feature 覆盖强制（每 F-ID ≥1 case，未覆盖 → unresolved 显式否则
  拒投影）+ `--bind-specs`（ID 可解析性）+ 基线互证（contract.dependencyBaselines 内嵌
  pack 规范化 digest）。
- **构造期**（gate-bundle，TOCTOU 堵口）：机械复验三件事——(a) contract 内嵌 pack digest
  === 盘上 pack 规范化 digest（规范化 = 投影输出字节，由编译器同轮写出）；(b) 重跑
  `verifyDomainCaseProjection`（domain-cases.js 现成导出）覆盖检查；(c) features.md 已作为
  basis 条目进入投影（否则 feature 覆盖是对未绑定文件执行）。任一失败拒绝构造。
- **record 期 sweep**（上游原生）：三 ref 快照逐条哈希比对（classic-application.js:229-243
  原生行为，无需上游改动）。

**旗标-门矩阵**：`--test-contract`/`--feature-map`：T 必填、缺件拒；R/A/P/Kp 传入即拒
（非静默忽略——gate.js:72 对 R/A/P 结构性忽略 testContract，V 门消费会改变 designOnly
判定路径）；V 门 testContract 消费语义随 V 门实证另案。

**强制链改动点（按首轮席2 finding 2 修正）**：artifactRefs 的权威声明在
**composition.json 的 composition.extensions**（build-application.mjs :86/:331/:439 消费，
编译为静态字符串数组入 application.mjs）；extensions/*.json 是装饰性源文档。验收以
「composition 扩 ref + 官方重编译 + relock + 重装 + extensions↔composition artifactRefs
相等断言（foundation-distribution 套件新增）」为准，杜绝字面满足。

### 3. 绑定键两阶段（字段语义按 domain-cases/v1 约定归位）

- **变更期**：用例 `Acceptance: AC-x`（该字段的设计用途）承载第一阶段绑定；proposal 验收
  节强制机器可解析 AC-x 编号约定（本提案自身验收节自举改用 AC-x）；`Requirement IDs`
  晋升前维持 unresolved（贴合 unresolved 纪律——不猜测未来 spec 形状）。
- **archive 晋升**（compile `--promote`，内建强制顺序：必须在 spec delta 合并之后、对
  正本写入；非可选旗标）：填 `Requirement IDs` 为 **capability 限定 spec 需求键**
  （`<capability>#<需求标题>`；约束：需求标题不得含半角逗号（`,` 为字段分隔符），冲突
  即拒绝；同 capability 内标题唯一性约束、冲突亦拒绝），并记录该需求的内容 digest 进
  用例元数据（后续 spec 漂移可检）。无 spec delta 的变更（纯实现修复类）：用例仍晋升进
  正本，Requirement IDs 标记 `change:<name>#AC-x` 引用冻结于 archive 快照的 proposal
  验收——如实标注引用性质。
- **bootstrap 前置事实**：openspec/specs/ 现为空（仅 .gitkeep）；首条种子 spec 由
  delivery-foundation delta 归档产生，列为首个真实晋升的前置。其前的 T 门变更晋升走
  无 delta 路径。

### 4. features.md 机读格式（与既有四套 ID 空间的关系声明）

固定字段（每行一特性）：`F-ID | 来源引用（design.md 节锚点） | 状态（proposed/covered/
unresolved）| Journey 维度（A..J 之一）| spec 绑定（晋升后填）`。与既有 ID 空间的关系：
F-ID 是**特性层覆盖登记**，叠加于 Journey-A..J 维度（投影 config 十键维持不变——case 的
Dimensions 仍属十键）；用例引用 F-ID 于 `Acceptance` 或专字段（以 domain-cases/v1 约定
的扩展方式落地，字段语义变化走技能快照显式替换前置）。编译器强制：每个 F-ID ≥1 case；
case 引用的 F-ID 必须在 features.md 登记。

### 5. 知识库纳管（模型 B：仓库为唯一事实源，llmwiki 为纳管镜像）

- 正本：tests/domain-cases/（git 管）。纳管三动作：**上架**=llmwiki MCP create/edit
  （hook kb-write-protection 强制 MCP 路径）；**编目**=reindex（SQLite+FTS 检索）；
  **验收**=读回哈希与正本比对。
- **机械消费口径（按首轮席2 finding 5 修正）**：KB 页在项目根外，哈希结构上不可入
  artifactRefs——纳管以**发布回执**承载：`.sdd/delivery/gates/t/kb-publish-receipt.json`
  （页哈希 + 正本 digest + 时间戳），进 T outcome 的 gateEvidence 字段，供 Kp/Kt 机械
  消费；「未纳管即未定稿」降级为 receipt-backed 纪律（如实声明非 sweep 强制）。
- KB 页面落 `wiki/testing/` 分类（对齐 llmwiki-structure.md）；**哈希比对对象 = 正本文件
  digest 记录在页面 frontmatter、读回比对该记录**（非全文镜像字节相等——对「不重复存
  全文」结构约定的显式裁决：KB 存摘要 + 指针 + 覆盖矩阵，全文以正本为准）。
- 环境现状如实标注：llmwiki MCP 本环境当前连接失败（ENOENT），纳管验收路径依赖其恢复，
  实施时重新核实。

### 6. 原子构造纪律（既有修复的制度化，不变）

束 + outcome + authority entries 同一构造轮次原子产出（gate-bundle 单次调用）；record
前禁止重跑构造器（r7 三连拒根因）。手工多脚本流水线退役。

## 非目标（明确不做）

- 不修改 @rpamis/comet 运行时（build 相位守卫严格性与 failed-terminal 终态语义维持上游
  设计；revise 命令门 + evidence-last 纪律覆盖；三项 UX 请求已登记上游波次）。
- 不在本提案内实现 V/Kp 门的工件规格细则（随各自门实证时按本架构对齐）。
- 不做 TestPack 自动化执行态（投影维持 design-only；作者执行来源资格化另案）。
- 不引入 TestPack v1 之外的新机读**契约**格式（SDD.Delivery.* 契约面不变）；features.md
  为正本侧治理登记表（编译器消费），不属于交付契约面——此为已声明例外。
- 不改动 vendored 技能正文；字段语义变化走技能快照显式替换流程（前置动作，见实施顺序）。

## 验收（AC 编号，机器可解析——自举本提案自己的绑定约定）

- **AC-1**：编译器扩展落地并通过拒绝路径回归：feature 覆盖强制（覆盖/未覆盖/unresolved
  三态各一测）+ `--bind-specs`（存在/不存在两测）+ `--promote`（delta 合并前拒、合并后
  晋升成功、重绑 digest 元数据三测）。
- **AC-2**：gate-bundle T 支持：`--test-contract`/`--feature-map` 注入 inputs.testContract
  + 独立评审绑定补 contractDigest + outcome.artifactHashes 三 ref 键齐全；缺件拒绝；
  构造期三件机械复验（baseline digest / verifyDomainCaseProjection / features basis）各有
  拒绝路径测试。
- **AC-3**：T 束三 ref sweep 端到端：composition.extensions 扩三 ref → 官方重编译（应用
  版本递增）→ relock → foundation-distribution 新增 extensions↔composition artifactRefs
  相等断言 → 合成 fixture 上 record 期三 ref 哈希比对通过、篡改任一快照即拒。
- **AC-4**：旗标-门矩阵：T 必填/缺件拒；R/A/P/Kp 传入即拒各有断言。
- **AC-5**：KB 发布回执：kb-publish-receipt 结构 + 读回比对脚本；llmwiki ENOENT 现状
  在验收中如实标注（该路径验证依赖其恢复）。
- **AC-6**：文档自举：RUNBOOK T 门节改写（domain-cases → 投影 → 纳管 → 束）+ AGENTS.md
  §1 目录清单与 §4 事实来源表增补 `tests/domain-cases/` 行（运行时投影配置文件名为
  `domain-cases.config.json`）+ docs/architecture/comet-ai-devops-convergence.md 的 T 门
  交付物行同步 + test/classic-integration.test.js 的单 ref 形状断言更新（composition 扩
  ref 的配套，点名列入实施）。

## 实施顺序（共识通过后；②③ 必须原子就位——中间窗口实例升级安装会让 T record 必败）

0. 技能快照前置核对：domain-cases/v1 字段语义变化（Requirement IDs 两阶段含义）→ 显式
   替换流程启动（若约定无需改动则记录「以现约定为准」）。
1. 编译器扩展（AC-1）。
2. composition.extensions 扩三 ref + 官方重编译（应用版本递增）+ relock（AC-3 前半）。
3. gate-bundle T 支持（AC-2）——与 2 原子合入。
4. RUNBOOK/知识库接线（AC-5/AC-6 的 RUNBOOK 部分）。
5. foundation 重冻结 + 全量回归（npm test + check.sh + foundation verify——完成判据）。
6. 实例侧：foundation 再分发 + 应用 `--upgrade` 安装（硬前置）→ r7 存量迁移（16 case 全
   字段重写为 domain-cases/v1、TC-14 拆分（单 Acceptance 规则）、语义维度映射进 Journey
   十键 config、features.md 登记、KB 页面）→ 新 Run 验证 record 期三 ref sweep（AC-3
   后半）。

## 下游迁移成本声明（如实）

r7 存量 16 条 case 的迁移 = 一次 T 设计工作重做（全字段重写 + 拆分 + 维度映射 + config +
features.md + KB 页面），非「补人读字段」。r7 在飞 Run 绑旧包：新 artifactRefs 双工件对
r7 不生效——构造期验收（AC-2）以 r7 后继 Run 证明；record 期端到端验收（AC-3 后半）以
升级包后的全新 Run 证明。revise 重放失败即烧 Run（r6 实证）——回退路径 = 弃 Run 保证据
链重跑，已在 RUNBOOK RUN_TERMINAL 行声明。
