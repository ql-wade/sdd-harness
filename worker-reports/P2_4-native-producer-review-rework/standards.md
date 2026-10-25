# P2_4 原生 producer Core 独立 Standards 审查

结论：**PASS，无新增 P 级阻断。** 本次只支持所审原 Kernel producer/transport/persistence/calendar construction，不认证 whole P2_4、真实Host/source/角色/OS/模型/知识或业务 Journey，也不替代 Root 当前完整7patch联合构建及复验。

## 固定输入与审查范围

候选 `5e19890d1b5a0ff3d332799041afac64229e907c`，base `a497b7b885984fa70cc3220173d47cc30da86a5e`；tree `/Volumes/mac-extend/codex/worktrees/comet-observer-qualification/sdd-harness`，审查前后 HEAD匹配、tracked clean。

仅3个owned文件及新 `worker-reports/P2_4-native-producer-ports/`，实际源码通过原补丁、精确私有构建和caller-map核对：

- 0002 SHA256 `8fcbeb2d11c11e5b1f34eb04ac21bdb5bb265685e564046fc2d785b0393112c5`
- tests/2_4.patch SHA256 `00786c45d0e9acfb6e6fc0c3243777f28247e1b6f4275d64ba690857a894eb77`
- owned2_4 SHA256 `d85cf5c2a56e0200124c30d4111d4067de2963c438401d6435c6500a1d304307`
- manifest SHA256 `fcd135c23ded1cbf06da1e64b92a0f8f1264e59aa12b09f3996cd11365330a9d`
- 私有build fingerprint `afa7b8de16017b3fbf87d3a2a33188782790c9f3d1aa3fe4edfdb28e310df28f`，Comet0.4.5/c90af44，Node24.15.0
- 私有锁 `candidate-12-root-context.lock.json` SHA256 `02cbcd609318e5675805100520130eb7b731466675c6edced7bcf6f8eeeb6e0e`

私有来源明确消费Root纯上下文0003 `861d60b7bb26bc29db0fe708bacee5c962338b92fd1b8c37943890cf76594742`；其独立上下文等价审查已另交Root，本报告不改该结论或任何patch。此私有build没有安全004。分支中央共享0003仍 `b266706c…`、共享锁仍 `a893be958b3efe8625f8be34a3f7959d4a1ce603ae960dd5604e60f45c68679c`，不同于Root将来的最终中央组合，不继承最终资格。

## Standards 核查结论

- **原Engine接缝而非第二主控**：新 `classic-managed-actions.ts` 调用原 `decideWithResolver/recordOutcomeWithResolver`。engine loop保留resolved action的type/ref后仍经原checkAction/guardrails；profile的方法只加入原snapshot/allowedSkills，新protocol标志阻止旧snapshot静默升级。action仍在原Run.pending/pendingRef，完成/失败走原outcome和retries，未加第二phase、queue、lease、scheduler或job数据库。
- **固定合同与生产/审查分离**：protected profile和同步Host CODE决定R/A/T/P/test.automate/build/code.review、workPackage、原task、方法、精确输入/输出/工具。项目引用拒绝绝对路径、逃逸段和控制/方法/归档目录，实际输入/输出复用 `readProtectedProjectFile` 正规文件字节。P只接受references-only方法并拒绝已识别调度工具；这没有被宣传为实际Goal能力不可见性证明，Shell/MCP/角色能力仍须后续真实环境验证。
- **独立判断不由Builder自签**：producer成功只提交认证产物，没有Gate receipt。R/A/T/P拒审receipt经原collection认证并加入新作者baseline；新作者之后仍需新的独立Gate。code.review使用原admit/evaluate/verifyReview，核Builder/作者execution与principal、完成审查摘要；不足的独立审查按原失败outcome返回Builder，任务完成入口要求当前独立review。未把测试设计与测试代码合并，也未把method声明或HMAC当真实身份授权。
- **短锁/CAS/未知恢复**：prepare、claim及保存用原锁；claim仅prepared→starting返回一次launchAuthorized。所有已有starting/started/unknown后续均observe。缺readExecution拒绝claim。长readExecution/readResult/collector在锁外，回原锁后重新核原Run、step/iteration、epoch/generation、source/principal、action/dispatch/operation及当前输入。UNKNOWN/ABSENT保留原执行且不能重启；handle、launchId、已知terminal exit不可替换，actual非零与pass不一致拒绝。没有通过timeout签业务失败或从lookup发新attempt。
- **持久失效与事务**：producer执行复核失败通过原pending记录保存invalidated，输入/来源旧字节恢复不能复活。新增pending/event/artifact的before/after并入原journal，提交点为原YAML或YAML不变时的pending原子发布；恢复冲突拒绝，未悄悄清理未知资源。手工run/resume/upgrade、ordinary next/transition不能清空producer pending。Design handoff与Archive checkpoint只保留原精确type/ref/id/step/phase兼容协议，未知pending fail closed。
- **归档目标**：archive原函数直接使用与固定OpenSpec1.11一致的本地年月日，不保留UTC初始化再补偿。原签bridge复核Run/action/MAC/目标，apply前再核日历；managed discovery不fallback找另一archive。跨午夜窄窗口若输出不符仍精确目标拒绝，未据此假称真实午夜测试完成。Root纯context0003不改这项新0002语义。

相关主要source锚点：managed-actions prepare221、invalidate264、execution272、claim338、record351、accept380、task-review448、Gate terminal461、producer write469；store journal104及write343；manual owner56；engine resolved action90；archive local date347/bridge385/apply536。这些是调用/机制锚点，非部署资格。

## 独立最小实测：8/8，一次执行

为不向候选 `.local/P2_4/case-audit` 写入，创建 `/private/tmp/P2_4-producer-std-fm42ce6k/mirror`：owned测试原字节复制，lib/contracts/tools/profile/已装公有工具与私有build用只读消费链接，只有tmp测试审计目录和fixture可写。实际源码、组件方法和原Native库均未替换。原测试通过COMET_UPSTREAM_LOCK显式选上述私有锁；未改中央pin。

实际argv（Python数组，无shell管道）：

```text
/Users/mac/.nvm/versions/node/v24.15.0/bin/node --test --test-reporter=tap --test-name-pattern=unknown launch keeps|input drift during long result|SIGKILL before pending|actual nonzero gate process|an observed original launch|manual resume and upgrade|missing fixed observation|cold archive refuses /private/tmp/P2_4-producer-std-fm42ce6k/mirror/test/delivery-cases/2_4.mjs
```

八项全部通过、0skip、exit0：并发唯一claim及unknown不重启；manual/resume/upgrade/next/transition不清pending；真实SIGKILL前pending提交journal恢复；长IO期间输入漂移及还原不复活；缺observer零launch；真实Node wrapper exit7不能消费pass source；launch/terminal替换拒绝；冷归档冻结目标不改投其它archive。

actual Node runner PID **56428**，tool session **36950**，已终态exit0。UTC开始 `2026-10-25T22:00:54.386509+00:00`；完整结束UTC/argv/cwd、前后17份输入SHA、输出SHA见receipt。总测试约22.8秒，没有重试。11种外部工具guard实际校准97，运行额外调用0；未执行Docker/model/API/secret/下载/安装/全局配置写。

独立实际原生句柄例：immutable-terminal组 Run `7997d3f5-6599-45d3-a318-c036cad17c81`、execution `producer-r-a7335ccd42b22acae554aa8a`；CAS unknown组 Run `0c79bf88-d5f7-4187-8da5-a8af4d473fc9`、execution `producer-r-61e7db3f4d18bee9aa40fe4c`。源Node PID56507、56523、56540、56550等由各fixture同步收尾，原SIGKILL按测试预期终止。全部八份审计快照保留在mirror `.local/P2_4/case-audit/`，目录映射、Run/execution、source PID及每文件SHA另见additional-input-audit。都是机械fixture身份，不是OS/生产句柄。

## 输入/原始证据与诚实边界

独立核manifest的3 source、48 report、119 ignored raw；normalization-index所有raw metadata/stdout/stderr和display摘要；私有锁、distribution manifest、17当前文件、六组caller-map build/pre0003源码、保护输入与历史manifest，合计345项摘要匹配。额外核实际消费Native bundle与7个相关dist模块对distribution条目一致；实际bundle SHA256 `6e3f56ccb2f076c28e3aacaf2a229d807d7e5cf71534710627522d1ac6ff7893`。**没有声称独立全量复验47249项发行树**。

作者74/74、481pass/4Windows条件未执行、generated0的原始记录与输入前后摘要保留；01等行为RED、02等SETUP、NODE_TEST_CONTEXT造成真失败、废弃UTC补偿构建、dispatch前中止均分开记载，未翻成最终PASS。原5ec的3源码/26报告/200raw保全记录已读并校验该记录SHA和两份旧发行manifest；不把作者保全记录冒充本次对旧全部200raw的再次内容审计。旧断言未因producer分支放宽；新增exit7参数仅供指定负例，默认旧observe仍要求exit0。

本次独立harness首次在测试派发前错误假定manifest ignoredRawEvidence为map，实际为list，产生AttributeError；只修tmp审查脚本后才首次派发上述8组。原脚本/错误记录保留在 `/private/tmp/P2_4-producer-std-2igqu3kn/`，分类为REVIEWER_SETUP_ONLY_BEFORE_TEST_DISPATCH，不能计产品RED或重试转绿。

独立入口：`/usr/bin/python3 /private/tmp/P2_4-native-producer-standards-run-20261026.py`，每次新建tmp。原始证据目录 `/private/tmp/P2_4-producer-std-fm42ce6k/`：

- `receipt.json` SHA256 `1ff5fdabe8151936ecb4885d82ff4b7b7aa42f2286479b851f8f98bc1a28c178`
- `stdout.txt`、`stderr.txt`、`guard-calibration.txt`
- `additional-input-audit.json` SHA256 `7e8aa2dd30e6dd971081034ee071ce00fc443890ec149df7e3c7014d47413af0`
- 八份实际case-audit快照、commands与proof

实际业务接纳仍0。真实A共识、模型方法应用、物理principal/OS/工具通道、P的真实能力限制、Kp知识写入索引、Outline Kt/ACL恢复、CI required与最终同Run旅程均NOT-EXERCISED。Root仍须将当前所有patch（含004）有序联编并在最终指纹独立复验；本次通过只供原任务范围的construction接纳。
