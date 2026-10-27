# P1_3 stdio close-current R2 Standards 复审

结论分层：**源码审查无新增P级问题，原P2修复方向与最小实现相符；本次独立行为复验SETUP_BLOCKED，不能签独立5/5通过或整个R2运行闭合。** 原窄组一次0pass/5fail、exit1，四场景全部首先报fs.watch EMFILE；普通tmp目录单watch也同样失败。没有重试转绿、替换屏障、改资源限制或使用作者自检代替独立结果。

## 固定对象与输入

HEAD `62011e03b8702af991d4b1c40eb75801cadfdb96`，parent `e361f097b09276288b6dc65db82d3e66d4374c12`；tree `/Volumes/mac-extend/codex/worktrees/comet-registry-qualification/sdd-harness`，前后tracked clean。仅harness一行、追加driver测试及新返工报告。

- harness SHA256 `6e4439c298e5d269a38bc269140eb4076f2e27ea4c78acc639bed71d83c0b8eb`
- driver test SHA256 `1d15e4d9a2b2f9c48402b1747ddc3fa489c1b0f27c3fde9e9f1ebedf988c6825`
- manifest SHA256 `0a410d612da252fd89d74c6dbd8789b35822a1aac599f2d7323153ffe1b0d905`
- inputDigest `a257e1ade9c10e6d3131992592f7f7a5b85d8f3df55e1151bdb7f061d2c1ba2f`，独立按inputFiles递归key排序、compact UTF8 JSON重算一致。

已读原独立Spec P2报告（SHA256 `af5a5e1d4f64c3041eb8043107bc822da7f380c6f418f0f14254a19ecb838217`）、新REPORT/manifest/inputs/runs、实际源码diff及原始证据。30 tracked/37 raw、17 raw-display对、32输入（含既有封存schema/Node/旧Native材料）、原47份不变报告与92 raw、原Spec文件，共273内容摘要检查通过；另外用git父提交核原两owned历史源码。旧test完整字节仍是新test前缀。

## 源码审查结论

`lib/adapters/harness.js:387` 唯一产品增量：

```js
try { current(); } catch { unknown('NATIVE_CONTEXT_STALE'); }
```

独立程序化验证：从新harness删去这唯一行后与parent完整字节相同。它位于close记录真实ended/exitCode/signal之后、最终OBSERVED_TERMINAL/done/closed之前。因此current tuple漂移或读取抛错会经原unknown变成粘性UNKNOWN/stale，而真实进程exit0/closed、原contextDigest和completed-turn事实仍保存。已存在UNKNOWN沿原函数保留首次原因，后续稳定不能恢复成OBSERVED_TERMINAL。

没有新增状态类别、controller、ledger、重连/重启/副作用重跑、Caller参数或provider选择。原main/constructors/binding fixture保持相同摘要，既有调用者不需传新参数；稳定路径只多做一次已有固定CODE回读。已经close的历史observe不随以后epoch变化被改写；未来Native/source admission仍必须复核，不能拿这次close快照当未来授权。

新测试只追加一顶层四子例，保留此前全部测试。stable、epoch1→2、currentContext抛错、timeout后恢复分别检查done/closed、实际exit0/closed、原handle/contextDigest、一次实际callback及错误文本不泄漏；恢复原tuple后同实例start仍原operation。

屏障是实际 `fs.watch` + ready/release文件：peer在stdin EOF后发ready，watch保持其存活，测试观察到protocolComplete且未closed后才改context，再发release。没有sleep制造目标竞态。timeout例仅等待原transport timeout以建立旧UNKNOWN。源码finally关闭ready watcher、释放peer、只cancel原handle并await operation.closed，再删除自身tmp。无自由PID/外部资源清理。作者原RED 5项/2pass/3fail与GREEN5/5、owned81/related52、旧75/1及原e361证据均保留；这些仍是作者证据。

## 本次独立执行：环境阻塞，非产品RED

一次执行原候选未改窄组，精确argv：

```text
/Users/mac/.nvm/versions/node/v24.15.0/bin/node --test --test-reporter=tap --test-name-pattern=native close rechecks test/comet-driver.test.js
```

actual cwd为上述候选tree；Node实际24.15.0。UTC开始 `2026-10-25T23:28:17.238421+00:00`，结束UTC/环境键/原始SHA在receipt。runner PID **37565**，tool session **29737**，已终态exit1。

实际输出 **5 total / 0 pass / 5 fail / 0 skip**：stable、epoch-changed、current-throws、timeout-restored均先发生uncaughtException：

```text
EMFILE: too many open files, watch
FSWatcher._handle.onchange (node:internal/fs/watchers:267:21)
```

因此不能将这些失败计为epoch/异常/粘性语义反例，也不能宣布这些语义已由本次独立执行通过。作者此前5/5不覆盖本次阻塞。所有本轮当前源码/静态输入前后SHA不变；guard11项实际校准97、独立测试额外调用0。

随后只做一次普通tmp目录fs.watch资源探针，不调用候选、peer、真实CLI或模型：Node24.15 PID **38545**，UTC `2026-10-25T23:28:56.784Z`，同样立即收到watch-error/EMFILE，handler关闭自身watcher后终态。该探针支持“当前执行环境watch不可用”的分类；没有试图定位全机FD归属、关闭别的进程、提权、改ulimit或全局配置。

本轮原组的peer PID值未打印留存，不虚构逐peer句柄或宿主全机清场证明；源码finally的原handle cancel/await close已核对，测试runner和独立资源探针的实际终态如上。Root已决定退原作者去掉fs.watch这项非必要宿主前提，改用原public wire观察加确定性同步屏障；必须保留完整turn/completed→epoch变化→同一peer close顺序及所有断言。待新候选再独立复验，保留本次SETUP记录，不能skip或放宽assert。此次不重试原5组、不改系统资源。

## 原始材料与保全

独立入口 `/usr/bin/python3 /private/tmp/P1_3-stdio-standards-r2-run-20261026.py` 每次新建tmp；本报告不授权在当前失败环境循环重试。

证据根 `/private/tmp/P1_3-stdio-r2-std-oj125g_f/`：

- `receipt.json` SHA256 `1b30ae77897b4f8fc9877d33f7629ccd00ab7e570815019c346085240aa0c41e`
- `stdout.txt`、`stderr.txt`、`guard-calibration.txt`
- `watch-resource-probe.mjs`、`watch-resource-proof.json`，proof SHA256 `c84728278eeca3f85c92f61f966f53dfd7f92877b5d6ebf7a33df2e893e590a8`
- `input-digest-proof.json`

审查harness首次在测试派发前把旧manifest两份必然变化的owned源SHA与live源比较，触发前置断言；纠正为git父提交历史字节比较后才首次派发上述原5组。原脚本/错误分类保留 `/private/tmp/P1_3-stdio-r2-std-lgpwee3s/`，testsDispatched=false，不能计产品RED或重试凑绿。新报告自身也保留作者组装旧manifest格式错误的历史，未隐藏。

旧不变47报告/92raw均独立校验；844旧ignored叶metadata保全是作者记录，未扩读旧秘密内容或冒充本轮完整metadata/全机资格。未改candidate、原报告/日志、锁、配置、DAG/phase，不派agent。无真实CLI/auth/model/MCP/Docker/API、网络、安装或全局写。

可供Root消费：最小源码修复审查及证据保全结论；**运行复核仍需补齐**。真实provider/SourceReader/worker/I02/artifact/no-bypass/OS身份和whole P1_3继续NOT-EXERCISED；此次没有业务通过增量。
