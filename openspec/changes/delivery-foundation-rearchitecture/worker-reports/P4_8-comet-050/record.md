# P4_8 worker report — revision 2026-10-26-comet-050-adoption-v1

Task: P4_8 撤权、隔离、告警与新授权恢复（tasks.md "### Task P4_8"，串行）。
Scope honored: only Owns files touched —
`lib/adapters/knowledge-revocation.js`（+判定面：evaluateRevocationSurface /
computeSegmentTimings / REVOCATION_CHANNEL_SURFACE / KT_REQUIRED_GRANT_ENTRIES，
既有 L01–L11 判定零改动）、`test/knowledge-revocation.test.js`（+R18/R19）、
`test/delivery-cases/4_8.mjs`（+J8/J9 活体臂，既有 J1–J7 零改动）、
`openspec/changes/delivery-foundation-rearchitecture/revocation-journey/`
（evidence/ 新增撤权矩阵与计时登记四件 + README comet-050 段）、
`revocation-journey/post-delivery-permissions.case.json`（未动——其 pinned
断言 L05/L05-maintenance-run/recipe-tracking 全部继续满足，新臂不属该 recipe 的
VERIFY 消费范围，避免 acceptance-index 分母漂移）+ 本报告目录。
No commit；未做任何真实外部撤权（Outline 无凭据；本地 LLMWiki 只在 /tmp 一次性
试点世界上真实操作，测后删除）。

## 1. Record（读侧事实）

- tasks.md P4_8 修订条款：Web/分享/搜索/附件/MCP 逐渠道实测；告警不能充当隔离；
  未知不当公开；新授权前不恢复。
- I07（G15/R10 契约）：`infra/delivery/monitor/health-contract.json` g15 ——
  discoveryTargetSeconds 180 / isolationTargetSeconds 120 / segmentsTimedSeparately
  [fault_exposure, alert_delivery, isolation] / alertIsNeverIsolation: true /
  operationalEvidence UNVERIFIED；两调度面（CI schedule / host timer）UNREGISTERED。
- P4_7（Kt 面）：`publication-surface-registration.json` ktSurface 五条 requiredEntries
  全部 NOT_PROVISIONED（protected-issuance-workflow / source-permission-readback /
  target-audience-live-readback / publisher-credential-materialization /
  fresh-outbound-authorization）——本任务矩阵逐字引用，不重定义。
- P4_4（Kp/Kt 实测）：/tmp 闭环世界 + LLMWiki 活体供给
  （`.sdd/venvs/llmwiki-311/bin/python` 3.11.13 + mcp SDK 1.27.0 +
  `.sdd/repos/llmwiki/mcp`，protocolVersion 2025-11-25）；Outline 本地栈
  127.0.0.1:3000 未认证 API 401。**本任务零新授权消耗**。
- I04（源码边界）：delete 拒 `*`/`**`/`**/*`、保护 `/wiki/overview.md`+`/wiki/log.md`
  ——本任务做活体复证（不改源码）。
- git：共享工作树 HEAD 移动中（RED 时 d32e6e5 → GREEN 时 c61ba066，其他 worker
  在飞）；本任务 Owns 文件改动独立。

## 2. RED（真实行为 RED）

- 基线（修订前，钉版 node v24.15.0）：`4_8.mjs` 7/7、
  `knowledge-revocation.test.js` 17/17 全绿（evidence/RED-baseline.txt）——
  判定层基点。
- 修订新臂 RED：先写 R18/R19/J8/J9 四臂再实现——R18/R19 各 fail
  （`evaluateRevocationSurface`/`computeSegmentTimings` 不存在，typeof undefined）；
  J8 fail（同因）、J9 fail（同因）（evidence/RED-new-arms.txt；19 tests 17 pass
  2 fail / 9 tests 7 pass 2 fail）。实现中途我引入过两处测试侧笔误（python driver
  的 `\\n` 转义、isolation 段 90s/110s 算术），当场修复，未计入 RED/GREEN 证据。

## 3. 撤权矩阵（渠道 × 操作 × 实测/UNVERIFIED）——本修订核心交付

| 渠道 | 操作 | 状态 | 证据（verbatim） |
| --- | --- | --- | --- |
| llmwiki-delete | 真实 stdio `local_server`（I04 供给）：create → read 确认 → search 1 result → **delete** → read `not found` → search `No matches` → 磁盘字节消失 | **MEASURED**（活体双读回） | evidence/llmwiki-delete-live-revocation.json |
| llmwiki-delete 保护 | `delete('*'/'**'/'**/*')` → 逐字 `Error: refusing to delete everything. Use a more specific path.`；`/wiki/overview.md`、`/wiki/log.md` → 逐字 `Cannot delete … structural wiki pages`；两结构页存活 | **MEASURED**（I04 源码边界的活体复证；结构页由服务器自动播种，无需预置） | 同上 |
| llmwiki-delete 恢复 | delete 确认消失 → **新授权** re-create 同路径 → 读回携带新候选字节、sha256 一致、磁盘重落 | **MEASURED** | 同上 |
| outline-unpublish | `POST /api/documents.unpublish` → **HTTP 401 `authentication_required`**（逐字） | **UNVERIFIED-NEEDS-GRANT**（五条 ktSurface 条目） | evidence/outline-revocation-401.json |
| outline-shares-revoke | `POST /api/shares.revoke` → **HTTP 401**（逐字） | **UNVERIFIED-NEEDS-GRANT** | 同上 |
| outline-collection-membership | `POST /api/collections.remove_user` → **HTTP 401**（逐字） | **UNVERIFIED-NEEDS-GRANT** | 同上 |

矩阵判定面：`evaluateRevocationSurface`——本地渠道只在**成对独立读回**（内容
不可达 + 全文检索零命中）下 MEASURED；delete 标签单独出现 = UNVERIFIED（L02 纪律
移植到矩阵）；Outline 渠道恒 UNVERIFIED-NEEDS-GRANT 且**已送达的告警不升级任何
渠道**（alertIsNeverIsolation 全渠道恒真）。

## 4. 隔离语义 / 恢复 / G15 三段计时

- **告警≠隔离**：I07 契约断言保持——`computeSegmentTimings` 返回
  alertIsNeverIsolation 恒真；`evaluateIsolationCompletion`（既有）继续要求逐渠道
  independent-readback；`judgeIsolationFailure`（既有）首败即告警、权限拒绝升级
  owner、`exposureUnresolved`/`alert.cleared=false` ——J8 活体断言升级面。
- **隔离=内容不可达**：LLMWiki delete 后三信道（MCP read not-found / MCP search
  零命中 / 磁盘字节消失）判 isolated（既有判定器 + 活体证据）。
- **恢复**：delete → 新授权 re-create → 读回字节一致（活体）；判定层
  `evaluateRestoration` 的 RESTORE_AUTHZ_NOT_NEW（新授权方可恢复）既有冻结不动。
- **G15 三段计时**：`computeSegmentTimings`——fault_exposure（发现，≤180s）/
  alert_delivery（≤30s）/ isolation（≤120s）三段从真实时间戳分别计时，缺时间戳
  的段=unknown（绝不置零、绝不暂停），超目标保留 violation
  （DISCOVERY/ALERT_DELIVERY/ISOLATION_TARGET_EXCEEDED）；deadline 从
  G15A_DEADLINES 引用（与 I07 monitor 同一集合，非第二套）。本地实测：LLMWiki
  撤权 isolation 段 ~3ms（within targets）；Outline 段/生产监控链 UNVERIFIED
  （evidence/g15-segment-timings.json 登记四条 unverifiedSegments）。

## 5. 验证（真实命令与结果，钉版 node v24.15.0）

| 命令 | 结果 |
| --- | --- |
| `node --test test/delivery-cases/4_8.mjs`（×2 稳定性） | **9/9 pass ×2**（GREEN-own-suites.txt） |
| `node --test test/knowledge-revocation.test.js`（×2） | **19/19 pass ×2** |
| 相邻（钉版）：knowledge-closeout 21/21、knowledge-authorization 13/13、4_7 13/13、4_4 5/5、4_6 6/6、3_4 9/9 | **全绿**（GREEN-adjacent-regressions.txt） |
| host node v22.13.1（npm test 同构）：knowledge-revocation 19/19、4_8 9/9 | **全绿** |
| `npm test`（全量） | 见 evidence/npm-test-full.txt |
| 新增 JSON 工件 python3 json.load 校验 | OK（revocation-matrix / g15-segment-timings / 两个活体证据，journey evidence 目录四件均验） |
| 活体证据生成 | `P48_REVOCATION_PROOF_DIR=… node --test --test-name-pattern "J8|J9" test/delivery-cases/4_8.mjs`（2/2，证据双落 worker-reports 与 revocation-journey/evidence） |

## 6. UNVERIFIED / 边界（如实登记）

- **授权 Outline 受众撤除**：无凭据；真实未认证调用 401 逐字记录。前置 = P4_7
  ktSurface 五条（issuance 凭据 → 源侧读回 → 五通道受众读回 → publisher 凭据 →
  新外发授权）；翻转必须带 evidenceRef，否则按 KT_GRANT_CLAIM_UNGROUNDED 家族
  fail-closed。
- **Outline 五通道隔离读回**（membership/inheritance/pageShare/publicShare/
  attachment）：attachment 从未观测（P4_7 记录）；承接者 Outline owner + 部署验证
  波次。
- **G15 生产计时证据**：本地只测了 LLMWiki delete 段（毫秒级）；fault_exposure /
  alert_delivery / Outline isolation 的生产段与监控链端到端保持 UNVERIFIED
  （I07 两调度面 UNREGISTERED）。
- **LLMWiki managed-host 接纳**：本任务证明组件 stdio 供给面（与 I04/P4_4 同口径）；
  真实宿主经注册入口的发现仍属 I04 接纳条件。
- **post-delivery-permissions.case.json**：未动（pinned 断言继续全满足）；VERIFY
  消费面的任何扩展归 VERIFY/唯一控制器。
- 我未执行 Step 4 独立 Spec/质量审查（review 归独立评审人）；Whitebox 签名不在本
  worker。全量跨边界旅程归 VERIFY，不以局部绿关闭父义务。

## 7. 交接

改动文件（绝对路径）：
- `/Users/mac/Code/sdd-harness/lib/adapters/knowledge-revocation.js`
- `/Users/mac/Code/sdd-harness/test/knowledge-revocation.test.js`
- `/Users/mac/Code/sdd-harness/test/delivery-cases/4_8.mjs`
- `/Users/mac/Code/sdd-harness/openspec/changes/delivery-foundation-rearchitecture/revocation-journey/evidence/{revocation-matrix,g15-segment-timings,llmwiki-delete-live-revocation,outline-revocation-401}.json`
- `/Users/mac/Code/sdd-harness/openspec/changes/delivery-foundation-rearchitecture/revocation-journey/README.md`
- `/Users/mac/Code/sdd-harness/openspec/changes/delivery-foundation-rearchitecture/worker-reports/P4_8-comet-050/`（本报告 + evidence/）

风险：J8/J9 为条件活体（供给缺失=skip UNVERIFIED，绝不假绿）；Outline 栈
127.0.0.1:3000 是本机开发栈，其 401 只证"未认证被拒"，不证生产行为；共享工作树
上其他 worker 未提交改动共存，控制器集成时按各 worker 报告归属。
