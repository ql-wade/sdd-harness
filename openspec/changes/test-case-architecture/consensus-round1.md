# 首轮共识评审结论存档（round 1，2026-11-03）

> 三席透镜：①架构一致性 ②契约严密性/对抗攻防 ③可实施性与下游影响。
> 全部 findings 已逐条纳入 v2 修订（本目录 proposal.md v2），本文为裁决存档。

## 裁决

| 席 | 透镜 | VERDICT | findings |
|---|---|---|---|
| 1 | 架构一致性 | REVISE-REQUIREMENTS | 8（4 major / 4 minor） |
| 2 | 契约严密性 | REPAIR | 7（1 blocker / 4 major / 2 minor） |
| 3 | 可实施性与下游 | REVISE-REQUIREMENTS | 9（6 major / 3 minor） |

**共识未过** → 按 findings 修订出 proposal v2，发起第二轮。

## 席1 findings（架构一致性）

1. major — `--promote` 重绑映射来源未定义（spec 需求为散文标题，AC-x↔标题无机械链接）。
   v2 处置：绑定键两阶段归位——变更期 `Acceptance: AC-x`（domain-cases/v1 该字段的设计
   用途），Requirement IDs 晋升前置 unresolved；`--promote` 内建强制顺序 + capability
   限定键 + 内容 digest 元数据。
2. major — spec 需求 ID 形状未钉死（散文标题/改名孤儿/跨 capability 唯一性）。
   v2 处置：capability 限定键（`<capability>#<需求标题>`）+ 唯一性约束/冲突拒绝声明 +
   晋升记录需求内容 digest（漂移可检）。
3. major — 字段语义冲突（Requirement IDs 数组 vs Acceptance 单值混用）。
   v2 处置：按 domain-cases/v1 字段设计用途归位（见 1）；字段事实源声明指向约定文件。
4. major — specs/ 现为空 + 无 delta 变更晋升路径未定义。
   v2 处置：bootstrap 前置事实声明（首条种子 spec 由 delivery-foundation delta 归档产生）
   + 无 delta 路径（Requirement IDs 标 `change:<name>#AC-x` 引用冻结快照）。
5. minor — KB 页面分类与「不重复存全文」张力。
   v2 处置：落 `wiki/testing/` 分类；显式裁决 = KB 存摘要+指针+覆盖矩阵，全文以正本为准；
   哈希比对对象 = 正本 digest 记录在页面 frontmatter、读回比对该记录。
6. minor — AGENTS.md 活文档义务未列入验收。
   v2 处置：AC-6 增补（§1 目录清单 + §4 事实来源表）。
7. minor — 覆盖矩阵 vs 非目标「不引入新机读格式」兼容性。
   v2 处置：声明覆盖矩阵为可选附加字段、校验器容忍未知名（对齐 contracts/delivery 现行为）。
8. minor — config 层未入三层图 + 模型 B 命名无出处。
   v2 处置：config 入①正本侧图 + 出处指认 knowledge-architecture.md 第 1 原则（Git 唯一权威源）。

## 席2 findings（契约严密性）

1. **blocker** — 静态 ref 无法表达变更级路径（三难：硬编码 change 名/固定路径副本/运行时模板化）。
   v2 处置（设计裁决）：sweep 钉**冻结的已判快照**（.sdd/delivery/gates/t/ 下三 ref，
   change 无关固定路径——archive 后不被 changeDir 映射搬走，回溯稳定）；活库由编译期
   强制治理。职责分离成文。
2. major — 强制链改动点写错（extensions/*.json 是装饰性源文档；权威在 composition.json
   extensions + 应用重编译；comet-executor compositionGateMap 不比 artifactRefs；现存断言
   无一能抓字面满足）。
   v2 处置：AC-3 改写为「composition.extensions 扩三 ref + 官方重编译 + relock + 重装 +
   extensions↔composition artifactRefs 相等断言（foundation-distribution 新增）」。
3. major — T ref 集合缺 test-contract（束+pack 双工件不含 contract → contract 漂移不察；
   V 门消费的契约 ≠ T 判定的契约）。
   v2 处置：T ref 集合 = 束 + pack 快照 + contract 快照（三 ref）；gate-bundle outcome
   artifactHashes 三键齐全。
4. major — TOCTOU：编译期覆盖强制在 record 前可被手改绕过（sweep 只比哈希不复验覆盖；
   contract 内嵌 pack digest 无人比对；features.md 未入 basis）。
   v2 处置：构造期三件机械复验（AC-2）：baseline digest === 盘上 pack 规范化 digest（规范
   形 = 投影输出字节）+ 重跑 verifyDomainCaseProjection + features.md 作为 basis 条目。
5. major — KB 纳管强制不成立（hook 管 HOW 不管 WHETHER；KB 在根外哈希不可入 refs）。
   v2 处置：发布回执落项目根内（kb-publish-receipt.json：页哈希+正本 digest+时间戳）进
   T outcome gateEvidence，供 Kp/Kt 机械消费；「未纳管即未定稿」降级为 receipt-backed
   纪律（如实声明非 sweep 强制）；llmwiki ENOENT 现状如实标注。
6. minor — promote 顺序错序均 fail-closed 但存在性校验弱（合并后 spec 被改写无再检）。
   v2 处置：promote 内建强制 spec 存在校验（非可选旗标）+ 记录需求内容 digest。
7. minor — 旗标-门矩阵（R/A/P 结构性忽略 testContract；V 消费改变 designOnly）。
   v2 处置：AC-4——T 必填缺件拒；R/A/P/Kp 传入即拒（非忽略）；V 消费语义随 V 门实证另案。

## 席3 findings（可实施性与下游）

1. major — 双工件静态路径位置决策未指定（与席2 blocker 同源）。
   v2 处置：同上——固定快照路径 + 职责分离；live/archive 两时点重校验语义写入。
2. major — 步骤③工作量低估 + **r7 实际过 T 的工具变体未回流提交**（已提交工具今天过不了
   T 门——evaluate INVALID_TEST_CONTRACT/TEST_DESIGN_REVIEW_REQUIRED 必拒）。
   v2 处置：What §2 列全改动面（inputs.testContract 注入 + contractDigest 绑定 +
   artifactHashes 三键）；「r7 差异回流」列为变更输入证据。（补注，三轮席3 finding 4：
   c2e4832 已回流 --test-contract；剩余缺口见 proposal Why §4。）
3. major — features.md 无格式契约 + 与四套 ID 空间（basis/Journey 十键/AC-x/Check ID）
   关系未定义。
   v2 处置：固定字段格式 + 与 Journey 十键的映射声明（F-ID 特性层覆盖登记，投影十键
   不变）+ 字段事实源声明。
4. major — specs/ 空白靶 + proposal 验收节无 AC-x 编号约定（自举不一致）。
   v2 处置：AC-x 约定入提案 + 本提案验收节自举改用 AC-1..AC-6；首条种子 spec 前置声明。
5. major — config 层缺失 + V 门默认路径耦合（verifyDomainAutomation 读
   `<changeDir>/tests/domain-cases.md` 固定路径）+ r7 迁移成本低估（16 case 全字段重写
   + TC-14 拆分 + 维度映射 + config + features.md + KB = 一次 T 设计重做）。
   v2 处置：config 入图 + 路径耦合对齐声明（变更内命名保持默认或 override）+ 迁移清单
   与成本如实声明（下游迁移成本声明节）。
6. major — 双层 enforcement 边界未声明（在飞 Run 绑旧包；构造期验收 ≠ record 期验收；
   revise 重放失败烧 Run 无回退声明；实例侧前置未列）。
   v2 处置：验收拆两层（AC-2 构造期 / AC-3 后半 record 期新 Run）+ 回退声明 + 实施顺序⑥
   展开实例前置。
7. minor — ②③ 原子窗口 + 应用重编译未入序 + ⑤ 无完成判据。
   v2 处置：实施顺序补齐（②③ 原子注记、重编译入序、⑤ 判据 = npm test + check.sh +
   foundation verify）。
8. minor — 纳管无可判定验收 + llmwiki ENOENT 现状。
   v2 处置：AC-5（receipt 结构 + 读回比对脚本）+ ENOENT 现状在 AC-5 如实标注。
9. minor — 「全字段」指向不硬（字段事实源在冻结技能快照；语义变化走显式替换）。
   v2 处置：字段事实源声明 + 技能快照替换列入实施顺序 0。

## 三席交叉验证记录

- 首轮 blocker（静态 ref）由席2/席3 独立证实（composition.json→build-application :86/:331/:439
  静态字符串数组编译；runtime 无 {change} 模板化）。
- gate.js 四处 kind 行号引用（:235/:239/:242/:245）由席1 逐字核实、席2 复核、席3 抽验，三席一致。
- 「r7 工具变体未回流」由席3 以两份 gate-bundle.mjs 全文对比实锤。
- 席1 未验证项（实例侧产物不在本 worktree）如实声明；席3 以只读勘察补齐实例侧事实
  （r7 comet-state phase=build、tests/test-pack.json 16 条四字段、authority entries 三门齐）。
