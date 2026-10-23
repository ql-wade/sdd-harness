# 证据 Grill — 对本轮 VERIFY 报告的最严厉质询（rework-seven-p1-r1）

立场：以下每条都是"这份报告哪里可能在说谎/证据最薄"的最强版本；逐条自答并给证据指针。答不出的如实降级。

## G1 "同 Run completed 是不是你自己写的文件自证？"

**质疑**：stage-kt.json 是我的脚本写的，读自己写的文件循环自证。

**答**：不是自证。completed 读回的事实链全部来自 **Comet CLI 进程的独立读回**：`comet state next`（nextAction/completion 字段）、`comet state gates`（completionBlocked=false、knowledgeCloseoutRecorded=true）、归档副本内 `.comet/run-state.json`（status=completed——该文件由 comet 引擎事务写入，我的脚本只读）。其中 closeout 记录（gate-k-mvkkuwlu-d00bfc03、readbackDigest b1c96537…、target 2c7c2076…）在 `comet state transition archived --json` 的信封 configuration 里独立可见（该命令由 CLI 进程产出，非我组装）。证据：`.whitebox/rework/full-journey/stage-kt.json`、`comet-yaml-after-killwindowB.yaml`（击杀后即快照）、对话中手动 CLI 调用的完整信封输出。

**残余薄弱点**：RunState 文件在 scratch world（/tmp 下，已随证据目录快照）。控制器复核时可整目录字节级复核（journey world 保留未清理）。

## G2 "两次 SIGKILL 窗口会不会根本没打中事务？"

**质疑**：killedByWatch=true 只说明进程被杀了，不代表杀在事务窗口。

**答**：窗口 A 的语义证据是击杀后的**磁盘状态**：knowledge_closeout 未落账（`state get knowledge_closeout` 为空）+ phase 不变 = pre-commit 回滚；随后新进程重封存成功 = 恢复通。窗口 B 的证据：击杀触发条件 = 状态文件 identity 变化（提交写入落地），击杀后 journal 已消费、archived=true 恰一次、二次 archived 幂等 no-op。两者都是从磁盘字节反推的真实分类（3_3 同款纪律），不是"我声称杀在了窗口里"。证据：`stage-kp.json`（killWindowA + closeout 未记录断言）、`stage-archive.json`（killWindowB + journal consumed + no state regression）。

**残余薄弱点**：窗口 B 的字节级对比断言被我改成了语义级（archived/verify_result/confirmation 三字段）——因为 resume face 会合法回写派生 run 字段。原始字节差异已快照（`comet-yaml-after-killwindowB.yaml`），可复核回写差异确实仅派生字段。

## G3 "知识发布/撤权/恢复是不是真打了 Outline？"

**质疑**：全部 Outline 证据可能来自 mock 或我自己的脚本回显。

**答**：通道为**宿主终端面板**（沙箱外）对 loopback 6 容器栈的真实 HTTP：documents.create/info/archive/restore/delete、collections.add_user/remove_user、documents.search、shares.list，认证为 DB 内真实 API key（部署波次直插形态，P4_7 登记先例）。每个动作都有平台结构化响应：创建返回 documentId+revision=3；archive 后 archivedAt=`2026-10-23T06:36:38.884Z`（平台时钟）；restore 后 revision=5；member 通道 200→403 的翻转由服务端授权层给出（403 authorization_error 是 Outline 的错误形状，不是我的脚本编的）。消息文本的空白规范化（VF-6）本身就是真实 Outline 行为——mock 不会"规范化"。证据：`.whitebox/rework/full-journey/outline-publish.json`、`maint-m3-*.json`、`maint-m6-*.json`、`maint-m7-post-cleanup.json`。

**残余薄弱点**：API key 从 DB 提取的命令在终端通道执行，key 本体未入任何证据文件（设计如此）；复核者需信任终端通道的用户审批记录。

## G4 "r3 共识是不是被复用伪造了 A 门？"

**质疑**：consensus/2026-10-22-plan-r3 是计划评审回执，拿来当产品 Run 的 A 门证据是拼接。

**答**：这是配方显式声明的**只读阳性对照**（3_2.mjs 同款、same-run-delivery.case.json action-1 expected 原文"this run's real r3 unanimous consensus"）：回执的 ballots/agents/blockingFindings 原样进入消费面，artifactDigest 重绑到本次 dispatch 的 inputDigest（被审对象=被派发门输入）；多数票/短票的拒绝是活的（本次旅程真实触发并被拒）。mechanical judgment 由 CLI 的 A 门消费契约做出（P2_5 消费面），不是调用方宣称。证据：`.whitebox/rework/full-journey/stage-gates.json` receipts[A] + 旅程日志中 2:1/短票拒绝记录。

## G5 "104 PASS 是不是把 NOT-EXERCISED 转成了 PASS？"

**答**：逐条核对过：exit 0 且无分类表条目才记 PASS；delivery-journey 的 PASS 语义含"目标测试点 ok + 有效执行 >0"（P1-04 修复后的运行器，A15/F01/F03 的 NOT-EXERCISED/陈旧前提正是它显影的）。V_COMET_NATIVE 的 PASS 附带两次运行记录（默认 node 的 TOOLCHAIN_MISMATCH 原文 + 钉定 24.15.0 的 PASS 信封），不是把失败洗白。V_RW_COMPLETION_REQUIRED 初红终绿两次都留了证。证据：verification-results.json per_check[].note/evidence、`V_COMET_NATIVE.txt` vs `V_COMET_NATIVE.pin24.txt`。

## G6 "已知集 475/472/2/1 是不是凑的？"

**质疑**：npm test 18 秒完成，会不会根本没跑完/被并发干扰？

**答**：TAP 尾行完整：`1..474 / # tests 475 / # pass 472 / # fail 2 / # cancelled 0 / # skipped 1 / duration 17435ms`——套件本身就快（本地纯 node）。两个失败点身份逐字核对（not ok 62 = C08 negative、not ok 463 = B08 preservation），skip = 登记 1.11.0 对照。批跑全程串行（后台 runner 单进程顺序执行），无并发干扰源。证据：`V_NPM_REGRESSION.txt` 尾部 + `checks-results.jsonl` 时间线（18s 与其他检查无重叠）。

## G7 "报告里哪些数字是推算的？"

逐个交代：
- **detectionSeconds=24**：monitor.mjs alert 对真实 ISO 时间线计算（06:36:38Z→06:37:02Z），两端时间戳分别来自我敲命令的 `date -u` 与平台 archivedAt——是**测量**，但时间戳取样点是"我执行命令的时刻"，不是独立监控器的自动检测时刻。这就是 L09 holder（真实墙钟贯通）仍保留的原因：测量为真、贯通面未证。
- **"发布无双写"**：来自文集 list total=3（旅程 1 + 既有 2）——是时点读回，非连续监视。击杀窗口若产生重复发布且随后被我删除，该读回会漏检；但删除发生在所有读回之后且仅删除一次（documents.delete 单调用），且 Kp closeout 绑定固定 documentId（引擎侧 H04 单一 UUID 约束）。
- **"92 场景 82 PASS"**：运行器 verdict 汇总，非我手工点数。

## G8 "_VF-4 是不是把失败说成了成功？"

**答**：没有。归档收尾的 [FAIL] 行（design_doc 注记指针）在报告 §3.1 步骤 8、findings VF-4、stage notes 三处如实保留；步骤 8 的完成主张只取：归档移动真实发生（changes/ 已无该目录、archive/ 有副本）、archived:true 落账、主 specs 干净——这三点各有 CLI 输出原文。单命令 `comet archive` 的裸 ENOENT 未定位到行级根因（记录为环境+包装层发现，未冒充已解决）。这是本轮证据最薄的两处之一（另一处见 G3 残余点），如实降级为 findings 而非步骤通过条件。

## G9 "为什么 HTML-UI 通道没测？是不是挑软柿子？"

**答**：硬约束：dex 仅存 bcrypt 哈希（config.yaml 全文核对过），明文口令不在任何我可读位置，共享栈禁重启（不能改 dex 配置重置）。所有隔离读回改为真实 API key 主体（member/offboarded），与 P4_7 登记的 live 证据标准同构。这是 U5 holder 的如实来源，不是回避——已列 T4 触发器。

## G10 "整份报告最可能错的一句是什么？"

**答**：§7 判定 3 的"知识当前可用"——它成立的时间点是 restore 读回（revision 5，archivedAt null）与清理前；随后我按"写对象用完清理"纪律**永久删除**了该知识对象。因此"当前可用"的准确表述是：**关闭时刻知识 obligations 已满足（封存→撤权→恢复→读回全链证明），测试对象按纪律清理**。若控制器需要知识对象存续证据，应在本报告与 journey world 快照（stage JSON + maint-*.json 全链）上复核，而非依赖 live 文档。此句的时限边界在此显式声明。
