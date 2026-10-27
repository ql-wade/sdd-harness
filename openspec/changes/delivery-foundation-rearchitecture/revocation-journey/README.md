# P4_8 知识撤销与恢复旅程证据（revocation-journey）

Task P4_8（分支 `impl/p4-8-knowledge-revocation`，基 `master@e04bac8`，2026-10-21）。
语义唯一来源：`specs/delivery-foundation/spec.md` 的 L01–L11 场景与
`knowledge-revocation-and-restoration.md`（G14 A 事件＋周期核验；G15 A 已确认：
正常依赖下 5 分钟目标，故障允许超时但必须留痕，计时不暂停）。

被测物是 `lib/adapters/knowledge-revocation.js`（KnowledgeRevocation.v1 判定＋协议
层，P4_4 adapter 形态）：不持第二 RunState/currentPhase，采集器只交事实，隔离
执行器只做单独预授权内的收窄，监控/监督器只告警与重启原实例。真实入口：

- **授权面（真实 CLI）**：P4_7 `tools/infra/knowledge-authz.mjs` 的
  decide → revoke → recheck —— 源权限缩小后旧发布回执按真实台账重验失效
  （exit 0/0/2，`LEDGER_CHANGED` + `GRANT_NO_LONGER_VALID`）。
- **本地渠道（真实机制）**：文件系统 wiki 真实字节；受控 stdio MCP 会话为
  隔离配置内**真实 JSON-RPC 握手子进程**（本沙箱 llmwiki venv 不可用，如实记
  录；真实超时＝unknown，绝不充当不可读）。资源端收窄＝移入隔离域（无删除）。
- **故障注入（真实）**：真实维护 worker 子进程、真 SIGKILL、终止确认、原实例
  重启；暴露窗口用真实墙钟计算，宕机时长留在窗口内（pausedMs=0）。
- **外部 Web 渠道（合同级）**：Outline Web/分享/搜索/附件按真实请求形状构造，
  无凭据无网络 —— 一律 UNVERIFIED + 承接者（Outline owner + 部署验证波次），
  绝不以 stale/unpublish 标签充当"不可读"，不伪造远端读回。

## 记录的执行（evidence/*.json，每文件含真实 exitCode + 结构化回执）

| 记录 | 场景语义 | 判定要点 |
| --- | --- | --- |
| budgets-freeze.json | 4.8.a / G15 A 冻结 | G15A_DEADLINES 判 ok（300s 端到端目标、alert-and-record 故障策略）；endToEnd=360 → END_TO_END_BUDGET_EXCEEDED；pause-clock-on-fault → FAULT_POLICY_INVALID |
| authz-cli-revocation-chain.json | L01/L04 经真实 CLI | decide exit 0（allow）→ owner revoke exit 0（真实台账原子写）→ recheck exit 2（旧回执失效） |
| channel-isolation-readback.json | L02/资源端隔离 | 收窄前 file-wiki/mcp-read/mcp-search 全 readable；移入隔离域后全 unreadable（file-wiki errorCode ENOENT）→ 判定 isolated；仅标签（stale+unpublished+archived）而渠道可读 → isolating + CHANNEL_STILL_READABLE；outline-share → UNVERIFIED + 承接者 |
| fault-injection-exposure-window.json | L09/L10/L11 | 真 SIGKILL（signal=SIGKILL）＋终止确认；宕机 156ms 真实留在窗口（exposureMs 432，pausedMs 0，violations []）；重启原实例幂等续作同一 operation（km-journey-fault，attempts 5，completed）；合成陈旧心跳触发 RUNNER_HEARTBEAT_STALE 且 isolated=false |
| run-manifest.json | 运行清单 | RED（4 个子集＋单测全量＋journey，全部真实 exit 1 / ERR_MODULE_NOT_FOUND）与 GREEN（全部 exit 0 ×2 稳定）、npm test 415/411/3（3 个均为已知环境性失败，零新增）、4 个证据驱动 exit 0 |

## 与套件的关系

同一判定面的正负例矩阵（ISOLATION_GRANT_REQUIRED、publish 权限≠隔离权、
两种期限、重复/乱序、全量对账计时、恢复不加回离组人员、监督器只准重启原实例、
三游标不可合一等）由 `test/knowledge-revocation.test.js`（17 例）与
`test/delivery-cases/4_8.mjs`（5 例端到端旅程）持续回归；本目录是一次真实完整
旅程的落盘证据。Live Outline Web 渠道读回、跨机恢复保持 UNVERIFIED（承接者：
Outline owner + 部署验证波次）。

## comet-050 修订（2026-10-26-comet-050-adoption-v1）：撤权矩阵与 G15 三段计时

知识撤域按渠道×操作登记为**撤权矩阵**（`evidence/revocation-matrix.json`），
判定面是 `lib/adapters/knowledge-revocation.js` 新增的
`evaluateRevocationSurface` / `computeSegmentTimings`（单元正负例见
`test/knowledge-revocation.test.js` R18/R19；活体旅程见
`test/delivery-cases/4_8.mjs` J8/J9）：

| 渠道 | 操作 | 状态 | 证据 |
| --- | --- | --- | --- |
| llmwiki-delete | 真实 stdio `local_server`（I04 供给）`create→read→search 命中→delete→read not found→search 零命中→磁盘字节消失` | **MEASURED**（活体双读回） | `evidence/llmwiki-delete-live-revocation.json` |
| llmwiki-delete 保护 | `delete('*'/'**'/'**/*')` 逐字拒 "refusing to delete everything"；`/wiki/overview.md`、`/wiki/log.md` 拒 "structural wiki pages"（I04 源码边界的活体复证；结构页存活） | **MEASURED** | 同上 |
| llmwiki-delete 恢复 | delete 确认消失 → 新授权 re-create → 读回逐字节一致 | **MEASURED** | 同上 |
| outline-unpublish | `POST /api/documents.unpublish` → **HTTP 401 `authentication_required`**（逐字） | **UNVERIFIED-NEEDS-GRANT** | `evidence/outline-revocation-401.json` |
| outline-shares-revoke | `POST /api/shares.revoke` → **HTTP 401**（逐字） | **UNVERIFIED-NEEDS-GRANT** | 同上 |
| outline-collection-membership | `POST /api/collections.remove_user` → **HTTP 401**（逐字） | **UNVERIFIED-NEEDS-GRANT** | 同上 |

Outline 三渠道所需的授权条目 = P4_7
`publication-surface-registration.json#ktSurface.requiredEntries` 五条（全部
NOT_PROVISIONED）；告警≠隔离在矩阵与所有渠道恒成立（已送达的告警不升级任何
UNVERIFIED 渠道）。G15 三段计时（fault_exposure ≤180s / alert_delivery ≤30s /
isolation ≤120s，与 I07 health-contract `g15.segmentsTimedSeparately` 同一
deadline 集）登记于 `evidence/g15-segment-timings.json`：本地可测段（LLMWiki
delete 延迟，毫秒级实测）已测；Outline/生产监控链各段保持 UNVERIFIED（I07 两
调度面 UNREGISTERED、ktSurface 五条未供）。隔离失败告警升级面（首败即告警、
权限拒绝升级 owner、告警不解除暴露）由 `judgeIsolationFailure` 冻结并在 J8
活体断言。
