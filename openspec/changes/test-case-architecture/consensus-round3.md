# 三轮共识评审结论存档（round 3 终审轮，2026-11-03）

> 三席透镜同前两轮（架构一致性 / 契约严密性·对抗攻防 / 可实施性与下游）。
> 三席均 REPAIR（无 blocker）。15 条原始 findings 合并为 **7 个主题**逐字落文
> （commit 938cf67，proposal v2.3）；3 个 minor 遗留项在 v2.4 闭合（见文末）。
> moderator 收敛认证：22→28→15（合并 7 主题），收敛于单一 config 键位主题；
> 核心设计（三 ref 冻结快照、F-ID basis 机制、host-ports archive 回退、旗标-门
> 矩阵）经三轮对抗全程 held（execution-ledger.jsonl 2026-11-03T19:30 认证条目）。

## 裁决

| 席 | 透镜 | VERDICT | 原始 findings |
|---|---|---|---|
| 1 | 架构一致性 | REPAIR | 4（1 major / 3 minor） |
| 2 | 契约严密性/对抗攻防 | REPAIR | 5（1 major / 4 minor） |
| 3 | 可实施性与下游 | REPAIR | 6（1 major / 5 minor） |

## 七个合并主题 → v2.3 处置（commit 938cf67 逐字落文）

| # | 主题 | 来源席位 | v2.3 处置 |
|---|---|---|---|
| 1 | config 10 键归层补全（design_basis_id/cleanup 归②变更级；basis 数组合并 = id 键并集〔②同 id 覆盖、异 id 追加〕；AC-1 增合并行为三测；合并位置钉死 compileDomainCases 入参组装处） | 席1#1 + 席2#1 + 席3#5 | §1「config 归层拆分」段全写 + AC-1 扩 |
| 2 | V/Kp 矩阵行矛盾消解（「两门细则另案（archive 回退已由本变更 AC-7 交付，另案以其为前置）」） | 席1#2 + 席3#1 | §2 矩阵行改写 + 非目标拆分条款 |
| 3 | 构造期复验 (a) 重算配方写明（canonicalJson 模块私有〔evidence.js:68〕，同源重算走已导出 envelopeDigest:74 于解析后对象；防实现者二歧路） | 席2#3 前半 | §2 编译期强制链括注 |
| 4 | pack digest 主机路径绑定声明（project_root realpath 内嵌 → 跨机重算不匹配内嵌 baseline 为预期行为，T 判定非跨机姿态） | 席2#3 后半 | §5 易逝性声明段补句 |
| 5 | F-ID 覆盖强制注册作用域如实声明（编译器只哈希 features.md 不解析行；「行↔条目一致性」属登记侧治理，与已声明例外同族，不加解析器） | 席2#2 | §4 机制段补句 |
| 6 | AC-4 两层断言拆分（(i) 工具级 `--test-contract`+gate≠T → 构造拒绝五门各一断言；(ii) gate.js 差异化 parse 行为仅设计依据记录、不作验收断言——防「P 跳过」被断成接受行为） | 席2#4 | AC-4 改写 |
| 7 | kb-publish-receipt 增 runId+change 绑定字段（堵跨 Run/变更复制——gateEvidence 记录可复制但 receipt 自身携带可检绑定，零强制成本加固） | 席2#5 | AC-5 结构声明 |

## 席位原始 findings 完整清单（存档）

**席1（架构一致性）**：#1 major config 10 键归层不完整且 basis 数组归属自相矛盾（→主题1）；#2 minor V/Kp 行「与 archive 回退一起另案」vs 四处划入本变更自相矛盾（→主题2）；#3 minor `domain-cases.draft.md` 悬空引用（v2.2 三层图已无此名）——**已随 938cf67 落文**（§1 命名段「v2.1 曾用的 draft 名已废弃」）；#4 minor --promote 后 ①库级基准投影演化未声明（basis 三选一）——**已随 938cf67 落文**（§3「① 基准投影演化声明」三选一裁定）。

**席2（契约严密性）**：#1 major（→主题1）；#2 minor（→主题5）；#3 minor（→主题3+4）；#4 minor（→主题6）；#5 minor（→主题7）。席2 攻防核验记录：F-ID 机制成立（onlyKeys/kind 枚举/:160 强制/多条目共享 path 合法/不注册无法绕过）；host-ports 回退可行（:159-168 只读活路径实锤 + admissionOptionsFor :380-389 既有模式）；旗标-门矩阵可实现无永败断言（gate.js:68/:72 语义逐字核实）；composition 权威面抽验通过（:85-86/:331/:439/:456）。

**席3（可实施性与下游）**：#1 major（→主题2）；#2 minor 自举计数残留「AC-1..AC-6」（实为 AC-1..AC-7）——**遗留**；#3 minor draft 孤儿指涉（→席1#3，已落文）；#4 minor round1 存档席3#2 处置行承诺的 c2e4832 补注未落盘——**遗留**；#5 minor config 合并无 AC 认领（→主题1）；#6 minor classic-integration 断言更新未列入 step 2+3 原子变更集、AC-6 其余文档项无 step 归属——**遗留**。

观察（非 finding）：实例 comet-state.yaml phase 已从 build 漂移为 open（runId/revision 不变）——提案未硬编码 phase，不受影响；实施 step 7 执行时重读 Run 状态再定「在飞 Run」验收路径。

## 三条遗留 minor → v2.4 闭合（本存档随 v2.4 一并提交）

| # | 来源 | 闭合处置 |
|---|---|---|
| 1 | 席3#2 | proposal §3 自举计数改「AC-1..AC-7」 |
| 2 | 席3#4 | consensus-round1.md 席3#2 处置行补注「（c2e4832 已回流 --test-contract；剩余缺口见 proposal Why §4）」 |
| 3 | 席3#6 | 实施顺序 step 2 点名 classic-integration 单 ref 断言同步更新（并入原子变更集）；step 5 点名 AC-6 其余文档落点（AGENTS.md §1/§4、易逝性声明、convergence 文档行） |
