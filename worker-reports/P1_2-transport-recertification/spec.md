# P1_2 9c9 原始运输工件：独立 Spec 复核

结论：**APPROVE_EXACT_ASSET_TRANSPORT_CONSTRUCTION_ONLY**。可消费范围见下；**不出具整个9c9或安装器通用Hook保全的一揽子批准**。发现一项既有混合Hook保全缺口，归原P1_2返工；它不阻断单独的packet/字节运输代码构造消费，但相应安装保证不能接纳。真实host/model/角色/权限/whole与Final129/103均未认证，准备边仍由Root结合独立报告原文明确接纳，不能由此报告自动激活。

本次是新的独立Spec复核，不依赖聚合integration.json中无法找到原文的旧“双审”声明。没有运行Docker、TeamAI、安装器、模型、服务、secret或新profile；没有改源码、配置、锁、phase、ACL、台账或创建worker/Goal。

## 版本、来源与核验方法

- 精确候选：`9c9b70b92f1c5f548c5f84cad24c644657a4c30d`；父提交 `ddb7849190c19e6d28f6d5dafeb00740def4e330`；作者 `8220ea35daaef46fef71ff2b43ca6bde3e54cb19`。审查主树 `/Users/mac/Code/sdd-harness`，作者只读树 `/Volumes/mac-extend/codex/worktrees/comet-method-profile/sdd-harness`。
- 直接审阅相对父提交的exporter、CC adapter、测试、gitattributes与lock差异。当前工具代码、测试、gitattributes、lock及245方法文件共250项，与9c9 Git blob逐字节相同。P1_2任务正文与9c9一致；适用原义务包含“用户条目不丢”、运输/升级/重复/卸载及退役入口不再生。
- 用manifest与原始hash索引核验，未向模型重复读取数百份相同生成正文。11种方法的245文件，在原源、sealed source与release视图字节一致；逐项重算11个锁摘要相同。当前sealed manifest的277项均匹配。原父提交1094项baseline文件及作者f708的278项均保留，共1372项，与Root记录相符。
- 作者Native显示索引60项、归一化索引对应原始records56项、原始harness/helper9项，均按记录的bytes/SHA实际核对。只从原字节推导有限事实，没有借缺失的旧审查结论补资格。

## 可消费的精确construction范围

**packet导出、外部expected绑定、完整字节接收与FoundationLock校验**可供原P1_3构造固定消费者。TeamAI仅运输；代码未新增业务phase、调度、恢复或第二source authority。expected描述及其精确SHA必须来自外部受保护控制器；packet内自带lock、相同两份JSON或worker自填SHA不认证来源/当前Action。该保护来源与实际角色仍归P1_3资格，不能由本工件自批。

`exportTeamaiView`先复用`verifyLock(requireBodies)`，生成含dotfile/模式/大小/每项hash的顶层packet；`receiveTeamaiPacket`先核外部expected及packet精确SHA、完整集合、路径/重复/模式/大小/base64，再写全新私有stage并核FoundationLock。旧expected、篡改或缺项不能通过；已有stage/链接不能当用户树合并覆盖。原71回归中的packet负例证明保持外部expected不变时拒绝污染，不能当作某个不受保护expected的授权证明。

**Native原始证据支持的运输事实**：原deep docs init/pull/repeat虽CLI0，实际558项运输0；packet修复后原版TeamAI实际init/pull/repeat/uninstall，接收558/558且missing/different/extra均0。内容升级使用639a harness，实际package.json.description从one变two，exportDigest从975ac7cc…变904b089a…，旧expected拒绝且旧已安装cache保留。4943旧harness未改变运输字节的更新只作origin metadata子例，不当作真实内容升级。

冷TeamAI扫描仅证明新进程读取staging目录：12个skills，其中内置team-wiki-codebase的12文件是staging额外内容；canonical方法仍是已接纳源的11种/245文件，不将内置Wiki当知识源或coding-agent方法资格。原始harness实际检查退役名称不再生、正反序与重复安装/卸载、独立用户目录/条目及Ponytail插件保全；注册的Bash caller实际允许0/拒绝2。这些都限定该隔离fixture，尤其不含下面的混合group形状。

Native fixture的Git确实调用真实/usr/bin/git并核成员专用guard，source更新是另记的fixture-owner本地CAS快进；不证明生产publisher身份或披露权限。Native实际运行的是其各自fixture/source digest，**不是主2aba发行的真实coding-agent安装证明**；相同代码/方法字节加Root当前重新发行与组件回归只支持construction衔接。

## 已确认的Spec缺口：混合Hook group会丢用户handler

**[P2，既有问题，阻断相应Hook保全保证]** `tools/adapters/claude-code.sh:410–416` 的`upsert_hook_array`以`is_ours(entry)`过滤整个entry。若一个合法group的hooks同时含项目stop-reminder和用户handler，整个group被删后只追加新项目命令，用户handler消失，违反P1_2 Step3“用户条目不丢”。该函数在9c9父提交原样存在，**不是本提交新引入的回归**，但旧71绿色也未覆盖它。

仅将现有`entry_hooks/hook_source/is_ours/upsert_hook_array`及原regex提取为只读、内存中的字典投影，没有运行installer或写文件，实际结果：

```json
{
  "mixedGroupBefore": ["\"$CLAUDE_PROJECT_DIR\"/hooks/stop-reminder.sh", "printf user-owned"],
  "mixedGroupAfter": ["bash \"$CLAUDE_PROJECT_DIR\"/hooks/stop-reminder.sh"],
  "userHandlerMissing": true,
  "upsertBodyIdenticalInParent": true
}
```

投影的精确函数源码SHA256：`1dddf0ae542354a83cd52ef5cc805bad9c52edf70c5f88568b999cfbd78ad422`。这是代码级确定性缺口，不冒充真实宿主安装测试。原P1_2应保留非受管handler及group metadata；无法安全处理的混合形状须在写前拒绝，不能直接丢整组。交作者补混合用户/插件group的重复、升级、卸载回归。该保证在修复及实际资格前不得用于P1_3真实Hook启用；本次不越权修产品或补测试。

## Root原始证据复核

Root `main71/result.json`的stdout/stderr SHA与原始文件匹配，TAP为**71 tests /71 pass /0 fail /0 skip**，UTC `2026-10-25T12:22:17.297857+00:00`至`12:23:19.227831+00:00`。输入前后与当前9c9源/锁一致；不是本次重跑。Root combined-regeneration的实际export及require-bodies verify均exit0，原始stdout/stderr按各命令记录重算一致，生成主`2aba3aa5457885338dba393613098606a7344b2da25893f79ec3fee8f6390c78`发行。聚合报告的832/822/10旧失败仍保留，没有当全仓通过。

## 精确输入与原始证据索引

| 输入 | SHA256 |
| --- | --- |
| tools/foundation-export.mjs | `951995b1dd5e73eea940a8c759e2b30947a044c3d4cf70aea873ac1452e8f3fb` |
| tools/adapters/claude-code.sh | `c279092f380d534fee2bf69f9778514f3e5654286ce87872825d7640d291402e` |
| test/foundation-distribution.test.js | `8cc485348b1d57e9bd6dfeda69fb42b966cb19c6c3e2838fe76ea4faa83aef5d` |
| foundation/foundation-lock.json | `85afaea45e9d5a1184a565ae869488c1c6e3c0ed4b06bd00244e80e060d96417` |
| 2aba baseline/manifest.json | `93bb1a56eafcdbdf8430d76b883c4aaf1cc6f679732a0f968ee6d2db4423cbff` |
| Native evidence-index.json | `e75f08ca36643dc5863e9940b664d7ce940f48f93239204d9b6fc17d9d60b892` |
| Native normalization.json | `90c5ae96a2bf6e6fd11d0c1915e33d969f32d46a74e5d86f451f0a6cb0376d69` |
| Root main71/result.json | `550d2e9657ece8f5db310c130f665c2825eeab31294f1a7b1294e43cbaf14a1f` |
| Root main71/stdout.raw.txt | `469b9b39edbc82a02cce3a58eab848e28261ac88bdf7a8c1bf6c54b8685cd355` |
| Root combined-regeneration/result.json | `511bb87ad9fa81df51432f7296e73338d917cf8c560b89303575dd6acdd9a2cc` |
| Native raw content-lifecycle-result.json | `292a1ea0accb385db15cab2e19deccb342be2031f4e51cd72e1b515828cb1894` |
| Native raw content-lifecycle-run.command.json | `5aafcf863bd7bfda3bf3fa523574e5eec0745c51ef9c2c41dc92fa84f119b27e` |
| Native raw content-lifecycle-run.stdout | `fcc10e141ff5561ec21d24c59814a874abc67fa69925f20a493915dfdef65714` |
| content-lifecycle harness | `639a4ff2984a755f89ba858229920a59238a51b460f37a48ae51ebc319798b05` |

Native索引位于主树`worker-reports/P1_2-convergence-current/teamai-native/`；其raw路径按索引相对上述作者只读树解析。Root原始证据位于主树`.local/comet-reset/p1_2-native-integration/`。全部原始失败与文件保留；本审查仅读取它们，不重放命令。旧不可追溯的审查原文不作为依据；本报告可独立归档。

真实host/model冷会话、受保护expected/当前Action来源、角色/OS、通用Hook保全、方法执行/无嵌套控制器及whole P1_2仍未验。不得把此有限报告计入任何业务场景通过数。
