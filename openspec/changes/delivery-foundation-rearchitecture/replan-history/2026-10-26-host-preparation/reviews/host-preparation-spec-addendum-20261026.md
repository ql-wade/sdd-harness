# 准备边 Spec 小修订补充

结论：**APPROVE_CONSERVATIVE_DELTA**。原报告 `/private/tmp/host-preparation-spec-review-20261026.md` 及 SHA256 `7edf2d068b4ead21be3970c0a12272a4b08f5daff841b86d5712d22bf65e95e8` 原样保留，本文件不改绑旧结论。

最终候选 contract SHA256：`a3cf328a8e46e0f48aa8420257aacf275b41aad6d3bdd6406f4f0e83aabc87ad`。独立将 `supplier_artifact_candidates` 恢复旧字段名并移除新增 `activation_status` 后，按原顺序重建得到原候选 SHA `43d174a52613d2eff35f7caa0005b0ff784aa5bb166bae9d7c78438adbb30ec5`；因此原 scope、两条新边及其余合同没有实质变化。

保守状态明确为：

- P1_3←P1_2：`PENDING_CURRENT_INDEPENDENT_REVIEW_REPORT_CUSTODY`；Root71 和聚合报告中无法找到原文的旧“双审”声明，都不能自动激活。须先保存当前精确候选的独立审查原文，由 Root 核对接纳范围；本补充本身不激活。
- P1_3←I02：仅 Root 已审已测代码候选，物理资格继续 pending。
- P1_5←P1_4：仅测试/metadata 准备例外，不接受模式保证。

独立重跑最终 shadow `plan_guard.py`：**exit0**，`{"valid": true, "handoff_ready": true, "issues": []}`。结构有效不等于供应资格或业务通过。原39/69/130/104及本期129/103/F10、角色、权限、Final VERIFY边界不变；主计划未改。

| 最终输入 | SHA256 |
| --- | --- |
| manifest.json | `33e81fb4d39ed971c87b82be7e8aa9b7cc47a4d349064668d45307184dafedd0` |
| README.md | `cb22018bb416cc42156a69e282f6b877c59318ae03a063c34cd8b47197088631` |
| drift-lock.json | `157ea1b32edf319d727a3d48e93b79c30a857732cb573c583b96891c545acd70` |

只读确认，未修改原报告、源码、主计划、锁、phase或ACL；未运行模型、安装、服务、secret操作，未创建worker/Goal。
