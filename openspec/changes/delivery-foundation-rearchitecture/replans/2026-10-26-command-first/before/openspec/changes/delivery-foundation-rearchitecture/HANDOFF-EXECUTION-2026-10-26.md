# Comet AI DevOps 重构：执行交接

交接日期：2026-10-26，上海时区。本文是同一 Change 的接手检查点，替代此前 HANDOFF 中过时的“当前进展”，不创建新计划、DAG 或验收口径。

本文相对文件路径均从主检出仓库根解释。冻结恢复清单为 `worker-reports/Root-handoff-20261026/snapshot.json`；接手者先核实际字节，不凭文档假设工作树未变。

**结论：方向沿用已批准架构；基础代码、适配器和 Runner 已有实质建设与组件证据，但真实角色、知识、权限和平台尚未贯通。目标未完成。最新未插桩总检查仍失败，不能从诊断轮绿色或旧报告推导交付完成。**

用户现在要求把总结交给其他 Agent 执行。原控制器停止新派发，现有工人只保存现场。接手者继续下列唯一计划；接手前核对实际句柄及所有权，避免两个控制器同时写状态。

## 1. 保持不变的架构与完成边界

| 层次 | 已确认职责 |
| --- | --- |
| Foundation / TeamAI | 分发固定资产；不调度业务阶段、不签完成 |
| Comet Classic | 唯一业务主控，拥有原 Run、状态、派发、返工、恢复和收尾 |
| OpenSpec / Git | 正式需求、设计、测试意图、任务、决策与版本权威 |
| 方法技能 | Matt 方法；grill-me、consensus、test-authoring、tdd、code-review、whitebox-verify 各守其职责 |
| Runner / Gate | Runner 执行；Gate 判断可信证据；二者不创建另一套阶段状态 |
| LLMWiki | 单项目 Agent 的精华知识，不收整仓代码、不承担团队 ACL |
| Outline | 经审查的团队知识、跨项目经验、源权限与受众控制 |
| deepwiki-open / Code Graph | 前者自托管代码 Wiki；后者可选结构与影响面事实，不代替正式设计或知识发布批准 |

继续保留原生五阶段。用户可直接选择阶段，自动推进也必须显示当前子步骤、证据和阻塞原因。下列绑定是目标合同，尚未全部真实接通：

| 原生阶段入口 | 内部步骤与配合 | 硬门禁 |
| --- | --- | --- |
| `/comet-open` | R：需求澄清，grill-me，确认目标/范围/AC/非目标 | R 通过才进入正式架构 |
| `/comet-design` | A：架构作者＋grill-me＋独立 consensus；之后 T：test-authoring 测试设计＋独立审查 | A、T 分开留证和放行，不能混成一个设计通过 |
| `/comet-build` | P：只做计划；随后测试自动化、TDD Builder、独立代码审查 | 唯一 tasks/DAG；真实 RED/GREEN；测试作者、Builder、Reviewer 分离 |
| `/comet-verify` | 独立 Whitebox 完整旅程验收 | 同候选、实际执行、真实终态；局部或结构检查不能代替 |
| `/comet-archive` | Kp 作者→独立审查→项目写入/读回；原生规格归档；Kt 团队发布/读回 | Kp 阻归档；Kt 可在归档后同 Run 恢复，但阻整体 completed |

`/comet` 用于配置路由和恢复；阶段入口不能跳过前置 Gate。R/A/T/P/V/Kp/Kt 是原五阶段内的义务，不新增 `/sdd:*` 或另一套阶段引擎。本文提到 Native API/Native kernel 是“原生内核接口”，不表示改选 Comet Native 工作流。

需求或设计变更使全部下游证据失效；恢复旧字节不能恢复已经失效的批准。发布后权限事件＋周期核验仍由同一 Comet 引擎处理隔离/重试/补偿；采集器只提供事实、监控只报警。

当前钉定 `@rpamis/comet 0.4.5`，源码 `c90af44a4474662d7853aae76ce785404974fb0a`。官网已介绍 0.5，但本轮没有升级决定，不能套用新版 API 或迁移旧 Run。官方依据：[Classic](https://docs.comet.rpamis.com/zh/concepts/workflow)、[Design](https://docs.comet.rpamis.com/zh/phases/design)、[SDK 边界](https://github.com/rpamis/comet/blob/master/docs/architecture/sdk-getting-started.md)。实际实现以钉定源码及本仓库受控补丁为准。

## 2. 唯一计划、工作目录和当前统计

主检出／控制器写点：`/Users/mac/Code/sdd-harness`。**不要在启动时的 observer 工作树或 festive-cohen 会话壳里做控制器集成。**

唯一计划根：`/Users/mac/Code/sdd-harness/openspec/changes/delivery-foundation-rearchitecture`。先读 `AGENTS.md`，再读当前收敛架构、ADR-0019/0020、`tasks.md`、`task-dag.json`、`execution-contract.json`、`execution-state.json`、`execution-ledger.jsonl` 与本交接的原始证据。

- 原记录：39 节点、30 父任务、69 工作包、104 场景、130 检查，全部保留。
- 当前：6 节点接纳、32 待办、1 明确另期；本期 129 required / 103 场景。
- F10／P5_2 跨机器 Control API 正向由人明确另期，保留 NOT-EXERCISED；未启用负例不能算正向 PASS。CLI＋固定 Runner、知识、权限、平台与恢复义务不减少。
- 本期真实业务场景验收数仍为 **0**。组件／fixture／构建通过不累加为业务验收。
- 契约 SHA256：`a3cf328a8e46e0f48aa8420257aacf275b41aad6d3bdd6406f4f0e83aabc87ad`；接手重新运行 plan_guard，不静默刷新锁。

文档准备前主 HEAD 为 `6596bad`，此前 `6f1fda0` 保存完整 Runner 构建证据，产品代码基线 `1f6ec33`。文档提交本身会推进 HEAD；准确版本看 `git log`。主检出已经应用下节九个源文件差异，但**尚未提交或接纳**，不能再次盲目 cherry-pick。

未接纳源文件的恢复补丁和逐文件 SHA：`worker-reports/Root-handoff-20261026/pending-source.patch`、`snapshot.json`。只在确有丢失且目标基线匹配时恢复，不覆盖现有同名改动。

另有用户原有改动，保留不覆盖：`docs/architecture/adr/0019-delivery-foundation.md`、`docs/architecture/delivery-architecture.md`、`test/delivery-cases/2_2.mjs`；`.codex/`、旧 research、`draft_c237fbf6_folder/`、`init/` 等不属于本次清理。不要全量暂存、重置或清理旧工作树。

## 3. 已完成的建设、尚未接纳的候选

### 已保存的基础建设

仓库已有 Foundation 分发/防再生、方法 profile、Gate/Audit、Runner execution slot、原生 Run 补丁、Host/Spec/架构审查适配器，以及 LLMWiki、Outline、代码知识、平台和运维相关模块与组件证据。这是后续实现基础，不是可用团队 AI DevOps 的完成声明。事实来源在 `worker-reports/`、当前原始台账及各基础设施域；不要继承早期“40/40”“全部 PASS”等结论。

本轮已明确完成：

1. **完整 Runner 镜像构建与隔离工具链读回。** 原冻结 D/E 真实 exit0；镜像内实际执行 Node24.15.0、Python3.12.15/PyYAML6.0.3、Git2.39.5、pnpm10.18.3、OpenSpec1.11.0、Comet0.4.5。非 root UID10001、无网络、只读根文件系统；缺受保护 bootstrap 时入口真实拒绝。证据：`worker-reports/Root-I02-full-runner-build/REPORT.md`。
2. **构建配方注释绕过已修。** 完整可执行模板由受保护 CODE 校验，不把“注释里出现安装命令”当作具备构建行为。已双审并集成 `1f6ec33`，当时原总检查1104/1104；该历史结果不覆盖后来的新源字节。
3. **Host 两项候选已双审、主关联240/240。** 见下表；因最终原总检查仍失败，暂不接纳。

旧镜像本地 config ID：`sha256:fad4c6a6ee25a0c65a0c665a7599d2b192ebe42e9bb490b2702c0fd1e718736c`；SDK `3056292584ad17c49080c7504c1a689f1a382012e708665a8f12069d75a12a69`，bootstrap `55ac772e81495c5575ccae0dacb9ef7ff140383b10d9516b39f3885ab93fb9f3`。RepoDigests 为空，不是 registry manifest digest。**它不包含当前未提交 Host 与未合入知识修复，最终必须重建。** Root 能执行 Docker 不证明 Claude 新会话也取得了相同能力。

### 当前工作树／候选

| 工作树 | 准确状态 | 后继动作 |
| --- | --- | --- |
| `comet-registry-qualification/sdd-harness` | `d4de54683c48e6ec12d2afa5af73dee93b7f1315`，clean；生命周期候选已双审 | 主检出已有准确源差异，先关闭总检查问题再决定接纳 |
| `comet-delivery-contracts/sdd-harness` | `74607cc93e8d8f566db74013aa9414cba1ecc48b`，clean；ab90cc2 产品修复＋仅诊断消息增强 | 主检出已应用；没有改原预期/时限 |
| `comet-observer-qualification/sdd-harness` | 外层 `d0b0d07302e1732463179130c9824b3ef6ced69c`，dirty；新知识代码只在私有 SDK/未应用 delta | 读取本目录 R3 检查点，不把私有 delta 当已合入 |

以上树的共同前缀是 `/Volumes/mac-extend/codex/worktrees/`。旧 `comet-runner-toolchain-bootstrap` 分支和 D/E ignored 目录保留，禁止清理。

主检出九个未接纳文件：`lib/adapters/{harness,comet-executor,spec}.js`，`infra/delivery/runner/image.lock.json`，`tools/infra/runner.mjs`，`test/{comet-driver,comet-execution-binding,spec-closeout,infra-runner-isolation}.test.js`。

生命周期修复：connect/ready 与 begin 分离；initialize-only 拒绝 turn，空动态工具集真实为空。独立审查曾复现 capture 上限触发 UNKNOWN 后又被写回 INITIALIZED 的 P2，已最小修复，原反例重放通过；作者114/114＋相关52/52。原105/111失败、111/111支持和拒绝记录全部保留。

归档路径修复：唯一 `SpecAdapter.readRunContext` 复用原 location 与原 Native 解析，返回同步 assertCurrent 闭包；Host 读、意图和签发锁检查沿真实 active/archive 目录，拒绝串 Run／位置竞争／完成态／锁软链。补齐固定 spec.js 的 bootstrap 清单和精确允许列表，作者207/207＋装配3/3。两候选独立评审及原始探针已保存在 `worker-reports/Root-P1_3-host-components-integration/reviews/`。

## 4. 最新验证：仍有失败，不得覆盖

完整原始证据：`worker-reports/Root-P1_3-host-components-integration/REPORT.md`、`root-runs/`。全都保持原断言、每项 deadline 和外部拒绝器，不是实际平台调用资格。

| Root 运行 | 实际结果 |
| --- | --- |
| 关联 public seams，40328 | 240/240，exit0，零跳过 |
| 初次原 check，26994 | 1164项，1162通过、2失败；missing-manifest子例及父项，先返回 OPENSPEC_INPUTS_UNVERIFIED |
| 限定诊断轮，93429 | 1164/1164；63次 Python 检查均成功。只是插桩轮，不覆盖原失败 |
| **最后未插桩原 check，94581** | **1164项，1161通过、3失败，exit1，零跳过** |

最后三项：I06 `legal queued/null metadata...` fixture 的 `GET user` 在约2003ms TIMEOUT，返回 OPERATOR_IDENTITY_UNVERIFIED；Runner `extra special FIFO` 在 mutation 前的初始验证返回 OPENSPEC_PACKAGE_METADATA_UNVERIFIED；其父项随之失败。尚未确认共同根因，不归因于权限不足、睡眠或云端执行。

另一个独立工作树确实捕获过 Python 包检查5003.997ms ETIMEDOUT，但不是主失败同次；初次主窗口没有 Sleep 事件。不得拿“耗时接近超时”或一次重跑绿色当因果证明。诊断探针仅曾临时放在准确 build-plan 子进程，已逐字恢复，没有全局 NODE_OPTIONS。不要放宽5000ms/2000ms/3s、接受任意UNVERIFIED或移除用例凑绿。

## 5. Core 知识链和 CLI 接线的真实检查点

### P2_4：知识 CODE／来源，仍未合入

源检查点：observer 树 `worker-reports/P2_4-native-fixtures-r2/`，主检出已逐字保全到 `worker-reports/P2_4-knowledge-R3-handoff/`（含67个冻结文件）。先读其中 `R3-PROGRESS.md` 和 `R3-HANDOFF-MANIFEST.json`。当前外层0002 SHA为 `11274049cf48408769bea8b9ed0228cf14c838d1ac9e4bbf59e56f7f3bdee6ee`；新知识改动在 `full-knowledge-delta-r3.patch` / `full-knowledge-delta-sdk-r3.patch`，后者SHA为 `07da435689715239b3aa99e08968489d2a5dfc3f0da1fdc70d3b7656ce5f1cf8`，不能直接应用到任意 SDK。

已实际证明的机械行为：没有正文、没有预知 digest 时可领取作者动作；真实 Node CODE 从原 R/V 已认证输入生成新正文，collection 后冻结摘要，再准备独立 review。已实际证明 writer一次／写入一次，之后必须进入独立 Gate/readback；同 Step 拒审后返工到新作者／新摘要也通过。

发现并修复中的实际缺口：原 pending.contract 的 output.ref 可被改写后通过 claim，最后窄例已验证拒绝；仍须跑完整原矩阵。知识输出不能自毁旧V，也不能豁免产品源码：复用原命令 check-policy 的 literal outputs 与完整 policy digest，Gate 候选仍 whole-tree；不新增 managedContract、目录豁免、作者账本或阶段。

最后 run16／session14436 **已真实终态 exit1：4项2通过、2失败，零跳过，237.759秒，输入未变**。通过：pending ref 篡改拒绝、同 Step 内容返工。未通过：unknown fixture 观察时 handle 变化触发拒绝；完整 Kp→归档→Kt 子进程达到原110s上限，status null，不能算行为RED或PASS。链在私有 fixture 中已到 `full.closeout.knowledge` / waiting，未完成Kt。原锁PID44985及直属子进程只读核验已不存在；现场及锁保留，不靠残留锁重启。

此处全部是机械 CODE／本地 fixture，不是实际模型、MCP发布、OS角色、权限或团队知识资格。外层原矩阵90例及所有新增负例尚未在最终候选完整通过。不要把新 private fingerprint 写进生产锁。Root私有0003上下文修订只是原程序行不变的context衔接，不能伪装程序改动；正式应用前重核补丁顺序、源码、生成结果及独立审查。

### P1_3：实际 CLI／工具闭包，尚未启动

Root已把准备包保存到 `worker-reports/P1_3-cli-S0-handoff/`。先读 REPORT、PROFILE、CODE-AND-PROBES 和 manifest；它是未执行计划，**不是现成 transport 或启动授权回执**。

- 固定现有 Codex CLI0.163.0，binary SHA `8813367285524ac798dd96d1b071aea30d58708c7226fd236cd275cf1cfdee31`。
- S0只在独占空 cwd 做 initialize/initialized，不发 thread/turn，不调用模型。真实 user MCP18名、main项目层3名、去重20；空cwd只能按实际继承18名关闭，不能虚构两个缺 transport 的 disabled entry。
- `environments=[]` 不等于关闭 Shell；`mcp_servers={}` 深合并不能清空继承服务器；remote_control feature 是 no-op。准确固定禁用 marker 及实际开关见包内证据。
- 实现须采用受保护的固定 profile/argv/env 编译，不能让调用者自由传 `-c`、provider、模块或 role；现有 transport 仅允许原三词argv，尚未支持该 profile。
- CLI启动即可能读取正常认证、cloud/config、环境、写缓存/SQLite或联网；init-only也不是零副作用。先核包内可执行范围及剩余闭包，按宿主规则处理具体授权；不提取token、不发明新的模型API key、不重定向 HOME/CODEX_HOME。

S0后仍需真实项目工具闭包、S1公开turn、原Run角色工具／制品接纳。当前Host仍声明 authoring UNVERIFIED：只有Gate执行基础，尚未真正消费完整 producer prepare/claim/read/accept 与实际 Agent。现有 registration 按Gate单一角色，Build里的测试作者／Builder／Reviewer及知识作者／reviewer／writer不能挤成一个角色；必须接原接口和真实来源，不能仅改标签、手写pass或另建队列/控制器。

## 6. 接手后的执行顺序与退出条件

1. **接管。** 核实际进程/原生Agent句柄、三工作树版本、主检出九文件SHA与用户原有改动；原控制器不再派发。只保留一个状态／台账写者，监督只观察。确认运行已终态后再开始后继任务，不因观察超时重启。
2. **关主回归失败。** 先核最终Runner前置与I06 fixture超时，收集同次原因；可评估有依据的测试调度改进，但不隐藏命令或放宽断言。通过最终未插桩check后才决定接纳d4de/ab90/746；同一候选复核 bootstrap 冷拷贝。
3. **关Core源码缺口。** 恢复现有私有候选，处理handle稳定性及110s路径、输出声明/权限/CODE/受众/其它文件的失效负例；完成原90例和新增矩阵、独立Spec/Standards与Root联编，再受控更新原生产锁。不要恢复已被拒绝的空作者或managedContract方案。
4. **接真实执行器。** 固定profile TDD及独立审查后，按准确范围资格化S0，再实际项目工具/来源和角色链；作者、测试作者、Builder、独立审查、Whitebox真实执行及canonical制品回读。沿原pending/trajectory/artifacts，未知结果观察原operation，进程活性不等于任务进展。
5. **重建最终Runner，完成真实知识与平台。** 最终SDK＋Host＋bootstrap准确镜像，实际OS/角色隔离；Kp→唯一OpenSpec归档→Kt同Run恢复；真实源权限/完整受众/有效预授权、撤权事件＋周期核验、隔离失败告警重试和恢复；实际平台required checks、精确SHA/构建digest/部署回滚、原生备份恢复与R10。缺资源／授权如实UNVERIFIED，不能用fixture或容器healthy顶替。
6. **最终验收与收尾。** 同一最终候选／实际产品Run及关联维护完成本期129required/103场景；独立Whitebox＋Grill、原始日志/终态和状态一致性通过。随后唯一Comet执行适用迁移规格归档与后审，保留F10未验处置，再关闭Goal和监督。旧三份verification产物不是本轮最终PASS，必须按真实最终证据重建。

## 7. 快速核验命令与授权边界

以下从主检出执行。Python一律 `-B`，防止向不可变技能快照产生字节码。Node固定24.15.0，Python镜像固定3.12.15；宿主Python版本不冒充镜像资格。

```bash
cd /Users/mac/Code/sdd-harness
git status --short
git log -5 --oneline
python3 -B .agents/skills/claude-parallel-tdd-planner/scripts/plan_guard.py \
  --repo-root . \
  --plan openspec/changes/delivery-foundation-rearchitecture/tasks.md \
  --architecture openspec/changes/delivery-foundation-rearchitecture/architecture.md \
  --dag openspec/changes/delivery-foundation-rearchitecture/task-dag.json \
  --lock openspec/changes/delivery-foundation-rearchitecture/drift-lock.json \
  --contract openspec/changes/delivery-foundation-rearchitecture/execution-contract.json
/Users/mac/.nvm/versions/node/v24.15.0/bin/node tools/infra/runner.mjs build-plan --json
```

build-plan只读导出不是实际Runner资格。总检查原命令为 `bash scripts/check.sh`；在固定Node PATH和原外部拒绝器/记录方案下运行，见Root报告capture.py，不把被拒绝的Docker/gh尝试记为真实平台证据。

- 旧14份共识外发许可和新15份（9784847e…befa4）一次共识许可均已使用；新包/新用途不能复用。新15份已两轮finalize，不为换执行Agent重开同一共识。
- Outline owner key只获且已消耗一次固定三API只读核验许可；不得重跑、读取值或用于publisher/isolator/issuer。完整受众、发布、隔离、签发身份仍未资格化。
- 没有默认选定新密钥transport。普通CLI既有认证与控制签发密钥、Outline身份是不同问题。真实外部写、ACL、发布、平台操作按现有具体授权和宿主审查；不从“通过模型审查”推导外部授权。
- 不再用旧Trinity／Superpowers控制器，方法原文不改。测试作者与独立Whitebox分离；迁移planner是唯一实施台账控制器，产品P只消费计划方法，不能嵌套启动第二Goal/DAG/监督。

Goal仍未完成；自动监督`sdd`只观察交接状态，不能成为第二调度者。原整体ETA未知。接手者完成事实核验后按同一任务身份推进，不另拆一个“更容易通过”的交付目标。

## 可直接交给接手 Agent 的指令

> 接手 `/Users/mac/Code/sdd-harness` 的 Comet AI DevOps 重构。先完整读取本文件、AGENTS 和原唯一 Change 的 tasks/DAG/contract/state/ledger，再核九个已应用未接纳文件、原始证据与所有既有句柄；确认单一控制器后继续原任务。先关最终总检查失败和 Core 知识/来源缺口，再接真实角色、知识、权限、平台与恢复，最终执行同候选同 Run 的129required/103场景、独立Whitebox/Grill和适用Comet收尾。保留F10另期处置及全部失败历史；不得重建DAG、重复派发、复用已消耗许可或以组件绿色关闭Goal。
