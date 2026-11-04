# 四轮共识评审结论存档（round 4 delta 终审，2026-11-03）

> 评审对象：proposal v2.4 delta（commit 01e9966：§7 三条最佳实践增补 + 三轮 3 遗留
> minor 闭合 + §4 状态语义澄清 + AC 扩展 + 非目标/实施顺序扩）。已认证核心设计不在
> 评审范围，三席均确认未被破坏。三席透镜同前三轮。

## 裁决

| 席 | 透镜 | VERDICT | findings |
|---|---|---|---|
| 1 | 架构一致性 | REPAIR | 1 major + 4 minor（无 blocker） |
| 2 | 契约严密性/对抗攻防 | REPAIR | 1 major + 4 minor（无 blocker） |
| 3 | 可实施性与下游 | **PASS** | 2 minor + 2 观察 |

**共识达成**：12 条 findings 全为文本级钉死/修正、均有明确处方，无 blocker、无新设计
问题 → 全部逐字落文为 **v2.5**（沿三轮先例：findings 应用即收敛）。moderator 认证：
v2.5 共识成立，可按实施顺序 0-7 进入实施。

## 合并处置对照表（12 条 → 10 主题，全部逐字落文 v2.5）

| # | 主题 | 来源 | v2.5 处置 |
|---|---|---|---|
| 1 | §4 补**验收节定义**（= 每 F-ID 行下随附非解析自由文本块，五固定字段外不参与投影）——增补 A 落点声明此前指向未定义结构 | 席1#1 major | §4 固定字段段补定义句 |
| 2 | **矩阵宿主钉死**：testPack 内嵌生成字段 + dependencyBaselines 专属条目 `{kind:'domain-cases/v1:feature-coverage-matrix'}`（digest = envelopeDigest(矩阵)，独立可寻址）；:124 保留字清单追加该 kind；校验器容忍未知字段（首轮席1 finding 7 处置恢复）；§2 构造期枚举「三件事」→「四件事」((b) 扩为深比较 + 专属条目 (a) 式比对)；§2 T 行/AC-1 扩/AC-2 扩措辞随宿主对齐 | 席2#1 major + 席1#4 + 席1#5 | §7 C/§2 表/§2 构造期/AC-1/AC-2 五处 |
| 3 | 矩阵字段语义钉死：unresolved 行 case 派生字段（Journey/level）置空 '—'（无解析面数据源），字段齐全性按键集判定；Acceptance 绑定数 = 绑定该 F-ID 的 case 数（不去重 AC） | 席3#1 minor | §7 C + AC-1 扩 |
| 4 | §4 写明**机器侧 unresolved 登记位置** = ② config.unresolved 数组条目（含 nonempty question，:140-150）；features.md 状态列为登记侧镜像不被解析 | 席2#2 minor | §4 状态语义段 |
| 5 | 三处措辞精度：「强制」双轨加**约定层**限定；「门只查存在性」写明 R 门机器实际查确认收据存在（可验证性属评审纪律）；Dimensions 降级限定为 features.md **列**（用例 `Dimensions` **字段**机检 applicability :168 不受影响） | 席2#3 minor | §4/§7 A/§7 C |
| 6 | PROOF 五问改标**项目裁剪版**（Bach 原典 Past/Results/Outlook/Obstacles/Feelings；Feelings 被替换如实声明）；timebox 30-60 min 标注项目取值（SBTM 常见 60-90） | 席1#3 minor | §7 B 第 3 条 |
| 7 | **计数口径对账**（见下节）+ ledger 追加澄清条目 | 席1#2 + 席2#4 minor | 本存档对账段 + ledger |
| 8 | **AC-7 陈旧陈述刷新**：archive 回退已落地（8ffcbf2，18 回归绿）——§1 对齐段/非目标/step 4 三处改为「已落地，剩余 = 在盘回归覆盖确认」 | 席2#5 minor | §1/非目标/step 4 |
| 9 | 实施对齐遗留显式化：AC-7 回退当前只读变更级单一 config，「①+② 合并传入」随 step 1 落地（席3 观察 O1） | 席3 观察 O1 | §1 对齐段 + step 4 |
| 10 | step 7 显式声明**在飞 Run 先完成 V/archive 再升级**（任何 compileDomainCases 输出变化会使升级前录制的 contract 在 V 重验 digest 失配翻案）+ 成本声明 features.md 项加「含 v2.4 双轨验收节编写」括注 | 席3 观察 O2 + 席3#2 minor | step 7 + 成本声明 |

## 计数口径对账（席1#2 + 席2#4，append-only 勘误并存档）

- **Round 1**：存档席位表原始 findings 合计 **24** 条（席1 8 + 席2 7 + 席3 9）；认证
  链（v2.3/v2.4 头部、ledger 19:30 条目、commit 消息）记「22 条」为去重口径，去重映射
  未存档——如实记录，不追溯重写历史条目（ledger append-only）。
- **Round 3**：席位原始 **15** 条（4+5+6）合并为 **7 主题**落文（938cf67）；ledger
  首条「Round 3: 7 findings」系误用合并主题数冒充 findings 数——追加勘误条目澄清。
- 此后一切引用统一口径：**先原始条数、后合并主题数，分别标注**。
- v2.5 头部已按此口径改写（「首轮 22 条〔去重口径；存档席位表原始 24 条〕」）。

## 席位原文要点（全记录见 consensus-round4-progress.md 前身，本节为裁决存档摘要）

- 席1（架构一致性）：增补落点与非目标自洽（五处互证）；ADR-0007/0020/domain-cases/v1
  无矛盾；锚点忠实度外部核对（ASPICE PRM v4.3、ASPICE 4.0 BP5 并入 BP1、Bach SBTM
  原文、Wikipedia SBTM）；主体成立，REPAIR 后即可收敛。
- 席2（对抗攻防）：schema 层面增补 C 可实现（dependencyBaselines kind 自由串零契约面
  变更）；增补 A 降级声明与代码逐字一致（全文件无 features.md 解析路径）；增补 B 边界
  三重对齐无承诺漂移；gate-bundle @ HEAD 对编译器扩展 0 命中——「剩余核心缺口」陈述
  仍准确。
- 席3（可实施性）：三增补无孤儿落点（全有 step+AC 认领）；r7 迁移面不变（双轨 AC =
  登记侧补齐；矩阵零迁移；成本段 v2.3→v2.4 逐字未动）；矩阵五字段数据源在 compileDomainCases
  现有返回形状内可得；RUNBOOK 在途中文化改动与 §7 正交（操作序：先落盘在途两文件，
  step 5 在其上重放）。

## 最佳实践来源与共识强度分级存档（§7 预告的兑现，研究综合 2026-11-03）

**业界共识（多来源交叉 / 标准原文）**：
- ISO/IEC/IEEE 29148：九属性 + verifiable 硬属性 + §7.2「AC = 具体条件或度量」
  （standards.ieee.org、modernrequirements.com、well-architected-guide.com、29148:2011 原文 PDF）
- ASPICE SWE.1.BP5 双轨验证准则 + BP6 双向追溯 + BP7 一致性（VDA QMC PAM 3.1 官方 PDF；
  ⚠️ ASPICE 4.0 已将 BP5 并入 BP1——本提案引用为 3.1 时代编号，席1 外部核对指认，文内
  不声明版本号即可）
- DoR/DoD/AC 三层分工 + INVEST（Scrum Alliance、rework/Agile Alliance、AltexSoft）
- GWT 单行为纪律（Agile Alliance 词汇表、Automation Panda；Cohn DoR 过严反模式警告）
- SBTM charter + timebox + session sheet + PROOF（Bach 原典 satisfice.us/articles/sbtm.pdf——
  PROOF = Past/Results/Outlook/Obstacles/Feelings；Momentic、Bitrupt、Ryan Craven、
  QASkills.sh、Virtuoso、arXiv 1704.00988 多源同构；**本提案五问为项目裁剪版，已如实标注**）
- UAT 证据化签署（Virtuoso、Testing Academy、Full Scale、TestMonitor；自动化验收与真人
  签署互补不可互替——r/devops 共识）
- 自动化 RTM：映射长在工件元数据、矩阵由工具生成、未覆盖自动标旗（Perforce、Parasoft、
  Jama、Abstracta 一致反对手工矩阵）
- Serenity BDD / Allure：层级标签 + 三态覆盖（零覆盖显式可见）（两生态官方文档同构）

**单一来源 / 采模式不采产品（已如实降级）**：
- Buddy APPROVE_VT「有 diff 暂停流水线等人工审批」产品形态（Argos/Chromatic 旁证模式，
  产品机制各异——提案只采「无 diff 机械 auto-pass、人力花在有 diff 处」模式）
- TestCollab「无上下文截图不算证据」（单一博客，但与本仓 Evidence/Check ID 字段设计
  独立契合）
- PROOF 各来源转述微差（QAPractices 五问版 vs Bach 原版——提案按 Bach 原典标注裁剪）
- Google Testing Blog test charter 专属文献未检索到；该词标准出处即 SBTM（Bach）

## moderator 收敛认证

四轮全程：22（去重）/24（原始）→ 28 → 15（合并 7 主题）→ 12（10 主题）条 findings，
逐轮收敛于文档级精确性；核心设计（三 ref 冻结快照、F-ID basis 机制、config 两层拆分、
旗标-门矩阵、host-ports archive 回退）**四轮对抗零破坏**。**共识在 v2.5 成立**，
实施顺序 0-7 解锁。
