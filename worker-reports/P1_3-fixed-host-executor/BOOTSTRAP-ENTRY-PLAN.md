# 固定CODE bootstrap：最小打包/注册图（待Root收口）

目标仍原P1_3，不新增控制器、phase、lease/Action库或轮询调度。当前Node物理fixture不等于生产/opt/sdd/runner-host.mjs。

## 最小源码路径

首选保留module相对依赖布局：
- 已有owned `lib/adapters/comet-executor.js`：新增固定bootstrap/main函数，复用当前Host构造和原Native main/窄ports；不从CLI/环境/Job JSON选择module/collector/issuer。
- **请求仅新增ownership `tools/comet/runner-host.mjs`**：短固定入口，只静态import前者并消费一次有界frame/原CLI调用，输出结构化状态/退出码；无inline Docker脚本、无循环/queue/retry。测试仍已有owned test/comet-execution-binding.test.js，不另加factory文件。
- 若Root坚持零新源码文件，可由I02把 `/opt/sdd/runner-host.mjs` 做成指向 `/opt/sdd/lib/adapters/comet-executor.js` 的固定镜像内symlink，Node保持真实module路径；该模块自身处理isMain。不要直接COPY重命名该文件而破坏../../相对依赖。

Root补具名ownership前不写新增入口。容器COPY/ENTRYPOINT、构建及digest由原I02负责。

## 固定依赖图

runner-host -> comet-executor -> 原P2_2 evidence/纯Gate/P2_1 taskDefinitionDigest -> contracts；物理部分仅 tools/infra/runner.mjs 三口及待审resolveCliJob。原Native aggregate及classic/runtime/entry资产必须按当前已正式绑定source/patch fp/digest加载；P1_2仅提供已审packet字节，不能自动安装/Hook。Node/归一化parser按package-lock闭合（commonmark0.31.2），原OpenSpec绝对Node/CLI+全安装manifest沿既有protected binding，不能改PATH去找另一个工具。

## 主控与worker权力不能混在入口参数里

controller bootstrap必须先取得实际I01/I02的project/authority/workspace/run、原Node/SDK/镜像/身份/挂载及当前purpose/grants证据，才安装一次固定Host并调用原Native main/ports。scope/role/principal不能从COMET_ROLE/hostname/Job字符串自批。

I02当前把同一路径作为六类容器入口；因此须由受保护登记区分controller与非controller：author/reviewer/publisher/isolator不能装持issuer key的控制Host、不能写原控制Run。worker只消费原Runtime签发的既定WorkPackage/方法/工具边界，不能把此入口变成另一个Comet主控；产出原report/result/methodTrace三字节与实际进程/工具记录返回原控制器。现有Gate路径/作者端口提案与此衔接，作者动作不冒用T独立reviewer。这里需要Root确认实际role部署边界，不能用一个env switch给所有role装控制Host。

## 当前真实缺口及默认拒绝

`tools/infra/secret-refs.mjs:163`公开resolver明确只校验登记/项目/身份/角色，**始终UNRESOLVED且不返回值**；4个Runner refs仍NOT_PROVISIONED。不存在可复用的运行时issuer/reader CODE source就不能发明一个读key文件/DB/env的resolver。当前bootstrap应在这些未知条件下结构化UNVERIFIED、0子进程、0Native写。

生产正向仍需原I01/受管运行时提供现有目的绑定授权机制的可信CODE端口（actual主体验证、authority闭包/实际source reader），而不是JSON qualified=true或把metadata当凭据。这个Source依赖要保持显式未完；本轮可测试原注册缺席/篡改时严格不启动，以及在临时测试自有CODE端口/fixture进程下原Native机械调用，不把测试CODE变成生产loader。

实际方法执行需要固定role程序与审查/应用证据；不猜Claude/ZCode/Codex flags、不借旧15份外发授权、不把读取SKILL/hash当方法应用。未知worker registry/入口/实际方法结果继续UNVERIFIED。

## 冷恢复位置（与待审resolveCliJob衔接）

Host先重读原Run/原pending/gate intent并验证当前签名/版本/输入/注册；现会话有原receipt时observe/stop exact handle。冷会话没有handle时，仅在**Root接纳并绑定新I02 API之后**调用 `resolveCliJob({job,dispatch,currentActionBinding})`：
- FOUND：取得原handle/observation；只observe、读取原execution产物，不再start；运行中等待原Runtime监督/调和。
- ABSENT：只表示当前未查到，不授予launch；原Native未证明never-started时保留UNKNOWN/UNVERIFIED，绝不start-as-query。
- 结果字节/原launch记录缺失：即便exited0也不accept/retry。durable原execution/产物ref与launch-start标记仍回原pending/gate record/事务，由P2_4拥有；不在P1_3写第二状态库。

当前源码未消费尚未实现/审查的resolve API；现有冷进程回归正是UNKNOWN且0重启。整个P1_3/I02的正向恢复、生产Bootstrap、角色/方法/三渠道及whole仍未验。
