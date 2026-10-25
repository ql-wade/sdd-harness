# I04 项目 LLMWiki 实施交接

当前为建设工件候选，待 root 独立双审和精确 main 集成复验。原 I04 与八个业务场景未签验收，业务通过数仍为 0。没有改动 canonical tasks/DAG/contract/case-plan、其它 owner 源码、源技能、活 MCP 注册、权限或真实知识数据。

## 已完成的范围

六个 owned 文件把原探针接到固定 LLMWiki 实现：validate/qualify/probe 共用 I01 公共 registry/identity/reference 校验，资格检查不能丢弃违规，探针不能绕过 registry。输入 selector、组件身份、必需能力、入口和只产组件 profile 的边界均先校验；错误 Python override 在执行前拒绝；错误字段和参数不会回显模拟凭据或宿主路径。

唯一 wiki 路径权威仍是现有 `getWikiHome(cwd)`。I04 只把登记目标校准到主树 `.sdd/wiki/sdd-harness`，用受控项目绑定调用该权威并比对，拒绝 policy 与环境共同发明陌生目标；CLI 请求的目标必须与登记一致，链接越域也拒绝。原 `main/llmwiki` 数据没有搬迁、清空或批量摄入。真实 `..` 段与普通含双点文件名分开；子目录不能冒充唯一根。raw/、staging/、wiki/curated/ 与正式 OpenSpec/source/native Comet state 分离，index 和任务勾选不取得知识权威。

固定源码是 `075c5b4996ff4e07f9d3c57c1f14fd2b54a955db`，Git tree `47a6f755b04189ac57586e3825989140519a2bd2`，当前文件树 SHA256 `861319ee0c84d0ef2aa56ee5ac1ee507364785b5fe48295bde17d9e4dcd99357`。requirements.lock SHA256 为 `678bd7301d80a602336e8fd3a81f98adcd4c5beaec4e2f1f2bfb8d2e04a9e732`，154140 bytes。root 补齐原缺席的主项目源码分发；本工人随后只读复核 HEAD/tree/clean。实际 Python 3.11.13、mcp 1.27.0，80 个当前平台适用的 lock 版本全部匹配。没有改 venv、造 clone/.venv 链接或改 pin。

## 真实链路与证据层

| 层 | 实际结果 | 边界 |
| --- | --- | --- |
| 当前 SDK stdio | 单会话 initialize/list/create/read/search；同一 payload 原字节文件读回、原生 documents/content、document_chunks 与 chunks_fts 独立只读查询一致 | 写入仅可丢弃 sandbox；不是实际业务批准或 Kp |
| 缺索引/陈旧索引 | 缺行和更改文件后的原生 index 均读到 INCONSISTENT/MISMATCH，原条目字节恢复核对 | 不再覆盖 MCP 条目造正例，不再自建 i04_index_gate |
| 当前原生宿主 | Codex app-server 只启用一个 fixture MCP、21 个其它配置禁用；发现 10 工具；一个 ephemeral 协议线程完成 create/read/search，文件/native SQL/FTS 一致；model turn/Goal/用户可见任务为 0，进程 exit 0 | 直接固定 Python 入口，私有配置；不是生产 launcher、真实受管角色或同一 Comet Run |
| 现有 CLI/launcher 目标 | 主树与本 worktree 的真实 getWikiHome 与 launcher 参数指向同一登记根，路径摘要相同 | 参数观察故意使用不存在的私有解释器，非零退出且未启动 MCP；不冒充 launcher 运行验收 |
| 当前 active chat tool catalog | LLMWiki 项仍为 0 | 临时原生宿主实验没有修改活注册 |

SDK 使用实际安装的 stdio_client/ClientSession 保持通道到回执完成；Node 回执仍等待 stdout drain。过去 stdin EOF 与 8KB 截断缺陷不会被“Python 3.14 导致”旧归因替代：本轮固定 3.11 是工具链要求，真正存储验证直接读取同一条目的 native 表与 FTS。

独立读回指不同读取通道，不代表作者取得独立 Whitebox/Reviewer 身份。fixtureAdmission 只验证私有测试条目的形状，不认证生产批准；上游 MCP 自身也不把 frontmatter 的 approvedBy 当成真实 grant。固定 SQLite 实现的 knowledge_base 参数不是项目授权边界，实际隔离来自唯一 workspace 和受保护的项目/角色配置。

## 作者验证

最终 Node 24.15.0 命令 `node --test --test-reporter=tap test/infra-llmwiki-paths.test.js` 为 **27/27、0 skip**，见 23-final-owned。复用 I01 validator/secret-ref 模块的相关测试为 **41/41、0 skip**，见 12-related-registry；该依赖未改。最终公开 probe 的完整 JSON 见 24-final-stdio，当前 qualify 见 25-final-qualification：sourceRuntimeReady=true，但 ready=false/exit2，live 注册、生产身份/权限和真实知识义务不能由 fixture 结果关闭。

真实 RED/GREEN 均保留：01/02 共用准入、03/04 同条目原生索引、05/06 registry 与路径几何、07/08b 根绑定/输入、10/11 读回状态、13/14 拒绝输出脱敏、17+17b/18 profile 元数据准入。08 的首轮修复只有 4/5，失败记录保留；13 的凭据只是明确构造的无效夹具，不是真实密钥。

按仓库规则实际运行一次 scripts/check.sh：方法自测通过，后续 npm 共 634 tests、619 pass、14 fail、1 skip。没有把全仓检查标绿。只回放这 14 个失败点，暂把本工人六文件恢复成 93753a4 原字节、其它文件/环境保持，14/14 在原基线仍失败；finally 恢复精确候选。详见 repository-failure-attribution.json。最后一组 profile 校验在此之后收紧，全仓结果只属于其实际输入快照，不伪称最终全仓验收；按 root 要求不再重跑宽检查。

每次 UTC/cwd/argv/exit、输入摘要、raw/display 双摘要见 runs.jsonl 与 normalization-index.json。最终 23/24/25/26/27 输入在运行前后稳定，等于 final-inputs.json。早期 RED 的 source_hashes 是执行后采样，明确不伪装预先冻结；历史输出不继承为当前通过。raw 在 ignored `.local/I04-convergence/`，tracked 文本为便携投影。

## 原生宿主尝试的准确处置

`mcp_servers={}` 不能清除继承配置，直接改 enabled 叶还可能破坏 transport。先以本进程已支持的覆盖保留 transport 类别，实际读取 names/enabled 投影确认唯一 fixture 后才启动宿主；没有保存全局 MCP 原文或环境值。

私有 sqlite_home 的初始化遭遇 30 秒状态回填超时，不把该环境失败当行为 RED。root 随后明确授权唯一一次正常原生宿主状态启动；只用私有日志/CWD/MCP目标与本进程覆盖，未改 HOME/CODEX_HOME/配置。正常宿主自身可能记账，不能声称全局 DB 零写；本工人没有查询、复制、重置或迁移全局 DB/rollout。没有猜关闭 backfill 的实验开关。成功探针的协议/非敏感线程投影和 native index 在 native-host-evidence.json 及其 raw 索引。失败私有 DB 和全部可丢弃工作区已在不检查内容的前提下删除，相关进程已终态。

曾追加的真实知识树递归哈希快照被自动审批拒绝；整组命令未执行，后续去掉该非必要动作，没有换方式读或重试，也没有要求扩大授权。这里只核对明确授权的配置与旧证据，不能据此宣称真实知识树逐字节核验不变。preservation.json 记录主树/本树七项配置摘要不变，179 份旧报告/raw 原字节不变。

## 交给原 owner 的后续

- P4_4 修复 getWikiHome 内 shell 调用，保留一个权威接口并让 launcher 复用；I04 目前只在登记主树安全输入上调用，未把旧漏洞修复或一般路径安全签过。
- P4_4 改旧 knowledge adapter 的 create 参数、返回路径与 readback。当前 `{kb,name,content}` 不符合固定 schema，concepts 目标也不等于已测 `/wiki/curated/`。真实 grant/批准、同 Run/candidate/attempt/revision 必须由受信链带入；unknown 先读原 operation，不盲重建。
- 注册源/生成器的具名 ownership 由 root 在原 P1_3 内修订、双审冻结；本工人不改 mcp-capabilities.yaml/.mcp.json/register-mcps。固定 Runner 的生产宿主装配与角色权限仍待验。
- P1_3/I02 按 root 的 intake 实证 P plan-only 不暴露独立 Goal/controller 能力。I04 没有 model turn，不能据此宣称真实产品角色安全或违规。

具体调用点见 owner-intake.json，准确端口见 host-port-contract.md。原八个 C04/C06/E01/E06/H08/F01/B09/N05 oracle/模块/IDs 全部保留，case-binding-proposal.json 只给已实测组件字段与必须补齐的真实链路缺口；生产 readback 命令/路径/冻结身份未伪造，accepted=0。最后仍由 root 串行集成、独立审查/Whitebox 与 VERIFY 执行真实 Comet 旅程，不能用这里的局部绿代替交付。
