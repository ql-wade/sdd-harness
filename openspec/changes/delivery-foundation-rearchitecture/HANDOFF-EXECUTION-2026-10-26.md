# 执行交接：原生命令、技能、硬门禁，退休六角色常驻服务

> 修订：2026-10-26-command-first-v1。用户本次只要求更新架构和详细交接计划，由其他Agent实施。**没有实施、删容器/卷、模型调用或新验收；原Goal保持暂停。** 旧交接、任务、契约、锁、规范和状态已逐字保存于`replans/2026-10-26-command-first/before/`，不可把旧当前进展当新基线。

相对路径以仓库根解释。唯一工作入口`/Users/mac/Code/sdd-harness`；启动壳/observer树不是控制器主检出。当前架构见`docs/architecture/comet-ai-devops-convergence.md`和ADR-0021；原tasks/DAG/contract仍是唯一实施清单，不另建项目或DAG。

## 1. 先接受这个边界

Comet使用原生命令和原Run/Guard；现有Claude/Codex等宿主提供模型、技能、子Agent与工具。**一个角色不等于一个服务；独立审查不等于六个常驻容器。** Docker只保留必要Outline/Postgres/Redis、按实际需要的附件/代码Wiki基础设施，以及有理由的临时测试作业。

| 用户入口 | 当前工作 | 硬门／失败去向 |
| --- | --- | --- |
| `/comet-open` | R需求：grill-me，范围/AC/非目标/环境与有权确认 | R未过不得进入正式A；范围问题回owner |
| `/comet-design` | A架构：grill-me＋独立consensus | 当前摘要/原票/完整审查通过，否则回架构作者 |
| 同一Design | T测试设计：test-authoring＋独立充分性审查 | 独立T门；case/oracle/边界/权限/环境不全回测试作者 |
| `/comet-build` | P计划→测试自动化→TDD实现→独立代码审查 | P只生成同Change计划；真实RED/GREEN；弱测试回作者，产品错回Builder |
| `/comet-verify` | V独立Whitebox | 同候选真实旅程、typed终态/数据/日志/适用截图；缺资源、skip不通过 |
| `/comet-archive` | Kp→唯一规格归档→Kt | Kp项目知识阻归档；Kt团队发布可归档后同Run恢复，阻整体completed |

`/comet`是路由/恢复入口；所有手动入口同样检查前置。显示phase、当前子步骤、制品版本、已过门、阻塞及下一动作。不得只写“Agent自行安排”或把A和T混成一个设计门。

要求/设计变化使全部下游证据单调失效，旧字节不复活旧批准；源身份来自宿主/平台真实事件和实际读回，不来自自写role/pass。使用宿主强制只读/工具/路径范围与受保护CI/MCP权限；宿主缺能力就标缺口/换已支持宿主或有权人处理，不自建Agent平台补洞。

## 2. 保留、删除／退休、返工清单

“删除/退休”是下面原任务里的后继实施目标。本次不删除任何代码、容器、卷或知识数据。每项均须查真实调用者、移除默认安装/启动/测试指令，并验证没有再生。

| 处置 | 内容／位置 | 原任务与必要证明 |
| --- | --- | --- |
| 保留 | Comet五阶段命令、Run/锁/事务、next/resume、OpenSpec | P1_1/P1_3/P2_4/P3_4：真实调用和所有入口共同Guard |
| 保留 | 原样Matt方法、grill/consensus、test-authoring、TDD、review/Whitebox | P1_6/P1_5/P2_5：真实方法与独立会话，非角色标签 |
| 保留 | LLMWiki项目精华、Outline团队知识、deepwiki-open代码Wiki；Graph可关 | I03/I04/I05/P4_4：实际MCP/API、版本/索引/权限与读回 |
| 保留 | 已有Git/CI、制品、部署回滚、权限维护、备份恢复/G15/R10 | I06–I08/P4_1/P4_2/P4_8/P5_3：真实资源与故障恢复 |
| 退休 | `infra/delivery/runner/compose.yaml`六角色默认服务及自动启动/发布/CI入口 | I02/P1_2：默认链零常驻角色服务；旧Run/卷/证据不丢 |
| 退休 | 固定Runner Dockerfile/image/UID/卷资格作为阶段命令前置 | I02/P1_3：缺Docker不阻普通命令；临时作业仅真实需要时保留 |
| 退休 | 独立controller端口、角色daemon、复制authority或额外业务状态 | I02/P2_4/I07：原Comet唯一写者，原生恢复不靠新服务 |
| 退休 | 自建app-server transport、S0/72配置、独立签发/secret平台作为主链前置 | P1_3/P2_2/I01：优先正常CLI/宿主工具/既有连接器，不另造Agent循环 |
| 返工 | `lib/adapters/comet-executor.js`等仅Gate/单角色映射的Host接线 | P1_3：真实作者/测试作者/Builder/独立审查执行；必要薄适配而非新RPC |
| 返工 | 原Guard/来源接纳/知识输出与失效、归档位置恢复 | P2_2/P2_4/P3_4/P4_6：最小保留必要实现，原pending/trajectory/artifacts唯一 |
| 返工 | 旧I02/角色/镜像专属测试与全链验收器 | I02/P3_1/P4_3/VERIFY：退休证明＋替代功能oracle，不用skip或旧PASS充抵 |
| 返工 | 发布/隔离按权限的工具调用和原有定时维护 | P4_4/P4_7/P4_8/I07：真实源/受众/grant、原operation未知结果查询、告警与补偿 |

六个旧容器此前只读观察均exit1、同旧镜像；不代表六个Agent可用。实际清理前重核归属和数据、保全恢复路线；删除卷/唯一工作区不由“简化架构”自动授权。

## 3. 计划身份、依赖和历史结果

保留39节点、30父任务、69工作包、104场景、130检查身份。本期仍129required/103场景；P5_2/F10正向明确另期、NOT-EXERCISED，不以未启用负例当PASS。单元用例数量可随退休变动，功能性129/103的覆盖不能减少。

改变的依赖记录在`replans/2026-10-26-command-first/amendment.json`：

- P1_3不再等待I02镜像；改接P1_2/P2_4/P3_1。
- P3_2先做R→V，不等待P3_4/I02/I03/I04/I05全部就绪。
- P3_4在R→V后完善唯一归档；P4_6等真实恢复使用它。
- P4_4不等平台部署或CodeGraph，按I03/I04/授权/归档恢复接知识；最终平台义务仍在VERIFY前完成。
- I07/I08不依赖角色容器；P5_3不依赖另期Control API。
- VERIFY仍在所有原任务之后，不能用上述依赖松绑提前签最终完成。

旧6个接纳节点、1164单元检查、镜像和私有SDK记录均保全为原范围证据；本修订重新评估受影响的设计/契约/宿主接线，不能继承业务PASS。既有版本、纯检查或通用安全代码有用就按准确范围复用，不要求把已完成工作全部重写。

## 4. 原工作树与候选如何处理

主检出原提交`43884be`保存旧交接；本次文档提交会更新HEAD。**九个源/测/装配文件已应用未接纳的差异仍在主工作区，不在本次提交里实施或撤销。** 清单和恢复补丁见`worker-reports/Root-handoff-20261026/{snapshot.json,pending-source.patch}`；不得重复盲目cherry-pick或覆盖用户改动。

| 旧候选 | 事实 | 当前处置 |
| --- | --- | --- |
| d4de546（registry树） | stdio connect/ready/begin及UNKNOWN修复双审；不是实际Agent资格 | 不再作为默认主链/强制S0前置；有真实调用者才保留相应安全回归 |
| ab90cc2＋74607cc（delivery-contracts树） | 同Run active/archive读取与锁检查、bootstrap闭包；诊断消息增强 | 归档路径/并发保护必要部分可复用；不要为打包该适配器强制重建整套Runner |
| d0b0d07外层＋aae9a3a3私有知识delta（observer树） | 机械CODE局部通过，最后2通过2失败，新代码尚未落外层0002 | 重新按原生技能/MCP边界评估最小需要，不把10源私有SDK方案当唯一实现；必要安全反例保留 |
| 旧fad4…镜像 | 构建和隔离工具链读回确实成功 | 仅历史支持；当前新流程无需先重建该镜像，不能认证新命令/角色 |
| `worker-reports/P1_3-cli-S0-handoff` | 未执行的149词argv/72配置计划，未启动CLI/auth/model | 移出默认执行要求。先用现有宿主原生能力；不在这里继续补平台闭包工程 |

三外部工作树共同前缀`/Volumes/mac-extend/codex/worktrees/`，名字为`comet-registry-qualification/sdd-harness`、`comet-delivery-contracts/sdd-harness`、`comet-observer-qualification/sdd-harness`。不要用启动时的observer cwd或旧festive-cohen壳做控制器写点。

保留用户原有修改：`docs/architecture/adr/0019-delivery-foundation.md`、`docs/architecture/delivery-architecture.md`、`test/delivery-cases/2_2.mjs`及未登记目录。新ADR明确覆盖冲突部署要求，不擅自重写这些原有文件。

## 5. 历史失败不是新计划的完成进度

旧Root原始证据在`worker-reports/Root-P1_3-host-components-integration/`：关联240/240；第一次原check1162/1164；限定插桩轮1164/1164；最后未插桩原check1161/1164。三失败是I06 fixture身份查询TIMEOUT、Runner FIFO初始预检PACKAGE_METADATA_UNVERIFIED及其父项。插桩轮不能覆盖原失败，不能把时间接近deadline当已归因。

旧知识run16已terminal，4项2通过2失败。已证机械作者产出后冻结、writer一次、内容拒审返工及pending ref篡改拒绝；unknown fixture句柄变化与110s归档后Kt路径尚未闭合。它不是实际模型/MCP/团队知识的通过证据。

当前无应恢复的旧工人测试：原40328/26994/93429/94581/14436均终态。接手仍要核实时进程/文件变化；残留锁不等于活进程，也不能因观察超时重启。270份交接证据与原摘要已保全，不清理旧现场。

下一步对仍被新主链消费的失败诊断修复；专属退役路线要明确退休及替代验收。不能为了绿色删正常功能测试、放宽原期望、隐藏命令或把UNVERIFIED接受为PASS。

## 6. 详细执行顺序（只消费原tasks/DAG）

### A. 接管与文档门：P0_1–P0_4

核当前源码/Goal/旧句柄和所有权；选择一个实施Agent和一个状态写者。读本架构/ADR、tasks、DAG、contract、amendment与原始证据，确认保留/退休/返工一致。用户已确认方向，不再泛化访谈；独立架构技术审查按新摘要完成，旧共识票不能改绑。计划校验不签业务运行资格。

### B. 原生入口与共同门：P1_1/P1_6/P1_2/P2_1/P2_2/P2_3/P2_4/P2_5/P1_3/P1_4/P1_5

- 先核原生命令/方法版本、实际宿主技能/子Agent/工具权限；只做必要适配。
- 第一RED：R未确认直接Design或跳transition应真实拒绝；GREEN后原Run推进。
- 第二RED：缺A或T独立审查、弱TestPack、P另起调度都拒绝。
- 第三RED：自写pass、同执行自审、旧摘要/旧代际、旧字节恢复或控制写绕行拒绝。
- 每个切片只改原owner文件，实际调用→产物→读回→Guard，记录真正原始证据；不用先部署容器/自建Agent协议。

### C. 首个真实R→V：P3_1/P3_2/P3_3

在一个已有真实试点和当前宿主完整走R→A→T→P→测试自动化→TDD Builder→独立代码审查→Whitebox。A/T分别审，P只产同Change计划，环境故障不算RED。展示当前步骤与阻塞，重复原命令恢复同Run。先做这一纵向切片再扩大其它模块；它是中间接纳，不代替最后129/103。

### D. 旧部署退休与必要知识基础设施：I01–I05/I02

I02按盘点→保全→退出默认注册/启动→替代权限/测试→确认无数据义务后清理的顺序执行。Outline/Postgres/Redis等只按必要依赖部署；LLMWiki为项目stdio MCP，deepwiki按实际需求，Graph可关。每项真实权限与数据读回分别证明，不能只看healthy。删除卷/唯一知识数据仍须具体授权。

### E. 实际Kp→归档→Kt：P3_4/P4_6/P4_7/P4_4/P4_5

作者真实产正文后冻结，独立审查，调用既有MCP/API写入并独立读回；知识输出提前声明但不排源码/授权。Kp缺失所有归档入口拒绝；唯一OpenSpec归档后Kt仍pending，同operation查询未知结果，重复hook/命令不重复发布。权限/源交集/受众/版本/grant写前重核，范围内自动、越界或敏感交有权人。

### F. 平台与维护恢复：I06/P4_1/P4_2/I07/I08/P4_8/P5_1/P5_3

沿已有CI/registry/目标环境实测精确SHA/check/digest/部署回滚；已有定时器只触发同Comet维护。事件＋周期核验验证3分钟发现/2分钟隔离目标，漏报/进程中断/隔离失败分别告警并补偿；新授权前不恢复。备份原Comet状态/知识DB/附件并实际隔离恢复，R10未完成义务不能丢。

### G. 最终交付：P4_3/VERIFY与唯一Comet收尾

在同最终候选、实际业务Run及关联维护中运行本期129required/103场景；要求命令、真实方法、平台知识权限和恢复终态都覆盖。独立Whitebox/Grill、证据索引/状态一致性及三报告通过，才由Comet完成本迁移Change适用归档/后审并关闭Goal/监督。F10正向另期保留。不能让此次规划完成或任一fixture/镜像绿色填业务分母。

## 7. 验证命令与当前授权

```bash
cd /Users/mac/Code/sdd-harness
python3 -B .agents/skills/claude-parallel-tdd-planner/scripts/plan_guard.py   --repo-root .   --plan openspec/changes/delivery-foundation-rearchitecture/tasks.md   --architecture openspec/changes/delivery-foundation-rearchitecture/architecture.md   --dag openspec/changes/delivery-foundation-rearchitecture/task-dag.json   --lock openspec/changes/delivery-foundation-rearchitecture/drift-lock.json   --contract openspec/changes/delivery-foundation-rearchitecture/execution-contract.json
```

产品实施阶段按当前公开seam做实际RED/GREEN与必要回归，再用原`bash scripts/check.sh`。现有测试命令若只证明旧拓扑，先修实现/验收映射，不能执行旧命令得0就算新流程通过。Python始终`-B`，不向不可变技能快照落字节码。

当前唯一执行清单是tasks.md，机器交接为同目录execution-prompt.md；本文件解释取舍与顺序，不是第二DAG。时间盒仅检查点，非承诺交付工期。接收宿主能力未知时按原计划serial/max_workers1，能力实测后若要改并行方案，走同一受控修订，不另起控制器。

本次没有恢复原暂停Goal、派工人、启动CLI/模型/MCP、访问凭据或做外部写。原sdd20分钟监督只观察，不自动恢复实施。新接手者收到实施指令后才登记接管/恢复适用Goal，复用一个监督；规划本身不激活执行。

旧14份和新15份一次共识外发授权均已消耗；Outline owner key固定三API一次只读核验也已消耗。不得重跑、读值或挪作Publisher/Isolator/issuer。新资料外发与真实资源写需要当前具体授权，不从本交接、容器可启动或服务账号可读推导。

## 给接手Agent的指令

> 从`/Users/mac/Code/sdd-harness`接手。先读本文件、ADR-0021、当前架构和原tasks/DAG/contract/state/ledger/amendment，核已应用九文件与旧现场并登记唯一控制器。以Comet原生命令、现有宿主真实技能/独立Agent和硬门先跑通R→V，取消六角色常驻和私有RPC/Runner镜像前置；再完成实际Kp/归档/Kt、平台/权限/恢复及最终129/103。保留全部原ID和失败记录；不删数据、不复用已消耗许可、不新建DAG或Agent平台。当前交付只是计划，后继必须拿实际终态出最终验证报告。
