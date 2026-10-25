# P1_3 watch-free R3 独立 Standards 行为复审

结论：**PASS，无新增P级阻断；原close-current P2在此次construction窄边界闭合。** 原候选五项窄组一次 **5/5，0fail、0skip、exit0**。不继承此前R2的行为通过：原R2独立0/5仍为EMFILE SETUP_BLOCKED并原样保留。

## 固定输入与范围

HEAD `8b0f937fde6209a31175f4a167ffecbf43185919`，parent `62011e03b8702af991d4b1c40eb75801cadfdb96`；tree `/Volumes/mac-extend/codex/worktrees/comet-registry-qualification/sdd-harness`，前后tracked clean。只改driver测试和新增 `worker-reports/P1_3-native-agent-transport-rework-watch-free/`，未改产品harness、main、binding fixture、锁、配置、计划或phase。

- 产品harness SHA256 `6e4439c298e5d269a38bc269140eb4076f2e27ea4c78acc639bed71d83c0b8eb`，独立与62011 git字节相同。
- 新test SHA256 `7933f916a113d7bf273859e6e9c6b7fc1e1ea24a7838bb7bad29a623e8a4890e`。
- manifest SHA256 `60c3d00353d6285b03092c335dc0a79fbc1aa3203bb319966c748f4cc714c1f1`。
- inputDigest `16eaacbe1759e42074f4d1e4658ebb7ed289b9b8ce44da049100b40084f53611`；独立以inputFiles递归key排序/compact UTF8 JSON的SHA256重算精确一致。

327项内容摘要检查通过，覆盖27新tracked、34新raw、14对raw/display、32实际输入/封存材料、e361与62011历史不变报告/raw及原独立R2准备阻塞证据。旧manifest中有意变化的owned源码另以原git提交核对，不要求当前源冒充旧字节。所有当前输入前后SHA一致。

## 时序与断言未被绕过

1. 删除两处fs.watch；peer以有界条件timer保持存活，仅在实际stdin EOF写ready，见明确release才正常退出。10秒安全上限报PRIVATE_CLOSE_BARRIER_EXPIRED/exit91，不能伪造exit0。
2. 测试通过原public `observe(handle)` 确认protocolComplete并同时看到EOF ready；等待期间检查非UNKNOWN、closed=false和2秒上限，以setImmediate让出执行。到达后仍断言turnStatus completed、实际peer存活、一次callback和真实note字节，再改epoch或让currentContext抛错。
3. release只发生在上述条件及context动作之后；timeout-restored先等待原transport真正timeout为UNKNOWN，再改/还原tuple并release。同一peer正常close，形成完整 `turn/completed→实际EOF/未closed→context动作→release→close`。
4. 这里的5ms timer只轮询release条件，setImmediate也只推进已观察条件；没有以“睡够若干时间”替代顺序证明。未知/提前退出/缺marker均失败，未吞掉EMFILE、改系统limit、skip或改oracle。
5. 程序化比较：close组前全部测试与62011字节相同；从before snapshot直到restoration的全部行为断言片段亦逐字节相同。finally只释放自身peer、原handle cancel并await operation.closed，再清理fixture；没有对外部PID/进程组操作。

## 产品修复与本次实际结果

产品仍是62011那一行close current()复核：先保存真实ended/exitCode/signal，再复核当前tuple，失败经原sticky unknown返回NATIVE_CONTEXT_STALE；随后只有非UNKNOWN才能写OBSERVED_TERMINAL。无API/Caller变更、新状态/调度/重连或副作用重跑。

本次原测试五项计数为一顶层＋四子例，真实结果：

- stable：完整正常协议/真实callback后close，OBSERVED_TERMINAL；exit0/closed=true、原contextDigest及原handle。
- epoch-changed：最后turn完成、close前epoch1→2，UNKNOWN/NATIVE_CONTEXT_STALE；真实进程仍exit0/closed=true，历史completed-turn与原digest保留。
- current-throws：同窗口CODE回读抛错也UNKNOWN/stale，无SHORT_CLOSE_CALLBACK_NOTE回显，真实退出事实保留。
- timeout-restored：旧UNKNOWN/NATIVE_TIMEOUT_UNKNOWN在恢复旧tuple并正常close后仍保持首个原因，不复活、不新建attempt，callback仍一次。

稳定进程已经closed后再观察更晚epoch保持历史观测，未伪称新授权；未来Native/source admission仍须独立复核。本PASS只关闭该transport回传窗口的construction缺口，不代替该上层责任。

## 独立真实命令、raw与终态

精确Node24.15.0，实际argv（原test未改）：

```text
/Users/mac/.nvm/versions/node/v24.15.0/bin/node --test --test-reporter=tap --test-name-pattern=native close rechecks test/comet-driver.test.js
```

以Python argv数组执行；shell手工复跑应给完整pattern参数加单引号。actual cwd为候选tree。UTC开始 `2026-10-25T23:36:14.802223+00:00`，结束时间及完整环境/前后SHA见receipt。runner PID **47349**，tool session **54732** 已终态exit0；TAP duration约2.016秒。一轮原组执行，无失败重试。

11种外部工具guard实际校准exit97，随后调用0。最小env保留原HOME/CODEX_HOME值，不改绑；没有真实CLI/auth/model/MCP/Docker/API、网络、安装/下载、全局配置或资源limit修改。每个实际Node peer正常close/exit0/原handle等值由原断言核验；测试没有打印逐peer PID，本报告不捏造其清单，也不签全机进程清场。

入口：`/usr/bin/python3 /private/tmp/P1_3-stdio-standards-r3-run-20261026.py`（每次新建tmp）。本次原始材料目录 `/private/tmp/P1_3-stdio-r3-std-cyuavp46/`：

- `receipt.json` SHA256 `7f410758e41fd7c143ad1eba66cada19d4f24bdb904251a136c391c9835f63cc`
- `stdout.txt`、`stderr.txt`、`guard-calibration.txt`

## 历史与剩余边界

R2原 `/private/tmp/P1_3-stdio-r2-std-oj125g_f/receipt.json`（SHA `1b30ae77897b4f8fc9877d33f7629ccd00ab7e570815019c346085240aa0c41e`）及普通tmp watch探针（SHA `c84728278eeca3f85c92f61f966f53dfd7f92877b5d6ebf7a33df2e893e590a8`）本次重核原字节，没有重写或继承通过，也未重试watch。

作者新watch-free fixture对原e361的负控真实5tests/2pass/3fail，epoch与exception仍错误返回终态；当前产品5/5和81/81、输入前后一致、guard0的raw均保留，未标作本次独立全81。Related52明确未重跑，产品源和原binding fixture与62011一致，其先前结果只保留历史。旧e361、62011、75/1、原Spec P2 RED及报告组装错误原始材料保留。1299旧ignored叶metadata的作者保全声明不被本报告扩大成知识/secret内容审计。

SourceReader、真实provider/角色/OS/CLI工具无绕行、worker/I02 interactive、canonical artifact返回、原Native同Run接纳/恢复及whole P1_3仍NOT-EXERCISED。待Root在最终current调用与全仓回归中串行集成复验，本次不签业务通过或解除这些义务。
