# P4_8 heartbeat 测试夹具：独立快速审查

**结论：可接纳这一个测试夹具修复，无阻断；不代表完整 check 或真实业务恢复已验收。** 本审查非作者，只读核当前diff、原始失败和窄测试证据，没有修改源码/状态或运行真实资源。

## 根因与修复

原完整check在真实SIGKILL之后，于 `test/knowledge-revocation.test.js:714` 解析 heartbeatFile 报 `SyntaxError: Unexpected end of JSON input`。原 `beat` 直接 writeFileSync 到读者正在使用的文件；写入会先截断，进程被杀在截断/写入期间可能留下空或半截JSON。该失败发生在夹具的heartbeat文件发布，尚未进入后续恢复/窗口断言，不能据此判产品恢复算法失败。

当前仅把第97行改为：写相邻 `heartbeatFile + '.tmp'`，完成后rename到heartbeatFile。它沿用第96行state文件已有写法；同目录位于同一文件系统，读者可见旧的完整内容或新的完整内容。若进程在rename前死亡，临时文件可能残留，但已发布heartbeat不被先截断；恢复进程会正常覆盖临时文件再发布。夹具先执行初始beat再开始计时，因此SIGKILL前已有已发布heartbeat。

已按HEAD原文做精确替换比较：旧beat恰好一处，替换这一行后与当前文件逐字节完全相同。没有产品lib改动；没有增加读取重试、捕获JSON错误、放宽超时或通过重复测试凑绿。

## 原测试强度保留

真实child spawn和SIGKILL、确认原writer退出后才重启、真实150ms停机与heartbeat年龄>=100ms、同命令/同state恢复、operationKey不变、attempt继续、暴露窗口包含停机、pausedMs=0及不可能预算仍产生违约的断言均未改。没有删断言或把真实故障换成状态模拟。

## 实际证据

- 原失败：`.local/comet-reset/p1_5-main-integration/required-check/stdout.txt`，SHA256 `313809af385e2a3f3ad5179f2e7e5cff9555449d2a404b5cf8af21ddfe3d55c1`。
- 窄测试原argv：固定Node24.15.0，`--test --test-reporter=tap --test-name-pattern=real fault injection test/knowledge-revocation.test.js`。
- Root实际记录：1 test / 1 pass / 0 fail / 0 skip，exit0；不是重跑整套check的完成结论。stdout/stderr/guard哈希与metadata一致，记录输入前后一致，guard调用为空。
- metadata：`.local/comet-reset/p1_5-main-integration/heartbeat-atomic/metadata.json`，SHA256 `56100946d1ca21004933e5e9c12adc57800cfe73663c289497d46dd286326dd2`。
- 本审查补绑定当前目标测试源SHA256：`6af3c50e3bde7afac97e6337d347f6e6d574a26a134dacb78a311acb2f87d599`；HEAD原文SHA256：`ca4b73f9f595b12aba1eaa6a7ebc1548ed75edce8ea5c3c789a3af2cc9a9f65c`。原metadata未改写。

未独立再运行故障测试；现有原始窄测与源码足以核这一行。剩余完整check仍由Root执行；此修复不证明断电持久性、真实Comet/角色/权限或业务环境恢复。
