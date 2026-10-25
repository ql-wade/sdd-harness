# I02 execution-slot Standards 返工复审

结论：**PASS，原 P2 已闭合；无新增阻断。** 独立最小原 slot＋新增确定性组一次执行 **11/11，0 fail、0 skip，exit 0**。接纳范围仅 fake-engine 夹具修复与原组件 construction，不认证 whole I02、真实 image/bootstrap、Host、角色/principal/OS、原 Comet CAS 接线或可信恢复。

## 固定输入与范围

- HEAD `2b7fce91984c739a7243ac48e2beeb1ec3545135`，parent `6870e6851d34bc017e759a83aeffa5de7e020762`；tree `/Volumes/mac-extend/codex/worktrees/comet-delivery-contracts/sdd-harness`，复审前后 tracked clean。
- 仅 `test/infra-runner-isolation.test.js` 与 `worker-reports/I02-execution-slot/` 新返工材料变化。产品 runner 保持 SHA256 `837751b28f1bc25ff55e5b40673e4138cbd0797acabf115f33f20363808a7072`，没有改动原物理端口合同。
- 新 test SHA256 `bbbaae1ca3504135f16d7f73e3a4c966e41cf227f1f5b457af1dbb64547098f5`。
- 任务提示中的 `REWORK-CURRENT.md` 实际为 `REWORK-CURRENT.json`，已读其中目录/父候选/manifest绑定，不以文件扩展名差异制造产品阻断。
- 新 manifest 32 项，SHA256 `abc298c66464f619c4a5ebf3d6aa31dce1a56834e8fcc58828684b7327d24802`；index 30 对 raw/display，SHA256 `bd8bda23d5126ad883991da7dc4638e5273599e15f8b3610486be2f6c4fc029f`。逐条核实32 content、30对、12 private archive、86份原证据及当前源码/8项保护输入，共200项 bytes/SHA校验均匹配。

## 原 P2 根因闭合

1. `test/infra-runner-isolation.test.js:1235–1241` 新 `publishExecutionFixtureJson` 在同目录创建 PID＋UUID 唯一临时文件，`wx` 写完整 JSON，再 rename 发布，finally清理自身临时路径。fake engine 与 parent fixture 的状态写都复用此路径。已有打开的读者继续读到旧完整 inode；新的读者读取完整新版本。未吞掉 JSON 解析异常、未增加自动重试。
2. `1264–1268,1325–1326` 每个 CLI 命令发布独立 UUID 命名记录，读取仅枚举最终 `.json`，不再对共享聚合数组读改写。临时 `.tmp` 文件不会进入 trace，两个并发命令不会彼此覆盖记录。trace顺序不承诺真实时间顺序；现有使用只按命令内容筛选/计数，新增顺序比较仅针对两个相同 `info`，未引入错误排序假设。
3. `1296–1301` 异步 start 在 stdin结束时重读当前状态、按原 id定位并复核原 run/execution，仅改原容器状态后发布最新快照，保留有序屏障前已经发布的 peer/字段。IPC running-published 只给确定性测试观察边界；产品 driver 无IPC时不改变其行为。
4. 原 `first=start→fresh().start→await terminal` 顺序完整保留。程序化对比 parent 的8组测试主体，除新增“一条start trace”更强断言外逐字节相同；旧 pre-slot 内容除需要的 spawn import外亦相同。strict inspect、ABSENT/created/UNKNOWN不启动、旧active/错handle/scope拒绝、create后peer检查等原断言未减。
5. 新3组实际验证：已打开旧状态FD不被新发布截断；真实两个Node进程经FIFO/IPC在文件发布边界双方ready后释放，保留两条trace；start真实保持stdin打开，在running发布后插入peer/字段，再关闭stdin，完成后仍保留。失败保护只有15秒子进程终止上限；没有sleep、重试或skip。新子进程有finally终止与await close，临时目录沿原afterEach清理。

这不是任意并发 mutator 的事务数据库或互斥锁。重读＋发布之间仍无CAS；此夹具没有承诺该能力，原产品唯一 launch claim仍归原 Comet CAS。没有新增产品queue/lease/phase/ledger/controller。无需为本 P2 引入额外调度或权限层。

## 历史与作者证据

原独立 **7/8** 失败及确定性截断因果实验继续保留；原报告 SHA256 `9be040362c411c8097dcbb1388ce73fda955338e24688b484ecc6be034496dc9` 不变。原6870证据包及 `.local` 历史86文件逐条匹配，原作者89/89没有覆盖旧独立失败。

新返工的三条确定性原RED有效且保留：

- `red-publication`：原非原子状态使旧FD内容被改、聚合trace丢事件，2 fail/exit1；输入test SHA `badac6538a5d256351f85c49b94c69afcb40ade26b146ad5df4f1dd46cf86459`。
- `red-overlap-completion`：stdin未结束时插入的peer被旧快照覆盖，1 fail/exit1；输入test SHA `9dd68e86d4f85c0b01ac4fa7eb1064100c8eb9fa64bfd0e674e65a5e9cd580c1`。
- 修复后的作者3/3、11/11与完整92/92，输入test均为冻结新SHA，前后源/保护输入一致；这是作者组件自检，独立审查只复跑下述11组。

原始新证据位置：tree 下 `.local/I02-execution-slot/rework-atomic-fixture/`，对应30对精确路径/size/SHA见新 `evidence-index.json`。作者完整92组Node PID91423/session31801的终态、UTC与exit0收据已读；本次不重跑92、不消费公有源cache、不下载。

## 独立真实执行与原始材料

复跑入口：

```text
/usr/bin/python3 /private/tmp/I02-execution-slot-standards-r2-run-20261026.py
```

实际测试 argv：

```text
/Users/mac/.nvm/versions/node/v24.15.0/bin/node --test --test-reporter=tap --test-name-pattern=execution slot test/infra-runner-isolation.test.js
```

Node实际v24.15.0。最小环境只保留PATH/语言/TZ/tmp/CI/Git禁系统与global配置，以及已有HOME值，不重设HOME；无provider/token/NODE注入。11种外部工具拒绝器实际校准exit97，校准记录单独保留，测试额外调用 **0**。未执行Docker、模型、网络/API、真实secret、下载、安装或全局配置写入。

实际 runner PID **99087**，tool session **26725**，exit0且已终态。精确UTC、argv、前后10份源码/保护输入SHA及stdout/stderr SHA均在：

- `/private/tmp/I02-execution-slot-standards-r2-20261026/receipt.json`，SHA256 `68cc7fc1b701ad83ace6beeb0446a0e35226aa153202c299dc7d5759118b564e`
- `/private/tmp/I02-execution-slot-standards-r2-20261026/stdout.txt`
- `/private/tmp/I02-execution-slot-standards-r2-20261026/stderr.txt`
- `/private/tmp/I02-execution-slot-standards-r2-20261026/guard-calibration-calls.txt`

复审环境限制：首次进程表只读检查 `ps` 被 sandbox报 `operation not permitted`；未申请提权或改用可触碰外部进程的操作。因此不能签“宿主无任何外部进程”。已核作者终态材料与本次自身runner退出；新增两个屏障测试源码明确await各自close。该可观测性限制不改变这次11组实际结果，也不冒充Host/OS资格。

允许Root按原双审/串行集成流程消费原slot/resolve construction及本次test-only返工。whole I02及真实运行资格继续UNVERIFIED；未修改候选源码、锁、计划/台账、Native状态或旧审查材料。
