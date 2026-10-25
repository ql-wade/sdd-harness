# 原 I02：确定性 execution 槽与只读查回

基点14bda75，分支codex/comet-execution-slot。只修改 tools/infra/runner.mjs、test/infra-runner-isolation.test.js 和本报告。原636/70a2历史及ignored证据/缓存保留；不改Dockerfile、rolePolicy、镜像/上游锁、任务/DAG或原Native状态。产品唯一主控仍Comet，业务增量0。

根因有真实Node进程合同RED：R1子进程exit0后，同Run/role合法R2被原固定namespace-role名字和strict execution检查拒绝，PROCESS_SCOPE_MISMATCH。修复保留严格检查，将名字绑定原可信registration/run/execution/role/job的canonical digest；添加只读resolve，不将ABSENT变成启动权限。旧active/unknown、错handle、外部namespace和scope仍拒绝。create后再次读peer，竞争时留资源给原Comet，不自动清理/再派发。详见PORT-CONTRACT.md，供Root交原P1_3/P2_4，不直接消息其它任务。

| 作者真实检查 | 结果 |
| --- | --- |
| 原物理/注册基线 | 3/3 |
| 同role R1退出→合法R2 | 原真RED1fail → GREEN1pass |
| slot序列、冷独立Node查回/重入、旧active/unknown、created不再start、legacy/错scope、元数据失败、create后竞争 | 7/7 |
| 合法带点namespace与外部近似名 | 1/1 |
| 原I02文件首次完整检查 | 89total/72pass/17fail，缺公开cache的SETUP失败保留 |
| 只读使用已验锁公开制品后，同一原文件完整检查 | **89/89，0fail/0skip** |

首次缺cache17项来自两个构建context组（含15子例），不计行为RED；没有skip或更换oracle。原测试已有I02_ACCEPTED_ARTIFACT_ROOT入口，Root确认后只读使用主检出既有公有源：Comet源40474019B/SHA28a7e2fa…faaa1f，OpenSpec1.11.0 tar471694B/SHA84820b17…05c3f，实际完整SHA/size均核验，fixture只复制到自己的tmp，没有下载/build/image/pull。带点namespace最初误写强制前缀，REGISTRATION_INVALID属于SETUP拒绝；修正fixture后通过，原失败保留。

固定Node24.15.0、最小环境、HOME保持。PATH11个真实Docker/模型/平台工具拒绝器已校准97；测试期间额外调用0，真实Docker/model/API/secret/全局配置操作0。Fake Docker是实际可执行Node子进程，私有containers.json只是测试engine数据，不是产品lease或状态库。所有测试子进程终态，fixture afterEach清理；无活worker/会话待恢复。

复验（先核验原接受的公开制品SHA/size，配置该既有只读入口；严禁借此运行Docker）：

```sh
I02_ACCEPTED_ARTIFACT_ROOT=/actual/accepted/public/artifact/root node --test --test-reporter=tap test/infra-runner-isolation.test.js
```

使用Node24.15.0及带拒绝器的PATH。evidence/是机器路径规范化、去显示行尾空白后的副本，不冒充raw stdout；原始argv/UTC/PATH/退出/输入SHA和完整日志在本工人树ignored .local/I02-execution-slot，精确raw/display清单见evidence-index.json。RED测试源码在ignored快照中按编辑历史恢复，并实际核对与最初记录SHA一致；重建方法及摘要单独登记，原raw不改写。

这仅组件代码/CLI进程合同作者结果。真实固定Runner image/bootstrap、独立OS/principal、物理角色程序、可信三原字节恢复及wholeI02仍UNVERIFIED；originalComet CAS、原生launch记录和最终同Run旅程仍由原owner及VERIFY实际闭合。Root双独立审查、串行接纳后才消费，不启用profile或修改任何业务phase。
