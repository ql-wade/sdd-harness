# I02 execution-slot 独立 Standards 审查

结论：REQUEST_CHANGES，1 个 P2（新增并发测试夹具），未发现本切片产品 slot/resolve 源码的新增阻断。仅审 construction；不得据此接纳 whole I02、image/bootstrap、真实 principal/role/OS 或原 Comet 旅程。

审查对象：`6870e6851d34bc017e759a83aeffa5de7e020762`，base `14bda75fe04f464594f3dbe36649d170454d7342`，tree `/Volumes/mac-extend/codex/worktrees/comet-delivery-contracts/sdd-harness`。读取时 HEAD 精确匹配且 tracked 工作区 clean。仅审两份源码与 `worker-reports/I02-execution-slot/`，未改任何项目文件、锁、台账或 Native 状态。

## P2：异步 fake engine 的共享 JSON 非原子读写，使“重复 start / 冷查回”证明存在真实竞态

位置：`test/infra-runner-isolation.test.js:1252–1255,1283–1284,1368–1369`。

新增 fake engine 每次命令均先读改写 `trace.json`，并无条件读取 `containers.json`；`save()` 对状态用直接 `writeFileSync`。测试先 `startCliJob` 启动异步 Node 子进程，尚未等待其终态就立即调用 fresh driver 重入。两个子进程因此会并行读写同一文件。直接写会先截断已发布 JSON，另一进程可能读到空/半截内容；trace 的读改写还可能丢事件，影响“没有额外启动”断言的可靠性。

本次对未改源码独立执行最小原组一次，实际 **8 total / 7 pass / 1 fail / 0 skip，exit 1**。失败为 cold resolution 组，在第1369行 `fresh().startCliJob` 的 `checkEngine→json` 抛 `DOCKER_METADATA_UNVERIFIED`。原产品 wrapper 将非零命令与 JSON 解析错误统一映射，原日志不能再细分当时是 trace 还是 state 文件先被碰撞；不虚称原 child stderr 已被捕获。

随后用原测试的 `String.raw` fake-engine 模板原样提取到 tmp，仅替换模板既有文件路径与 inert 注册字段。固定正常 JSON 时 `info` exit0；持有普通文件 `open('w')` 打开的截断窗口时同一 `info` exit1，实际 stderr 为 JSON SyntaxError；写回同一原内容后 exit0。四项确定性断言全通过。此控制实验确证源码中的文件发布缺陷可产生本次错误路径，并未运行 Docker、替换产品行为或重试原测试凑绿。

最小修正：由原作者修夹具的发布/并发协议。完整状态用同目录唯一临时文件写完后原子 rename；trace 改为不丢事件的进程独立记录或可靠追加，不能只对其读改写加 rename 就认为解决了丢事件。保留 live overlap、重复 start 仅一次、冷查回、created/UNKNOWN 拒绝重启及全部现有断言；不得以先等待 first.terminal、放宽错误/断言、自动重试或 skip 隐藏竞态。修后在同输入边界复验并保留这次失败。

这是测试构造阻断，**不是实际 Docker 产品行为 RED**，也不是原始未知资源的自动启动许可。Root 尚未 apply 此候选。

## 产品源码可消费范围

- `runner.mjs:1398–1401`：沿用原 `envelopeDigest`，槽名明确绑定受保护 registration digest、原 Run、execution、role digest、job digest；job/current ActionBinding/签名 dispatch 的既有验证未删。
- `1412–1447`：拆出的注册物理检查保留 image/authority/workspace/registration/user/cwd/readOnly/cap/network/mount 校验；对外 handle 仍额外精确核 run/execution/role/registration。legacy 固定名只作同原执行观察，不 rename/remove/复用启动。
- `1429–1463`：role 查询转义 dot；严格 inspect，不将失败/坏 JSON/歧义变 ABSENT；同 Run/execution 的错摘要槽拒绝。旧同 role 非终态及未知状态围栏新启动，其他 Run 非终态也保守拒绝。
- `1483–1515`：任何已存在槽，包括 created/unknown，只读回 `resumed:true, terminal:null`；新 create 后再次查 peer，缺自身或竞争 writer 则拒绝 start、保留资源。不清理、不重派发。
- `1533–1541`：resolve 是固定 engine 下 ls/inspect，无 create/start/stop；FOUND 与 ABSENT 均 `launchPermitted:false`、`managedClosureEligible:false`。调用方仍须使用原 Native 唯一 launch claim；ABSENT 不授权重启。
- 无新 queue、lease 表、phase、ledger、retry 或 controller。peer 读回存在已声明竞态窗口，不提供 OS 原子互斥；唯一 claim 仍须原 Comet CAS。原生产接线、cold bytes 可信恢复与真实物理资格依旧未实现。
- 现有三口及新 resolve 一致使用 authorize / 受保护 registration。此分支 `lib/` 未改；没有将端口增加冒称 P1_3 已接线。旧 stop 的更广状态资格不在此次修改范围，本报告不认证其真实 OS 效果。

## 证据一致性与实际执行

manifest SHA256 `e0d014174a002a8e69cdac0400908f8f327cfc0be2bc63c948fb6394b47dde78` 精确匹配；**37 content、33 raw/display 对、3 private archives**逐条 bytes/SHA 全匹配。合计116项文件校验包含当前两源、保护输入。base 源 SHA/bytes也一致，旧测试完整内容为新测试逐字节前缀，未放宽原断言；源码 diff-check 通过。

- 当前 runner SHA256：`837751b28f1bc25ff55e5b40673e4138cbd0797acabf115f33f20363808a7072`
- 当前 test SHA256：`1b332dea4732f822f7a87b850e225f6c79ef7eac8151749c022a6d927f1a07f1`
- 作者原 RED1fail、首次缺公开 cache 的89/72/17 SETUP、修正 namespace 的 SETUP、后续89/89原日志均保留，不改写。89/89是作者单次组件结果，不能覆盖本次实际7/8。
- 原始作者证据指针：tree 下 `.local/I02-execution-slot/raw/`；精确条目在 `worker-reports/I02-execution-slot/evidence-index.json`。RED源码按编辑历史重建且与当时输入SHA相同的声明/私有快照均存在；不是伪称同时捕获的新原始源码。

独立实际 argv：

```text
/Users/mac/.nvm/versions/node/v24.15.0/bin/node --test --test-reporter=tap --test-name-pattern=execution slot test/infra-runner-isolation.test.js
```

独立执行入口：`/usr/bin/python3 /private/tmp/I02-execution-slot-standards-run-20261026.py`。仅一次原组执行；receipt记录精确UTC、argv、PATH、前后源SHA、pid **78867**、exit1，工具 session **21066** 已终态。Node24.15，受控最小环境，HOME保持已有值不重设；PATH中11种Docker/模型/网络/包管理拒绝器，实际拒绝器调用0。没有消费 public cache，未执行整个原文件或真实 Docker/model/API。

原失败日志：

- `/private/tmp/I02-execution-slot-standards-20261026/stdout.txt`
- `/private/tmp/I02-execution-slot-standards-20261026/stderr.txt`
- `/private/tmp/I02-execution-slot-standards-20261026/receipt.json`，SHA256 `c87d276ef93fe63577f830245ec816a1e904c35f5232819d078c68192c6c3070`

确定性因果实验：`/private/tmp/I02-execution-slot-standards-20261026/causal-probe.mjs` 与 `causal-proof.json`；proof SHA256 `bdb3e5258831827d5a0f99a9dd7646082bf974200732a98a42cb358863f5a8a4`，含实际0/1/0 stdout/stderr、模板源码与生成文件SHA。该实验记录的 `000…001` 仅 inert fixture handle；原suite未把各 handle 值打印，afterEach已清理，不能声称保留了真实容器句柄。

可接纳范围：源码机制可继续独立 Spec / integration 审查；合并当前新测试与此候选的“复验通过”结论应等原作者修 P2。whole I02/image/Host/roles/OS/原 Native CAS 集成均 NOT-EXERCISED，不申请额外资格或改动。
