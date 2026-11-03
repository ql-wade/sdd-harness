# 二轮共识评审结论存档（round 2，2026-11-03）

> 三席透镜同首轮。全部 findings 已逐条纳入 proposal v2.2（本文为裁决存档；
> v2.1 阶段席1 处置见 consensus-round2-progress.md）。

## 裁决

| 席 | 透镜 | VERDICT | findings |
|---|---|---|---|
| 1 | 架构一致性 | REPAIR | 8（1 major / 7 minor）——v2.1 已全部处置 |
| 2 | 契约严密性/对抗攻防 | REPAIR | 10（5 major / 5 minor） |
| 3 | 可实施性与下游 | REPAIR | 10（6 major / 4 minor） |

**共识仍未过（三席均 REPAIR，无 blocker）**→ 合并修订出 proposal v2.2，发起第三轮。

## 席1 findings（架构一致性，8 条）——v2.1 已全部处置

处置对照表见 consensus-round2-progress.md。其中 finding 1（consensus-round1.md「不存在」）
经盘上与 git 双证为**评审侧 find 竞争误报**（文件实存 8166B、提交于 c2e4832）。
其余 7 条已按建议修订（非目标措辞限定契约面、features.md 定位正本侧登记表、
proposal 派生 basis 条目承载两阶段绑定且技能快照替换改必做、晋升键逗号约束、
host-ports 默认路径策略、AC-6 三处补强、V/Kp 行标待实证）。

## 席2 findings（契约严密性，10 条）

核心确认：**三 ref 冻结快照设计经对抗攻防成立**——archive 回溯语义稳定（.sdd ref
不被 changeDir 映射搬走，r3-r7 实证模式沿用）；V 不静默消费漂移正本（双重绑定
fail-closed）；verifyDomainCaseProjection 构造期入参全可得；composition.extensions
权威面 + 对齐断言模式已存在；gate.js kind 行号引用逐字核实。

1. major — 旗标-门矩阵 Kp 行矛盾：gate.js:72 对非 R/A/P 门无条件 parse
   inputs.testContract，「Kp 传入即拒」会制度化永败断言。
   v2.2 处置：Kp = testContract 必填（T 快照链同源重构）；V 与 Kp 细则显式另案
   （含 archive 回退）。
2. major — archive 期 V 重验结构性失败（verifyDomainAutomation 重算只读活路径
   changeDir，无 archive 回退；archive 搬移后已录 V pass 被翻案 → Run 卡死）。
   v2.2 处置：列入 §1 对齐工作项（scaffold lib host-ports 可修）+ 新增 AC-7。
3. major — config 归层矛盾（①库级 config 无法服务并发 change 的逐变更字段）。
   v2.2 处置：拆分 ①库级（basis 路径 + 维度十键）/ ②变更级（project/change/mode/
   checks/self_checks/unresolved）+ 合并规则（① 基底 ② 覆盖，身份字段以 ② 为准）。
4. major — 快照拷贝源与 ② 命名自相矛盾 + 编译语料未钉死。
   v2.2 处置：编译语料 caseFile = ②（host-ports 默认锚点 tests/domain-cases.md）；
   快照拷贝源 = ② 判定投影；唯一形状钉死并同步 host-ports 路径。
5. major — F-ID 覆盖强制机制悬空（Acceptance 双载互斥；专字段 = 改冻结约定）。
   v2.2 处置：采用 requirement-kind basis 条目原生机制——每 F-ID 注册为
   kind:'requirement' basis 条目（path 指 features.md），:160 既有「每 requirement 需
   case 或 unresolved」免费获得覆盖强制；features.md 字节进 basis（绑定同达）；
   覆盖逻辑在 compileDomainCases 内 → 构造期复验闭环。
6. major — kb-receipt「供 Kp/Kt 机械消费」无消费者（sweep 不比、gate.js 无路径、
   Kt 无实现；receipt 可伪造/分叉无察觉）。
   v2.2 处置：如实降级——receipt 落盘 + gateEvidence 记录；Kp/Kt 消费语义随其门
   实证另案（delivery-architecture :259 Kt 命名无实现，如实登记）。
7. minor — 规范化 = canonicalJson（envelopeDigest 同源），非「投影输出字节」。
   v2.2 处置：已改。
8. minor — gate.js:72 表述如实化（忽略仅在缺席时；R/A 提供契约会真正解析）。
   v2.2 处置：旗标-门矩阵括注已改。
9. minor — ③ 快照层 gitignored/单例槽位易逝性未声明。
   v2.2 处置：§5/AC-6 声明（持久证据角色由 ② 承担）。
10. minor — --feature-map 注入语义含糊。
    v2.2 处置：--feature-map = features.md basis 注入，触发构造期复验 (c)。

## 席3 findings（可实施性与下游，10 条）

1. major — 双工件静态路径位置决策（与席2 同源）。
   v2.2 处置：同上——gate-bundle 构造时把 ② 投影快照写固定路径，outcome 双 ref 哈希，
   live/archive 重校验语义对照上游三处源码写入提案。
2. major — Why §4.4「未回流」表述失真（c2e4832 已回流 --test-contract）+ 剩余缺口清单
   （contractDigest 0 处 / 三键 artifactHashes / 构造期复验 / --feature-map）。
   v2.2 处置：Why §4 如实改写（c2e4832 回流 + 剩余缺口列举）；round1 存档处置行补注
   回流提交号。
3. major — 按门契约表 A/P 行承诺超出交付范围（本变更只交付 T）。
   v2.2 处置：表加「本变更范围」列——R=现状已满足；A/P=维持现状随各门实证对齐；
   T=本变更交付；V/Kp=另案显式延迟。
4. minor — step 0 死分支（domain-cases 约定明确「未知字段不会被忽略」+ Acceptance 单 ID
   regex 已被 AC-x 占用）。
   v2.2 处置：step 0 改无条件必做（F-ID basis 条目机制为既定方案）。
5. minor — 「relock」术语撞车（既有 relock = plan/supply 重锁）。
   v2.2 处置：AC-3 首次出现处写明 = foundation-export 重导出 lock + `foundation verify`。
6. minor — extensions 对象数组 vs composition 字符串数组形状不同，deepEqual 断言会失败。
   v2.2 处置：AC-3 断言写明 ref 集合相等（非 deepEqual）。
7. minor — 实施顺序⑥ 未钉「先再分发、后 --upgrade」内部次序（先 upgrade = 提案自命名
   的「T record 必败窗口」）。
   v2.2 处置：⑥ 写明次序（fail-safe 侧）。
8. minor — kb-publish-receipt 注入管线无 AC 认领。
   v2.2 处置：AC-5 增补 receipt 出现在 T outcome.gateEvidence 断言。
9. minor — 旗标括注「结构性忽略」失真（R/A 提供契约会真正解析）。
   v2.2 处置：同席2 #8。
10. minor — domain-case-config.json 拼写缺 s。
    v2.2 处置：v2.1 已改（AC-6 用运行时真实名 domain-cases.config.json）。

## 三席交叉验证与事实修正记录

- 席2 证实：三 ref 设计攻防成立（攻点 1/2/3a/3c/6 全held）；classic-archive-annotation
  才是 ref 映射模块（席2 首轮引用的 comet-host-ports :372-389 实为 authority 记录回退——
  行号张冠李戴由席2 自己纠正，结论不变）；gate.js:72 语义如实化。
- 席3 实锤：c2e4832 已回流 T 支持（评审期间落盘，以 HEAD=c2e4832 现状为准）；现行安装
  版本=27、递增即 v28；r7 tests/test-pack.json 16 条四字段实测；Journey-A..J 十键 config
  强制已核实、r7 现用 5 个非十键语义维度名（迁移=映射工作）；openspec/specs/ 空白属实。
- 席3 确认提案四个结构性 gap 诊断全部属实（源码 + r7 实束核验）。
