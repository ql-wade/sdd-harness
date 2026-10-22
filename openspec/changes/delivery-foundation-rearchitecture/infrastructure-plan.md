> 当前修订：2026-10-22 七P1返工。依赖/归属以task-dag.json为唯一事实源；infra任务详单是其只读投影。所有原资格/恢复要求仍需真实证据，不以局部组件通过替代。

# 基础设施实施计划与交接候选

本文件只制定计划，交给后续执行者实施。当前没有启动服务、安装工具、派发worker、发送通知或修改生产/远端策略。claude-parallel-tdd-planner仅负责本次计划与交接；目标产品运行时仍只有Comet Classic主控，TeamAI仅分发。基础设施脚本只管理资源/进程并返回事实，不能拥有阶段、业务重试或第二DAG。

## 范围与权威

沿用原30父任务、69工作包、92场景；已完成0.1–0.4不重复计数。I01–I08是基础设施补充任务，不重编号原任务，不另建可写进度权威。I01–I08已由计划owner合入canonical tasks/DAG并重新冻结；本说明不另持有进度或派发权，不激活Goal/监控。

项目沿用本仓库：GitHub1285806550、public，owner/current-auth ql-wade主体262266039此前读回admin；这些是观测，不是生产授权，执行时仍须核验。Docker29.6.2此前可用不等于服务已部署。所有资源使用专用sdd-harness-pilot命名，loopback暴露；不隐式复用PAV等已有项目的任何资源或凭据。

## 启动前共同硬门

- 先完成I01资源owner、目的、secret-ref、网络/故障域、保留策略登记。secret-ref只引用独立运行时凭据，不把值/模型选择/宿主私有路径写入提交或报告。
- 每个组件的源码、镜像digest、CPU平台、许可证/功能、健康API与恢复兼容在实施时实测固定。当前没有已认证的Outline、数据库、Redis、OIDC、对象存储或代码知识镜像，因此不虚构tag/digest。lock未ready则up必须拒绝。
- infra组件profile不是hooks/MCP第二事实源；共享hooks.yaml、mcp-capabilities.yaml、.mcp.json由原归属任务串行集成，禁止各组件直接覆盖活配置。
- 规划中的工具命令尚未实现，不能作为本轮执行证据。后续先RED真实失败，再GREEN最小实现；每条probe必须有实际动作计数、当前候选/资源身份、原始日志、请求/进程关联和独立读回。缺服务/权限标UNVERIFIED，不用mock或零执行转绿。
- 数据owner、批准签发者、author/reviewer/publisher/isolator相互独立。源读取权不等于外发权，管理员能读不等于目标受众被允许；外部token各自独立引用。

## 依赖增量

- I01 after P0_4。
- I02 after I01, P1_1, P2_4, P2_5, P3_1；before P1_3（受限工件交接规则见execution-contract）。
- I03 after I01；before P4_7。
- I04 after I01, P1_1；before P4_4；真实完整旅程最终由VERIFY消费。
- I05 after I01, P1_1；before P4_4。
- I06 after I01；before P4_1。
- I07 after I02, P2_4；before P4_8。
- I08 after I02, I03, I04, P4_4, P4_6；before P4_8, P5_3。

VERIFY增加对全部I01–I08的依赖；原依赖不删除。已用当前canonical DAG计算无环；JSON附完整串行拓扑候选。I08依赖真实知识关闭与归档后恢复机制，故不能在I03“容器启动”时提前宣称恢复通过。Batch5的逐宿主/跨机器/租约迁移仍是显式启用前门，F10等正向认证不因未启用而被标PASS。

## 实施任务

### I01 独立资源登记、版本准入与秘密引用

原任务关联：1.1, 3.1, 4.7, 4.8；原场景：F01, A19, U01, U07。

**精确独占文件：**

- `infra/delivery/registry.json`
- `infra/delivery/registry.schema.json`
- `infra/delivery/secrets.refs.example.json`
- `infra/delivery/qualification-policy.json`
- `tools/infra/registry.mjs`
- `tools/infra/secret-refs.mjs`
- `test/infra-registry.test.js`

**公共接口：**

- Registry.v1 -> project/resource/owner/credentialRef/lockRef/authority/domain/retention, no secret values
- SecretRef.v1 -> purpose-bound opaque reference resolved only by allowed service principal
- Qualification.v1 -> exact source commit, image digest/platform/size, license, health API and backup compatibility evidence before up

**owner、秘密引用与前置输入：**

- 项目owner ql-wade与可信委托范围；GitHub仓库1285806550、主体262266039须在执行时重新读回
- 每资源独立service principal、owner/备用owner与用途/受众；公开仓库不代表所有外部知识/附件可公开
- 独立秘密存储/运行时引用机制与可验证授权；不得复用既有PAV项目资源、凭据、网络、数据库或卷
- 各服务候选上游地址/发行物、平台架构、许可证和镜像来源待准入；锁未ready不得启动

**独立秘密引用：**

- secret-ref:sdd-harness-pilot/source-git-read
- secret-ref:sdd-harness-pilot/runner-authority
- secret-ref:sdd-harness-pilot/outline-publisher
- secret-ref:sdd-harness-pilot/outline-isolator
- secret-ref:sdd-harness-pilot/outline-oidc-client
- secret-ref:sdd-harness-pilot/outline-db
- secret-ref:sdd-harness-pilot/outline-redis
- secret-ref:sdd-harness-pilot/outline-object-store
- secret-ref:sdd-harness-pilot/codewiki-provider
- secret-ref:sdd-harness-pilot/ci-registry
- secret-ref:sdd-harness-pilot/monitor-alert
- secret-ref:sdd-harness-pilot/backup-encryption

**RED：必须先实际失败：**

- 未知owner/用途或凭据引用跨项目解析失败；将普通Agent身份访问签发/发布材料实际拒绝
- 未固定镜像digest、缺许可证/平台/备份兼容证据时up入口拒绝；浮动tag或假digest不通过
- 引用包含秘密明文、宿主绝对路径或同一个凭据被不同高权角色复用时校验拒绝

**GREEN：实施与探针：**

- 仅实现注册表schema、只读解析与逐资源qualification gate；秘密只通过运行时授权挂载/secret store，不写入Git/报告
- 生成各组件配置所需引用，但不写mcp-capabilities/hooks等其它owner的唯一源；由对应P任务串行接纳
- 所有启动工具先解析相同registry与组件lock，状态ready前仅可validate/qualify

**计划执行命令（尚未运行）：**

- node --test test/infra-registry.test.js
- node tools/infra/registry.mjs validate --registry infra/delivery/registry.json --json
- node tools/infra/registry.mjs qualify --resource <registered-resource-id> --json

**证据与终态oracle：**

- 原始owner/权限读回与拒绝日志匹配project1285806550和真实principal；无秘密值输出
- 资格回执绑定实际image digest/commit、平台和输入摘要；配置有效与运行ready分开

**备份与生命周期：**

- 登记每资源RPO/RTO、保留期、加密/恢复owner与销毁前置，未确认不可启用自动清理
- 秘密备份与数据备份分离；引用不存在或恢复密钥不可用则停止恢复，不生成新密钥掩盖原密文不可读

交接步骤：test-authoring先冻结本任务正负用例和独立oracle；实现者仅改上述归属，保存RED/GREEN和回归；独立Whitebox/审查者核对真实证据。原计划owner串行接纳结果并更新同一任务源；本文件不授权任何自动运行。

### I02 固定Comet Runner及真实OS/container角色隔离

原任务关联：1.3, 2.2, 2.4, 3.1, 4.6；原场景：A09, A10, A11, A19, C07, D01, D08, H03, H09, U07, F05, F07, M02。

**精确独占文件：**

- `infra/delivery/runner/compose.yaml`
- `infra/delivery/runner/Dockerfile`
- `infra/delivery/runner/image.lock.json`
- `infra/delivery/runner/role-policy.json`
- `infra/delivery/runner/workspace-mounts.json`
- `infra/delivery/runner/authority-registration.example.json`
- `tools/infra/runner.mjs`
- `test/infra-runner-isolation.test.js`

**公共接口：**

- RunnerInfra.v1 validate|qualify|up|probe|stop -> process/mount/principal observations only
- RoleBoundary.v1 -> immutable tool image, distinct principal/mount/credential scopes for controller/author/test-author/reviewer/publisher/isolator
- Authority.v1 -> one fixed Comet authority and workspace; startup refuses copied state or concurrent writer

**owner、秘密引用与前置输入：**

- Runner实际owner、单实例服务标识、可持久卷与authority登记；本机交互式宿主不直接标secure Runner
- 角色工作空间的真实sandbox实现与UID/GID/容器权限、只读输入/结果输出渠道；支持能力不足即cooperative-local/NO-GO
- 受控Comet源补丁构建产物、完整摘要和生成入口；依赖P1_1固定工具链和后续P2_4行为门禁
- 所有worker无Docker socket、宿主HOME、控制状态/策略/签发材料读写权；controller发布凭据也按动作隔离

**独立秘密引用：**

- secret-ref:sdd-harness-pilot/runner-authority
- secret-ref:sdd-harness-pilot/worker-author-api
- secret-ref:sdd-harness-pilot/worker-review-api
- secret-ref:sdd-harness-pilot/runner-source-read

**RED：必须先实际失败：**

- 以实际worker身份经Edit/Shell/MCP分别写.comet/run-state.json、策略、回执与签发目录；实际拒绝并保留errno/请求
- 挂载宿主凭据/访问Docker socket、使用只读driver写产品文件、复制state后第二实例启动分别拒绝
- 杀掉controller后不能由worker自行领取phase/重试；旧owner/attempt结果由Comet拒绝，基础设施不伪造新operation

**GREEN：实施与探针：**

- 镜像由精确已锁Comet源及项目补丁构建，启动前固定image digest；只读根文件系统、最小capabilities/权限和独立角色挂载
- 唯一Comet状态/锁/事务仍在其受管持久卷；infra仅启动/停止进程，不维护DAG/phase/job queue
- 工件/角色结果通过受控入口交原Comet；普通Agent不可构造可信dispatch身份，不能只靠env角色字符串或同主体签名

**计划执行命令（尚未运行）：**

- node --test test/infra-runner-isolation.test.js
- node tools/infra/runner.mjs validate --registry infra/delivery/registry.json --json
- node tools/infra/runner.mjs probe --case role-denial --json
- node tools/infra/runner.mjs probe --case duplicate-authority --json

**证据与终态oracle：**

- 真实container inspect/UID/mount/权限和负向写结果，分别对应Edit/Shell/MCP，不以容器配置文本代替实测
- 原RunID和operation恢复读回；两个启动请求只有一个有效Comet写者，控制目录不存在worker可写路径

**备份与生命周期：**

- 持久化Comet Run、锁/事务恢复资料、工件/回执与批准payload；临时worker工作区与控制卷分开
- restart policy仅原实例监督；未确认旧写者终止不得复制卷另启；跨主机恢复交I08证明受控迁移

交接步骤：test-authoring先冻结本任务正负用例和独立oracle；实现者仅改上述归属，保存RED/GREEN和回归；独立Whitebox/审查者核对真实证据。原计划owner串行接纳结果并更新同一任务源；本文件不授权任何自动运行。

### I03 Outline独立资料域、Postgres/Redis、OIDC与对象存储

原任务关联：4.4, 4.6, 4.7, 4.8；原场景：U01, U02, U03, U04, U05, U06, U07, U08, H04, H05, L02, L04。

**精确独占文件：**

- `infra/delivery/outline/compose.yaml`
- `infra/delivery/outline/images.lock.json`
- `infra/delivery/outline/outline.env.example`
- `infra/delivery/outline/oidc-registration.example.json`
- `infra/delivery/outline/storage-policy.json`
- `infra/delivery/outline/collection-registration.example.json`
- `tools/infra/outline.mjs`
- `test/infra-outline.test.js`

**公共接口：**

- OutlineInfra.v1 validate|qualify|up|probe|stop -> actual API/UI/storage/principal evidence
- OutlineDomain.v1 -> instance/collection immutable IDs, actual effective reader set and registered owner
- OutlineState.v1 -> durable database+attachment storage; cache is not rights authority; API contracts include fixed create UUID and lastRevision only if verified

**owner、秘密引用与前置输入：**

- 专用loopback实例、受管文集/隔离文集与独立owner；数据库/Redis/对象存储全部新建专用项目资源
- 精确Outline/数据库/缓存镜像和兼容矩阵、许可证/所需功能、应用配置参数按选定版本核验；未选定不编造tag
- OIDC提供方/issuer/discovery/client/redirect URI/subject→principal映射及测试用户/离组用户；启用前真实签发与登录证明
- 对象存储类型、endpoint/bucket/访问策略/签名URL期限与密钥轮换输入；不得假定附件撤回立即生效
- 源用途许可、publisher/isolator专用grant与有效受众须由有权主体分别签发；本任务不代签

**独立秘密引用：**

- secret-ref:sdd-harness-pilot/outline-db
- secret-ref:sdd-harness-pilot/outline-redis
- secret-ref:sdd-harness-pilot/outline-app-session
- secret-ref:sdd-harness-pilot/outline-oidc-client
- secret-ref:sdd-harness-pilot/outline-object-store
- secret-ref:sdd-harness-pilot/outline-publisher
- secret-ref:sdd-harness-pilot/outline-isolator

**RED：必须先实际失败：**

- 未登录/普通读者/离组用户对集合、页面、子树、公开分享、搜索和附件逐通道访问负例；实际拒绝/残留路径分别报告
- 来源交集不包含目标读者、分页失败、无法映射principal、过期grant时受管发布阻断；不能以admin读得到替代
- 重启应用/数据库后测试页和附件可读回；更新冲突409不盲覆盖；超时/403不能解释为目标不存在

**GREEN：实施与探针：**

- 锁定镜像后搭建独立Postgres/Redis/应用/存储和最小网络权限；loopback暴露不得自动开公网
- 接OIDC及专用受管文集，保存真实ID和有效受众查询能力；一般用户不能改issuer/secret/isolator角色
- 分别验证健康、登录、CRUD/readback/附件持久化、权限负例和受管发布/隔离API的真实参数；缺MCP参数时对应P任务建设薄adapter

**计划执行命令（尚未运行）：**

- node --test test/infra-outline.test.js
- node tools/infra/outline.mjs validate --registry infra/delivery/registry.json --json
- node tools/infra/outline.mjs probe --case oidc-principal-acl --json
- node tools/infra/outline.mjs probe --case restart-persistence --json
- node tools/infra/outline.mjs probe --case attachment-denial --json

**证据与终态oracle：**

- 原生浏览器登录/页面/分享行为截图+关联请求，独立用户权限/API/数据库与对象存储读回；不共享其它应用会话
- effective audience闭包含collection/parents/page/groups/shares/public入口，未覆盖访问路径不能宣称隔离；记录附件URL缓存残留风险

**备份与生命周期：**

- 一致性备份Postgres、附件对象和配置引用/issuer映射；Redis角色与恢复策略按部署选型证明，不当权威授权库
- 还原到独立资源先保持封闭访问，当前OIDC成员和源权限重验后才由Comet安排恢复；不回放旧ACL重加离组成员

交接步骤：test-authoring先冻结本任务正负用例和独立oracle；实现者仅改上述归属，保存RED/GREEN和回归；独立Whitebox/审查者核对真实证据。原计划owner串行接纳结果并更新同一任务源；本文件不授权任何自动运行。

### I04 项目LLMWiki MCP、索引与worktree安全路径

原任务关联：1.2, 1.5, 3.1, 4.4, 4.6；原场景：C04, C06, E01, E06, H08, F01, B09。

**精确独占文件：**

- `infra/delivery/llmwiki/package.lock.json`
- `infra/delivery/llmwiki/project-root-policy.json`
- `infra/delivery/llmwiki/index-policy.json`
- `infra/delivery/llmwiki/mcp-profile.json`
- `tools/infra/llmwiki.mjs`
- `test/infra-llmwiki-paths.test.js`

**公共接口：**

- ProjectWikiInfra.v1 validate|qualify|probe -> canonical project/wiki/index identity and MCP read/write observations
- ProjectRoot.v1 -> projectID/repoID/wikiRoot/worktree mapping, contained paths only
- KnowledgeWrite.v1 -> approved curated entry plus source/revision and independent readback; no task/phase/spec authority

**owner、秘密引用与前置输入：**

- 项目wiki唯一位置和跨worktree身份映射、保留范围、可摄入精华资料类型与脱敏政策
- 选定LLMWiki/MCP实际分发内容、源码/包摘要与索引工具版本；文件存在不算宿主已发现
- MCP host注册由mcp-capabilities.yaml唯一源对应P任务接纳，本任务只产出组件profile，不能双写活配置

**独立秘密引用：**

- secret-ref:sdd-harness-pilot/llmwiki-source-read

**RED：必须先实际失败：**

- 不同worktree/CLI/MCP指向另一wiki、目录穿越/符号链接越域、错误project ID分别拒绝
- 源码/正式spec或任务勾选被当wiki事实权威时拒绝；未经批准全Git代码摄入不允许
- MCP写成功但独立索引/存储读回不一致时Kp失败，不因本地文件存在放行归档

**GREEN：实施与探针：**

- 固定真实目录与项目标识、可重建索引和最小MCP能力；保持项目知识与OpenSpec specs/tasks及Comet状态分离
- 用隔离配置验证CLI/MCP/worktree同一规范路径；新宿主真实发现工具后完成知识写入及独立查询
- 清楚区分raw/staging/curated及index缓存，索引不能覆盖源记录或改知识授权

**计划执行命令（尚未运行）：**

- node --test test/infra-llmwiki-paths.test.js
- node tools/infra/llmwiki.mjs validate --registry infra/delivery/registry.json --json
- node tools/infra/llmwiki.mjs probe --case worktree-mcp-readback --json
- node tools/infra/llmwiki.mjs probe --case escape-denial --json

**证据与终态oracle：**

- 同一批准条目通过真实MCP写入、独立CLI/文件/索引查询同一项目读回；两工作树canonical root一致
- 未通过门禁时同一Comet Run的归档保持阻断；基础设施只返回事实，不签Kp回执

**备份与生命周期：**

- wiki精华源工件/来源与版本必须备份，索引可重建但要校验摘要和权限过滤；不能只备份向量/索引
- R10下未完成Run引用的wiki staging与唯一批准payload不得因索引重建或worktree回收丢失

交接步骤：test-authoring先冻结本任务正负用例和独立oracle；实现者仅改上述归属，保存RED/GREEN和回归；独立Whitebox/审查者核对真实证据。原计划owner串行接纳结果并更新同一任务源；本文件不授权任何自动运行。

### I05 自托管deepwiki-open及独立CodeGraph

原任务关联：1.1, 4.4, 5.1；原场景：F01, F03, A20, C06。

**精确独占文件：**

- `infra/delivery/code-knowledge/compose.yaml`
- `infra/delivery/code-knowledge/images.lock.json`
- `infra/delivery/code-knowledge/deepwiki-profile.json`
- `infra/delivery/code-knowledge/graph-profile.json`
- `infra/delivery/code-knowledge/repository-scope.json`
- `tools/infra/code-knowledge.mjs`
- `test/infra-code-knowledge.test.js`

**公共接口：**

- CodeKnowledgeInfra.v1 validate|qualify|probe -> selfhost code-wiki and separate graph provenance/freshness evidence
- CodeWiki.v1 -> repository immutableID/commit and wiki generation manifest, approved code access scope
- CodeGraph.v1 -> structure-only index with exact input commit/coverage; removable optimization, no gate or knowledge authority

**owner、秘密引用与前置输入：**

- deepwiki-open选定上游仓库、精确commit/发行物、镜像digest、许可证与启动/API契约在实施时核验；不得换成公共托管服务
- 试点语言/仓库规模、索引资源上限、更新策略与required/optional code knowledge policy；未定不能默认启动中心服务
- 每源独立只读Git凭据与独立生成服务provider引用；资料外发范围/目的必须已有授权，不向其它服务借token
- API/MCP私有认证/分页/版本暴露能力必须实证；结构索引单独生命周期，不能把整仓自动送Outline/LLMWiki

**独立秘密引用：**

- secret-ref:sdd-harness-pilot/codewiki-source-read
- secret-ref:sdd-harness-pilot/codewiki-provider
- secret-ref:sdd-harness-pilot/codegraph-source-read

**RED：必须先实际失败：**

- 未固定commit/镜像、未授权源码或错误项目源时拒绝启动/摄入；敏感代码不得用public服务作为替代
- wiki生成失败/commit陈旧/语言覆盖不足不得提供新鲜度通过；graph缺失不能阻断正确性协议
- 删除/停用graph后正确性协议保持可执行，错误服务实例或其它PAV索引不可被当项目结果

**GREEN：实施与探针：**

- 固定自托管版本和专用存储/网络，生成精确commit的code wiki；graph部署成可选独立结构查询组件
- 分别输出wiki生成manifest与graph coverage，外层纯gate按事前policy判断，不建立自己的调度/阶段
- optional关闭时报告未启用且不称已验证；若policy要求code wiki则必须真实API/MCP独立读回

**计划执行命令（尚未运行）：**

- node --test test/infra-code-knowledge.test.js
- node tools/infra/code-knowledge.mjs validate --registry infra/delivery/registry.json --json
- node tools/infra/code-knowledge.mjs probe --case pinned-code-wiki --json
- node tools/infra/code-knowledge.mjs probe --case graph-disabled-correctness --json

**证据与终态oracle：**

- 实际容器/进程、认证API/MCP响应、repoID/commit与生成manifest一致；抽查wiki引用准确性，结构查询有独立coverage
- 错误commit/私有源越权/语言缺口真实负例；停graph后相同候选正确性测试真实重跑，不靠配置开关文本

**备份与生命周期：**

- 备份生成策略/源版本/授权映射与必要wiki工件；graph可重建，重建必须当前权限重新拉取
- 恢复不得复用已撤销代码源缓存公开服务；worker/provider密钥不放在生成wiki或索引备份中

交接步骤：test-authoring先冻结本任务正负用例和独立oracle；实现者仅改上述归属，保存RED/GREEN和回归；独立Whitebox/审查者核对真实证据。原计划owner串行接纳结果并更新同一任务源；本文件不授权任何自动运行。

### I06 Git/CI、Registry、制品与隔离目标环境连通

原任务关联：4.1, 4.2, 4.3, 5.2；原场景：A13, A14, A16, A17, A19, F06, F09, B08。

**精确独占文件：**

- `infra/delivery/platform/repository-registration.json`
- `infra/delivery/platform/ci-policy.json`
- `infra/delivery/platform/registry-registration.example.json`
- `infra/delivery/platform/environment-registration.example.json`
- `infra/delivery/platform/artifact-retention.json`
- `tools/infra/platform.mjs`
- `test/infra-platform.test.js`

**公共接口：**

- PlatformInfra.v1 validate|probe -> repository identity/permissions/check policy/registry/environment evidence, no implicit remote policy writes
- IntegrationIdentity.v1 -> PR head/mergeSHA -> build artifact digest -> target deployment identity
- Environment.v1 -> isolated endpoint/owner/rollback authorization and readback oracle

**owner、秘密引用与前置输入：**

- 执行时重验repo1285806550 public/owner262266039 ql-wade及实际令牌范围；管理员身份不等于本次批准修改分支保护
- CI实际provider/runner和受保护策略来源、required-check名称与管理员登记；本阶段仅设计/只读核验，无远端策略写授权
- 专用Registry/制品存储、签名/来源机制、环境endpoint与独立业务readback、超时查询和批准回滚方案
- 本地模拟Git或本地Registry只能证本地机制；受保护平台拒绝合并/真实环境读回仍保留原P4_1/P4_2门

**独立秘密引用：**

- secret-ref:sdd-harness-pilot/ci-source-read
- secret-ref:sdd-harness-pilot/ci-check-publisher
- secret-ref:sdd-harness-pilot/ci-registry
- secret-ref:sdd-harness-pilot/artifact-reader
- secret-ref:sdd-harness-pilot/pilot-deployer
- secret-ref:sdd-harness-pilot/pilot-rollback

**RED：必须先实际失败：**

- 无远端修改授权时申请配置required checks拒绝；开发身份不能读取release/rollback secret
- 新head/mergeSHA复用旧check、缺项/skip/超时、tag改指不同digest实际阻断候选提升
- 部署成功但响应丢失先按原关联ID查询；未批准回滚请求被拒绝，已批准回滚要独立业务终态

**GREEN：实施与探针：**

- 只登记读回Git/CI/Registry/隔离环境身份和权限；提供最小scope专用credential引用
- 将精确integration SHA、build digest、部署receipt与目标readback贯通；平台writer归既有P任务和Comet closeout授权
- 无真实平台写授权则本地试点保持LOCAL_ONLY，不伪报required checks已配置或生产交付

**计划执行命令（尚未运行）：**

- node --test test/infra-platform.test.js
- node tools/infra/platform.mjs validate --registry infra/delivery/registry.json --json
- node tools/infra/platform.mjs probe --case repository-identity --read-only --json
- node tools/infra/platform.mjs probe --case registry-environment-identity --json

**证据与终态oracle：**

- 实际Git/平台只读回执、精确SHA/digest与隔离部署身份；后续P4_1真实缺check阻断合并记录另验
- 禁止只以workflow YAML、管理员可读、模拟Status green或本地push成功宣称平台已保护

**备份与生命周期：**

- 保留精确源/策略/制品manifest和受保护check历史，恢复后旧证据不能给新SHA放行
- 回滚同digest并保留上一已批准制品；凭据轮换或撤销后重新核验，备份不能恢复已撤权能力

交接步骤：test-authoring先冻结本任务正负用例和独立oracle；实现者仅改上述归属，保存RED/GREEN和回归；独立Whitebox/审查者核对真实证据。原计划owner串行接纳结果并更新同一任务源；本文件不授权任何自动运行。

### I07 独立监控、告警与原Runner进程监督

原任务关联：3.3, 4.8, 5.3；原场景：L08, L09, L10, L11, A11, H09。

**精确独占文件：**

- `infra/delivery/monitor/monitor-registration.example.json`
- `infra/delivery/monitor/health-contract.json`
- `infra/delivery/monitor/alert-policy.json`
- `infra/delivery/monitor/supervisor-policy.json`
- `infra/delivery/monitor/fault-domain-policy.json`
- `tools/infra/monitor.mjs`
- `test/infra-monitor.test.js`

**公共接口：**

- Health.v1 -> heartbeat_age, complete_scan_watermark, unresolved_isolation/deadlines and authority identity; read-only
- Monitor.v1 -> external fault-domain registration and alert delivery/ack/escalation only, never business phase/retry/ACL
- Supervisor.v1 -> restart same fixed Comet authority only after old writer gone; bounded attempts and escalation

**owner、秘密引用与前置输入：**

- Runner故障域之外的真实监控实例/owner/网络与持久性登记；同宿主container可证明进程故障，不能证明主机宕机2分钟发现
- 真实平台值班、知识权限值班、备用人/渠道与告警投递授权；当前任务不隐含通知发送授权
- 细分时限沿原契约：30秒心跳/30秒检查、>90秒心跳或>2分钟完整扫描无进展告警；最迟2分钟发现，另30秒投递目标，须容量/故障实证冻结
- 建议原实例10分钟内恢复并开始对账、5分钟最多3次重启；不是故障期5分钟隔离保证

**独立秘密引用：**

- secret-ref:sdd-harness-pilot/monitor-health-read
- secret-ref:sdd-harness-pilot/monitor-alert

**RED：必须先实际失败：**

- Comet进程宕机、主机不可达、心跳正常扫描卡死分别注入；同机监控随主机停止时必须标故障域未满足，不能PASS
- 首次隔离失败即时事件未投递/主渠道失败转备用/值班未确认升级真实计时；未经授权仅prepare不发送
- 监督器不得改phase、创建Comet维护operation或直接写Outline ACL；重启原实例与停止旧写者分别审计

**GREEN：实施与探针：**

- 外部监控读既有Comet事实，分开心跳/接收游标/完整扫描水位/隔离结果；告警投递重投与业务重试分离
- 监督器仅进程级restart，Comet自己恢复事务、补偿、重试；未知旧写者存活或存储归属不明时停止双启
- 未登记外部监控和投递渠道则无人值守发布pre-enable阻断，允许标本地进程探针完成但不偷换主机故障能力

**计划执行命令（尚未运行）：**

- node --test test/infra-monitor.test.js
- node tools/infra/monitor.mjs validate --registry infra/delivery/registry.json --json
- node tools/infra/monitor.mjs probe --case runner-process-failure --json
- node tools/infra/monitor.mjs probe --case external-host-down --json
- node tools/infra/monitor.mjs probe --case scan-watermark-stall --json

**证据与终态oracle：**

- 外部时间戳+失联起点+监控判定+已授权渠道送达/升级回执，分别计算检测与投递，不把告警当已隔离
- 原authority/RunID恢复后仍只有一个业务owner；遗漏权限由Comet全量对账接纳，不让monitor维护第二重试循环

**备份与生命周期：**

- 监控配置/值班映射与告警投递审计独立于Runner备份；不能因Runner卷故障丢全部告警证据
- 告警重投只恢复投递状态，不恢复业务phase/ACL；监控本身故障需独立既有平台监控发现，未登记保持准入缺口

交接步骤：test-authoring先冻结本任务正负用例和独立oracle；实现者仅改上述归属，保存RED/GREEN和回归；独立Whitebox/审查者核对真实证据。原计划owner串行接纳结果并更新同一任务源；本文件不授权任何自动运行。

### I08 备份恢复、单权威迁移与R10未完成保留

原任务关联：3.3, 4.6, 4.8, 5.3；原场景：A10, A11, H08, H09, L06, L11, B08, U07。

**精确独占文件：**

- `infra/delivery/recovery/backup-policy.json`
- `infra/delivery/recovery/restore-policy.json`
- `infra/delivery/recovery/retention-policy.json`
- `infra/delivery/recovery/authority-transfer.schema.json`
- `infra/delivery/recovery/operations-runbook.md`
- `tools/infra/recovery.mjs`
- `test/infra-recovery.test.js`

**公共接口：**

- Backup.v1 -> consistent manifest of Comet state/transaction/receipts/approved payload plus knowledge/database/objects/config refs
- Restore.v1 -> restore into quarantine, authenticate current permissions, fence old writer, verify same operation and readback before release
- Retention.v1 -> R10 A: unresolved Run/knowledge obligation retains sole workspace; cleanup requires verified completed or separately approved migration+restore proof

**owner、秘密引用与前置输入：**

- 各数据owner签发备份读取/加密/恢复与保留授权、独立备份目标和密钥恢复owner/备用人
- RPO/RTO、频率/保留期/容量阈值由试点实测及owner确认；未确认不编造恢复时限或自动清理期限
- 原Runner永久丢失时的受控归属迁移批准、旧writer隔离证据和新的authority登记；不能共享目录冒充分布式fencing
- 所有恢复资源使用专用隔离项目，禁止覆盖现有PAV/其它项目数据或使用其凭据

**独立秘密引用：**

- secret-ref:sdd-harness-pilot/backup-writer
- secret-ref:sdd-harness-pilot/backup-encryption
- secret-ref:sdd-harness-pilot/restore-reader

**RED：必须先实际失败：**

- pending Outline发布/未知远端结果/唯一payload在工作区时cleanup实际拒绝；磁盘压力只告警不静默清理
- 不完整备份、校验不符、缺密钥、DB/附件时间点不一致、旧writer未隔离时恢复不启用
- 恢复旧ACL或重加离组成员、恢复旧grant/旧attempt结果、复制状态另开writer实际拒绝

**GREEN：实施与探针：**

- 备份包含原Run权威文件/事务/操作/回执/批准payload与版本；数据库和附件可一致恢复，索引可重建且校验
- 隔离恢复后先冻结新发布、调和未知写、完整权限对账和优先隔离，独立验证后由同Comet继续
- 原已完成产品历史保留；权限维护仍由同引擎关联作业处理；cleanup门禁使用Comet真实义务不只archived/git complete

**计划执行命令（尚未运行）：**

- node --test test/infra-recovery.test.js
- node tools/infra/recovery.mjs validate --registry infra/delivery/registry.json --json
- node tools/infra/recovery.mjs probe --case pending-cleanup-denial --json
- node tools/infra/recovery.mjs probe --case quarantine-restore --json
- node tools/infra/recovery.mjs probe --case old-writer-denial --json

**证据与终态oracle：**

- 真实备份manifest摘要、恢复资源ID/版本、同Run/operation与权限独立读回；记录停机起点/恢复/补偿结束和暴露违约
- 容量告警证据和cleanup失败状态可重现；恢复前后唯一owner证明，已下载数据不能声称可追回

**备份与生命周期：**

- 本任务验证备份本身可恢复：至少一次真实DB+附件+Run一致恢复演练与破坏/撤权负例
- R10 A不能用“有备份”提前清掉唯一未完成工作区；只有另行确认迁移且恢复已证明才允许变更该边界

交接步骤：test-authoring先冻结本任务正负用例和独立oracle；实现者仅改上述归属，保存RED/GREEN和回归；独立Whitebox/审查者核对真实证据。原计划owner串行接纳结果并更新同一任务源；本文件不授权任何自动运行。

## 检测、隔离与故障域验收

G15 A沿已确认边界：正常依赖下实际权限变化起3分钟内检测、再2分钟完成资源端隔离和独立读回；漏报由每分钟完整扫描兜底，每轮不超过1分钟。原契约的Runner心跳/监控周期均30秒，心跳年龄>90秒告警、最迟2分钟发现，另有判定后30秒送达目标。两种时间必须分别记录，不写成故障总送达已≤2分钟。细分参数仍需容量/故障实证冻结。

独立监控必须位于Runner故障域之外。相同宿主的另一个container仅能证明Comet进程宕机，无法证明宿主掉电/网络中断时2分钟发现；真实external monitor registration和投递owner未登记前，无人值守发布保持pre-enable阻断。监控故障还需既有独立平台监控发现，不通过增加业务控制器补洞。

告警/投递重投归独立监控；业务隔离、持久重试、恢复补偿仍归同一Comet operation。进程监督器仅重启原实例，不迁移authority、不写ACL、不派发Agent。首次隔离失败即告警；Runner恢复先冻结发布、调和未知写、全量对账、优先隔离，再独立证明恢复。故障期间接受隔离超时，但必须保留暴露窗口和违约，告警成功不代表已隔离。

## R10与恢复关闭门

整体completed前保留唯一工作区、权威Run、事务、批准payload、回执及知识收尾记录。容量不足先告警，不能按超时静默删。存在备份不等于允许提前清理；只有另行确认的受控迁移并已证明完整恢复才可能改变保留条件。恢复时先隔离旧writer并证只有一个authority，数据库/附件/知识/Run一致读回，当前权限重新核验，不能回放旧ACL或旧grant复活撤权成员。

## 交接仍需提供的真实输入与启用阻断

1. 各组件实际版本/digest/许可证/资源预算资格；当前全部尚未完成，不生成虚假已锁镜像。
2. 固定Runner的真实owner/角色隔离及控制卷权限证明；本机同主体合作模式不能宣称防篡改。
3. Outline实例/受管文集/有效受众/源用途授权、OIDC真实issuer/成员映射、publisher与隔离grant。
4. 独立Git/CI/Registry/目标环境身份和管理员配置/发布权限；没有授权不改远端分支保护或部署生产。
5. Runner故障域外监控、真实值班/备用渠道和发送测试授权；未登记不能承诺host-down检测/无人值守。
6. 备份目标、恢复密钥owner、RPO/RTO/保留期/容量阈值与一次真实隔离恢复证据。
7. deepwiki-open与graph的实际分发、语言/规模、源码外发范围；生成服务provider和各源token独立引用，不借用其它应用凭据。

这些是交接前置输入/后续启用门，本轮计划不把缺失改成不适用，也不意味着用户必须现在提供秘密。执行者应先完成可逆本地配置、用独立资源实证，只有确实需要有权人输入的动作才停在对应门。

### 2026-10-22 amendment 3 注记（llmwiki 项目化）

I04 的 llmwiki 发行版解析改为项目内：SDD_HOME=<repo>/.sdd，克隆 pin 075c5b4 落 .sdd/repos/llmwiki，venv .sdd/venvs/llmwiki-311，wiki 根项目内（slug 目录名撞根随之消除）。package.lock.json 的 launcher sha 与 requirementsLock digest 语义不变（内容不变则哈希不变）。
