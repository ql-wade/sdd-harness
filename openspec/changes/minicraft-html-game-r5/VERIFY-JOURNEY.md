
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
