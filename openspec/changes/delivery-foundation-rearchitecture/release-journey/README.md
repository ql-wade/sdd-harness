# P4_2 提升/回滚执行证据（release-journey）

Task P4_2（run impl-dfr-20261020-r1，分支 impl/p4-2-promotion-rollback，2026-10-21）。
语义唯一来源：`specs/delivery-foundation/spec.md` 的 A14/A16/A17/F09 场景。
执行器为真实 CLI：`tools/ci/release.mjs`（ReleaseProtocol.v1，本任务新建）；
独立判定复用已接纳基建（未修改）：`tools/infra/platform.mjs`（I06
IntegrationIdentity，`probe --case registry-environment-identity` 真实子进程）。
被测物是本地隔离 Registry/环境（目录形态，$TMPDIR 下真实生成）：digest 为
真实 sha256（对真实构建产物字节），部署账本/active 绑定/业务终态为真实文件，
零 mock。本轮无生产/平台授权：全部证据 LOCAL_ONLY，真实生产提升/部署如实
UNVERIFIED（承接者：环境 owner + P4_2 之后的运行时准入）。

## 记录的执行（evidence/*.json，每文件含真实 exitCode + 结构化回执）

| 记录 | 场景语义 | 判定要点 |
| --- | --- | --- |
| promote-v1.json | 4.2.a/F09 隔离构建并提升同 digest | exit 0，status VERIFIED；artifact.digest 内容寻址、builtFromMerge=精确 integration SHA；tag/active/业务终态全部贯穿同 digest |
| i06-chain-v1.json | F09 独立评估 | I06 probe exit 0，VERIFIED（执行器事实与已接纳评估器一致） |
| tag-drift-refusal.json | A14 tag 漂移拒绝 | 真实带外改指 tag 后提升：exit 2，TAG_DIGEST_DRIFT；回执记录实际身份不符（tagResolvedDigest≠expectedDigest≠built digest），零状态变更 |
| i06-chain-drift.json | A14 独立评估 | I06 exit 2，codes 含 TAG_DIGEST_DRIFT（双向一致） |
| promote-v2.json | 4.2.a 顺序发布 | tag==active 校验通过后提升 v2：exit 0；提升自身把 tag 移到新 digest（漂移防护针对带外改指，不针对本协议内的顺序发布） |
| promote-v2-idempotent.json | F09 同 digest 锁定 | 重复提升同 digest：exit 0，idempotent=true，deployed=false，同一 correlationId，账本仍 1 条 |
| reconcile-v2.json | 4.2.b/A16 部署超时查询 | 响应丢失后按原关联 ID 查询：exit 0，found=true，绑定原 requestedAt 原回执，deployed=false（不重复部署），账本仍 1 条 |
| i06-chain-reconciled.json | A16 独立评估 | I06 exit 0，VERIFIED，readback via=QUERY_BY_CORRELATION_ID |
| rollback-unapproved.json | A17 未批准拒绝 | exit 2，ROLLBACK_NOT_APPROVED，零状态变更 |
| i06-rollback-unapproved.json | A17 独立评估 | I06 exit 2，ROLLBACK_NOT_APPROVED |
| rollback-approved.json | A17 批准回滚+业务读回 | 批准 + 同 digest（等于保留的上一已批准制品）：exit 0；读回 digest、环境与独立业务终态（serving=回滚 digest） |
| i06-rollback-approved.json | A17 独立评估 | I06 exit 0，VERIFIED（rollback 步全过） |
| run-manifest.json | 运行清单 | 12 步真实 CLI 执行，全部 exitCode 如实记录 |

## 与套件的关系

同一 CLI 的正负例矩阵（含 ISOLATED_RELEASE_ENVIRONMENT_REQUIRED、
ENVIRONMENT_PROJECT_MISMATCH、ARTIFACT_NOT_FROM_MERGE、
DEPLOYMENT_DIGEST_MISMATCH、READBACK_UNCONFIRMED、ROLLBACK_DIGEST_MISMATCH、
ROLLBACK_RETENTION_MISSING、ROLLBACK_TERMINAL_STATE_UNCONFIRMED）由
`test/release-protocol.test.js`（17 例）与 `test/delivery-cases/4_2.mjs`
（6 例，含 P4_1 delivery-gate 真实前置）持续回归；本目录是一次真实完整
旅程的落盘证据。
