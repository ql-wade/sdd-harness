# 提案 v2.4：测试用例领域架构（feature map + 人读用例库 + 知识库纳管 + 按门工件契约 + 最佳实践回流）

> 状态：v2.4（三轮共识 2026-11-03 认证收敛：首轮 22 条 → 二轮 28 条 → 三轮 15 条原始
> findings 合并 7 主题逐字落文〔commit 938cf67〕；核心三 ref 冻结快照设计经席2 对抗攻防
> 三轮确认成立。v2.4 = v2.3 + 三轮 3 个遗留 minor 闭合 + 三条业界最佳实践增补（§7，
> delta 终审中）。裁决与处置存档：consensus-round1.md、consensus-round2.md、
> consensus-round2-progress.md（v2.1 席1 处置）、consensus-round3.md、
> consensus-round4.md（本轮 delta 终审，评审完成后归档））
> 提案人：主会话（sdd-harness 框架侧）；触发：sdd-test 验证实例 r6/r7 T 门实证回流 + 项目所有者架构对齐
> 关联：delivery-foundation-rearchitecture（父 change）、ADR-0020（知识栈）、ADR-0023（comet 0.5.1）、
>       test-authoring v1.1.0 domain-cases 约定、whitebox-verify v2.6 交接协议

## Why（为什么做）

sdd-test 验证实例六门实测暴露 T 门四个结构性缺口（r6/r7 实证，二轮三席独立核实全部
属实——含席3 新实锤：r7 实际过 T 的构造载荷来自本地工具变体，c2e4832 已回流 --test-contract
支持，剩余缺口见下）：
1. **人读用例层缺失**：T 门产物只有机器契约，唯一「case」是元判定（c1=「设计充分性」），
   真实用例（TC-01..16）以散文嵌在 oracle 字段——人类无法阅读、执行、评审测试设计
   （项目所有者裁决：测试用例须借鉴领域设计、与 whitebox-verify 同款编写范式、
   有 feature map 指导、入知识库纳管）。
2. **真工件未被门束绑定**：T 束只绑定元判定契约哈希，tests/test-pack.json（16 条结构化
   用例）不在 artifactRefs 内——pack 可在 T 门后漂移而不被 sweep 察觉。
3. **跨构造轮次载荷漂移**：束/outcome/authority 三方来自不同构造轮次（r7 实证三方比对
   实锤，第 4 次同族事故）——构造必须原子化进框架工具。
4. **按门工件契约缺失**：按门主工件无声明、无强制；且 r7 过 T 的本地工具变体证明
   框架工具尚缺 T 完整支持（contractDigest 独立评审绑定 0 处、三键 artifactHashes、
   构造期复验、--feature-map——本变更剩余核心缺口）。

## What Changes（做什么）

### 1. 三层用例结构（正本/变更草稿/判定快照——职责分离）

```
tests/domain-cases/                 # ① 活库正本（git 唯一事实源，跨变更维护，不随 archive 走）
├── features.md                     #    特性登记表（机读格式见 §4；每个 F-ID 注册为
│                                   #    kind:'requirement' 的 basis 条目——见 §4 机制）
├── domain-cases.config.json        #    库级投影配置：basis 路径（含 features.md 条目）、
│                                   #    Journey 维度十键——仅库级字段
├── <domain>.md                     #    领域用例（domain-cases/v1 约定，人读全字段）
└── tests/                          #    库级投影产物目录（正本侧基准）
      （变更内）openspec/changes/<change>/tests/test-pack.json + test-contract.json
                                    # ② 变更投影产物（逐变更字段：project/change/mode/checks/
                                    #    self_checks/unresolved——含 archive 冻结语义，随变更目录
                                    #    入档为持久证据）
.sdd/delivery/gates/t/              # ③ 判定快照（T 门束绑定对象，固定 change 无关路径；
│                                   #    gitignored、被下一 Run 同路径覆写、不跨机审计——易逝层，
│                                   #    持久证据角色由 ② 承担）
├── receipt-bundle.json             #    束
├── test-pack.snapshot.json         #    判定时 pack 快照（gate-bundle 构造时从 ② 拷贝）
└── test-contract.snapshot.json     #    判定时 contract 快照（同上）
```

**config 归层拆分（三轮三席收敛裁定：十键全归属 + basis 数组 id 并集语义）**：
投影 config 共 10 键（lib/delivery/domain-cases.js:114），归层如下——
- ① 库级（tests/domain-cases/domain-cases.config.json）：`basis`（库级条目：F-ID
  requirement 条目〔path 指 features.md〕+ 稳定领域 source 条目）+ `dimensions`（十键）。
- ② 变更级（`<changeDir>/tests/domain-cases.config.json`，host-ports 既有默认锚点）：
  `project` / `change` / `mode` / `design_basis_id`（指向 ② 注册的**本变更 design.md**
  kind:'source' 条目——compileDomainCases :125-126 必需，逐变更内容不可能活在库级①）/
  `checks` / `cleanup`（逐变更 environment/data）/ `self_checks` / `unresolved`。
- **basis 数组合并语义：id 键并集（② 同 id 覆盖、异 id 追加）**——① 的 F-ID 条目不被
  ② 整体替换摧毁（:160 覆盖强制保持生效）；① 库侧基准编译自身所需 ② 键由库级维护
  流程提供。
- AC-1 增补合并行为测试：「① F-ID 条目 + ② design source 合并后投影成功、F-ID 覆盖
  强制仍生效」「同字段冲突 ② 胜」「仅 ① 时回落」三测；合并位置钉死在 compileDomainCases
  入参组装处（调用方读两文件合并后传入）。

**变更内文件命名**：采用 host-ports 既有默认锚点（`<changeDir>/tests/domain-cases.md` +
`domain-cases.config.json`——`verifyDomainAutomation` :159-160 的读取路径）。三层图中
`<domain>.md` 为正本侧文件名；变更内工作文件一律以默认锚点为准（v2.1 曾用的 draft 名
已废弃）。

**字段事实源声明**：用例字段集以 domain-cases/v1 约定（.agents/skills/test-authoring/
references/domain-cases.md + lib/delivery/domain-cases.js）为唯一事实源。两阶段绑定的
实现 = **F-ID 注册为 kind:'requirement' 的 basis 条目**（path 同指 features.md；见 §4），
变更期用例 `Requirement IDs` 指向该 F-ID 条目（既有 :160「每 requirement 需 case 或
unresolved」检查即免费获得 per-F-ID 覆盖强制），`Acceptance: AC-x` 承载变更验收绑定；
`--promote` 时 F-ID 条目随 spec 合并重写为正式 spec 绑定。字段语义如需约定微调，走技能
快照显式替换流程（step 0，必做——首轮席1 finding 3/席3 finding 4 证实现约定下无法
字面表达，非条件分支）。

**archive 期对齐工作项（二轮席2 finding 2，scaffold lib 可修）**：
`comet-host-ports.js verifyDomainAutomation` 重算只读活路径 changeDir（:158-168），无
archive 回退——archive 搬移变更目录后已录 V pass 会被重验翻案（Run 卡死）。本变更对齐
工作项：为投影重算增加 archive 回退（读归档后 ② 冻结证据，同 admissionOptionsFor
:372-389 的既有回退模式），含拒绝路径测试（AC-7）。

### 2. 按门工件契约（三层强制：编译期 + 构造期 + record 期 sweep）

| 门 | 必绑主工件 | review.kind（对齐 gate.js 硬约束） | 本变更范围 |
|---|---|---|---|
| R | proposal.md | requirements-scope-confirmation（:242） | 现状已满足（双轨 AC 为 §7 增补 A 约定层增强，不动门机器） |
| A | design.md | grill-exact-unanimous-consensus（:239） | 维持现状，随各门实证对齐 |
| **T** | **三 ref 快照（束 + pack 快照 + contract 快照；覆盖矩阵 digest 随 contract.dependencyBaselines 同链绑定——三 ref 结构不变，§7 增补 C）** | independent-test-design-review（:235） | **本变更交付** |
| P | task-dag.json 快照 | plan-unique-review（:245） | 维持现状（r7 已实证配方），随 gate-bundle 统一 |
| **V/Kp** | testContract **必填**（gate.js:72 对非 R/A/P 门无条件 parse，缺失即 INVALID_TEST_CONTRACT）；Kp 来源 = T 快照链同源重构；V 消费 testContract 且改变 designOnly 路径——**两门细则另案（archive 回退已由本变更 AC-7 交付，另案以其为前置）** | 待实证 | 另案（显式延迟条款） |

**强制分三层，各司其职**：
- **编译期**（活库治理）：F-ID 覆盖强制（经 §4 requirement-kind basis 机制，compile 内）
  + 覆盖矩阵生成（§7 增补 C，投影产物）
  + `--bind-specs`（ID 可解析性，内建非可选）+ 基线互证（contract.dependencyBaselines 内嵌
  pack 规范化 digest——规范化 = 对解析后对象取 canonicalJson，与 envelopeDigest 同源）。
- **构造期**（gate-bundle，TOCTOU 堵口）：机械复验三件事——(a) contract 内嵌 pack 规范化
  digest === 盘上 pack 同式重算（canonicalJson 同源，非「投影输出字节」字面比对）；
  (b) 重跑 `verifyDomainCaseProjection` 覆盖检查（domain-cases.js 现成导出）；(c) features.md
  已作为 basis 条目进入投影。任一失败拒绝构造。
- **record 期 sweep**（上游原生）：三 ref 快照逐条哈希比对（classic-application.js:229-243
  原生行为，无需上游改动）。

**旗标-门矩阵（如实语义，二轮席2 finding 1/席3 finding 9 修正）**：
`--test-contract`：T 必填缺件拒；R/A/P/Kp/V 传入即拒（gate.js 对 R/A 在**提供了**契约时
会真正解析——畸形即 INVALID_TEST_CONTRACT 硬拒；P 跳过解析；Kp/V 无条件 parse——拒收
必须落在构造期工具，否则制度化永败断言）。`--feature-map`：注入 features.md 作为 basis
文件条目（同 §4 机制），触发构造期复验 (c)。

**强制链改动点（权威面修正）**：artifactRefs 权威声明在 **composition.json 的
composition.extensions**（build-application.mjs :86/:331/:439 消费，编译为静态字符串数组
入 application.mjs）；extensions/*.json 为对象形状源文档（{ref,kind,hashBinding,
contentAddressing}）。断言写法：`extensions[*].artifactRefs[].ref 集合 === composition.
extensions[同 id].artifactRefs 字符串集合`（形状不同不做 deepEqual）。验收以「composition
扩三 ref + 官方重编译（应用版本递增）+ foundation 重导出 lock（`foundation verify` 通过）
+ 重装 + 上述相等断言（foundation-distribution 新增）」为准。

### 3. 绑定键两阶段（字段语义按 domain-cases/v1 约定归位）

- **变更期**：用例 `Acceptance: AC-x`（该字段的设计用途）承载第一阶段绑定；proposal 验收
  节强制机器可解析 AC-x 编号约定（本提案验收节自举 AC-1..AC-7）；`Requirement IDs` 指向
  F-ID basis 条目（§4 机制）。
- **archive 晋升**（compile `--promote`，内建强制顺序：必须在 spec delta 合并之后、对
  正本写入；非可选旗标）：F-ID 条目随 spec 合并重写为正式 spec 绑定——`Requirement IDs`
  填 **capability 限定 spec 需求键**（`<capability>#<需求标题>`；约束：需求标题不得含
  半角逗号（`,` 为字段分隔符），冲突即拒绝；同 capability 内标题唯一性约束、冲突亦拒绝），
  并记录该需求的内容 digest 进用例元数据（后续 spec 漂移可检）。无 spec delta 的变更
  （纯实现修复类）：用例仍晋升进正本，Requirement IDs 标记 `change:<name>#AC-x` 引用
  冻结于 archive 快照的 proposal 验收——如实标注引用性质。
- **bootstrap 前置事实**：openspec/specs/ 现为空（仅 .gitkeep）；首条种子 spec 由
  delivery-foundation delta 归档产生，列为首个真实晋升的前置。其前的 T 门变更晋升走
  无 delta 路径。
- **① 基准投影演化声明（三轮席1 finding 4 三选一裁定）**：晋升后用例保留 F-ID 引用，
  spec 映射由 features.md 的「spec 绑定」列承载（不重写用例 Requirement IDs 为 spec 键）；
  ① 库级基准投影仅限晋升前语料——晋升后整库基准投影需先注册 spec requirement 条目
  （归档轮按需启用）。

### 4. features.md 机读格式与 F-ID 覆盖机制

固定字段（每行一特性）：`F-ID | 来源引用（design.md 节锚点） | 状态（proposed/covered/
unresolved）| Journey 维度（A..J 之一）| spec 绑定（晋升后填）`。状态语义澄清（v2.4，
随 §7 增补 C）：`proposed` = 已登记未覆盖的**编写期状态**，投影前必须转为 covered 或
显式 unresolved（否则 ：160 拒投影）——编译器可达状态仅 covered/unresolved 二态；
Journey 维度列**降级为纯分组统计字段，不承载覆盖语义**（绑定唯一键 = Requirement IDs
→ F-ID，见 §7 增补 C）。每个 F-ID 的验收节强制双轨（≥1 机制 AC + ≥1 体验 QC——
§7 增补 A）。

**机制（采用二轮席2 发现的原生解）**：每个 F-ID 注册为 `kind:'requirement'` 的 basis
条目（path 同指 features.md，id 唯一）→ domain-cases.js:160 既有「每 requirement 需
case 或 unresolved」检查即**免费获得** per-F-ID 覆盖强制（未覆盖 → unresolved 显式，
否则拒投影）；features.md 字节随条目进 basis（覆盖强制的作用域被哈希绑定，TOCTOU
(材料) 闭合）；覆盖逻辑位于 compileDomainCases 内 → gate-bundle 构造期复验 (b) 闭环。
`--feature-map <file>` = features.md 的 basis 文件注入（同 --test-contract 模式），触发
构造期复验 (c)。如实声明强制作用域：覆盖检查只覆盖**已注册**的 F-ID 条目——features.md
新增行而未在 config 注册对应条目时不被强制；「行↔条目一致性」属登记侧治理（与已声明
例外同族，不加解析器）。

### 5. 知识库纳管（模型 B：仓库为唯一事实源，llmwiki 为纳管镜像）

- 正本：tests/domain-cases/（git 管）。纳管三动作：**上架**=llmwiki MCP create/edit
  （hook kb-write-protection 强制 MCP 路径）；**编目**=reindex（SQLite+FTS 检索）；
  **验收**=读回哈希与正本比对。
- **机械消费口径（二轮席2 finding 6 降级裁定）**：KB 页在项目根外，哈希结构上不可入
  artifactRefs——纳管以**发布回执**承载：`.sdd/delivery/gates/t/kb-publish-receipt.json`
  （页哈希 + 正本 digest + 时间戳），落盘并记录于 T outcome 的 gateEvidence 字段。
  receipt 本身不入 artifactRefs（sweep 不强制）且 gateEvidence 记录可被复制——**如实
  声明：非 sweep 强制、非防伪造**；Kp/Kt 消费语义随其门实证另案（delivery-architecture
  :259 的 Kt 架构命名无门扩展实现，如实登记）。
- KB 页面落 `wiki/testing/` 分类（对齐 llmwiki-structure.md）；**哈希比对对象 = 正本文件
  digest 记录在页面 frontmatter、读回比对该记录**（非全文镜像字节相等——对「不重复存
  全文」结构约定的显式裁决：KB 存摘要 + 指针 + 覆盖矩阵，全文以正本为准）。
- 环境现状如实标注：llmwiki MCP 本环境当前连接失败（ENOENT），纳管验收路径依赖其恢复，
  实施时重新核实。
- **③ 判定快照层的易逝性声明（二轮席2 finding 9）**：`.sdd/` gitignored——三快照不入
  git、被下一 Run 同路径覆写、archive 后跨机/新 clone 无法审计 T 快照；Run 生命期（含
  archive sweep）内语义稳定（已验证），持久证据角色由 ②（变更目录，随 archive 入档）
  承担。另声明：pack 内嵌 project_root（realpath）→ pack digest 与主机路径绑定——
  归档后的 ② 在另一台机器重算不匹配其契约内嵌 baseline 为**预期行为**（T 判定非跨机
  姿态）。AC-6 的 AGENTS.md 增补含此声明。

### 6. 原子构造纪律（既有修复的制度化，不变）

束 + outcome + authority entries 必须同一构造轮次原子产出（gate-bundle 单次调用）；
record 前禁止重跑构造器（任何重跑 = 新随机量 = 全部先前产物作废，r7 三连拒根因）。
手工多脚本流水线退役；「从盘上束推导 outcome」的自洽推导保留为事故恢复手段。

### 7. 需求质量与人类验收约定（业界最佳实践回流，v2.4）

三条增补来自三维度最佳实践研究（需求质量门 / 人类验收制度化 / 特性覆盖矩阵；
2026-11-03 研究综合，来源与共识强度分级存档于 consensus-round4.md）。每条锚定业界
标准原文或多源同构共识，落点为**约定层与编译器生成物**——不新增门机器、不新增
SDD.Delivery.* 契约面格式（features.md 登记表例外已在非目标声明）。

**增补 A — R 门双轨验收标准（机制验收 + 体验验收）**

对标 ASPICE SWE.1.BP5（每条需求的定性 + 定量验证准则——VDA 官方过程模型原文）与
ISO/IEC/IEEE 29148 verifiable 硬属性（AC = 可判定的条件或度量，非描述散文）：

- features.md 每个 F-ID 的验收节强制双轨：**≥1 条机制 AC**（quantitative：可判定
  pass/fail 的条件/度量/可执行 check）+ **≥1 条体验 QC**（qualitative：评审者按
  charter 观察的定性判据，GWT 单行为格式，Then 必须是可观察结果）。
- 每条 AC/QC 标注 verification route（test / inspection）；测试不可达的验证项显式
  登记兜底路径（inspection/演示）。
- 不可验证条目不得过 R 门：必须显式 `unresolved`（ISO 29148 verifiable 属性）。
- 防门槛化（Cohn 反模式警告：DoR 过严退化为 stage-gate 瀑布）：门只查**存在性 +
  可验证性**，不查措辞完美、不设逐条评审通过才放行。
- **机械可见性边界（如实）**：features.md 验收节不在编译器解析面内（只哈希不解析，
  §4 已声明同族例外）——双轨性本身不做机器强制，属登记侧治理；机器可见性 = 矩阵
  per-F-ID case 数 + 显式 unresolved 行（§7 增补 C）。
- 落点：features.md 格式定义（§4）+ RUNBOOK R 门节模板行；R 门
  requirements-scope-confirmation 判定机器维持现状。

**增补 B — V 门人类验收步骤（charter 制度化，非橡皮图章）**

对标 SBTM（Bach：charter + timebox + session sheet + PROOF debrief——多源同构）与
UAT 证据化签署（已执行场景 + 结论 + known issues 清单 + 显式 go/no-go + audit trail）：

1. V 门人类验收 = 一页 charter session：`Explore <F-ID> With <入口/工具> To discover
   <风险>`，30–60 分钟 timebox，验前声明测试数据与环境。charter 不是脚本——把期望
   结果清单塞进 charter 即退化了探索价值。
2. session sheet 实时记录：时间戳 + BUG/OBSERVATION/QUESTION 三标签；截图挂 check-id。
3. PROOF debrief 五问：charter 完成度 / 意外发现 / 阻塞 / 后续 charter / 可升级为
   回归用例的发现。
4. **证据三元组纪律**（TestCollab「无上下文截图不算证据」原则，与本仓 Evidence/
   Check ID 字段设计独立契合）：check-id + 期望引用（AC/QC）+ 评审决定，缺任一不算
   证据；每 QC-x 一行（截图 + 结论 pass/fail + 备注）+ **known-issues 显式清单**
   （禁止静默豁免）+ 显式 go/no-go 决定（记录后的决定，非「没出事就算过」）。
5. 转化通道：探索中发现可复现问题 → 升级为机制 AC（进 features.md，回到 R 门双轨
   闭环）；无 diff 场景允许机械 auto-pass，人力只花在有 diff 处（Buddy/Argos/
   Chromatic 同构模式——采模式不采产品，单一厂商流水线形态不采）。
- **落点与边界（如实）**：本变更内落**约定层**（RUNBOOK V 门节模板行）；V outcome
  gateEvidence 字段形状为本变更给 V/Kp 另案的输入（另案以其为前置，机械强制随另案）——
  本变更不实现 V 门机器（非目标维持）。

**增补 C — 特性覆盖矩阵（生成物，非手维护物）**

对标自动化 RTM 业界共识（requirement↔test 双向映射长在工件元数据上、矩阵由工具
生成、未覆盖自动标旗——Perforce/Parasoft/Jama/Abstracta 一致将手工维护矩阵列为
反模式）与 Serenity BDD/Allure 层级标签三态覆盖（零覆盖必须显式可见，不是空白）：

- **绑定键与分组维度分离**：feature→case 绑定唯一键 = `Requirement IDs → F-ID`
  （§4 requirement-kind basis 机制；:160 检查原生承载 case→feature 方向）；
  **`Dimensions` 降级为纯 Journey 分组统计字段，不承载覆盖语义**（§4 已改）。
- 编译器**生成** feature-coverage matrix（每已注册 F-ID 一行：case 数 / Acceptance
  绑定数 / Journey 维度 / level / 状态 covered|unresolved）——矩阵是投影产物，digest
  随 contract.dependencyBaselines 同链绑定（三 ref 结构不变），进 T 门构造期复验
  （与 (b) 同式重跑）；**禁止手写矩阵**。
- 覆盖显式化：:160 强制使「已注册但零覆盖且无 unresolved 条目」不可能静默存在
  （拒投影）——矩阵的 unresolved 行即显式零覆盖（Serenity「no tests」语义的对应物）；
  未注册行不在矩阵作用域（登记侧治理，§4 已声明例外）。proposed 不是投影可达状态
  （§4 已澄清）。
- feature→case 方向报告由矩阵本体承载；promote 后 spec 漂移一致性检查（ASPICE
  BP6/BP7 语义）由 §3 digest 记录承载。
- **列演进声明（如实）**：机制 AC 数 / 体验 QC 数分列**不在本变更承诺内**——现
  domain-cases/v1 用例格式无 track 区分字段；若 step 0 技能快照替换为用例引入
  track 语义，矩阵可升级分列（可选演进，随实证另议）。

## 非目标（明确不做）

- 不修改 @rpamis/comet 运行时（build 相位守卫严格性与 failed-terminal 终态语义维持上游
  设计；revise 命令门 + evidence-last 纪律覆盖；三项 UX 请求已登记上游波次）。
- 不在本提案内实现 V/Kp 门的工件规格细则（另案，以其为前置）。
- host-ports verifyDomainAutomation 的 archive 回退**实现属本变更**（§1 对齐工作项，
  AC-7，scaffold lib 可修）。
- 不做 TestPack 自动化执行态（投影维持 design-only；作者执行来源资格化另案）。
- 不引入 TestPack v1 之外的新机读**契约**格式（SDD.Delivery.* 契约面不变）；features.md
  为正本侧治理登记表（编译器消费），不属于交付契约面——此为已声明例外。
- 不改动 vendored 技能正文；字段语义变化走技能快照显式替换流程（step 0，必做）。
- §7 三条最佳实践增补落**约定层与编译器生成物**：不新增门机器（R 门判定、V/Kp 门
  机器维持现状/另案边界不变）；V outcome gateEvidence 机械强制随 V/Kp 另案；矩阵
  机制/体验分列为可选演进不承诺（§7 增补 C 列演进声明）。

## 验收（AC 编号，机器可解析——自举本提案自己的绑定约定）

- **AC-1**：编译器扩展落地并通过拒绝路径回归：F-ID 覆盖强制经 requirement-kind basis
  机制（覆盖/未覆盖→unresolved/缺 features.md 三态各一测）+ `--bind-specs`（存在/不存在
  两测）+ `--promote`（delta 合并前拒、合并后晋升成功、重绑 digest 元数据三测）+
  config 两层合并行为三测（同字段冲突 ② 胜 / 仅 ① 回落 / 合并后 F-ID 覆盖强制仍生效），
  合并位置钉死在 compileDomainCases 入参组装处。
- **AC-1（v2.4 扩）覆盖矩阵生成**：矩阵产物每已注册 F-ID 一行且字段齐全（case 数 /
  Acceptance 绑定数 / Journey 维度 / level / 状态）两测；unresolved 行显式零覆盖 +
  covered 行计数正确两测；矩阵 digest 入 contract.dependencyBaselines 一测。
- **AC-2**：gate-bundle T 支持：`--test-contract`/`--feature-map` 注入 + 独立评审绑定补
  contractDigest + outcome.artifactHashes 三 ref 键齐全 + 构造期三件机械复验（baseline
  digest canonicalJson 同源比对 / verifyDomainCaseProjection 重跑 / features basis 校验）
  各有拒绝路径测试；R/A/P/Kp/V 传入即拒（旗标-门矩阵）各有断言。（v2.4 扩：构造期
  复验含矩阵 digest 同链复验——与 (b) 同式重跑，拒绝路径一测。）
- **AC-3**：T 束三 ref sweep 端到端：composition.extensions 扩三 ref → 官方重编译（应用
  版本递增）→ foundation 重导出 lock（`foundation verify` 通过）→ 重装 →
  extensions↔composition artifactRefs **ref 集合相等断言**（形状不同不做 deepEqual，
  foundation-distribution 新增）→ 合成 fixture 上 record 期三 ref 哈希比对通过、篡改任一
  快照即拒。
- **AC-4**：旗标-门矩阵两层断言：(i) 工具级——`--test-contract` + gate≠T → 构造拒绝
  （五门各一断言，拒收落在构造期）；(ii) gate.js 差异化 parse 行为（R/A 提供契约即真正
  解析、P 跳过、Kp/V 无条件 parse）仅作设计依据记录，**不作验收断言**。
- **AC-5**：KB 发布回执：kb-publish-receipt 结构（含 runId + change 绑定字段——比对
  脚本顺带校验与当前 Run 一致，堵跨 Run/变更复制）+ 读回比对脚本 + receipt 出现在
  T outcome.gateEvidence 断言；llmwiki ENOENT 现状在验收中如实标注（该路径验证依赖其
  恢复）。
- **AC-6**：文档自举：RUNBOOK T 门节改写（domain-cases → 投影 → 纳管 → 束）+ R 门
  双轨 AC 模板行 + V 门人类验收 charter 模板行（§7 增补 A/B，v2.4）+ AGENTS.md
  §1 目录清单与 §4 事实来源表增补 `tests/domain-cases/` 行（运行时投影配置文件名为
  `domain-cases.config.json`）+ docs/architecture/comet-ai-devops-convergence.md 的 T 门
  交付物行同步 + test/classic-integration.test.js 的单 ref 形状断言更新 + AGENTS.md
  增补 ③ 快照层易逝性声明。
- **AC-7**：host-ports verifyDomainAutomation archive 回退：archive 搬移变更目录后已录
  V pass 重验通过（读归档后 ② 冻结证据）+ 搬移前篡改即拒，含拒绝路径测试。

## 实施顺序（共识通过后；②③ 必须原子就位——中间窗口实例升级安装会让 T record 必败）

0. 技能快照显式替换（**必做**）：domain-cases/v1 字段语义扩展（F-ID basis 条目 + 两阶段
   Requirement IDs 含义）——首轮席1/席3 证实现约定无法字面表达。
1. 编译器扩展（AC-1，含覆盖矩阵生成——v2.4）。
2. composition.extensions 扩三 ref + 官方重编译（应用版本递增）+ foundation 重导出
   lock + test/classic-integration.test.js 单 ref 形状断言同步更新（AC-3 前半 +
   AC-6 断言行——三轮席3 finding 6 闭合：断言更新并入本原子变更集，不留红到 step 6）。
3. gate-bundle T 支持（AC-2/AC-4）——与 2 原子合入。
4. host-ports verifyDomainAutomation archive 回退（AC-7）。
5. RUNBOOK/知识库接线（AC-5/AC-6 文档落点全认领：T 门节改写 + R 门双轨 AC 行 + V 门
   charter 行 + AGENTS.md §1/§4 + ③ 易逝性声明 + convergence 文档 T 门交付物行）。
6. foundation 重冻结 + 全量回归（完成判据：npm test 全绿 + check.sh 通过 +
   `foundation verify` 通过）。
7. 实例侧：foundation 再分发（**先于** --upgrade——避免「T record 必败窗口」）→ 应用
   `--upgrade` 安装 → r7 存量迁移（16 case 全字段重写为 domain-cases/v1、TC-14 拆分
   （单 Acceptance 规则）、语义维度映射进 Journey 十键 config、features.md 登记、config
   拆分、KB 页面）→ 在飞 Run（旧包判定，构造期验收 AC-2）与升级后新 Run（record 期验收
   AC-3 后半）双层验证。

## 下游迁移成本声明（如实）

r7 存量 16 条 case 的迁移 = 一次 T 设计工作重做（全字段重写 + TC-14 拆分 + 维度映射 +
config 拆分 + features.md + KB 页面），非「补人读字段」。双层验收见实施顺序 7。
revise 重放失败即烧 Run（r6 实证）——回退路径 = 弃 Run 保证据链重跑，已在 RUNBOOK
RUN_TERMINAL 行声明。
