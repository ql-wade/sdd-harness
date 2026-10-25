# Host 有限准备修订：独立 Spec 审查

结论：**APPROVE_PREPARATION_SCOPE，新增阻断 0**。这份草案消除的是代码构造和两项测试准备的前置循环，**不解决或认证运行准入**；不能据此启动角色、接受模式保证或关闭整体验收。

输入：`/Users/mac/Code/sdd-harness/.local/comet-reset/host-construction-readiness` 的 README、manifest 和 candidate 六份文件，对照主计划基线 `1941ae13b55ac915406fac02f0d9bbd61cb04f36`。原/候选十二项文件摘要均匹配；未改主计划或源码。

## 具名准备范围符合原需求

1. **P1_3←P1_2**：只消费精确 `9c9b70b92f1c5f548c5f84cad24c644657a4c30d` 的分发/资产传输建设工件。Root integration 记录71/71且明确 cold model、角色/OS/Runner、whole P1_2 和 Final129/103 未验；草案没有把运输证明提升为冷宿主发现、Hook 安装、方法执行或身份来源证明。代码因此可先接线，实际安装、模型、凭据、服务与业务回执仍无新增许可。
2. **P1_3←I02**：精确 `67095e2a615d525c354234fb7e7723ded39acb38` 的输入/context 和物理三口代码可先供固定 Host 构造，解除“必须先有 Host 才能证明、又须先证明才能写 Host”的代码准备循环。原镜像/OS/mount/channel 条件完整保留，真实角色正向链仍须结合 P1_3 证明后才可能接纳 whole I02。该边自身不授实际进程启动、当前 Action 或身份资格。后续隔离资格探针和运行激活仍须 Root 的精确资源/权限计划，不能把“可构造”读成“可运行”。
3. **P1_5←P1_4**：明确仅对已确认的 C08 版本断言、method-pin 测试及 probe metadata 修复作 supplier-ready 的准备例外。P1_4 未合格模式记录仍是未信任观察；其他工作包不因这条边启动或接受。历史 **1.3.1 replay**、实际 **1.14.3** 和隔离 **1.11.0** 必须分开，replay 不能冒充本轮真实 CLI 负例。版本字面/pin 登记修复不允许削弱业务 oracle、缺工具转 skip、全局降级或改方法正文。C01–C08、whole P1_4/P1_5 和真实 OpenSpec/方法来源义务未豁免。

两份供应工件引用都在固定主基线 Git 祖先中，引用的 integration.json 字节与该主基线一致。I02 Root81/41 仍只是 construction；其全仓941/939/2原失败也被保留，没有包装为全绿。

## 不存在扩大到资格或最终验收的改动

独立对象比较确认：原 **18** 条具名边逐项保留，仅追加上述两条至 **20**，每一条仍是原 DAG 的依赖；没有新增 DAG 边、任务或通用准备例外。contract 除这三条具名范围和对应修订元数据外完全相同；lock 仅合同摘要级联和追加单条修订记录。

tasks、architecture、DAG、spec-baseline **逐字节不变**，因此步骤、勾选、角色/接口、原准备/whole 条件均未变。**39/69/130/104** 总记录及本期 **129 checks/103 scenarios**、F10 NOT-EXERCISED 原样保留。`required_evidence`、`no_waiver`、`activation`、`whole_rule`、完成谓词和 Final VERIFY 无豁免。源安全回移仍是原 P1_1 当前阻断；本次不批准补丁、发行重建、来源认证、角色/权限或业务通过。

## 独立只读检查与精确输入

实际执行现有 `plan_guard.py`，显式指定 candidate 的六份输入和 shadow repo-root，设置 `PYTHONDONTWRITEBYTECODE=1`；**exit0**：

```json
{"valid": true, "handoff_ready": true, "issues": []}
```

该输出只证明计划结构和摘要一致。未重跑作者/Root测试，未执行模型、服务、secret、配置、phase 或 ACL 操作，未创建 worker/Goal。报告不把计划有效当运行资格。

| 输入 | SHA256 |
| --- | --- |
| manifest.json | `745dc3ac5d28518e89dc87937aadeb684f411e83667937066c8f6c8844cc9e5f` |
| README.md | `da661ce90b41f08ab53cdd0afb3a7373998e1ab1a984cd801d2b47b758290822` |
| candidate/tasks.md | `b5bce9ce5c68772048700c203d84a01d049a1380f1864493cc72cf6aa4879f3d` |
| candidate/architecture.md | `36e14eb296995562f75f801a5087096fd53ed3e34529cd1f236b8eaf6503e589` |
| candidate/task-dag.json | `1211ec6cadc58aeeac4a300749d9738037b6158fccec44222e6157dfebaa43cc` |
| candidate/execution-contract.json | `43d174a52613d2eff35f7caa0005b0ff784aa5bb166bae9d7c78438adbb30ec5` |
| candidate/drift-lock.json | `e3f5181a2be2b697b370702afab93baa7a79efaba0bbd2aff6c4188415083866` |
| candidate/spec-baseline.json | `95a0be3c0082417443c898490ce06730d1940850dc814bd224656c563f74e299` |
| I02-main-integration/integration.json | `40a62c7a4c92111362e924bb738603641a49f9a66f3607558271528f876bc7d9` |
| P1_2-main-integration/integration.json | `7b3b7a675fce082b1314b053db631dbef9d4735492c6d891691a2e50585c3f92` |

所有输入均只读；后续准备工件仍需按当前源独立审查，真实资格与最终完整旅程保持未验。
