
---

## 出局报告补记（2026-10-30 深夜，业务 VERIFY 执行轮）

真实产品 Run 已推进到 R 门**最后一道验证层**：

1. r5（v12）→ r7（v13，读取器 HOME 锚定缺陷）→ r9（v14，读取器修复后）三轮真实 Run，
   每轮 Open 阶段全程真实：prepare→open 证据（classicOpenEvidenceReceipt，派生
   submissionId）→**人类委托批准需求**→revalidate→R 门认领（真实会话 UUID）。
2. 两个**真实子代理**完成 R 门领域工作并落盘真实会话记录：
   - 作者（agent-abb264bcda89d6c0c）：执行确认命令，产物含 proposal 摘要
     d34e054d… 与 R4-REQUIREMENTS-CONFIRMED 声明；
   - 独立审查者（agent-a8707cf33ddb57514）：R4-INDEPENDENT-REVIEW-OK +
     自有 cat/ls 命令执行记录。
3. 驱动器全链真实构造并**通过**：authority.issueDispatch（schema-exact
   ActionBinding）→ collectResult（sourceVerifier 回读真实转录物，
   qualifiedObservation 全谓词）→ admitEvidence(managed) →
   **class: independent-acceptance 准入成功**；v14 包内读取器对真实记录
   佐证 ok:true。
4. record-outcome 最后一层拒绝：`RAW_EVIDENCE_REQUIRED` ——record-outcome
   的 JSON 结果文件通道无法承载原始字节（Buffer→普通对象，rawBytes 检查拒）。
   **这是上游 CLI 结果文件材料化契约的真实架构缝隙**：需 runtime 支持
   二进制材料化（如 base64 + reviver）或受管二进制旁路通道。此发现即本期
   VERIFY 的核心产出之一。

过程中同时实证：产品控制平面（hook router fail-closed）、应用版本与 Run
绑定（WORKFLOW_CHANGED 拒绝跨版本 Run）、change-run 身份绑定
（runId===change）、危险命令清单 hook——全部真实生效。

运行时可恢复：`VERIFY-JOURNEY.md` 前述恢复命令（HOME=tmp 运行时 +
v14 包）。

## 材料化缝攻坚记录（2026-10-31）

三轮修复均被运行时解析后的字节形状变体驳回：{type,data} 数组形 → 数字键
290 键对象形 → 键控连续投影形（v17）。rawBytes 已按三种形状扩展（纯
octet 校验、签名链完整性不受影响）；record-outcome 的解析层仍在验证前把
字节转换为未知的第四种形状——需对 vendored classic record-outcome 解析器
本身插桩（或受管二进制旁路通道）才能定形，属上游波次。R 门最后一层
（RAW_EVIDENCE_REQUIRED）之前的全部链路已真实打通并被 v14/v17 包内门禁
逐项接受。

## R 门真实 verdict PASS（2026-10-31，verify/r-gate-verdict wave）

四波阻塞的根因落地：`rawBytes` 投影分支的正则笔误 `/^d+$/`（字面量 d，缺反斜杠）
——所谓"运行时第四形状"其实就是驱动器一直写出的数字键投影对象（无 length 字段），
本仓库分支是死代码。修复 `/^\d+$/`（严格 octet 校验不变，完整性仍由 collection
签名与摘要承载），wave 顺序 v21（修复+形状探针）→ v22（+宿主端口作者身份修复）。

新实证的两层宿主路径缺陷（历轮未触及）：
1. `admissionOptionsFor` 把无 session 的 executor claim（prepare/revalidate）映射为
   author 候选，`authoringPrincipals` 被 undefined 污染 → knownAuthors 永假 →
   PROTECTED_CONTEXT_REQUIRED。修复：过滤无 session claim + 合并受管记录
   （delivery-authority.json）的 authoring 名单（同一信任锚，转录读取器逐记录佐证）。
2. `verifyReview` 要求 prepared claude review 绑定与 report/action 摘要位于观测
   source 顶层（不在 facts 内）——驱动器 wire 形状已按此构造。

真实链路：r18@v22 Open 全程重放（wrapper skill-invocation 入口——raw dispatch 不落
分支绑定；branch binding 由写路径 heal）→ R 门认领 → 两个真实子代理（作者
R17-REQUIREMENTS-CONFIRMED 38e5b5d98604f231；独立审查 R17-INDEPENDENT-REVIEW-OK，
摘要绑定 envelope/report/action）→ record-outcome 真实通过，Run 推进至
full.design.handoff（rev16）。回归：77/77 协议套件 + 7/7 host-ports，fail=0。

死 Run 台账：r15（selection 引导）、r16（分支绑定发现）、r17（宿主层发现）。
形状探针仍 vendored（lib-delivery-evidence.mjs），下一次 relock 波移除。
