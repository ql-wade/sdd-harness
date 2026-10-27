# P4_2 提升/回滚执行证据（release-journey）

Task P4_2（run impl-dfr-20261020-r1，分支 impl/p4-2-promotion-rollback，2026-10-21；
修订 2026-10-26-comet-050-adoption-v1 增补 foundation 分发链，见文末）。
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
ROLLBACK_RETENTION_MISSING、ROLLBACK_TERMINAL_STATE_UNCONFIRMED，以及
foundation 面的 BUILD_DIGEST_DRIFT、SUPPLY_RUNNER_MISMATCH、SUPPLY_BUILD_DRIFT、
SEALED_BASELINE_UNRESOLVABLE、RELEASE_PROTOCOLS_UNREGISTERED、
DISTRIBUTION_LEDGER_REQUIRED、DISTRIBUTION_PROJECT_MISMATCH、
ROLLBACK_BASELINE_UNRESOLVABLE）由
`test/release-protocol.test.js`（30 例）与 `test/delivery-cases/4_2.mjs`
（7 例，含 P4_1 delivery-gate 真实前置与 4.2.c foundation 旅程）持续回归；
本目录是一次真实完整旅程的落盘证据。

## foundation 分发链（修订 2026-10-26-comet-050-adoption-v1，2026-10-26/27）

本仓库自身就是分发生产者：部署语义 = foundation-export 分发包的
构建/发布/回滚。新增 `foundation-promote|foundation-reconcile|
foundation-rollback` 三个子命令（同一 ReleaseProtocol.v1 CLI），复用
exporter 原生模块接口（`buildLock`/`resolveBaseline`）；供应侧 build
fingerprint 镜像 `tools/comet/build.mjs fingerprintOf` 公式，并在
`.sdd/vendor/comet/<commit>/builds/<fp>/distribution.json` 存在时实测比对。

发布协议登记：`release-protocols.json`（本目录，如实登记当前发布路径——
git 分发 LOCAL_VERIFIED；npm publish 与 GitHub release 为 UNVERIFIED：
本任务无发布凭据/授权，`.github/workflows` 仅有只读门
delivery-gate.yml + quality-gates.yml，无发布流水线）。

### foundation-*.json 旅程（全部真实提交字节，账本在 $TMPDIR，零仓库写入）

| 记录 | 场景语义 | 判定要点 |
| --- | --- | --- |
| foundation-promote-v1-old-commit.json | 旧提交 60a75c53 的已提交分发（exportDigest 3ab11336…，runner 0.4.5 供应指纹 30562925…） | exit 0：以钉版 releaseCommit 重算 live build == 已提交 lock；sealed baseline 逐字节解析；发布记录绑定 exportDigest+供应指纹+releaseCommit |
| foundation-promote-v2-current.json | 当前提交分发（bd4fe3be…，runner 0.5.0，供应指纹 de39629a… 与本机 `.sdd` vendored build 的 distribution.json 实测一致） | exit 0：顺序发布自身移动 tag；保留上一已批准 exportDigest（3ab1…）为唯一回滚目标 |
| foundation-rollback-unapproved.json | A17 未批准拒绝 | exit 2，ROLLBACK_NOT_APPROVED，零状态变更 |
| foundation-rollback-approved.json | A17 批准回滚到前一 exportDigest | exit 0：目标 3ab1… 的 sealed baseline 从**当前仓库** foundation/baselines/ 多版本保留中逐字节解析（source=sealed-assets）；active/tag/服务终态读回全部 = 回滚 digest |
| foundation-reconcile-unknown.json | A16 未知关联 ID | exit 2，READBACK_UNCONFIRMED，found=false，绝不二次发布 |
| foundation-drift-refusal-old-commit.json | A14/digest 锁真实拦截样本 | 历史提交 0e0d8341（lock 19df85e0…）在其自身提交上 live 重算即漂移（并行波次冻结竞态）：exit 2，BLOCKED [BUILD_DIGEST_DRIFT, SEALED_BASELINE_UNRESOLVABLE]，committed 19df85e0… vs built d34809dd…，零发布 |
| foundation-run-manifest.txt | 运行清单 | 6 步真实 CLI 执行 exitCode：0/0/2/0/2/2 |
