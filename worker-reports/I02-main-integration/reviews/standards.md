# I02 修订：独立 Standards 轴

**结论：PASS，仅限 construction Standards 范围；0 项必改、0 项新增阻断。whole I02 仍不接纳。** 原 P1 的完整 context 树缺口有针对性修复和独立纯 tmp 确认；不替代另一个 reviewer 的 Spec 结论。

- 候选：`636dfb83acc94e901192875c0feeec8e5f47f128`；固定点：`cbde39e6b811b94fec89fd6ae11a31b009704097`。
- 审查命令：`git diff cbde39e...636dfb83acc94e901192875c0feeec8e5f47f128`；另读 `70a2c087..636dfb83` 区分原建设与本次返工。
- 提交：636dfb8 fix(infra): reject non-manifest Runner build context paths；70a2c08 fix(infra): bind runner inputs and physical job lifecycle。开始时 HEAD 匹配、工作区干净。
- 依据：AGENTS 的范围、单主控、Node ESM/最少依赖、信任边界 fail closed、控制面与真实验收分层规则，以及当前 I02 host-port contract/报告。当前版本仍为已冻结0.4.5；本次未新增版本选择或运行前置。
- 当前 runner SHA256：`528930d243b6e45a1d0d3242cfa6e4691ac97420ff527a04217a3698c9897caf`。
- 当前测试 SHA256：`058b63279df7ce61f73f244d3e33e6d5e0734d12fc16b840a4232f653aaec6b8`。
- 新 manifest SHA256：`f6f90a5ead89966e3d66494095909e0757b2a71e668b57338276ed8fe887e886`。

## 源码与维护范围

`buildContextStatus` 是 I02 内部检查，不新增公开接口、依赖或可写状态；两个现有消费者（普通 build-plan 与 export-context）共用同一判定。只允许 manifest 的普通文件和必要祖先目录；未知文件/目录、软链（含父路径与悬空链）、特殊节点、缺文件及 hash 漂移均拒绝。打开文件使用 no-follow/non-blocking 并核打开后的 inode，目录身份做复核；fd 由 finally 关闭。冲突路径不输出可执行 dockerBuild，也不删除或覆盖未知树。

新建导出使用私有目录与 exclusive 文件写入，结束再走同一个完整树检查。源码仍明示时间点检查，未来真实构建消费者必须在消费边界复验或保护快照；它没有把当前可写目录伪装成未来永久不可变的 OS 保证。

调用者/测试/fixture 覆盖完整：新增测试复用私有 build-context fixture，覆盖额外根/嵌套文件与空目录、内容漂移、文件/祖先/context根/父/.local链接、悬空链、额外/预期文件 FIFO、缺失文件和首次导出父链接；普通 plan 与 export 都应拒绝。finally 恢复各私有冲突，afterEach清理仅本测试拥有的临时根，原始未知字节保留有断言。原精确字节/mtime幂等正例保留。没有需要同步的新 config、export 或外部调用者；没有改 shared Comet 上游正文/锁。

## 独立机械确认

本审查仅执行纯 tmp CLI 边界检查，没有跑 Docker/模型/服务或重跑全仓：

```bash
python3 /private/tmp/I02-context-standards-check-20261026.py
```

实际：首次真实 `build-plan --export-context` exit0；加入31字节无秘密 `.env` 后，第二次 exit2、`CONTEXT_CONFLICT`、不含 `dockerBuild`；未知文件原字节仍在。它直接确认原 Spec P1 的最小反例已关闭，没有修改候选或旧反例。

原始 proof：`/private/tmp/I02-context-standards-jqyy9jo9/proof.json`；SHA256：`a8e0ca5ec7a54cad7f534302de25d7d2b53ae3191fa939dc346eb1194fd47137`。同目录有原始 stdout/stderr、argv/UTC、固定源 hash 与纯 tmp 副本。

## 81/41 与历史证据

- 新 manifest **52/52** 当前文件 hash 匹配；其 **58/58** 私有 raw 索引也匹配。
- final-owned：TAP **81 tests / 81 pass / 0 fail / 0 skip**；final-related：**41/41 / 0 fail / 0 skip**。metadata 输入前后相同，13个源输入逐一匹配当前候选；两组 raw/display hash 与记录一致。
- 旧 manifest 保持原70a2快照：**116/116** 对 `git show 70a2c087:<path>` 字节匹配；旧 **221/221** raw hash匹配。旧报告/manifest/证据文件在70a2→636diff未改写。旧 manifest 中 runner/test 指向旧 hash 是正确的历史记录，新CURRENT指针已经区分当前候选。
- 81/41依然是作者自检，不能记成独立业务验收。owned guard调用0；related的Docker9/gh2均为离线拒绝guard，不是当前真实资源成功读回。
- `git diff --check` 对源码、测试、infra config范围通过。全范围在保留的原始/显示TAP失败日志中报告 trailing whitespace；这是工具输出/证据字节，未要求重写被冻结日志来制造整段无告警。

## 固定物理边界与未验风险

本次未改 `createCliJobDriver` 的固定注册三口、job字段约束、签名绑定或 image/mount/环境来源；没有新增 phase/DAG/队列/重试或另一主控。host-port contract仍把当前资格、可信注册与实际结果来源交固定 P1_3 host核实，进程结果仍是 `component/physical-process` / `managedClosureEligible=false`。HMAC/标签/fixture只是绑定机制，不证明真实独立 principal、方法送达、OS或渠道隔离。

当前镜像/真实Docker资格未执行，upGate仍关闭。真实Role/OS/ACL/Edit-Shell-MCP正负链、复制state/并发writer/死亡恢复、真实宿主与知识/平台义务保持UNVERIFIED。本Standards结论不勾task、不更新台账、不启用profile、不授权build/pull/start/stop，也不因0.5研究改变当前0.4.5路线。

未发现需要本轴再要求修改的明确标准违例或有收益的结构重构；不为风格拆出新通用框架。未验证项如上，主要剩余风险是将时间点/fixture证据提升成真实运行隔离结论。
