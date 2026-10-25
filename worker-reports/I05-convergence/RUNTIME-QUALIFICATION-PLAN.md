# I05 固定资源与真实资格化执行计划

状态：交原唯一控制器核对，当前未部署、未摄入、未调用模型。既有明确授权继续有效；两次已用尽的旧专项许可不复用。本计划不签发 grant，也不自批执行。

## 1. 无凭据空实例启动与健康（可先独立核对）

源：公开 AsyncFuncAI/deepwiki-open，immutable repo975318071，源码3e0f503b0cc815c1525a063911524d233bda2400，MIT。已实际读回17个固定 Git blob、公开构建 workflow 与 OCI metadata；没有上游 release，不以package0.1.0当正式发行。镜像 `ghcr.io/asyncfuncai/deepwiki-open@sha256:90a0cfaf03f61fe903b72cb58b44832c63b49749bf8f5348803fd0aafa2a822b`；arm64 manifest `sha256:0157488acc078f9b34d7f00db120fb1364375f74896c5dfa6b832f093db1c824`，amd64 manifest `sha256:fda89e9c10a8668b4745f74d6a0e61a00e509f842ac387479e9b0cdc58e42d56`。arm64 image revision标签确为上述源码，license标签MIT；这不代表运行与供应链签名认证通过。

执行主体为原控制器批准的本机 I05 operator，资源只新建 `sdd-harness-i05-qualification` Compose project，一个 codewiki-app，独立 internal 网络与新具名卷 codewiki-data、codewiki-logs。前端127.0.0.1:17400→3000，后端127.0.0.1:17402→8001；占用则停止，不自行换目标。不启动Graph，不挂载主机代码、Docker socket、HOME、旧数据或秘密目录。PORT8001、NODE_ENVproduction、SERVER_BASE_URLhttp://127.0.0.1:8001、LOG_FILE_PATHapi/logs/application.log、NEXT_TELEMETRY_DISABLED1；不注入任何 provider/source/auth key，不读 .env 或 credential store。新卷分别挂 `/root/.adalflow`、`/app/api/logs`，不复用其它项目缓存。内存上限6g、保留2g、CPU2、cap_drop ALL、no-new-privileges。无外部网络，所以无法发送代码到模型。

步骤是端口/项目名/新卷无冲突预检→仅拉取固定digest→以最终候选Compose编译配置并核对输入SHA→仅启动这一个空实例。允许无凭据 GET `/health`（期望 status=healthy、service=deepwiki-api）和前端`/`，禁止redirect。只读容器状态/镜像ID/固定源码文件SHA/挂载目的地/网络/端口与不含秘密的启动诊断；不调用 repo/prepare、wiki/tasks、chat/completions、wiki_cache 或任何写API。无源、无模型、无MCP注册、不改现有服务。

失败回退只停止并移除本project新容器/新网络，保留新卷及日志供审查；不 `down -v`、不prune、不清旧I01/I03、也不删旧镜像。root核对并明确可执行这份空实例计划后才进行。当前机器是本机候选，不推断其它宿主支持。

## 2. 代码域与生成前置（本轮空实例不包含）

源只能是本项目 `ql-wade/sdd-harness`、repoId1285806550、当前principal262266039。最终 ingest commit、逐文件清单与归档SHA必须在提交后重新冻结，不用远端旧master cd64618、rpamis、PAV缓存替代候选。建议先只选 bin/lib/tools/contracts/hooks 与必要架构说明；排除 .git/.local/.sdd/凭据、历史证据和无关知识。清单与摘要交root确认披露边界后，才把这个快照放进专用数据卷；固定commit前后均核验。

provider/model/endpoint、embedding provider/model是两个必须登记的实际数据目的地，当前均未给出；codewiki-provider、codewiki-source-read、codegraph-source-read仅是独立purpose引用，仍NOT_PROVISIONED。本轮不读取其它服务的API key，不用旧三方评审材料许可，不借Outline owner key，不发本地未公开代码。实际source read、向generator和embedder发送文件、费用/资源上限、完成后保存期限必须由原控制器按现有授权范围核对；缺值不构造provider或执行。

## 3. 上游缺口与接线要求

固定上游的Repo默认 `--depth=1 --single-branch`，请求/缓存键不暴露immutable repo ID/commit。原生缓存只按repo类型/owner/repo/language命名；不得把缓存命中当当前commit。需要受控离线快照导入与生成manifest独立记录snapshot/file hashes、实际provider/model、generation时间/状态、coverage和wiki工件SHA；读取缓存后再核验同一绑定。

GET wiki_cache/processed_projects 及任务读接口未证明逐项目鉴权，DEEPWIKI_AUTH_MODE/code端点不构成Reader ACL。没有原生MCP路径证据。团队接入前需要实际认证/源权限过滤与已获准既有MCP读取适配；边界由原P4_4/授权owner接入，不能在I05另造服务控制器或写活MCP。未解决前API/MCP/多主体隔离维度UNVERIFIED，空实例healthy也不ready。

## 4. 必需正负例与恢复

真实生成时冻结同Run/action/source commit/provider/model/manifest/wiki SHA，并由独立读者对API/MCP、引用文件和coverage读回。过期commit、失败生成、错repo/实例、覆盖缺口、401/403/掩蔽404/429/timeout/5xx/redirect、重复/缺页均不能当absence或新鲜。Graph在单独授权后才可选安装，不承接正式需求/架构/知识权威；卸除Graph后的当前正确性测试与Comet检索链必须实际复跑。

wiki卷与授权映射按I08一致性备份；恢复后先核当前源权限再提供访问，不暴露撤销源缓存。生成manifest与实际API/MCP证据缺任一，C06/N05对应门仍保持未完成。所有动作交同Comet原operation/恢复义务，不新建调度/阶段/全局进程监督。
