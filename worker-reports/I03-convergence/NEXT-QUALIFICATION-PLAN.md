# I03 实际资格化与最小权限计划（待原控制器审查）

本计划未执行，不是授权文件。当前只完成代码/模板机制、无凭据健康与静态元数据观察。一次 owner-key 三 API 授权已消耗；后续使用独立 purpose-bound 运行时身份与正常受管后端，值不进入模型、argv、日志或报告。Comet 继续拥有唯一 Run/operation、重试、恢复和完成决定。

## 固定资源和当前未通过项

- Outline `http://127.0.0.1:3000`，app `outline-outline-1`，imageID `sha256:777f35ad2ee7e86fca52a0a24fb5a37661d5440e2665d6ea42e8f4b2acc126ce`，安装版本 1.11.0。PG/Redis/Minio/Dex 分别为同项目 `outline-outline-postgres-1`、`outline-outline-redis-1`、`outline-outline-object-store-1`、`outline-outline-dex-1`。
- 历史 team `cb59131d-2d7c-421e-a818-44f84236b56d`、managed collection `a3c6b4d8-1f1e-473d-9f49-ea5c48b7a818`；仅身份历史事实。isolation collection、独立角色 actual user IDs、issuer/client/subject 映射、允许披露源域、grant ID 均未冻结，先保持 UNVERIFIED。
- 已观察持久卷 `outline_outline-data`、`outline_outline-db`、`outline_outline-attachments`。Redis 的 `/data` 是匿名卷，不当作 ACL 权威；当前没有恢复演练。保留现有全部数据/卷。
- 当前 app 与 Dex 还连接 `outline_outline-access`（internal=false）；PG/Redis/Minio 仅连接 internal 网络。端口仍为 loopback。owner 需要审查必要 OIDC/客户端路由，不能把这项偏差或模板全 internal 直接算作运行隔离通过。
- app 环境字段名含 `MINIO_ROOT_USER/PASSWORD`。没有读取值，因此不声称已取得该权限；资格化前需由 operator 清理应用的 bootstrap 输入并证明最小作用域。
- 现有 app 中使用的部分 S3 名称与 1.11 静态客户端不一致：客户端读取 `AWS_REGION`、`AWS_S3_FORCE_PATH_STYLE`、`AWS_S3_UPLOAD_BUCKET_NAME/URL`，SDK 默认 provider 读取 `AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY`。模板已纠偏，运行栈尚未修改。signed URL 的 endpoint 还必须同时对 server 和真实 browser 可达，内部容器 DNS 本身不足以证明 Web 附件通道。

## 审查后分开授权的动作包

| 动作包 | 固定目标/原生支持 | 输入、边界和解锁条件 | 独立读回/回退 |
| --- | --- | --- | --- |
| 1. 非秘密登记补齐 | 上述项目实例、OIDC/存储配置 owner；I01 refs 与 P4_7 model | owner 提供/授权导出 issuer/discovery/clientId/redirectUris、bucket/region/endpoint、subject mapping 的非秘密字段。值未知时不构造任意 URL。`CROSS-OWNER-INPUT-PROPOSAL.json` 四条引用先由 root 审查，均 NOT_PROVISIONED，不包含值/签名 | 记录字段版本/摘要及有权 owner；保留原登记和 c5c538 历史原件，不将旧 LIVE 字段沿用 |
| 2. 独立身份与运行时绑定 | Reader、Publisher、Isolator、issuer/审批主体，PG bootstrap、S3 bootstrap 与 app principal | 正常受管身份/秘密后端提供最小用途绑定与签发链；必须冻结实际主体 ID/target/actions/expiry/source audience。Reader 只读相关文集/ACL，Publisher 只读写获准内容，Isolator 只做获准隔离，issuer 与普通 Agent 分离。OIDC 测试身份通过原生登录获取各自会话 | `auth.info` 必须与已登记的对应主体/team 一致；逐角色 OS/tool/API 拒绝证据。Native browser runtime 先恢复，当前没有可用会话/截图。禁止借历史 owner key 补齐角色 |
| 3. 只读受众资格 | 固定 team/collection；`collections.info/memberships/group_memberships`、相关 `documents.info/memberships/group_memberships`、`groups.memberships`、`shares.list/info`、`documents.search`、`attachments.list` 均有安装静态路由 | 这是新的 API/身份授权需求，当前未执行。只访问固定文集及其返回、且核验属于固定 team 的文档/组/share IDs。每页记录 total/offset/limit、唯一 ID、实际 principal 映射；403/timeout/漏页保持未知，不解释为空/公开。只读 API 原生 activity 记账应记录 | metadata whitelist、请求 ID/时间/主体、完整分页、独立复读摘要；collection/parents/page/groups/shares/public 必须闭合。扩大范围或缺权限交 owner，不自动增权 |
| 4. 运行配置整改 | 既有 compose/runtime owner 和上述固定服务/卷 | owner 先保存加密/受控回滚材料，审查需要的网络和 app-only 字段。S3 app 使用 bucket-scoped 独立 key；PG app 使用独立 DB role。此包包含实际 setup/reconfigure/restart 写动作，当前无授权。模板编译 fixture 不是部署输入 | 保留全部旧卷/DB/知识；operator 有权回退原配置与镜像。实际配置白名单读回、OIDC normal login、app→PG/Redis/S3连通和 signed URL 双向可达证明后才资格化 |
| 5. 可丢弃文档/附件及并发负例 | 静态支持 `POST /api/documents.create` 的 `id/collectionId`、`documents.update` 的 `id/lastRevision`；实际 response `data.id/data.revision`，DB 内部字段为 revisionCount | 精确 disposable UUID、title/content hash、目标文集和原 operation 必须在首次请求前由 root 冻结。只使用获准无业务内容的 fixture。create/read/update/upload、受控响应丢失和第二合法 writer 都是新的写/故障注入授权；当前没有客户端或执行权限 | 真实 API + DB/对象存储 + 原生 UI 独立读回。409 必须实际观察；不刷新 revision 盲覆盖。403/timeout/5xx 不新建。附件 URL/签名不进入普通日志，保存 hash/expiry/结果 |
| 6. 隔离与维护负例 | 新登记 isolation collection ID 与当前 Isolator grant；`documents.move`/获准 shares 操作须按原生能力和 grant逐项确认 | 目标 ID 目前未登记，不能对任意文集执行。ordinary/member/offboarded/unauthenticated 会话逐通道执行；grant过期或源权限收缩触发同 Comet operation。未获准的 share/ACL action不自动补上 | page/subtree/share/search/attachment 每一通道都有实际拒绝/残留证据；任何残留保持 isolating/unknown并交 I07/P4_8 告警。标 stale/move/unpublish/admin可读均不足 |
| 7. 持久性与恢复 | 上述精确 app/PG 容器及三持久卷；I08 owner | I08 先提供一致性 DB+附件+配置引用备份和可回退点。实际 app/DB restart、restore、密钥轮换/撤回均需新的范围授权；当前仅观察挂载，没有执行 | 重启前后 fixture doc revision/content/attachment hash独立相等；恢复先封闭访问并重验当前成员和源权，不回放旧 ACL。原数据保全、清理仅针对另行确认的 disposable UUID |

所有真实写动作应由原 Comet 调用已授权执行者。报告里的 endpoint 表示安装源码存在，不表示当前凭据能调用；不能把本地 classifier/HTTP health 或静态参数支持当成 actual API/UI/权限/恢复 PASS。root 可按这些具体动作包提问并冻结范围，未提供的身份/URL/UUID/grant/备份值继续阻断对应动作。

## 执行主体冻结表

| 主体 | 精确作用域/端点与读写 | 当前授权缺口/回退边界 |
| --- | --- | --- |
| 项目 owner / 新授权 operator | 固定 project repo1285806550、team cb591…；审批非秘密字段、独立 principal/ref/grant、既有5容器配置整改；正常 OIDC/native 管理入口 | ql-wade/历史Outline user17fcd…不能由一次 key 观察直接继承当前权限。需要 owner 当前身份和明确 operator grant；rollback 保管在 owner 后端，不由Agent读取值 |
| 拟 `svc:sdd-harness-pilot/outline-reader`，实际 userId待登记 | 仅上述固定 collection a3c6…及其已校验归属的返回 IDs；auth.info、collections.info/memberships/group_memberships、documents.info/memberships/group_memberships、groups.memberships、shares.list/info、documents.search、attachments.list；全为元数据读 | 新 purpose ref/principal/read scope、native Web角色会话未提供；403/漏页停止该维度，不借owner材料。读动作无内容/ACL回退写 |
| `outline-publisher` ref 的独立实际主体待登记 | 仅审批后的 disposable document UUID、collection a3c6…、payload hash；POST documents.create(id,collectionId,...) / documents.update(id,lastRevision,...)；独立 reader读回 | 实际 principal/允许写grant/fixtureUUID/操作与内容摘要待冻结，不能执行。未知结果保持同operation，回退只涉及另行授权的fixture，不覆盖他人修改 |
| `outline-isolator` ref 的独立实际主体待登记 | 只对冻结的fixture文档及新登记isolation collection；documents.move 和明确授权的share收窄操作，逐渠道读回 | isolation UUID尚无；需要owner先通过正常管理界面/确认的原生 collections.create 入口建设并返回实际UUID、证明私有闭包后才可 move。创建schema参数/未知结果调和仍须冻结，不预造UUID/权限。失败保持isolating/unknown和原operation，不自动改任意ACL |
| 独立 issuer/审批主体 | 在受保护授权后端签发本项目/source/target/actions/expiry/audience交集的限定grant；Outline内容API不是签发入口 | 实际主体、后端和签发能力未登记；普通Agent/Publisher/Reader均无此权限，审批记录不能自批或自动续期 |
| DB/S3 bootstrap operator 与 app principal | 精确PG角色/bucket/application policy由新独立bootstrap引用建设；app只拿其DB/bucket用途绑定；上述三卷和现有数据保全 | 实际初始化/策略写、credential provision、重启未授权。先受控备份，审批差异；保留原配置/卷回退，不重置DB，不把Minio root或PG bootstrap材料放入app |

上述 `svc:` 名称仅为待注册的逻辑引用建议，不是已存在的真实账号、凭据或权限证明。任何 actual userId、issuer URL、document/isolation UUID、grant ID 或 backup ref 为空，都必须保持对应 live case UNVERIFIED。

## typed case 接口

`typed-case-binding-advice.json` 仅覆盖原 U01–U08/H04–H05/L02/L04/N05，共 13 case /35 条必需断言。保留原 intended command 与证据目录，列出已实现本地 CLI、安装原生路由/字段/SHA、当前 scope proof layer 和尚未生产的 exact artifact 路径。所有 live/原生 UI/持久化/same-Run 断言都为 UNVERIFIED；空冻结值必须先补齐并审核，不能由 fixture 标签代填。root 审查后才写唯一 caseplan。
