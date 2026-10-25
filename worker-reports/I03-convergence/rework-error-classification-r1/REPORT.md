# I03 P2 返工：观察错误不再被推成目标不存在

本轮基于 `5d5707c0dbffc39422b3d074515996f356d5bdc8`，只修原 I03 的公开 `probe --case managed-publish --publish-request <fixture> --json` 声明门。候选待独立双审；whole I03、实际 API/UI、有效受众、独立服务身份和恢复仍为 UNVERIFIED。

原实现只阻断 timeout/network/403/409/5xx。Spec 反例中的 401、404、429 会返回空 blocks 并声称声明前置成立，虽然仍 exit2/UNVERIFIED。根因是有限错误种类白名单。现在任何 `observationError` 与 `targetRecordedAbsent:true` 组合都明确返回 `BLOCKED_ABSENCE_INFERRED_FROM_ERROR`；未知错误同样不能证明目标不存在。输入形状校验和无错误声明的 UNVERIFIED 对照保持原契约。没有新增网络、服务或第二控制器。

## 实际 RED / GREEN

固定解释器为 `<node24-runtime>/bin/node`。最终 PATH 为本轮 offline-bin、同一 Node 24 bin 和系统目录；RED（fixed-guards）、聚焦 GREEN、两组最终回归完全相同。CLI 子进程使用 process.execPath，故与测试进程一致。所有命令、cwd、UTC 起止、输入 SHA、Node 二进制 SHA、PATH 和真实 exit 见 run-results.json。

- 参数化 seam：18 种错误（含 1xx/3xx/4xx/5xx 边界、401/404/429、timeout/network 和未知 kind）与一个无错误声明对照。RED 实际有 11 个错误子项漏阻断；TAP 8 pass /12 fail（含父节点失败），exit1。修复后 20/20（19 子项与父节点），exit0。
- 最终 I03：保留原 23 个顶层检查，新增一个参数化组，合计24个顶层、TAP43/43，0 fail/skip，exit0。
- 直接相关 registry/knowledge-authz/backup-restore/recovery：82/82，0 fail/skip，exit0。仅一次最终回归；未运行无关全仓。
- 两组最终结果绑定同8项输入摘要 `6b993ed508124a34cc6ec0b7d647749b9e4b6ee12ece8543a5b3fb9106319965`。Node syntax、git diff --check、raw/display/trace SHA及旧证据不变核对通过。

首次 fake 守卫校准因 NVM bin 排在守卫前而失败：只读 `npm --version` 命中 NVM npm；没有 API/服务/凭据访问。原失败 trace 与首次 RED 均保留，没有当作已校准通过。调整为守卫优先后，docker/gh/npm/curl/wget/fetch 六个阳性控制均通过，再次真实 RED 后才改实现。最终 I03 trace 为空；相关套件的 npm/docker/gh 命中离线守卫，未调用真实 CLI 服务。fixture 由既有 afterEach 清理，不写活配置。

## 原证据与权限边界

`5d5707c` 的22份报告文件逐字未改；原 manifest 保持 `32d7cd05d543b39f82b85d5586972b75140eac975a857cbb9f23c473c2378c59`。本轮另存于本目录，CURRENT.json 只指向本轮候选。原始输出保留在 `.local/I03-convergence/rework-error-classification-r1/`，display 副本脱敏宿主路径并移除 TAP 空白行尾的水平空白；各自摘要独立记录，原始字节保持不变。旧 `.local/I01-convergence` 与 I03 raw 未覆盖或删除。

已明确的人类授权范围继续有效；本轮没有新增 API、secret、服务启停、ACL、grant 或业务台账动作。历史 c5c538…一次 owner 三 API 观察未重跑、未刷新；它不能转成当前 Reader/Publisher/Isolator/Issuer 资格。后续仍按原 NEXT-QUALIFICATION-PLAN 与 root 审核后的真实主体/资源/端点/回退边界执行，不由本地绿色解除尚缺的实际身份、grant 和渠道读回。
