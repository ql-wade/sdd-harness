> 激活说明：旧 openspec-strict.txt 属于前一候选，仅保留历史。当前合同的验证以 validation-evidence/commands.json 和 independent-review/ 为准。

# P1_2 ← P2_4 离线冷导出依赖候选

本目录是主检出唯一 DAG 的隔离候选，不启动业务或改变主检出。`before/` 保留原计划及原始状态、ledger 和双份取样时刻；`amendment.json` 记录精确原始/候选摘要。

- P1_2 增加 P2_4 依赖，原 P2_4 先行一波、P1_2 下一波；所有依赖均处于前波，39 节点、69 工作包、104 场景、130 检查与 67 条原子义务保留，本期 129/103 和 F10 正向另期/NOT-EXERCISED 不变。
- 限定边仅供私有隔离的离线 Foundation 冷导出及恢复验证；消费前须重新核查本合同、P2_4 内容摘要 `8e73083389637cc42d045246d057934517a89c7a465a2cc8345d39830028761f`、源码、编译清单和独立审核。它不是 P2_4/P3_1 接纳，不传递给 P1_3；禁止真实项目安装、产品 Run、发布和外部副作用。
- 原 eb1 合同的五条 construction admission 改作历史证据，候选状态全部失效；P0_1–P0_4 规划审查待当前合同重审。原状态/记录保留，不能将规划有效视作正式 A 门或产品 PASS。
- `validation-report.json` 是 plan_guard exit 0 的原始输出；`openspec-strict.txt` 是锁定 OpenSpec 1.15.0 strict exit 0。renderer 曾因输出在计划目录外拒绝，重试在计划目录内 exit 0；生成文档仅为 `renderer-diagnostic.md`：默认自动 20 分钟定时与用户已停止监督及 30 分钟自动审批拒绝冲突，故没有覆盖现有手工 execution-prompt、没有启动定时。
- 复制期间状态及 ledger 发生变化：最新快照复核后存入 `before/`，原先复制版以 `.initial-copy` 保留；集成前仍须由唯一控制器重新核对当前状态和所有 worker 句柄，避免覆盖新增记录或重复派发。已有 8e 包的组件审核不构成新合同下此消费者的准入。

追加修订：P0_1–P0_4 的当前修订 Step 7/8 均恢复为未完成；各节点旧 consumer_allowlist、construction_readmission 和历史宿主准备资格均移入 historical 字段，活动名单置空。不得读取/输出凭据或业务资料原件；未资格化的真实 MCP 只用合成 fixture，真实材料未验。

验证原始命令、进程号、退出码及 stdout/stderr SHA 见 `validation-evidence/commands.json`。`renderer-raw-output.md` 是上游模板原文，严禁执行；`renderer-diagnostic.md` 为禁止执行声明。
