# P1_3 固定 CLI S0 配置与执行准备（未执行）

结论：可以进入固定 profile 的受控 CODE 实施；本包不授予真实 CLI 启动或业务资格。本轮仅保存 ignored 准备材料，产品仍精确 `d4de54683c48e6ec12d2afa5af73dee93b7f1315`，未改源码、默认 main、DAG、锁、ACL、凭据或用户配置。未启动真实 CLI、认证/status、模型、MCP、Docker、服务；未访问 auth store/keyring，也未提取token值。

## 固定输入与实际元数据

- Darwin arm64 二进制本轮只读重新计算 SHA：`8813367285524ac798dd96d1b071aea30d58708c7226fd236cd275cf1cfdee31`，249952688 bytes，普通可执行文件。精确路径、149词 argv 模板、72项固定值见 `PROFILE.json`。版本来自既有 `codex-cli 0.163.0` 执行记录，本轮未重新执行 help/schema/version。
- 原0.163生成协议 schema 复用；另核版本tag `rust-v0.163.0` 的配置 schema 与实际公开启动源码。旧40项 profile 键全部有声明，14项新增固定值及18个真实 user MCP 覆盖见 PROFILE。schema声明只证明形状，不证明有效配置或工具行为。tag源码与已安装binary不是编译来源证明。
- 当前 HOME `/Users/mac`，CODEX_HOME 未显式设置，默认 `~/.codex` 是已有软链；保持继承，不重定向。user 配置真实路径和 SHA 见 `config-metadata.json`，只输出名称、布尔及文件元数据，未输出 URL、command、header、env、token 或指令正文。
- 当前非秘密选择是 builtin `openai`、`gpt-6.1-sol`；未设置顶层 openai/chatgpt URL 覆盖，另有一个 custom provider 定义但未选择。未查看登录状态；现有普通 CLI 认证是候选，不新增模型 API key 假定。控制签发密钥、Outline服务身份仍是独立义务。

user18名：chrome-devtools、computer-use、exa、excalidraw、gitee、mcp-web-reader、memory、node_repl、notion、open-websearch、pencil、sequential-thinking、tavily、web-reader、web-search-prime、weixin_search_mcp、zai-mcp-server、zread。只有computer-use显式enabled=false，其余未声明布尔不等于禁用。

main项目层3名：chrome-devtools、github、playwright。合并去重20是当前**登记名称盘点**，不是实际effective集合。S0在独占 `/private/tmp/<owned>/work` 空cwd，只给实际继承的18个user名加固定 `enabled=false`；不把main独有github/playwright造为disabled占位项。0.163 `mcp_types.rs:489–544` 在enabled解析前仍要求真实command或url，只有enabled=false的新项会invalid transport；不造dummy command补洞。以后实际项目cwd重新读取实际继承集合与来源契约，不沿用18声明。

## 配置闭包与真实源码界限

`config/loader/mod.rs:110–137` 明确package/admin(system MDM)/system/cloud/user/profile/project/runtime多层；requirements另受system/cloud/legacy/admin约束。现场 `/etc/codex/config.toml`、requirements.toml、managed_config.toml 均不存在，拟S0三个祖先 `.codex/config.toml` 均不存在。user selector未设；有历史litellm profile表但本方案不选择它。package/MDM/cloud/未来reload没有实际原生读回，不把这些缺席观测扩成全闭包。

`mcp_servers={}` 深合并会保留下层项；已知18名覆盖加文件摘要也不能阻止未知cloud/MDM名或并发配置变化。它只是限定S0配置候选，不是默认拒绝所有MCP的权威。完整项目工具链要复用原生受管requirements/ToolPolicy或另一个已独立验证的原生闭包；本轮不写 `/etc`、MDM、全局文件，不换 HOME，不新建gateway，不造注册/授权。Root在S0后按真实项目来源继续核验。

几处不能误用的开关：

| 项目 | 固定0.163源码结论 | S0处理 |
|---|---|---|
| remote control | features.remote_control在features/lib.rs明确no-op；默认AppServerRuntimeOptions是ResolvePersisted | 提议CODE固定注入 `CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED=1`。CLI主线程消费并移除此内部marker，选DisabledEphemeral，controller将初始desiredState置Disabled。此为**版本锁定的内部兼容口**，需Root审CODE和真实启动核验；不开放caller env，不能称稳定公开flag |
| plugins/apps/hooks/notify | plugin启动warmup本来在initialize前调用；manager:2824起由plugins_enabled硬门控制 | 固定plugins/apps/enable_mcp_apps/hook/plugin_hooks/remote_plugin=false、notify=[]；这些是源码候选门，实际启动仍要看进程/网络副作用 |
| shell/FS | spec_plan:1245起需独立ShellTool；stable_environment_tools可让零environment仍广告工具 | shell_tool/stable_environment_tools/view_image=false，environments=[]不能单独作Shell/FS隔离证据；S0根本不启动thread/turn |
| 子agent/Goal | agents.enabled、multi_agent/v2、goals有真实配置入口；multiAgentMode已ignored | 全部用固定CODE关闭，不用旧字段冒安全控制；不发任何Goal/协作/执行RPC |
| skills/memory/input | user现启用memories/chronicle，且存在skills/hooks/plugins/notify配置 | 增加关闭memories/chronicle、memory use/generation、host skill discovery及自动MCP依赖安装的候选值；不把配置键存在说成无注入证明 |
| 模型内置utility | spec_plan可按model catalog注册clock/test_sync/send-message等，部分为feature OR catalog | 说明固定profile不是全局工具allowlist。S1和正式工具链必须补实际注册/拒绝及effects证据，不以模型自愿不用工具为通过 |

## 唯一最小 S0 动作计划

执行入口由Root受控CODE冻结，非worker JSON/argv/env选择。先完成下述CODE与公共seam测试；本包 `runnable=false`，没有启动句柄。

1. Root创建新的0700、无链接独占 `/private/tmp/<owned>`；`work/`保持空cwd，SQLite/log/公开instructions均在它的兄弟路径。只新增这一个自有根；不更HOME/CODEX_HOME，不复制auth或其它项目资料。公开instructions沿用eb341冻结正文/SHA；实际路径、二进制、全部argv/env、配置来源摘要在启动前再冻结。若文件/来源漂移，按真实不匹配拒绝，不能只更新摘要使其继续。
2. 精确可执行文件+SHA与 `PROFILE.json` argv模板（含strict-config）组合；只接受固定literal profile，不开放自由-c/provider/module/role。fixed env只增加上表准确marker=1，原caller env白名单仍仅PATH/LANG/TZ/TMPDIR；HOME/CODEX_HOME按原值存在性继承。没有API key/token/preload/proxy传递。无daemon/proxy/remote/ws/unix listener模式。
3. 只发送 `initialize`（experimentalApi=true、explicitGatewayOauth=true、requestAttestation=false）及 `initialized`。不发thread/start、turn/start、auth/account/status/login、MCP/discovery/config-write。capabilities只选择协议行为，不授权限；explicitGatewayOauth也不表示启动没有认证访问。
4. 观察最多15000ms。ready INITIALIZED只记录历史握手；不称Role/source/OS/20-MCP合格。超时保持UNKNOWN和原handle；不自动重连/重启。仅原handle取消/EOF并读到真实close；现有cancel会产生UNKNOWN/NATIVE_CANCEL_REQUESTED，init-only没有turn/completed，不能修改done/exit判定来凑业务成功。
5. 输出只允许版本/二进制及profile/source摘要、握手是否发生、原handle/pid、字节计数/摘要、真实exit/signal/closed/UNKNOWN原因常量。native stderr/response/error/account/config原文和raw buffers只在可信CODE有界内存，不送模型、日志或Git；不把整个native DB/log复制成证据。只读自有目录的文件名/大小/摘要。清理先确认真实终止，再删除本次新建的probe目录；不清理HOME/config/auth/cache/DB等既有资料。

S0是普通CLI资格探针的支持证据，不是原Comet业务action。若通过业务transport接入，仍需真正原Native action/source；不能为min1合同虚构tool/path/binding。Root若选普通一次协议probe，明确不写原Run phase、不作为Gate证据；产品正式接纳仍由原Native控制。

### S0 原生启动的副作用（即使没有turn）

版本源码 `app-server/lib.rs:526–679` 在initialize前加载config、AuthManager、cloud bundle、EnvironmentManager、SQLite/telemetry；:790附近解析installation_id。正常native auth可能读原auth存储/keyring并刷新，native cloud/config/residency/telemetry可能联网，安装标识/缓存及受管state/log可能写盘。read-only turn sandbox并不限制这些bootstrap动作；strict-config阻止配置错误回落默认，也不证明requirements没有覆盖或收紧所设值。

固定marker避免恢复持久远控偏好，plugins=false在源码门阻止插件startup sync。EnvironmentManager的全部启动进程/已保存环境行为、实际网络去向、实际受管要求仍未验，不能用environments=[]概括。S0前Root按这些具体启动类别判断现有普通CLI授权；若还有不允许的connector/自选第三方路由/环境启动路径不能事前关闭，就停该实际启动，交具体路径及owner动作，不绕过。此处没有提出新的通用审批。

## 后续边界

最小CODE与有意义公共seam测试见 `CODE-AND-PROBES.md`。S0后才按实际项目cwd重新核实际来源/工具契约，S1公开无工具turn与S2原Run工具/制品接纳仍未执行。原protected provider/SourceReader/OS角色/内置旁路/同Run制品与恢复、canonical写接纳、平台与Kp/归档/Kt完整义务均未减少。旧15份外发和Outline一次key许可不复用。

本轮仅静态源码、schema与元数据核对；没有运行产品测试或实际CLI资格探针。public fetch中的路径404/连接失败留在各index；没有拿失败当特性缺失，也没有执行下载源码。全部源码、配置投影与旧schema输入摘要见inputs/manifest。
