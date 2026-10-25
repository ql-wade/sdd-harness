# P1_2 TeamAI 原生分发返工交接

基点0c228bd；沿原P1_2与唯一DAG。本包补真实TeamAI运输、接纳与现有安装caller，不签whole/AC/生产Runner。主检出与全局配置未写，旧P1/I06证据未改。Root后续Core链未rebase进本树；f708发行视图只证明本候选范围，主Foundation由Root接纳代码后统一重建。

原版teamai-cli0.22.0及原62项SRI依赖保持不变。它确有Git原生分发，不需要新增服务；直接把既有Foundation深目录放进普通docs时，真实init/pull/repeat均exit0，但558期望文件实际运输0。这个RED来自可运行公开CLI，不是缺工具/模块。新视图只增加一个顶层JSON/base64文件，完整文件表包含dotfiles；方法原文不改。普通skills仍交原版TeamAI，11种方法245文件字节相同，内置代码Wiki12文件始终仅在staging。

接纳绑定来自控制器外部冻结的expected描述及其精确SHA，包含sourceCommit/exportDigest/完整文件集合digest/packetSHA，不能用packet自带lock或自算hash批准自己。路径、重复、未知字段、模式、base64、大小及每项byte/hash先验，所有验证完成后才写新的私有stage，再实际复用FoundationLock验证。旧expected或篡改packet拒绝且不创建接纳目录；未知extra不接纳。受管方法最终仍由现有adapter安装，TeamAI不拥有业务phase/派发/恢复或第二进度。

公开接线保留原工具：

```text
node tools/foundation-export.mjs export --root SOURCE --out FOUNDATION --profile comet-managed-v2 --skills-copy --teamai-view VIEW --teamai-expected EXTERNAL_EXPECTED --teamai-repo HTTPS_GIT_URL
teamai init HTTPS_GIT_URL --scope project --no-inherit-user-scope --agent claude --force
teamai pull --force
node tools/foundation-export.mjs verify --teamai-packet RECEIVED_PACKET --teamai-expected EXTERNAL_EXPECTED --teamai-expected-sha256 FROZEN_SHA --teamai-stage FRESH_PRIVATE_STAGE
```

这是数据运输/验证接口，不启用生产profile；具体远端、授权与真实角色仍未资格。VIEW和EXTERNAL_EXPECTED位于Foundation源外，external期望不来自supplier。

实际隔离参数已逐容器inspect：固定本地镜像、networknone、readonly、uid1000、capdropALL/no-new-privileges、0hostbind/socket/credential env，仅自然/home/node与/work、/tmp私有tmpfs。首次/work默认noexec导致Git忽略755 hook，guard校准失败后严格未native；真实mount/X_OK诊断保留。Root明确只批准/work加exec，home/tmp仍noexec；Git pre-receive一直真实exec，不用解释器绕该guard。

成员-only私有bare guard先以stats/forbidden.json真实push校准拒绝及HEAD不变。所有native push只准fixture成员文件；任何非成员report尝试即整个实验失败。Source更新由独立记录的fixture-owner本地CAS快进，核old/ancestor/tree，保留member leaf与原hook字节；这不证明生产发布角色或权限。全部执行无真实远端/API/model/自动报告。

| 实际证据 | 结果及边界 |
| --- | --- |
| 原native完整运输 | CLI0但558→0，保留RED |
| 顶层packet原版native | init/pull/repeat/uninstall0；558/558、0missing/diff/extra |
| 实际注册hook caller | 原设置真正执行126；compiler三受管命令显式Bash后，真实允许0/拒绝2；策略和脚本原文/mode不变 |
| 重复注册兼容 | 新Bash前缀曾漏旧plugin-wrapper，两项真实回归保留；仅精确三项目命令作bare/Bash等价后原拒绝测试通过；无关用户脚本与插件条目保留 |
| 实际资产升级 | 私有package.json仅description one→two；version/deps/engines、方法body/pins、policy不变；exportDigest975ac7cc…→904b089a…；native新byte实际安装读回，新expected接纳/旧拒绝，v1已安装cache逐字节保留 |
| 组合生命周期 | 正反序、repeat、synthetic retired输入失败无污染、退役无再生、用户/原Ponytail插件保留、native与managed卸载终态实际通过 |
| 冷机制 | fresh原生TeamAI进程实际扫描staging12目录；已接纳canonical11方法与用户目录独立核验。没有host Codex/model/globalDB新探针；不把staging目录当coding-agent执行/角色资格 |
| 组件回归 | 固定Node24.15/PATH，同候选71/71、0fail/skip；输入前后SHA一致 |

4943旧完整harness只改未运输note/exportDigest相同，其结果仅作origin metadata子例，不能代替实际byte升级；后续639a内容子例独立冻结并真实执行。旧70/66/4回归保留：两重复注册已修根因；两committed视图漂移在源定后真正重建解决，不改断言。

测试镜像由固定node4e6…与精确24公开deb/62SRI构建。现adapter需要Python，b05实际ENOENT保留；同三已验签Debian索引补12精确包，112基包未变、124包实读。Python3.11标准库含secrets和ManagedOutputs.validate真实调用0，仅CCadapter fixture，不满足或宣称Comet/I02 PythonMinimum3.12。Python初装Pre-Depends顺序失败及修复前raw保留，没有在线apt/npm、生命周期脚本或宿主安装。

原始UTC/argv/cwd/source/image/inputSHA/exit/stdout/stderr留ignored `.local/teamai-distribution-convergence`。此目录是明确归一化的便携显示副本，不能冒充raw stdout；raw/display hash、bytes与转换规则见索引。所有大harness及完整输入仍有原始SHA/bytes/位置可独立复跑，复跑须使用新label避免覆盖历史；不自动拉镜像/增包。canonical TestPack只在ignored目录，显示副本不可当原包验证。

原方法MF、唯一profile、上游正式锁均未改；11方法摘要逐项相同。f708完整code/skill发布视图和新sealed baseline由当前源真实生成、requireBodies实际通过；旧baselines未改。sourceCommit仍记录worker基点及owned工作差异，完整文件SHA固定；最终主树版本由Root串行接纳与重新发行绑定。
