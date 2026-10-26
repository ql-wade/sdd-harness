# P1_3 worker report — 原生宿主命令、技能与实际执行接线（0.5.0 改写）

- 修订：`2026-10-26-comet-050-adoption-v1`（ADR-0022）
- 钉版环境：node v24.15.0（`~/.nvm/versions/node/v24.15.0/bin`）
- 基线：upstream.lock.json = 0.5.0 / commit `aeb1a659…` / `patches: []`；构建
  `builds/29f2332b…`（distribution.json 校验通过）
- RED 记录：`evidence/red-baseline.txt`（原始输出 + exit 码）
- GREEN 记录：`evidence/green-summary.txt` + 逐套件全文
- 全量 check.sh（诚实记录，含既有失败归属）：`evidence/check-sh-full.txt`
- 差异：`diff.txt`

## 1. 目标与完成范围

把 P1_3 的宿主接线从 0.4.5 六补丁链（0002 注入端口）改写为 Comet 0.5.0
原生组合应用面，并以构造/路径/命令断言为 oracle（不要求真实宿主执行，
UNVERIFIED 项如实标注）。完成：

1. `lib/adapters/comet.js`（重写）
   - 状态文件双名制：`resolveChangeStateFile`（`comet-state.yaml` 0.5.0 默认
     + legacy `.comet.yaml` 兼容读；两者同存 → `WORKSPACE_STATE_CONFLICT`；
     symlink/目录 → `WORKSPACE_STATE_INVALID`；镜像上游
     `classic-state-file.ts` 语义，只读不写）。
   - `describeWorkspace` 增 `changeStateName/changeStateLegacy/
     changeStateDefaulted/checkPolicyFile`。
   - 组合包命令构造面：`applicationInstallArgv`（`comet application install`
     全部官方旗标，越界即拒）、`runtimeDispatchArgv`（组合 Run 唯一入口，
     拒绝 `--application`/`--workflow` 第二选择器）、
     `RUNTIME_REQUEST_OPERATIONS`（上游 operationFields 白名单）、
     `classicCompositionStartRequest`（runId===change、changeDir 双根校验、
     workflow `comet-classic-full@1`）、`classicCompositionRecoveryRequest`
     （只构造 next|inspect 只读恢复）。
   - check-policy v2 命令身份：`selectCheckPolicyCommand`（COMMAND_KEYS 形状、
     version-2 只允许 version+commands、argv+cwd 恒等匹配、歧义拒绝；
     entryDigest 归上游，不伪造）。
   - 0005 Kt 读侧谓词：`knowledgeCloseoutBlocked`（fail-open 默认，仅
     `required===true && completed!==true` 阻塞；与补丁逐字同义）。
   - `readArchiveSeal` 改读 0.5.0 `state get` 的 `data.fields`（stdout 兜底；
     实测 envelope 形状记入 host-probes）。`sealCloseout`/F07 authority/
     `probeWriteChannels`/`evaluateGate` 保留。
2. `lib/adapters/comet-executor.js`（重写）
   - 0002 注入端口（`runClassicCli/ensureClassicRuntimeRun/
     installManagedDeliveryHost`）→ 0.5.0 面：`native.runCometCli` 单一 CLI
     端口；registration 强制 `runId === change`（上游不变量）且
     `applicationFile` 必须是打包组合包的 `application.json` 规范位置。
   - 组合包接线只读 `composition.json`+`extensions/*.json`（不二次声明），
     六门映射 R/A/T/P/V/Kp 与 validator ref 由包派生；`runtimeAccepted:false`
     如实透出。
   - `installApplication`/`dispatchRequest`：构造官方 argv 并经端口执行；
     编译波未产出 `application.json` 前 → `APPLICATION_PACKAGE_REQUIRED`
     （UNVERIFIED 边界，CLI 零调用）。
   - 六门扩展回执：`acceptGateReceipt` 先镜像领域包膜前置绑定（verdict/
     sourceHash/artifactHashes），再经打包 `bindings.mjs` validators（纯
     SDD.Gate.v1 委派）判定，无任何兜底接受；跨门重放/缺 payload/覆盖缺口/
     篡改回执全部 fail-closed。
   - 签名作用域 [reuse 0.4.5-candidate]：`issueDispatch` 仅在
     `nativeCall` 作用域内、且存在同 run/同门/同 inputDigest 的已判回执、
     且 change 目录 `.comet-state.lock` 存在时签名。
   - Kt：`ktCloseout` 走 0005 谓词（状态字段），writePath 显式 UNVERIFIED。
   - 引导 main `runCometHostMain`：只转发注册包的 `runtime dispatch`（请求
     校验先于包存在性检查；基础 state 写命令一律
     `NATIVE_COMMAND_SCOPE_REQUIRED`——0.5.0 本就拒绝组合 Run 走基础命令）。
3. `mcp-capabilities.yaml`：llmwiki 增 `enforcement: "hook:kb-write-protection"`
   （ENFORCEMENT_PAIR_ROUTED 路由到本波次重做；P1_2 已交付 hook 侧 canonical
   落点覆盖）。`tools/register-mcps.mjs` 再生成 `.mcp.json`（无变化——注记不
   影响注册视图）。
4. foundation 机械重导出：按 P1_2 报告 §5.1「最后落盘波次必须重跑 export」
   规则执行 `foundation-export.mjs export --release-commit 9e822e45
   --freeze-baseline`（`foundation-lock.json`、`release/mcp/mcp-capabilities.yaml`
   、新基线 `788d2c9c…`；`verify` 通过，drift gate 回绿）。未触碰 hooks.yaml
   与 hook 策略。
5. `host-probes/1_3-050-surface.json`（新）：登记 0.5.0 表面事实（live build
   实证 + pristine 源出处）与 4 项 UNVERIFIED（组合包编译/install、真实 Run
   内 dispatch、0005 落入重建树 + Kt 写路径、基础 state 命令在真实组合 Run
   上的拒绝——当前仅源推导）。

## 2. 测试改写

- `test/comet-driver.test.js`：保留全部既有断言（0.4.5 stdio 会话候选 + runner/
  closeout/gate oracle），追加 7 个 0.5.0 面 test（双名解析含冲突/symlink、
  describeWorkspace 新键、install/dispatch argv 构造与拒绝、start/recovery
  请求契约、check-policy v2、0005 真值表）。
- `test/comet-execution-binding.test.js`：完全重写为 0.5.0 面 21 test——构造
  拒绝（含 0002 端口不再满足 NATIVE_PORTS_REQUIRED）、组合接线只读打包声明、
  install/dispatch 构造与编译波缺包拒绝（CLI 零调用）、六门回执经 bindings
  validators（真实 admitEvidence 载荷通过；重放/缺口/结构拒绝）、签名作用域、
  引导 main 只收 scoped runtime dispatch。
- `test/delivery-cases/1_3.mjs`：setup 改为 0.5.0 身份（版本/commit/patches==0，
  六补丁栈永不满足）；布局断言改双名制（init 前默认 `comet-state.yaml`，
  非 Git scratch `state init` 后 live 事实为 legacy `.comet.yaml`；两文件同存
  拒绝）；状态读取经 `describeWorkspace().changeStateFile`；新增组合面 test
  （构造 + 真实 CLI 对缺失 application.json 的 dispatch 拒绝 = UNVERIFIED 边界
  的 live 证明）。lifecycle/门禁/通道探针/单主 closeout 断言保留并全部在
  0.5.0 live build 上通过。

## 3. 旧候选处置清单（9 文件）

| 旧候选 | 处置 |
| --- | --- |
| `lib/adapters/harness.js` + `test/comet-driver.test.js`（d4de546 registry 树：connect/ready/begin/startPolicy 会话语义） | **保留**（0.5.0 无关的宿主 stdio 会话层，随本波次一起验证 121/121 绿；来源在文件头与 diff.txt 注明） |
| `lib/adapters/comet-executor.js` + `test/comet-execution-binding.test.js`（ab90cc2+74607cc delivery-contracts 树：同 Run active/archive 跟随、锁检查、0002 gate_dispatches 端口） | **丢弃其 0.4.5 拓扑**（0002 注入端口、gate_dispatches registry、Docker CliJobDriver 物理协议、spec.js readRunContext 依赖）；**复用其语义**：签名作用域（judged 回执 + 状态锁 + 同 run/门/input 绑定）以 `[reuse 0.4.5-candidate]` 注明重写进 0.5.0 面 |
| `lib/adapters/spec.js` + `test/spec-closeout.test.js`（候选 diff） | **未触碰**（非本任务 Owns；其 `readRunContext` 增量是 0.4.5 候选的一部分，我的重写不再依赖它） |
| `tools/infra/runner.mjs` + `test/infra-runner-isolation.test.js` + `infra/delivery/runner/image.lock.json` | **未触碰**（已退休 Runner 镜像拓扑，待其返工波次；对本波次改动前后失败集完全一致） |

## 4. 真实执行的验证命令与结果（钉版 node v24.15.0）

| 套件 | 结果 |
| --- | --- |
| `node --test test/comet-driver.test.js` | 121/121 pass，exit 0 |
| `node --test test/comet-execution-binding.test.js` | 21/21 pass，exit 0 |
| `node --test test/delivery-cases/1_3.mjs` | 10/10 pass，exit 0 |
| `node --test test/comet-method-binding.test.js`（相邻） | 9/9 pass，exit 0 |
| `node --test test/foundation-distribution.test.js`（相邻，重导出后） | 61/61 pass，exit 0 |
| `node --test test/knowledge-closeout.test.js`（comet.js 消费者） | 20/20 pass，exit 0 |
| `node tools/register-mcps.mjs` | 注册 4 MCP，`.mcp.json` 无变化 |
| `node tools/foundation-export.mjs verify` | 一致，exit 0 |
| `bash scripts/check.sh` | exit 1 — 全部为既有失败（stash 本波次文件前后失败集逐套件相同：comet-security-backports 3、comet-flow-acceptance 3、classic-integration、infra-runner-isolation 32；属 0.4.5→0.5.0 返工债与已退休镜像套件，归属与证据见 `evidence/check-sh-full.txt` 尾部归属段） |

RED（改写前现状，原始输出见 `evidence/red-baseline.txt`）：
- driver 114/114（旧候选下绿）；execution-binding 60/60（对旧 0.4.5 vendored
  运行时绿——0.5.0 锁下面临报废）；1_3 8/9，setup 断言六补丁栈 0!==6 为真实
  RED，其余 8 项在 0.5.0 build 的 compat classic 面上恰好仍通过。

## 5. 未验证项（UNVERIFIED，归后续波次）

1. 组合包经官方 compiler 的编译（`application.json`+manifest+内嵌 bindings）
   与 `comet application install` 真实安装 → 供给波次（ADR-0022 迁移序）+ P1_4。
2. `runtime dispatch --application-file` 在真实 Run 内的行为（扩展阻塞、返修
   路由、归档期 validateOutcome 复验 Kp）→ P1_5 装配 + P3_2 + VERIFY。
3. 0005 补丁落入重建树（Kt 同 Run 停靠 `<profile>.archive.execute`）与
   `knowledgeCloseout` 状态字段**写路径**（wire keys + 受管接纳）→ 供给/接纳
   波次；P3_4/P4_6 恢复旅程。
4. 基础 state 命令在真实组合 Run 上的 live 拒绝（当前为 pristine 源推导，
   见 host-probes unverified[4]）→ P1_4 模式资格。
5. 真实宿主执行/模型调用/MCP 启动：本波次零次发生（边界遵守）。

## 6. 风险与需人工确认

- foundation 重导出新增基线目录 `788d2c9c…`（冻结规则产物）；若有并行波次
  在集成提交前再落盘 Owns 源，需按同规则再次重导出（P1_2 §5.1 既有规则）。
- `1_3.mjs` 组合面 test 在编译波产出 `application.json` 后会走 else 分支打印
  重导基线提示——届时该 test 必须由 P1_4 改写为真实 install/dispatch 旅程。
- `test/comet-driver.test.js` 仍包含未接纳的 0.4.5 会话候选 diff（保留决策见
  §3）；若协调者最终拒绝该候选，需同步移除 driver 中对应会话 test 与本波次
  追加部分共存的部分（追加的 0.5.0 测试独立于会话候选）。
