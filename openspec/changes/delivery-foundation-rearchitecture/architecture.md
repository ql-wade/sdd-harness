# 实施证据与接口登记


权威设计仍是 design.md、delivery-architecture.md 与 ADR-0019；本文件只是实现输入与接口登记，不另建工作流。原 tasks.md 父任务身份及依赖继续保留。用户已授权端到端实施与验证；R10 A 已确认。三方同摘要独立共识已通过，允许按既有任务分批实施；实际运行/角色隔离仍需后续验收。

## 已获得的源码与构建事实

Comet 0.4.5 精确提交 c90af44a4474662d7853aae76ce785404974fb0a；源码归档、package、锁文件摘要见 toolchain-baseline.json。原源码在隔离工作区使用 Node 24.15.0、pnpm 10.18.3，以 frozen-lockfile/ignore-scripts 安装后实际 build 成功；这仅证明可构建，不证明目标门禁存在。模块独立摘要见 comet-source-seams.json。

拟采用 integrations/comet/upstream.lock.json＋有序源补丁，工具仅下载/校验/准备/构建 Comet 原运行时；构建工作区在被忽略的 .sdd/vendor/comet 下。不得修改全局 CLI、插件缓存或用新守护进程接管运行。该落点已按架构批准后的1.1.c冻结；实际补丁和运行启用仍逐项审查验收。

## 必须保持的接口边界

| 边界 | 输入/输出与必须覆盖的事实 | 原任务 |
| --- | --- | --- |
| Comet Run 持久化 | 在既有 RunState 增加版本化 managedDelivery；同时覆盖 engine types/state/storage-run、classic-store checkedRun 的严格字段与恢复；复用原锁/事务，不加 currentPhase | 2.4 |
| managedDelivery | 固定 policy/输入摘要、义务、已接纳回执及原 operation 的 job/attempt/epoch/owner；派发仍复用原 Run pending/currentStep/status | 2.4、4.6 |
| 纯 SDD gate | 输入当前声明基线、必需检查、回执和受保护派发来源；输出判定/拒绝原因，不保存执行阶段、不派发 | 2.1、2.2 |
| 真实命令入口 | guard、直接 transition、hook 写入、next/resume、archive 使用同一谓词；生成的宿主脚本也必须覆盖 | 1.5、2.4 |
| 可信执行身份 | 启动器先登记 run/gate/input/policy/attempt/epoch；只接纳与真实派发绑定的独立结果，不信作者自填角色/摘要/pass | 2.2、2.4 |
| Runner 隔离 | 控制文件/签发权限由受管主体持有，worker 不可写；hook 的 .comet 广泛白名单不能作为认证。相同无沙箱 OS 主体自签不能证明角色独立 | 1.3、3.1、4.7 |
| 规格/知识收尾 | archive 事实与 completed 分离；Kp 卡归档，Kt 卡整体完成；R10 A 下未 completed 不清唯一工作区 | 3.4、4.4、4.6 |



## 测试边界与首个纵向切片

沿用已批准的公开测试边界：纯检查函数/CLI、真实 Comet CLI 与生成脚本、真实 OpenSpec、受管 Outline/平台 API；不因现有函数返回 pass 就改变业务 oracle。第一切片先以缺 R 回执的真实 open-complete/guard --apply 验证原生状态会推进，再通过源补丁阻断，并独立读回同一 Run。序列化/事务恢复和所有绕行入口是必要回归。测试作者产物不能签最终业务 PASS。

现有 project-test-gate 接受 exit 0，generation-gate 接受文件增量，均只能保持原证明范围；新 Gate 不把这些结果提升为有效测试分母或独立验收。源树摘要不能只枚举 src，必须覆盖冻结清单内源码、测试、锁文件、配置、迁移和正式工件；正常 checkbox 勾选与任务定义分开。

## 启用前仍需实证

可信 Runner 主体/worker 隔离的真实配置、精确执行事件协议与检查器版本、实际试点/Outline/权限 owner 及 CI 管理入口未登记。缺失不以本机 schema、签名夹具或 mock HTTP 代替；相关验收保持 required/未通过。高层接口、检查清单和92场景分母已进入结构化执行锁；具体实例和信任配置仍是启用门禁，结构 handoff_ready 不代表已实现或可越过门禁。

## 首个源码准备切片（1.1.c，已选公开边界）

锁文件为 integrations/comet/upstream.lock.json，固定 npm 产物、精确提交、源码归档 SHA256/大小和工具链；项目自有源补丁保持独立，pristine 上游不混入业务逻辑。

公开接口：prepareCometSource({ projectRoot, lock, archivePath })。只在该项目 .sdd/vendor/comet/<commit> 下准备上游源码；不安装全局工具、不推进 Run、不调度角色。首个用例先拒绝错误归档摘要，并证明未留下目标目录。后续纵向增加有效归档、目录穿越/链接拒绝、完整基线摘要与缓存漂移拒绝；每片单独记录 RED/GREEN。


## Schema2候选接口与执行登记

本文件仅是权威design及已审查源码seams的机械登记；不取代ADR或规格。精确补丁分发落点如下，pristine上游和项目代码分离：

- integrations/comet/upstream.lock.json
- integrations/comet/patches/0001-matt-method-profile.patch
- integrations/comet/patches/0002-managed-delivery-runtime.patch
- integrations/comet/patches/0003-post-archive-closeout.patch

RunState扩展必须同时经过 engine/types、state、storage-run，以及classic-store.checkedRun；只在types添加字段会在恢复中被丢弃。Run-only更新用原atomic writer，YAML+Run遵从原事务commit point。受管控制文件和worker必须使用真实OS/container隔离；hook及同主体签名不能证明独立。

冻结接口：
- Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase
- SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch
- Knowledge.Closeout.v1: Kp before archive, Kt before overall completion
- Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state

执行合同使用92个单场景可执行检查；未实现的 runner命令仅是计划，不算已执行。每个case要实施实际WHEN动作并以THEN读回作为oracle，拒绝零测试、未授权和缺能力的假绿。

归档协作说明：shared helper仅作为静态freeze/校验/预演方法；本候选不授权它接管业务状态或实际finalize。正式产品closeout必须经同一Comet Spec Adapter完成，保留单写者与归档后readback。

## 源码准备/构建接口增量

- Comet.SourcePreparation.v1: prepareCometSource({projectRoot,lock,archivePath}) returns canonical pristine source and verified provenance
- Comet.DistributionBuild.v1: buildCometDistribution({projectRoot,lock,archivePath}) returns buildRoot, entrypoint, sourceCommit, fingerprint with exact toolchain precondition

仅增加1.1测试文件归属与既有构建工具的公开接口，不改变92场景或Runtime所有权。构建不匹配固定Node/pnpm时先拒绝；合成测试验证门禁，真实上游构建另证。

## 基础设施交接增量

I01–I08 的文件归属、接口、RED/GREEN、秘密引用、恢复和资源资格详见 infrastructure-plan.md 与 infrastructure-tasks.json；它们已合入同一 task-dag.json，不是第二套调度/进度。无镜像摘要、真实owner或授权的组件不得启动。静态校验工具快照在 planning-toolkit，方法完整分发由原 P1_6 完成，禁止调用旧 Superpowers planner。

## 2026-10-22 环境能力裁决（amendment 3）

- SDD 分发项目化（用户裁决）：SDD_HOME=<repo>/.sdd；llmwiki 克隆（pin 075c5b4）/venv（.sdd/venvs/llmwiki-311）/wiki 数据根全部项目内解析；启动器按 $SDD_HOME 解析，语义不变；消除跨项目目录名撞根。
- Docker 经终端面板通道（能力实测）：daemon 运行中（server 29.6.2），会话 Bash 沙箱拒 socket（EPERM）；I02/镜像/Outline 栈的 docker 操作走用户可见的终端 tab 通道执行并留回执，沙箱内不伪装可达。
- 环境门控纪律不变：缺资源=未满足前置，UNVERIFIED 不转 PASS，holder 登记。

## 2026-10-22 七P1返工准则（本轮优先）

仅沿用已冻结的Classic同Runtime受控扩展路线；官方overlay仍为未接纳候选，不混用缺失的overlay设计/预研路径。架构选择不在本轮重新投票。审查依据docs/research/2026-10-22-delivery-implementation-grill.md；当前f4afe05与旧测试基线68f7963的实现目录已提交内容相同，工作区既有架构/config改动保留不覆盖。

R前置必须覆盖进入正式设计；A消费实际grill闭合与精确全票共识，T消费独立测试设计审查。dispatch号与role文本不构成可信结果；原Run事务内保存单调revision和失效代际，旧字节还原不复活旧批准。observer不写phase/不恢复业务，以必需目标断言和typed终态读回判断，组件绿不关闭跨边界旅程。

Runner镜像必须消费当前完整有序补丁和正确构建根/入口，真实角色隔离后才称受管。实际Comet进程故障、归档后同Run Kt恢复、真实Outline写入/资源隔离及外部告警分别实证。产品Run归档是旅程内阶段，本迁移Change归档是VERIFY之后的控制器closeout，避免自依赖。完整118required检查与92原场景保持，holder不豁免。

冻结接口增量：
- SDD.Verification.Journey.v2: observer requires exact targets and typed terminal readback and observes real Comet Run without controlling phase or recovery
- Comet.GateRevision.v2: same Run persists monotonic requirement and design revisions and trusted reviewer result binding and never revives invalidated receipts by restoring bytes
