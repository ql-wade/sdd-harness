# P2_4 Design 写门窄修：独立 Spec 审查

**结论：窄修 construction/mechanism 范围可接纳；本轴未发现新增阻断或必改项。production、真实角色和 whole P2_4 仍未验，不签业务场景通过。** Root 仍须完成另一轴、跨任务锁更新及主候选受控联编/复跑；本报告不更新锁、台账或接纳状态。

候选：`5ec97b25db76241658b16f64e2eda1468da07424`；base：`9c9b70b92f1c5f548c5f84cad24c644657a4c30d`。只读 worktree HEAD 匹配且开始时干净。审核依据为原 Classic integration/gate runtime/closeout contract，以及本次限定的登记、精确写许可、词法逃逸和分phase返工要求。

精确私有候选 fingerprint：`40de314253079e045ab09445ef8f6e52fc28f1ee9c5e0d023c359de89a0eb814`。候选 lock 真实重算匹配，SHA256 `a5e9c3ac000f75bd72d7d1c52c383345a2ad40a44fed8379fd4cf9e63006d034`。

## 对照结论

| 要求 | 源码与证据结论 | 接纳范围 |
|---|---|---|
| managed test_intent 登记 | state-command setFieldsLocked:614–617 在实际写入前要求已装固定host、调用该change原requireRunAuthority，并拒绝归档后登记；原字段/相对路径/受保护目标校验和原短锁保留。standalone、foreign environment拒绝且旧指针未变，原Runtime成功重登记有正例。 | 已有组件fence接线；不是Controller actor认证。 |
| Design 精确新写许可 | hook-guard:1076–1092 先走固定authorizeWrite、真实HMAC verifyDispatch、同Run及原签名范围，再同步失效；1176–1229 的新例外只在Design、当前R、受保护登记testIntent与目标一致、签名allowedPaths含精确归一项时返回允许。没有用目录prefix、惯例名或邻文件grant制造这个新许可。 | 原保护分支内的新增例外；不宣称全部既有普通文档白名单都变成该例外。 |
| 许可负例 | 默认空driver、standalone、readonly、foreignRun、坏签名、目录范围、邻文件、改登记后不匹配旧grant、未登记惯例名、无当前R均保留拒绝。登记目标变为内部/悬空链接或目录亦拒绝。 | author自检证明机制；不是实际Native author launch或宿主Write通道证明。 |
| 六类词法外逃 | hook-guard:1007–1025 在physical scope判为external时重新保留词法项目归属，先原change/archive ownership，再控制路径及managed候选拒绝；registered testIntent、designDoc、source、普通doc、control、archive六类有否例。真实外部及普通nonmanaged对照保持原scope语义。 | 外部scope的allowed并非受管作者授权；真实OS/工具渠道要另验。 |
| A/T分phase返工 | gate-runtime repairRoute(A/T,phase)在Design仅指向现有作者修订和原Runtime重新独立审查，不再提示非法transition；Build/Verify保留原architecture/test-design-repair事件；缺失/未知/Open/Archive仅提示读Native状态。五个evaluator分支、两个managedPremises分支及原accept拒绝路径都传当前phase。 | 纯指引修正，不增加阶段或控制器。 |
| 既有转换和收尾 | 与原6da实际源码相比只有gate-runtime/hook-guard/state-command三文件变化；state.ts、transitions.ts、managed-host.ts逐字节相同。原允许phase集合、强制门条件、同Run短锁与0003后置收尾保留，Design直接repair transition仍拒绝。 | 没有通过放宽guard/transition或更换0003取得绿色。 |

## 明确的授权边界

`requireManagedDeliveryHost`证明当前进程已安装固定代码接口；`requireRunAuthority`仍是该change目录中既有 authorityId 与 COMET_RUN_AUTHORITY/hostname 的环境围栏。它没有新增每次调用的Controller actor证明，也不证明同一可信进程中的readonly/reviewer无法调用setter。**不能将这个围栏、签名标签或fixture driver映射当作生产身份/OS权限授予。** 这一限制在本次REPORT/source-boundaries已如实记录，真实producer/授权/角色隔离仍归I02/P1_3及后续真实旅程。

写入正例使用测试自身固定执行/工具/路径记录和原createLaunchAuthority的真实fixture HMAC，成功后是测试代码 fs.appendFileSync 修改私有fixture。它证明原Hook机制可以精确放行登记目标，不证明平台Tool.Write实际已经接入或某个真实独立主体具备写权。原P2_5 false host未改，也未当作本次角色资格。

## 证据核验

- `evidence-manifest.json`：3项owned源、26项distributed报告/记录、200项ignored原始证据全部逐项hash匹配。
- Core44最终：真实记录exit0，44 tests / 44 pass / 0 fail / 0 skip；输入前后相同且逐项匹配当前owned字节、私有lock、distribution与Runtime入口。原stdout SHA256 `bcf6559be43680218ec8793b779e387400967337b6fd93aae5b549ebaf8f873f`匹配。
- Native相关4文件：实际cwd在精确40de work内，exit0，345 passed / 4 skipped；四skip均为报告列出的Windows case-variant，不计通过。
- generated：classic/native/entry三族原构建脚本检查exit0；输入前后匹配；raw/display摘要均匹配。
- 02 fixture scope/JSON通道错误、11错误CWD、先build再prepare的SOURCE_BASELINE_DRIFT均保留为setup问题，不作为行为RED。真正登记/授权拒绝/词法逃逸及phase表反例与最终绿链分开保留。
- 本审查只读核源码、真实原始记录与hash，**未独立重跑44项、345原生测试或generated**；这些执行结果保持作者自检的证据等级，Root后续联编复跑仍是独立义务。

## 保留与最小后续

当前upstream.lock、0003和tests/4_6.patch对base逐字节不变；未动主6da包。真实读取的40de state/transition/host hash与6da一致，分别为：

```text
classic-state.ts        103d7f2f02ef00c0941d73364a6992aaf81623ff8c7427871cd3c56420b538ac
classic-transitions.ts  4dd29bab3271428cb8bdd6b501ff8518bd35c82263a903061a5e70b641111108
classic-managed-host.ts 5fa6779d0bfe1c2422d0db09f06fc3a297fe93c806cb464fc67fe2a666b9ee31
```

无本轴新增代码修正。Root后续应在独立审查后，只更新owned补丁SHA并受控联编同一锁/分发，再跑受影响集成；保留6da、2699、40de与现有旧证据，不将私有候选直接冒作production包。真实author/controller每动作授权、OS/独立身份、方法送达、平台/知识以及整体Journey保持UNVERIFIED。

本审查未运行模型/Docker/API、未读取真实秘密、未改项目源码/主配置/锁/台账/phase或其它计划。风险是把组件层的固定host/环境fence/HMAC放行扩大为真实主体权限；本报告仅接纳上述窄机制修复。

报告输入摘要：

```text
0002 patch    861543fbf699bc6f8451333c9f459dfe129422a9d6390365776221ba1e93de63
tests2_4      00786c45d0e9acfb6e6fc0c3243777f28247e1b6f4275d64ba690857a894eb77
owned2_4      415b3fae2d1395d1a6bdb8f3544cdad935784388d08229d6005f9d8e4b32cca8
evidence-index d99901bd9b8f8d3c5d69afb502d5b5a88320d449115c451f9943f23494df41df
```
