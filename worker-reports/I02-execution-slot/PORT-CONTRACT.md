# I02 execution slot：给原 P1_3 / P2_4 的端口交接

仅 `createCliJobDriver` 的既有物理进程接口补充；Root负责后续审查和接线。本文件不是新Runtime接口、DAG、lease、进度或权限源。真实image/bootstrap/OS/角色仍UNVERIFIED。

## 原可信输入

`{ job, dispatch, currentActionBinding }` 沿原接口：verifyDispatch必须有效，完整ActionBinding相同，`runner-job`、`runner-registration`、`runner-role-binding`三个digest必须对应。role从受保护注册选择，不接受worker自由role/namespace。哈希只决定名字，不能签发授权。

确定性名字：

```text
namespace + '-' + registeredRole.id + '-' + envelopeDigest({
  registration: registrationDigest,
  run: originalAction.run,
  execution: originalAction.execution,
  roleBinding: envelopeDigest(registeredRole),
  job: envelopeDigest(originalJob)
})
```

canonicalization复用原 `envelopeDigest`。同一原operation/job重入不更名；新execution不会碰旧terminal槽。旧固定 `namespace-role` 仅作严格同execution/run的历史查回及围栏，不rename/remove/复用执行。

## 新只读端口

```js
driver.resolveCliJob({ job, dispatch, currentActionBinding })
```

只做固定engine检查、严格role命名范围内的Docker ls/inspect；不会create/start/stop、发dispatch、写Run或签回执。

- 找到：`{found:true,status:'FOUND',handle,observation,launchPermitted:false,managedClosureEligible:false,scope:'component/physical-process'}`。
- 没有精确原执行：`{found:false,status:'ABSENT',handle:null,observation:null,launchPermitted:false,managedClosureEligible:false,...}`。
- 错注册/engine，或命名范围内候选的namespace、原execution/run不匹配、歧义、工具失败/不完整JSON均拒绝，不能降成ABSENT。范围外namespace不会被当成原执行，也不会获查回handle；调用者不能提供自由名字。

FOUND只说明查回原物理记录，不证明工件、方法、principal/OS或Gate通过。ABSENT只指没有原operation的精确匹配，不证明role空间没有其它进程，更不是新启动许可。

## 原Comet调用纪律

| 原Native记录 | 允许的后续 |
| --- | --- |
| 全新且由原记录CAS取得唯一launch claim | 可调用既有startCliJob一次；真实来源/输出仍须独立验证 |
| starting / started / unknown，或冷进程丢失volatile handle | 先resolve同一原job/dispatch/action；FOUND查回原handle再读实际状态；ABSENT保持UNKNOWN，不据此重启、新dispatch或自增attempt |
| 已有原handle | observeCliJob/stopCliJob仍需精确execution/run/roleBindingId/registrationDigest及实际image、用户、mount、namespace检查 |

start对任何已存在原槽（含created/unknown）只读回、`resumed:true,terminal:null`，不再次Docker start。不同execution的旧role进程只有明确exited且有合法exitCode才允许新槽；created/running/paused/restarting阻断，dead/removing/未知/不完整状态保持UNKNOWN。为保护同一role workspace，其它Run的非terminal记录也保守围栏。

新create后再读peer；有竞争writer或本新槽读回缺失，则拒绝start，保留created资源交Comet调和。禁止自动stop/rm/rename/kill，也不另建slot/lease表。错误可能发生于create前或后，调用方不能把异常推断为“从未产生资源”。

跨进程唯一claim仍由原Comet记录/CAS负责；peer读回不是新的原子锁或OS资格。本改动未补生产 `/opt/sdd/runner-host.mjs`、实际image/权限、Native持久launch记录、stdout/result/method-trace的可信恢复；这些仍由原任务资格化。不得把本Fake Docker Node协议夹具当成真实worker/bootstrap。
