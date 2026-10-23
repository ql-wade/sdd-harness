# VERIFY — 最终验证报告（delivery-foundation-rearchitecture，七P1返工 run rework-seven-p1-r1）

## 1. 最终基线与执行环境

| 项 | 值 |
| --- | --- |
| 基点（最终集成候选） | `6918798`（merge rework/p5-3: capability boundary, real rollback drill, runbook v2 — review APPROVED；37 个实现节点全部接纳合入） |
| 分支 / 工作区 | `rework/verify`（控制器专用 worktree；.sdd 预备态 gitignored） |
| Comet 构建 | fingerprint `d437093083ad4500253795fe231484c606e925b2404f958e5a7dd4fd4c11cba6`（六补丁链，lock 逐文件 sha 校验），`--version` = **0.4.5**，node 钉定 24.15.0（lock toolchain；会话默认 22.13.1 仅跑非 comet 套件） |
| Outline 试点栈 | loopback 6 容器（outline healthy / postgres / redis / minio / dex OIDC），受管文集 `a3c6b4d8-1f1e-473d-9f49-ea5c48b7a818`，三测试主体 owner/member/offboarded（API key 通道，P4_7 登记形态） |
| 观察者资格 | delivery-journey.mjs 为 test action/observer adapter（无 phase/DAG/retry/job-lease/auto-recovery 权）；三 journey 配方经 journey_definitions 注册、owner/required_check/path 齐备；schema 校验通过 |

## 2. 合同 118 检查执行汇总（逐项见 verification-results.json per_check）

| 分类 | 数量 | 明细 |
| --- | --- | --- |
| PASS | 104 | 89 场景检查 + 3 journey 配方检查 + 辅助 12（npm 类按已知集判定的见下行；infra I01–I08、openspec-strict、comet-native(钉定 24.15.0 重跑)、RW_* 反例检查、3 组合检查） |
| KNOWN_ENVIRONMENT_DRIFT | 9 | V_B08/V_A11（3_4.mjs 的 B08 preservation 两点）+ V_C01/C02/C03（classic-integration.test.js 的 C08 negative 拖累）+ V_C05/C08（1_5.mjs 同点）+ V_NPM_REGRESSION/V_SCOPED_REGRESSION（npm 签名 475/472/2/1 恰已知集） |
| UNVERIFIED | 3 | V_F01/V_F03（断言映射缺失，诚实 NOT-EXERCISED）+ V_RW_RUNNER_BUILD（合同引用已退役 probe case 名） |
| FAILED | 2 | V_FULL_CHECK（whitebox 绿夹具缺口，base 起 pre-existing，同原轮 F-5）+ V_A15（3_1.mjs 点 23 陈旧前提拖累，A15 自身点绿） |

**npm 回归签名**：`475 tests / 472 pass / 2 fail / 1 skip` —— 失败点恰为登记已知对（not ok 62 = C08 negative：宿主 openspec 1.3.1 钉定 vs 宿主 1.14.3 漂移 fail-closed；not ok 463 = B08 preservation：同漂移根因），skip 为登记的隔离 1.11.0 阳性对照未安装。**恰已知集，零新增失败**。

**92 场景判定**：PASS 82 / KNOWN_ENVIRONMENT_DRIFT 7 / FAIL(陈旧前提) 1 / UNVERIFIED 2。逐场景 verdict 与证据指针在 verification-results.json；每条检查的原始输出在 `worker-reports/VERIFY-rework/evidence/<检查ID>.txt`（已脱宿主路径）。

## 3. 三条真实旅程（同 Run 规则，全部真实执行）

### 3.1 V_SAME_RUN_DELIVERY — 同 Run 完整产品旅程（步骤 1–11 全部到达）

产品 Run `verify-e2e-journey`（scratch world + 真实受管 Comet CLI d4370930，managed-delivery + knowledge-closeout-required=true）：

1. **R confirm**：无 R 回执时 `open-complete` 被拒（exit 1，拒因点名 R）→ dispatch-gate R（Runtime 签发 execution/attempt/inputDigest/epoch）→ 回执接纳 → phase=design。
2. **A grill/全票共识**：2:1 多数票被拒（unanimous 纪律）、缺票短法定人数被拒；**本 run 真实 r3 全票回执**（consensus/2026-10-22-plan-r3，三票 APPROVE 零阻断）经 trusted-launcher dispatch 消费接纳。
3. **T 独立审查**：弱 oracle 被拒（oracle 纪律）、强 oracle 接纳。
4. **P**：接纳；任务 id 分配改变计划定义后 **P 重接纳**（generation 提升，P1-03 纪律活体）。
5. **TDD build**：registered check identity（build-ok/verify-ok 经 check-policy），build-complete → phase=verify。
6. **Whitebox V**：verification report 登记、verify-ok check、V 回执、verify-pass → **phase=archive（R→V 切片边界，39 项断言全绿，回执含 attempt/epoch/generation）**。
7. **Kp（VERIFY 所有）**：Runtime K dispatch → **真实 Outline 发布**（documents.create 200，documentId `2c7c2076-92a5-459c-8112-71456afbed3b`，独立 documents.info 读回 200，读回摘要=发布对象摘要）→ knowledge-publish 注册（固定 UUID）→ **真实 SIGKILL 窗口 A**（closeout 记录事务 pre-commit 击杀；回滚验证：closeout 未落账、phase 不变）→ 新进程重新封存恰一次（Knowledge.Closeout.v1：targetKind=external、target=documentId、revision、readbackDigest、execution=K dispatch）。
8. **真实 OpenSpec 归档**：archive-confirm（入场前提 R,A,T,P,V 现）→ **真实 SIGKILL 窗口 B**（archived 转移 post-commit 击杀）→ **roll-forward 恢复**：archived 恰一次为 true、二次 archived 为幂等 no-op 引导、事务 journal 已消费、**发布无双写**（Outline 文集内该知识恰一份）→ 经引擎 classic passthrough 执行真实 openspec archive 移动（`changes/archive/2026-10-23-verify-e2e-journey`）→ comet archive 收尾：archived:true 落账、主 specs 干净（一处包装层注记指针缺陷如实记录，见 findings VF-4）。
9. **Outline 未知结果/重启恢复窗口**：即窗口 A/B（同 Run 内、completed 之前注入的真实故障），监督面 `monitor.mjs supervise` = **ALLOW/SAME_FIXED_AUTHORITY_ONLY**（stateCopy FORBIDDEN、secondBusinessOwner FORBIDDEN），`probe runner-process-failure` = VERIFIED（进程级真实击杀/重启证明）。
10. **Kt 读回**：completionBlocked=false、knowledgeCloseoutRecorded=true。
11. **completed**：RunState `status=completed, currentStep=completed`（evidence: stage-kt.json）。

配方检查本体 PASS（3_2.mjs 13/13，含 rv-slice-real-cli 真实切片点）；完整同 Run 终态主张由本节 VERIFY 所有编排证据承载（`.whitebox/rework/full-journey/stage-{gates,kp,archive,kt}.json`）。

### 3.2 V_RW_REAL_COMET_RECOVERY — 实际 Comet 故障恢复

配方检查 PASS（3_3.mjs 8/8：pre-commit kill 回滚 / post-commit kill 前滚 / 同 operation 恢复无重复派发 / 旧 attempt 重放拒绝 / 锁层旧 writer 隔离）。同 Run 内两真实击杀窗口见 §3.1 步骤 7/8；监督只恢复原 authority；无双写、无重复发布、无假 completed。

### 3.3 V_POST_DELIVERY_PERMISSIONS — 关联知识撤权恢复（消费 §3.1 同一发布知识）

| 步骤 | 真实执行（墙钟 UTC） | 结果 |
| --- | --- | --- |
| 受众变更 | 06:36:18Z add member 入受管文集 | member documents.info **200**（受众扩变真实生效） |
| 撤权触发 | 06:36:38Z remove member + documents.archive | archivedAt=`2026-10-23T06:36:38.884Z`（平台落账） |
| 检测读回 | 06:37:02Z 独立读回 | member info **403** authorization_error；offboarded **403** user_suspended；member search **0** 命中（owner search 1 = 阳性对照，搜索功能本身正常）；shares.list **0** |
| 独立计时 | monitor.mjs alert 评估真实时间线 | **detectionSeconds=24**（撤权→独立检测）；ALERT_UNDELIVERED + ESCALATION_MISSING 如实记录（本任务从未持有告警发送授权，工具只备不发） |
| 恢复 | documents.restore | ok，revision 5，archivedAt=null（知识当前可用）；**member 不回加**（被撤受众永不静默恢复）；新凭据签发通道在部署版本 not_found（findings VF-5 如实记录；RESTORE_AUTHZ_NOT_NEW 拒绝语义由配方在适配器面证明） |
| 清理 | 旅程文档永久删除 | 受管文集回到既有 2 篇 smoke 文档，共享栈零残留 |

配方检查本体 PASS（4_8.mjs 7/7：origin_run/知识 id/operation key 关联、RUN_ID_REQUIRED/CLOSURE_INVALID 拒绝、RESTORE_AUTHZ_NOT_NEW、SLA 段登记）。

## 4. 诚实边界（UNVERIFIED 台账 + holder + 复审触发器）

| # | 项 | holder |
| --- | --- | --- |
| U1 | **F10 跨机能力 = UNVERIFIED_NOT_ENABLED**：V_F10 检查本身 PASS（未启用分支语义真实执行），能力建设（5.2.a API / 5.2.b 正向隔离撤权恢复断联）未执行 | 用户（跨机范围启用裁决） |
| U2 | I02 真实容器半边 S6/S7/S8（角色探针/正向链/恢复入口） | I01 refs 准入（4 ref）/ runtime admission |
| U3 | 知识 DB 备份通道（canonical run-state 信封外的真实备份恢复贯通；机制四探针全 VERIFIED） | I08 backup owner + 部署波次 |
| U4 | live 告警投递（无发送授权；真实时间线已测 detection=24s） | 用户/平台准入（secret-ref monitor-alert） |
| U5 | HTML-UI 通道与未认证读者逐身份 ACL（dex 仅 bcrypt 哈希、明文口令不可得、共享栈禁重启；隔离读回全部以真实 API key 主体完成，P4_7 登记标准） | 用户（测试主体口令披露）或具 UI 的试点环境 |
| U6 | V_F01/V_F03 断言映射缺失（诚实 NOT-EXERCISED；旧验收器下可被假 PASS 掩盖） | F01/F03 case-module owner |
| U7 | V_RW_RUNNER_BUILD 合同 probe case 名退役 | 合同 owner（I08_FILENAME_DEVIATION 先例） |
| U8 | I01 Step3 gh TLS 读回（x509 -26276） | 用户（环境） |

**复审触发器**：
- **T1**：用户裁决 HOST_OPENSPEC_DRIFT（重钉 1.3.1 / 迁移基线 1.14.3 / 显式重冻结三选一）→ 复跑已知集九项 + npm 两项，预期全绿。
- **T2**：用户启用跨机范围 → 建设 5.2.a/5.2.b 并执行 F10 正向隔离恢复认证 → U1 关闭（整体目标随之可重判）。
- **T3**：I01 refs 准入完成 → I02 真实容器 S6/S7/S8 探针 + V_RW_RUNNER_BUILD 按现行 case 名复跑 → U2/U7 关闭。
- **T4**：披露测试主体口令或提供 UI 试点环境 → HTML-UI 通道与未认证逐身份 ACL 读回 → U5 关闭。
- **T5**：告警发送授权（secret-ref monitor-alert）落地 → live 投递 + 升级段真实计时 → U4 关闭；备份 owner 贯通 canonical 信封 → U3 关闭。

## 5. 七 P1 关闭矩阵（逐一绑定 fix 提交 / 反例变绿 / 最终候选读回）

| P1 | fix 提交（实现→合入 master） | 反例变绿证据 | 6918798 最终读回 |
| --- | --- | --- | --- |
| P1-01 门禁入口拒否 | P2_4 838e5b1→27aeea2；P1_5 bf7770f→bdac92f | worker-reports/P2_4-rework、P1_5-rework（真实 CLI 无 R 成功→拒） | V_RW_R_ENTRY exit 0；旅程内 live 复证（无 R 拒绝） |
| P1-02 回执接纳 | P2_4 838e5b1；P2_5 0a56a35→ea996c7；I02 本地半边 | P2_5-rework 消费面漂移复现→绿 | V_RW_TRUSTED_REVIEW / V_RW_TARGET_REQUIRED / V_RW_OBSERVATION_REQUIRED / V_I02_METHOD_STATE_SCOPE 全 exit 0 |
| P1-03 epoch/generation 隔离 | P2_4 838e5b1；P3_3 53e8b6f→e42c348 | P3_3-rework 三窗口击杀 + fencing | V_RW_REVISION_NO_REVIVE exit 0；旅程回执带 epoch/generation、P 重绑定提升 generation |
| P1-04 验收器分母/映射/typed 读回/--journey | P3_1 315b1a0→e278b81；VERIFY 本轮 | P3_1-rework RED-1..4 全翻绿 | 本报告 118 检查即 P1-04 读回：两假 PASS 类被诚实显影（V_F01/F03 NOT-EXERCISED、V_A15 陈旧前提）；V_RW_COMPLETION_REQUIRED 复跑 12/12 |
| P1-05 真实 Runner 资格 | P1_1 0ff66e3→65598f7；I02 本地半边 | P1_1-rework 工具链/llmwiki 项目化绿；I02 构建链+准入 ACK | V_INFRA_I02 / V_I02_METHOD_STATE_SCOPE exit 0；S6/S7/S8 保持 staged-UNVERIFIED（不冒充） |
| P1-06 观察配方+机制 | P3_2 cc5622c→302dc9b；P3_3 53e8b6f→e42c348；P4_6 fc54ccf→cbe4dc5；P4_8 5b4e14c→cb9eb0c；I07 53c15f3→f3cbf6a；I08 ba218ad→e5fe671 | 各 -rework 目录 red→green + mutation 击杀 | 三 journey 配方检查 exit 0 **且** VERIFY 亲自执行完整真实旅程（同 Run completed；两真实击杀窗口恢复；真实撤权→隔离→恢复） |
| P1-07 四层索引+完成门诚实 | P4_3 2b34cc3→72b3a9e；VERIFY 本轮终基线重生成 | P4_3-rework 判定器 red→green | acceptance-index.json 于 6918798 重生成（P5_2 行按返工计划有意脱落，runbook 第 8 节同步）；V_RW_COMPLETION_REQUIRED 陈旧 index 红→重生成后 12/12（两次均留证） |

## 6. 发现清单（全部如实上报，未静默修复）

- **VF-1** 3_1.mjs 点 23 断言三 journey 仍为 TO_IMPLEMENT——配方落地后前提陈旧，模块级拖累 V_A15（A15 自身点 ok 25）。属 case-module owner 的前提刷新。
- **VF-2** F01/F03 无场景锚定测试点——P1-04 诚实拒绝类（旧验收器下可假 PASS）。
- **VF-3** V_RW_RUNNER_BUILD 合同命令引用退役 probe case（现行 role-denial/duplicate-authority）；底层覆盖经 V_INFRA_I02 绿。
- **VF-4** comet archive 收尾在"外部恢复路径"（移动先于收尾）下按移动前路径核对 design_doc 注记（归档副本 design.md 在位、archived:true、主 specs 干净）；单命令 `comet archive` 在本 scratch 环境另有 pre-flight 裸 ENOENT（引擎两步面为 runbook 形态）。上游包装行为，如实记录。
- **VF-5** 部署版 Outline 的 api-keys.create 返回 not_found——新凭据签发通道不可用；恢复以 owner 凭据+隔离后授权动作完成。
- **VF-6** Outline 对发布文本做空白规范化：Knowledge.Closeout 登记的是发布对象（读回验证对象）摘要，意图载荷差异如实注记。
- **VF-7** 5_3.mjs J4 的 ≥4 环境门常量在 P5_2 行有意脱落后需再校准（≥3）——归属已 REOPENED 的 P5_3 复验（控制器 Step 7 串行接纳处理）；无合同检查绑定 5_3.mjs，92 场景结果不受影响。

## 7. 完成判定核对

1. **required=PASS**：104 PASS + 9 登记环境漂移（恰已知集、逐项有因有 holder）+ 3 UNVERIFIED + 2 FAILED（均 pre-existing/陈旧前提、逐项有因）。**未达全绿——如实标注**；漂移项全部锚定 HOST_OPENSPEC_DRIFT 单一用户裁决（T1）。
2. **零未关闭 P0/P1**：七 P1 全部绑定关闭（§5）；本轮新发现 VF-1..VF-7 无 P0/P1 级产品缺陷（测试前提/包装层/登记类）。
3. **同 Run 产品 completed 且知识当前可用**：**满足**（stage-kt.json：RunState completed；Kp 封存、读回绑定、恢复后知识可用、清理完成）。
4. **F10 未启用**：如实记录（U1），**整体目标不宣布完成**（goal_complete=false）。

本轮仅接纳验证三产物 + acceptance-index.json 终基线 + runbook 第 8 节同步 + worker-reports/VERIFY-rework 证据；本 Change 的 Comet 唯一归档/后审由控制器在验收后执行（tasks.md VERIFY Step 6/7）。
