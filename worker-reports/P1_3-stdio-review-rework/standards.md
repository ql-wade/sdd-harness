# P1_3 原生 stdio transport 独立 Standards 审查

结论：**PASS，无新增 P 级阻断**。独立窄组一次25/25，另有真实私有Node peer正例与确定性迟到重复负例。仅支持此CODE construction，不认证真实Codex CLI隔离/认证/模型/source collector、worker/I02/artifact接线、whole P1_3或业务通过。

## 固定输入与证据

HEAD `e361f097b09276288b6dc65db82d3e66d4374c12`，base `1c66edf4237b3b5039ce5b1e63f84401e2c785d0`，tree `/Volumes/mac-extend/codex/worktrees/comet-registry-qualification/sdd-harness`；审查前后tracked clean。只改harness、追加driver测试及新报告。

- harness SHA256：`a4236d094cc993d4b88ec6b86e89b45cc40196d5ca5da20ab4bdc4b0a719de75`
- test SHA256：`0d9ffd8a7cdeca3371198b242765d87fd0f27b6dc677865218a6c81adf7827fe`
- inputDigest：`4dbea8f537fa7d6f7993deced436443c79f8489d68d5e4590d2fa84db6d57ae8`，独立重算为candidate-inputs整个envelope去掉inputDigest字段后，递归排序key、compact UTF8 JSON的SHA256，精确一致。
- manifest SHA256：`7b1470cce03cb603a6845ce1fa627939532cd514365944cbf69715384895ed47`

49 tracked报告、92 raw、42对raw/display、当前源码/封存schema/材料及preservation记录，合计256项内容摘要校验匹配。原1170份ignored叶文件仅lstat size/mtime/mode比较，全匹配，未读秘密内容。原driver测试主体除新增fs/os imports外逐字节保留；binding fixture/main/锁未改。

已读封存0.163 schema而非启动CLI：DynamicToolCallParams的arguments/callId/threadId/tool/turnId与可选namespace、response的contentItems/success、thread/turn start及item lifecycle时间字段与实现相符。multiAgentMode在schema明确deprecated/ignored，候选不拿该字段冒充禁协作能力。没有联网拉schema或生成新schema。

## Standards 核查

- `harness.js:179–205`：固定CODE constructor只接受四个已声明字段；数据快照拒绝getter/隐藏argv/循环/稀疏/超深数据等。registration限定绝对regular executable的SHA、执行位和精确 `['app-server','--listen','stdio://']`，env仅PATH/LANG/TZ/TMPDIR。HOME/CODEX_HOME只继承父进程已有值，不由job覆盖；没有argv/env/provider/module/preload/鉴权选择入口。
- `nativeContext`解析原ActionBinding并约束runner/profile、文本input、闭合集合DynamicToolSpecs。`currentContext()`是固定同步CODE投影，启动/发材料/工具执行前与回复前都对原预输出tuple；声明输出不会被读回并重算旧批准。shape与contextDigest不认证actor/source。
- `nativeMessage/receive`：256KiB单frame、2MiB三通道合计capture、512解析event、深度/数组/数据大小限制；fatal UTF8且拒绝解码后的重复JSON key。原bytes保留，截断显式UNKNOWN，错误reason不包含producer诊断。工具结果另限64KiB、16项文本，异常/坏类型/越界metadata静态拒绝，不回显callback错误。
- `toolCall`：固定thread/turn/call/RPC id关联，最多4个未确认turn的早到frame，仅在原turn响应确认后处理；最多64个call、同时4个未回复。RPC id不能换callId；精确在途重复不再调用callback，变更或已回复重复拒绝。requestDigest携带原context/params，源工具/路径/用途授权仍由受保护invokeTool负责。
- 普通status/token/reasoning/diff/plan/item通知只记录telemetry，不调度/写文件。未声明server request、权限批准、Shell/Edit/MCP/协作等执行表面拒绝；transport不能撤销真实CLI已经发生的builtin副作用。`environments:[]`、read-only/sandbox声明和事件拒绝不是生产no-bypass证明，报告准确保留该缺口。
- `start/observe/cancel`：start无call-time参数，同实例只创建一次child并返回同operation；preflight失败或过程UNKNOWN在该attempt sticky，旧字节恢复不复活。不重连、不再派发、不落第二session/phase/DAG/queue/lease。done的UNKNOWN与实际closed分离，timeout不伪称物理终态。取消只认原对象handle，信号发给本实例创建的POSIX group，有限SIGTERM→SIGKILL尝试；不接受复制handle/自由PID。Windows fail-closed。散列检查与spawn没有被包装成OS不可变image或真实角色授权。
- 即使turn completed加exit0，也只返回原transport观察，runtimeQualified/managedClosureEligible恒false，无业务verdict；实际collector、方法/源身份与原Native交易尚未接线。旧harness/createRunner/authority行为未删改，新export无隐式安装或调用者迁移。

## 独立实际执行

精准Node24.15.0，原候选测试不改。一轮窄组 **25/25，0fail、0skip、exit0**，不是全76/52重跑。原始argv：

```text
/Users/mac/.nvm/versions/node/v24.15.0/bin/node --test --test-reporter=tap --test-name-pattern=one RPC id|native exact in-flight|native timeout|a stale preflight|changed current input|native schema ordinary|native control-stream|native raw capture|native output overflow test/comet-driver.test.js
```

argv由Python数组传递；shell手工复跑需给完整pattern参数加单引号。覆盖RPC复用、14种控制流/格式负例、在途duplicate、timeout/原handle取消、preflight还原拒绝、callback后漂移抑制回复、UTF8拆写、capture溢出、普通通知及早到工具确认。

runner PID **13788**，session **59098** 已exit0终态；UTC及前后输入SHA在receipt。11种外部工具guard实际校准97，测试及额外peer调用0；测试父进程仅最小env并保留已有HOME/CODEX_HOME，没有写活配置。全部peer为tmp真实Node可执行文件，未启动安装的Agent CLI、模型、认证、MCP、Docker或外部API。

额外独立正例从原test原字节提取两个peer helper，导入实际harness；正常wire完成一次受保护callback实际写/读tmp note：

- 原handle `60d55a18-d5c4-49bf-aac7-f9b30d941a97`，peer PID **14560**，exit0/closedtrue。
- 固定fixture run/execution为 `stdio-run-1`/`stdio-execution-1`，实际native wire thread/turn为 `thread-stdio-1`/`turn-stdio-1`。
- 原始stdin/stdout/stderr、events、peer源码、peer收到的wire、实际note字节与摘要均保留。不会把这些fixture标识称为生产Run/OS身份。

另一独立peer仅在收到首次callback回复后再次发完全相同call，确定性验证late拒绝：reason `NATIVE_TOOL_REPLAY_REFUSED`，实际callback次数1，UNKNOWN保持，同实例start仍原operation；原handle `e5d9db33-4054-4126-a333-756997096857`，peer PID **15226**，显式取消后SIGTERM/closedtrue。这是新迟到边界检查，没有重试任何失败用例。

两个额外peer脚本以env-i运行，只有PATH/语言/TZ/tmp；未将HOME改指其它位置，也未触碰实际配置。源报告宣称的原HOME继承语义由源码及上述窄组原父环境核查；两个空env peer不冒充真实CLI配置资格。

## 历史失败与可维护性

原75/1是“预期在途重复”到达时已成为late replay，transport正确拒绝。返工只让测试在真实callback完成前等到两条wire事件，并保留实际IO/全部原断言；产品 `previous.responded` 仍拒绝迟到重复，本次独立迟到peer再次证明没有放宽。旧76/76、52/52属于作者自检；相关组实际harness/binding字节与当前相同，修最后fixture后只重跑owned没有伪称重新跑related。

其它真RED、错误普通通知fixture等待UNKNOWN后物理close的失败、只清理其两个已确认peer group的历史均保留在raw index。新transport不会因这段作者清理历史获得自动恢复或实际OS资格。协议版本被明确限0.163；这次没有扩大到其它CLI或产品安装。

## 原始独立材料及范围

入口：`/usr/bin/python3 /private/tmp/P1_3-stdio-standards-run-20261026.py`（新建独立tmp）。额外两脚本及原始材料在 `/private/tmp/P1_3-stdio-std-yq3cdrmz/`：

- `receipt.json` SHA256 `fcdf4661ac76d96319a8ef8c2a9488d0a5846bb5b8cad132a9096c05bbdc1ee5`；stdout.txt/stderr.txt/guard-calibration.txt。其computedCanonicalFilesDigest是辅助files-only基底，**不是**候选envelope inputDigest；正确完整envelope重算另见 `input-digest-proof.json`。
- `peer-proof.json` SHA256 `71f3a323b1a0c6c8f9e5c3d0d5ec02f4febdd601346d342fcb561ebbfc53be34`，及独立正例raw/wire/源码/产物。
- `late-replay-proof.json` SHA256 `fb6a4472bc4573bf33603043fe1842135c6e7e782265283d52c15c4478bf0898`，及late原始三通道/peer源码。
- `independent-peer.mjs`、`independent-late-peer.mjs` 是tmp机械复跑入口，无真实CLI依赖。

未修改候选、主锁、配置、计划或状态；无下载、全局写或新agent/controller。source工具/路径/用途授权、真实provider/issuer/CLI配置/通道无绕行、I02 interactive/artifacts、原Native producer事务与冷恢复、真实方法和业务终态仍NOT-EXERCISED。PASS仅供Root construction串行集成。
