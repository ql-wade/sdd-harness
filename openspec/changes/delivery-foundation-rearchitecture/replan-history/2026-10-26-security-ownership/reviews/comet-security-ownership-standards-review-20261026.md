# 安全回移所有权草案：独立 Standards 审查

结论：**APPROVE_OWNERSHIP_DRAFT，阻断 0**。仅确认这份未应用的计划所有权修订符合仓库及现有单主控纪律；不批准新补丁代码、架构变更、发行 pin、运行启用或发布。

输入根：`/Users/mac/Code/sdd-harness/.local/comet-reset/security-ownership-amendment`。主检出 HEAD `c59b79b06b305b4248d968b1a7f1d3c004392461`；六份原计划文件与 manifest 的 original 全匹配，候选六份也全匹配。没有修改主计划或覆盖主树已有其他改动。

## 核对结果

- 新增 `integrations/comet/patches/0004-upstream-security-backports.patch`、`test/comet-security-backports.test.js`，仅进入 P1_1 的 Files/Owns、DAG owns 和锁 allowed_paths。独立检查所有其他任务的精确及目录前缀归属，新增冲突 **0**；两条均为 repo 相对具名路径，没有通配目录授权。
- tasks.md 除 P1_1 的 Files/Owns 两行外逐字节不变，全部步骤、勾选及原验收身份未改。DAG 去掉这两条 P1_1 owns 后与原对象完全相同。P1_6/0001 方法、P2_4/0002 业务、P4_6/0003 收尾及 P1_4 原任务块和所有权完整不变，P1_2/P1_3/I02 的宿主、装配、隔离义务没有转移。
- 使用现有 `plan_guard.py` 的 `prose_and_normalized` 独立重算 checkbox-normalized-v1 摘要，得到 `8b91e35e764ae52b5628507174d7aadf8cff2927c3a9fddebe62771360fa84e5`。spec-baseline 仅 tasks 来源摘要变；contract 仅 baseline 摘要变；drift-lock 仅上述规范级联、两条 P1_1 allowed_paths 及一个明确修订记录变化。architecture.md 字节不变。
- **39 节点、69 工作包、130 检查、104 场景**及本期 **129/103**、F10 NOT-EXERCISED 完整保留。合同所有检查、完成谓词、依赖、waves、具名建设例外、接口、单主控与权限边界均未变化。新增内部安全回归文件没有另设验收分母或控制器。
- 新修订明确旧结果仅历史，源码/补丁 pin 变化后须重做当前 source/build/generated/runtime 与相关安全回归。引用的适用性报告 SHA 已与 `/private/tmp/comet-0_4-security-applicability-20261026.md` 实际字节核对；它是源码诊断，不能充当架构批准或实现接纳。README 明确未启用 profile、无新服务/凭据/业务权限，符合 AGENTS §1、§4、§7 和 ADR-0019 单主控/供应链纪律。

## 独立只读校验

从主仓库现有脚本执行完整 shadow `plan_guard.py`，显式传入候选 tasks、DAG、lock、architecture、contract 和候选 repo-root，设置 `PYTHONDONTWRITEBYTECODE=1`。实际 **exit 0**：

```json
{"valid": true, "handoff_ready": true, "issues": []}
```

该输出只证明 shadow 计划结构与摘要一致。未执行安全载荷、产品测试、构建、锁更新、配置、服务、模型、secret 或状态/台账操作；未创建 worker/Goal。最初一次只读 diff 查询误把候选目录当平铺布局而 FileNotFound，随后按明确的 candidate/openspec/changes 路径重读；不计为验证失败或产品证据。

## 精确输入摘要

| 输入 | SHA256 |
| --- | --- |
| candidate-manifest.json | `5254a625813b82a76541a0f6ce7e97e09409b83df43a9ebbb427269a43dea377` |
| README.md | `b854aed2f0fbf8759ff43800674dbb8f710406d157f98f76d5174153a736d02f` |
| candidate/tasks.md | `645dd549ca0cb7c6baf7c0a5cd0544fb821728de3b4f80ed8bbe6294aea0a811` |
| candidate/architecture.md | `36e14eb296995562f75f801a5087096fd53ed3e34529cd1f236b8eaf6503e589` |
| candidate/task-dag.json | `1211ec6cadc58aeeac4a300749d9738037b6158fccec44222e6157dfebaa43cc` |
| candidate/execution-contract.json | `41fc7da2604e31b4b85ac99d2092e554f31155ccfa08c49fae7726eaa538dc41` |
| candidate/drift-lock.json | `416498c705c59baea5be53b0e509b5072d3144448de3c89961ea95805cf9e21e` |
| candidate/spec-baseline.json | `95a0be3c0082417443c898490ce06730d1940850dc814bd224656c563f74e299` |
| 现有 plan_guard.py | `a17e66cd5c01bd7a165f1380539e75d97be4fa368513eab04135d9508ea662f9` |
| 适用性诊断报告 | `f28bd366fe3eefca5eb3b6cbbab2008b30c6426b42a24c99538e70b501443100` |

后续安全代码、平台覆盖、新指纹重建和完整旅程仍须分别验收；本报告不继承旧 GREEN，也不自动授予实施或发布权限。
