# I02 execution slot / readonly resolve：独立 Spec 审查

结论：**APPROVE_EXECUTION_SLOT_CONSTRUCTION_ONLY**，限定候选范围阻断项0。不签 whole I02、真实Docker/Runner、OS/principal/方法/角色资格，也不代替P1_3实际消费端及Comet持久claim/恢复验证。

候选2b7fce91984c739a7243ac48e2beeb1ec3545135，base14bda75。审查树 `/Volumes/mac-extend/codex/worktrees/comet-delivery-contracts/sdd-harness`，前后tracked clean。依据Root本轮I02边界及PORT-CONTRACT，不依赖另一轴结论代替源码/行为核验。

## 需求核对

1. 原固定namespace-role在R1终态后会与合法R2的execution严格检查冲突；本改动只把物理槽名改为原registration/run/execution/roleBinding/job的既有canonical digest。授权仍先验完整ActionBinding、原dispatch签名与三个runner输入摘要，role来自固定注册，槽名hash不签发权限。没有第二queue/lease/controller。
2. resolveCliJob仅检查固定engine、严格命名范围的ls/inspect；FOUND与ABSENT均明确launchPermitted:false、managedClosureEligible:false。非法工具输出、错误退出、错scope/注册和歧义不能变成ABSENT；ABSENT只表示当前原执行未匹配，不表示role空闲，更不是新launch许可。
3. 原handle保留containerId/execution/run/roleBindingId/registrationDigest，以及实际image、authority/workspace、用户、mount、网络和安全参数严格检查。新增legacy名字只限同run/execution历史观察；不得重命名、清理或复用其它旧执行。已存在原槽含created/unknown时不重新start，只返回原观察。
4. 同role其它run或execution仅明确exited且合法exitCode才不围栏；created/running/paused/restarting拒绝，dead/removing/不完整/unknown不当终态。create后再查peer，竞争或新槽失读时拒绝启动并保留资源，不自动stop/rm/rename/kill。
5. peer读回仍有读查到启动间窗口，不是OS原子锁；PORT-CONTRACT明确原Comet记录/CAS才是唯一launch claim。检查当前main消费点仍保留NATIVE_EXECUTION_RECOVERY_PORT_REQUIRED，尚未调用新resolve；端口建设不能冒作正向同Run恢复已完成。

## 独立实际执行

固定Node24.15.0，原离线Node fake-engine fixture，外部模型/container/platform/distribution CLI拒绝器在PATH。执行：

```sh
node --test --test-reporter=tap --test-name-pattern='execution slot' test/infra-runner-isolation.test.js
```

实际 **11tests/11pass/0fail/0skip，exit0**，11154.9425ms；未重复完整92组。包含R1→R2、冷独立进程只读查回、fresh/冷重入不重复start、旧active/unknown与created、legacy/错handle/scope、元数据错误、create后竞争、带点namespace，以及R2新增三项真实文件发布/IPC边界。fixture JSON/trace是测试engine数据，不是产品存储或实际Docker资格。

UTC2026-10-25T21:01:06.348547Z至21:01:17.546905Z；句柄33841明确终态exit0。独立原始 argv/cwd/输入/输出摘要保留 `/private/tmp/I02-slot-spec-ta5f_r03/metadata.json`；stdout SHA `8336e6ac4d2a028db70e798367d24c678e7838b20ff8642a45bb7ac613f411e5`，stderr为空。输入前后相同，外部拒绝器调用0。没有真实Docker/model/API/secret、下载、全局设置、候选源码/锁/计划写，未派工人或Goal。

## 输入与历史证据

- runner SHA `837751b28f1bc25ff55e5b40673e4138cbd0797acabf115f33f20363808a7072`；test SHA `bbbaae1ca3504135f16d7f73e3a4c966e41cf227f1f5b457af1dbb64547098f5`。
- R2 manifest SHA `abc298c66464f619c4a5ebf3d6aa31dce1a56834e8fcc58828684b7327d24802`，32内容项与30对raw/display逐项size/SHA匹配；原父包37内容项与33对raw/display也匹配。
- 原7/8失败、JSON截断与三条RED均明确保留。R2仅修fake状态原子发布、独立trace及stdin结束时重新读取最新状态；没有吞异常、加sleep、重试或删skip。原作者92/92是作者证据，本轴不拿它替代独立11项，也不把fake-engine的有限并发回归宣传为任意并发写入/CAS保证。

可消费范围仅是固定物理driver的slot/只读查回源码及其真实临时CLI组件合同。下一步须由Root给原P1_3/P2_4接线，复验原持久operation/CAS、UNKNOWN调和、受信三原字节和最终当前发行；真实角色/镜像/OS及whole资格均继续UNVERIFIED。业务接受增量0。

审查 UTC：2026-10-25T21:02:42.248971+00:00
独立 metadata SHA256：`a5a46474e5ca89ce5f272ca3a61463ac3f45b756eced8f9be844ea0279c84826`。
