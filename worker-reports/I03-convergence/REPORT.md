# I03 建设工件与真实资格缺口交接

本工人基于 `2a45bb414cb4d72b9f2a48e00390c6ae8b81f441`，分支 `codex/comet-outline-qualification`。I03 的本地机制和配置工件可审查，whole I03、资源资格与新 profile 旅程未验收。root 仍是唯一 controller；未写任务/DAG/caseplan/业务 phase，未创建 worker/Goal/监督。

## 已实现的建设工件

- `outline.mjs`：所有五入口共用 registry/ref/domain 输入形状与语义准入；nullable/数组/元素/版本/跨项目/重复组件在 map/find/诊断转换前拒绝。qualify/up/probe 不再忽略 validate 违规。
- 镜像选择与旧 digestAuthenticated/admission 文本保持声明层，不能变成 VERIFIED 或 ready=true。up/stop 始终要求当前完整资格和独立 operation authority，未触发 Docker 启停。普通 probe 不因有 endpoint 自动请求 `/api/config` 或暗用宿主环境变量。
- managed-publish 的局部机械拒绝覆盖完整分页/重复/缺页、collection/parents/page/groups/shares/public 闭包、principal 未映射、独立 publisher purpose、403/409/timeout/network/5xx 不能当 absence；全部声明满足仍 UNVERIFIED/liveReadback=false。输入错误与输出脱敏统一处理，不将 fixture ACL 当活权限。
- Compose 现在显式绑定 app/PG/Minio 必需字段；应用不接 shared env_file 或 PG/Minio bootstrap 变量。PG app 身份与初始化身份、S3 bucket app key 与 bootstrap key分开声明，尚未 provision。对象存储补上原生 server command；具名卷/内部网/loopback约束保留。
- S3 参数按已安装1.11.0与SDK静态源纠偏到 AWS_REGION、AWS_S3_FORCE_PATH_STYLE、AWS_S3_UPLOAD_BUCKET_NAME/URL、AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY。环境例仅是引用契约，不可把字面 secret-ref 直接当运行密码。
- own collection 登记修正真实已知历史 UUID 与 URL；owner principal/grant和有效受众仍未登记，不借 admin 可读性授权。隔离集合未虚构。旧 image upGate 移为历史准入记录，当前入口关闭；静态 create.id/lastRevision 支持仅作为静态事实，API状态仍 UNVERIFIED。

## 实际执行与证据层

| 实际检查 | 结果 | 证明范围 |
| --- | --- | --- |
| 修改前原测试，显式 TAP/离线依赖与 fetch guard | 18/18 | 原组件基线 |
| 四组新增公开 seam | 4 项真实行为 RED；原合同1项通过 | 输入/共同门禁/错误分页/请求泄漏，不是依赖缺席 RED |
| 必需 Compose 参数与 shared env 控制 | 1 项真实 RED | 配置结构约束 |
| 外项目/重复组件/未知主体补充 | 2 项真实 RED | 独立资料域与未知权限 fail-closed |
| 最终 `node --test --test-reporter=tap test/infra-outline.test.js` | **23/23，0 fail/skip**；04:59:37.982748→04:59:56.684808 UTC | 机制回归，未证明 live ACL/CRUD |
| registry、knowledge-authz、backup-restore、recovery 四套关联回归 | **82/82，0 fail/skip**；04:59:35.460635→05:00:32.739305 UTC | 直接相关组件回归，不混主检出全量数据/I02已知失败 |
| 实际 Docker Compose `config --format json` | exit 0，所有变量为显式合成 fixture，私有 env/project目录 | 真实配置编译；loopback/internal/独立卷/app环境白名单/Minio command，未启动资源或证明权限 |
| syntax / diff / JSON 与输入摘要核对 | 通过 | 当前声明范围 |

首轮22/23中的一个失败是旧负例用两行固定锚点替换，新增环境块后替换未发生；已改成真正注入 host network，并增加负载落地断言，保留原 HOST_NETWORK_FORBIDDEN 条件。原始失败与后续结果都在 `run-results.json`，没有放宽断言。最终两套使用相同8文件输入集合 `87f6a637ead9d2ba316c2cf39078cecbcf504064d2144f32f2c4caaf451b9edf`。

TAP 运行使用本任务校准的五个外部 CLI deny guard 和 fetch deny preload，避免原测试触达真实 API。真实只读观察另行按原授权执行：五容器 running、app healthy，固定 `/_health` 200/OK；PG未发布5432，app3000仅127.0.0.1。安装版本1.11.0，package license为Business Source License1.1，镜像OS/arch/size/本地RepoDigest与静态文件SHA有原始记录；这不等于来源/许可证使用/平台兼容/恢复已资格化。

真实挂载元数据固定了 `outline_outline-data`、`outline_outline-db`、`outline_outline-attachments`；未读取数据。app+Dex有额外非internal的同项目access网络，app环境名字含Minio root变量；当前端口仍loopback，未把这解释成公网暴露或已获得值/权限。它们与新模板的差异须 operator 审查后整改，运行栈没有被修改。Redis有匿名/data卷，也未作为ACL权威或恢复成功证据。

原始执行UTC、输入、exit、raw/display SHA 与资源/静态/编译证据在本目录；raw与合成rendered配置留在 ignored `.local/I03-convergence/`。归档前保全该目录以及原 `.local/I01-convergence/`。没有读取key、env值、cookie/session、重跑一次性探针或新增认证API；c5c538仍是原历史观察。

## 可移交的准确缺口

1. 独立 Reader/Publisher/Isolator/issuer、PG/S3 bootstrap/app 身份、运行时 secret-store/授权挂载及有权 owner grant仍未提供。I01拥有的四条最小引用建议在 `CROSS-OWNER-INPUT-PROPOSAL.json`，仅提案，未改catalog/model。
2. issuer/discovery/client/subject映射、普通/离组/未登录原生会话、有效受众全渠道分页及源许可交集未读回。原生浏览器runtime已知未恢复，没有截图/网络证据；没有换HOME/CODEX_HOME、读取其它应用会话或使用API key替代UI。
3. 实际 create UUID、stale lastRevision→409、丢响应恢复、附件签名残留、角色拒绝、重启/DB/对象存储持久性和恢复都未执行。只有安装静态支持及本地机械拒绝，不能关闭这些义务。
4. 运行配置整改、fixture写/重启、只读新API、实际身份/配置值等需 root 审查 `NEXT-QUALIFICATION-PLAN.md` 后分别冻结资源/字段/边界/回退及授权。没有准备秘密提取执行器或自动授予动作。
5. `typed-case-binding-advice.json` 按原 U01–U08/H04–H05/L02/L04/N05提供13 case/35条必需断言、现有CLI/安装路由/字段/SHA/精确预期产物路径和proof layer，所有真实终态均UNVERIFIED，未生产的路径明确标识。仅建议，root审核后写唯一caseplan；没有新case ID。

## 输入与主控状态分离

本树未rebase。任务启动给定合同4414780d…，整理时main已推进为dff53cec…，差异仅dependency_readiness，I03<-I01建设边和129/103 scope保持；两份源摘要同时记录，未据此扩大权限。caseplan仍56e3967c…。case模块SHA注明本树基线并附主检出观察SHA，最终必须由root绑定集成后的真实生产者。旧I01 raw/报告、正式Comet lock、根规则、hooks/MCP、权限模型和注册表都未修改。
