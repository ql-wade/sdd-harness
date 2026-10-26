# P2_4 R3执行交接：用户要求停止，未完成

本页仅是原P2_4局部检查点，不替代Root唯一tasks/DAG/state/ledger。收到停止要求后没有新增构建、测试或源码修复，只消费既有session14436真实终态、只读核登记PID并保全结果。当前无未消费的已知工具会话；不需要继续wait，也不能因旧观察超时重启测试。

## 当前结论

- 私有最后候选的四项必要机制试验：4项、2通过、2失败、0跳过，exit1，237.759秒，输入SHA不变。不是完整P2_4或业务验收。
- 已证明的限定行为：真实Node CODE可在正文不存在且无预知digest时领取原Kp.create，从原R/V已认证raw生成新正文；实际collection输出后冻结摘要，在同原Step准备独立review。原writer物理调用计数在传输幂等之前，attempts=1/writes=1；next返回NEEDS_INDEPENDENT_REVIEW，再prepare拒绝，原独立Kp Gate实际Node读回发布正文/版本/SHA。
- 最新两项通过：pending输出ref篡改拒绝；独立内容拒审后同Step返回creator，实际新正文/新digest，再独立review/Kp Gate通过。
- 尚未闭合：writer unknown同operation观察；Kp→真实本地Spec归档→Kt完整链；新边界负例组与原90例完整回归；真实CODE登记/模型/MCP/服务/身份/OS/权限资格。
- 原39节点/69工作包、本期129required/103场景（总130/104，F10另期）没有修改，业务通过仍0。main、中央0003/profile/计划/台账/角色权限未写。

## 源码位置、所有权与冻结摘要

外层树仍HEAD d0b0d07302e1732463179130c9824b3ef6ced69c，分支codex/comet-native-fixture-preconditions。外层0002保持11274049cf48408769bea8b9ed0228cf14c838d1ac9e4bbf59e56f7f3bdee6ee，tests/2_4.patch保持00786c45d0e9acfb6e6fc0c3243777f28247e1b6f4275d64ba690857a894eb77；外层fixture保持9e132e2c5f6857935f89e3135fe9e46670aa80d0545552e87a57f4e9342d8ff5。这里只保留上一轮合法前置/symlink有限修；新知识代码和新测试仍未应用到外层源码，未提交新候选commit。

完整交接包在knowledge-r3-handoff；各文件精确SHA、未应用source清单及与实测build的对照见R3-HANDOFF-MANIFEST.json。主要入口：

- full-knowledge-delta-r3.patch：相对原六patch组合的完整最小源增量，SHA 50f80a819e56075ceba1161181a6527f836a2677879e20231f9acb8feb5043e0。
- full-knowledge-delta-sdk-r3.patch：只缩短Runtime首import hunk上下文、保持同一代码变更，SHA 07da435689715239b3aa99e08968489d2a5dfc3f0da1fdc70d3b7656ce5f1cf8；原SDK此前git apply --check=0，尚未应用。
- 2_4.proposed.mjs：私有实际测试fixture完整候选；新增case均保留原断言，不改时限、不跳过、不手造producer history。精确SHA见manifest。
- combined-source-view：最后实测私有组合的完整10文件视图，含原六patch已有中央内容作阅读上下文。不得将该视图整文件覆盖SDK或把原0003代码重新打入0002；只可用上面的增量按原helper导出owned patch。
- private-binding.lock.json及private-stack-patches：实际11patch私有组合。Root提供的0003上下文artifact仍为861d60b7bb26bc29db0fe708bacee5c962338b92fd1b8c37943890cf76594742，未修改，只供私有构建。实际privateFP为aae9a3a306416f1249c1dd520edb6729f278de6a6d91d292ec3092ac0a2deda1。该组合不含Root最后联编的security004，不能充抵主候选联验。

新源增量仍只拟归owned0002：固定六个内部CODE动作、原selected/prepare/claim/accept、生成后tuple、原source provenance、原Runtime tools/guardrails、原稳定JSON函数的无环utility、原命令outputs在Gate和原archive rawInputs的精确接线、Kt next消费者字段保留及pending合同签名绑定。没有新phase、ledger、MAC、controller、动态模块选择器或技能壳。

## 已选边界

Root明确取消knowledge-output-freeze.proposed.patch新增ToolDefinition.managedContract方案，旧提案仅保留历史，不能应用。当前实现复用原check-policy精确literal outputs：V执行前声明知识payload/review/write-result；Gate只取同Run真实verify记录的argv/cwd，核原log/manifest字节、环境/完整政策绑定，candidate输入仍whole-tree，不跟随policy.files缩窄。输出全集与受保护CODE的原producerContract核对，CODE、权限、来源、受众及原非知识生产输出不可列为知识排除。声明变更进入原Gate输入摘要并单调失效。

原archive helper由owned0002第1行引入，rawInputs约46行，原collectCheckSnapshot约51行，before/register/current调用约114/224/274行；不是0003新文件。本次保留原桥MAC、Run/path、完整policy及before/after检查，未签新桥MAC。原stableStringify算法原样移至classic-stable-json，旧导出保留，消除反向Runtime初始化环；无动态import/通用loader。

## 最后运行与失败现场

最后命令为固定Node24.15.0：node --test --test-reporter=tap --test-name-pattern='pending producer output contract reference|rejected independent content review|unknown writer observes|actual CODE Kp before' test/delivery-cases/2_4.mjs；cwd是私有mirror，COMET_UPSTREAM_LOCK=private-binding.lock.json；仅测试生命周期caffeinate-i，Python -B。原tool session14436已消费exit1，不得再次当活句柄等待或重启。

原始结果：knowledge-r3-evidence/16-knowledge-rework-observe-archive-green/{metadata.json,stdout.raw.txt,stderr.raw.txt}。stdout SHA a6efe9eea5b747786c08617ec787dfcea768e87106c284735a72c28368ef92ab。两失败：

1. unknown用例：UNVERIFIED: physical handle changed for the same execution。直接源码原因是fixture.readExecution把不断变化的observations/observationPid放进原physical handle，触发原正确不可变约束；尚未走到unknown最终断言。应先修fixture保持原handle恒定并将新观察证据放在原回读结果/原raw中，不能放宽Native handle guard。
2. Kp→归档→Kt用例：触及原110000ms子进程观察上限，child.status=null，未记录signal/error字段；不能当目标行为拒绝或完成。实际局部Spec归档已经发生，剩余保留fixture路径见下面。未归因，不能以增加时限或重跑猜测求绿。可先静态检查新增knowledgeOutputScope在归档路径迁移/锁内读取artifacts与原锁重入的交互；这只是待证假设。

保留的fixture为 /var/folders/xv/bkd_vyq16x7604ttfbfpgwfh0000gn/T/native-2-4-SLXKZd/project/openspec/changes/archive/2026-10-26-demo 。只读回读：runId=10e78a3f-9556-49d5-9f49-96037e390360，currentStep=full.closeout.knowledge，status=waiting，iteration=17，pending=null。原.comet-state.lock登记pid44985；已用ps -p 44985 -o pid=,ppid=,stat=,etime=,comm=和pgrep -P 44985核无该PID/直属子，不输出args/env。未删除锁、Run或raw；未声称扫描并排除所有未登记后代进程。selected control原字节复制在knowledge-r3-handoff/chain-timeout-control。该测试fixture的临时authority在已结束子进程内，不能伪造新authority把历史重签成可继续业务Run；后续只做法证/明确授权的新隔离机械试验。

## 已知试验历史（均保留，不用后来局部绿色覆盖）

- R1完整90项曾50pass/40fail，旧失败原义为缺真实producer前置，未以空作者或legacy豁免处理。
- R2旧12组原raw已核终态；14/15路径组各1通过；16原非知识19/19、零跳过属于旧11274049候选的限定证据。
- R3原e311/a9d提案：script型项目CODE不在Runtime package内，原snapshot拒绝；Root同意使用真实注册function类型，四元组/文件SHA/guardrails照核。工具软链CLI空输出曾未真正执行构建，明确记setup，不算通过。
- 原项目内R/V投影文件引起旧V自失效是setup问题；已改机械CODE直接消费原R/V已认证raw，不预拷全文。
- 05/06真实无正文/无digest目标RED；08实际生成后V自失效的输出边界RED；09TS类型失败；11初始化环setup失败；这些原raw完整保留。
- 13创作/冻结1/1通过；14writer-once通过、pending-ref拒绝反例RED；15最小绑定联编；16 ref拒绝/同Step返工通过，unknown/完整链失败。

## 交给下一Agent的必要步骤

1. 先读本交接、原AGENTS/HANDOFF/tasks/DAG/contracts与Root最新主状态；保持原唯一DAG、原owner和建设/业务资格边界。不要新建Goal、automation或第二controller，不reset/删除旧树/raw/分支。
2. 核原16已终态及上述残留fixture，再按Root新授权处理两个明确失败。保留不可变physical handle；诊断post-archive挂点，不能把110s观察上限当进程仍活、行为RED或重启理由。
3. 运行尚未执行的已写负例：同目录其它文件、CODE、授权、源权限、受众、真实源/产品、命令outputs晚改、受保护contract晚改；以及caller补digest、target/ref篡改、旧creator字节回放。要求V/Kp及原归档桥不能恢复旧证据。
4. 两个必要正链闭合后，再对原90例做保持原case身份/断言/时限的完整或无遗漏分组回归、相关原Native tests及generated/integrity检查。当前没有这个候选的完整矩阵通过证明。
5. 只在精确候选可审查且验证到位后应用SDK增量，沿原export helper冻结owned0002/fixture/报告；不要整文件搬入0003内容，不改中央锁/profile/角色/权限/其它owner。由Root做原003 context协调与含security004的最终联编、独立两轴审查后再接纳。
6. 全部Node固定 /Users/mac/.nvm/versions/node/v24.15.0/bin/node，Python -B；不改时限/断言，不运行真实CLI模型/MCP/API/服务写。真实源码/身份/权限/知识运输缺口保持未验。没有用户新授权时，本worker到此停止。
