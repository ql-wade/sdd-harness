# CONTEXT_CONFLICT 前置验证诊断交接

没有修改产品代码、image/code pin、断言预期或任何 5000ms / 3s 时限；没有运行整仓或 Docker/模型/认证/网络。主原始 stdout/stderr/metadata 逐字保全为 original-*。原主失败仍未关闭。

## 已观察与尚未证明

- Root 主失败：1164 项、1162 pass、2 fail（missing manifest file 与父项）、0 skip；实际 OPENSPEC_INPUTS_UNVERIFIED，预期 CONTEXT_CONFLICT，7238.991ms。原日志未记录 findings，不能由时长逆推到某一个 finding。
- 原三份 image lock / Runner / test 源码在本树与主失败 metadata 摘要完全相同，见 input-match。
- 用原 makeBuildContextFixture helper 和原缺 Dockerfile mutation 建立窄循环，3 次独立 fixture、6 次 plan/export 都得到 CONTEXT_CONFLICT，缺文件保持、恢复后均 materialized:true。它只证明当时独立路径不复现，没有消除主失败。
- 随后已在途的一份原 15-case 矩阵捕获真实 deadline failure：`.local ancestor symlink` 的 initial preflight 在 mutation 前失败（16 项、14 pass、2 fail、0 skip）。原 Python tar inspector 5003.997ms，ETIMEDOUT / SIGTERM / status:null、metadata EMPTY；stdin 471694 字节，SHA 84820b173b57204bd7582a47ddae65e85fd492724172acc8e434e97ea1c05c3f。57 个实际调用中，另外 56 个成功，整体中位 48.421ms、最小 45.560ms，见 02-python-events / summary。
- 这个失败和主失败处于同一前置调用链，但不是同一次、同子例、同阶段。捕获矩阵曾用 command-local inherited NODE_OPTIONS，因此不能冒充主原始环境；后续不再这样做。Root 已核原主时间窗没有真实 Sleep，不能按 sleep 归因。负载/调度仍只是待检假设。

三种需要主同次证据区分的分支：Python deadline/进程失败（PACKAGE_METADATA）、受管 project/tar/dependency 漂移（对应具体 finding）、其它 metadata 输出/解析失败。`verifiedOpenSpecProject` 在原 context conflict 检查之前执行，其任何失败都先返回 OPENSPEC_INPUTS_UNVERIFIED；不能放宽为接受任意 UNVERIFIED。

唯一测试改动只为下一次失败打印非敏感 code/findings，保留原 expected/status/readback/恢复断言与时限。新的 probe 只记录耗时、timeout、errorCode、signal、status、metadata 分类、stdin 字节数/摘要与时间戳，不记录原始 stdout/stderr、执行参数、业务、凭据或环境值；原 Python 执行体、options、结果均原样透传。

## Root 精确一次捕获步骤

本次不由工人在资源不全的树中再跑矩阵或整仓。由 Root 先消费本提交的诊断消息增强，然后在完整主基线上沿原外部拒绝器、Node24.15、HOME/TMPDIR 和电源观察方案执行一次原 `/bin/bash scripts/check.sh`。不是 wrapper/shim 代替原命令。

1. 将本目录 `python-spawn-probe.mjs` 复制到 Root 私有 `.local/comet-reset/host-components-preflight/python-tar-diagnosis/python-spawn-probe.mjs`。模块仅会向同目录 `python-events.capture.jsonl` 追加允许字段；先用新的空文件承接本次证据，保留旧记录。
2. 临时且只在 `test/infra-runner-isolation.test.js` 的 `makeBuildContextFixture.invoke` 为准确 `Runner build-plan` 子进程加入 Node 的 `--import`。只做下面一次精确替换，先保存增强后测试的完整原始字节和 SHA；必须计数为 1：

   ```python
   old = "spawnSync(process.execPath, [path.join(fixture, 'tools/infra/runner.mjs'), 'build-plan',"
   new = "spawnSync(process.execPath, ['--import', " + json.dumps(str(probe_absolute_path)) + ", path.join(fixture, 'tools/infra/runner.mjs'), 'build-plan',"
   assert test_source.count(old) == 1
   instrumented = test_source.replace(old, new)
   ```

   仅这一 helper 的实际 Runner 子进程加载 probe。不要设置全局或 inherited NODE_OPTIONS；其它测试进程和其它 Runner 路径不加 preload。`probe_absolute_path` 必须是第 1 步 Root 私有诊断文件的确切绝对路径，不使用用户/worker/env 选择器。
3. 在同一个 try/finally 中写入临时测试，执行原 `/bin/bash scripts/check.sh` 并保存 stdout/stderr/metadata；finally 逐字恢复原始增强后测试，再核 SHA。记录本次完整主输入、临时单点插入的 diff、probe 摘要和成功恢复证明。该临时插入不提交、不进入产品代码、bootstrap 或镜像锁。
4. 将失败断言打印的实际 code/findings 与同时间 Python event 对齐。若同时是 PACKAGE_METADATA 与 ETIMEDOUT，才能把这一次前置失败识别为实际 deadline failure。仍需单独证明为何超时，不能直接归因资源或 sleep；其它 finding 走其具体输入证据。
5. 如主同次确认为调度/资源边界候选，下一步可由 Root 对同一全部用例做显式文件级并发度对照，保持全部原断言和每项 deadline；先报告数据，不直接改 5000/3s、不排除测试、不把一次串行绿色当因果证明。捕获结束必须移除临时 preload，并在最终候选通过原未插桩 check 后才能关闭本失败。

## 当前验证范围

这次只做源码/探针语法与 diff 检查，均 0。未为诊断消息修改再反复跑同一矩阵凑绿；已完成的真实单矩阵失败保留。此提交不改变 ab90 已通过的 archive readback/Host/bootstrap 产品字节；全仓仍保留原 FAIL，等待 Root 同次捕获和最终原 check。
