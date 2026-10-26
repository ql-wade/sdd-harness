# I02 full recipe：独立 Spec 审查

结论：**源码无确证P级偏离，限定支持CODE construction；独立行为复验部分未闭合，不报全独立PASS。** Root须在主集成同源106中确认missing-manifest mutation确实执行并拒绝，再决定CODE接纳。镜像完整构建/非rootbootstrap D/E未执行；不签Source/Role/OS、wholeI02或129/103。

候选7bdb16dbfce5507943bb7d3099d191e7b719cffc（1c66→205aa→7e48→7bdb）；tree `/Volumes/mac-extend/codex/worktrees/comet-delivery-contracts/sdd-harness` 前后tracked clean。只读审四源码、完整Docker正文/锁/上下文、原规则与Root/作者限定报告；不依赖Standards结论。

## 源码与闭包判断

- Node/Python固定公共image引用、版本与构建参数同源；Python3.12.15的23个非glibc库/realpath/owner/version/copyright/license是明确记录，recipe在源stage逐项验证并保留provenance，复制后做实际import检查。该CODE和既有probe记录不是本次实际image运行证明。
- 明确Git24deb、根10npm、pnpm原包、OpenSpec原1.11tar及真实file:项目锁/71唯一依赖（原安装位置表）、PyYAML wheel与Comet429包，均有size/SHA/SRI。当前独立读取536条依赖记录，逐项size/SHA及声明的SRI匹配；未下载/安装。recipe使用标准npm/pip/pnpm，不从host node_modules或整cache伪造Linux输入。
- Comet使用原8ecc lock/public429，经仅loopback静态tar hydration、关闭listener后原lock frozen/offline操作，再在无node_modules的fresh项目复验429reused/0download。Root Linux机制v2/v3是该局部机制证据；recipe之后的完整SDK构建与非root组合行为仍待D/E，不能继承局部成功。
- SDK保持30562925…的原七patch（含security004），bootstrap为明确1c66 CODE闭包，未消费当前主9f912 stdio或未接纳Core。19模块/普通基础设施读取及相对import/package锁进入同一sealed context。固定/opt/sdd/runner-host.mjs符号链接和确定性Comet fingerprint入口仍在；metadata按image-root相对路径表达，不是调用者任意host/source选择器。
- recipe24569字节/SHA ac633df2a4707914b018263e13f45333314e6e6280474798860bf2e6eac954ee由受保护runner源码常量固定。完整正文每字节校验，输入lock自改摘要不能允许注释、字符串或if(false)伪装执行步骤；只允许完整ENTRYPOINT之后的安全注释/空白，且所有行继续扫描host path/secret形状。没有仅依赖includes的旧漏洞。
- build-plan的construction argv与运行资格分开：ready:false、statusUNVERIFIED、provider:null、productionQualified:false。依赖缺失/未closed不给可执行argv；context存在并精确匹配才标materialized/executable。导出与复用拒绝父目录/后代链接、特殊项、额外文件/目录和内容漂移，保留冲突，不自动清理用户对象。公共工具不执行Docker build/up或开启原upGate。

## 独立实际结果及未闭合点

固定Node24.15.0/Python3.14，外部模型/container/platform与包管理拒绝器在PATH。原测试窄组包括：七patch映射/确定入口、合法context物化/复用/extra拒绝、全部unlisted/link形状、锁定runtime来源、bootstrap元数据与缺依赖拒绝。**21total/19pass/2fail/0skip、exit1**，不是完整106。

唯一失败子例为missing manifest file：`test/infra-runner-isolation.test.js:1237`尚在合法baseline invoke就实际2≠0，mutation没有执行；父汇总随失败。原断言没有记录该次CLI JSON原因。不得将它计为missing-file拒绝通过，也不能断言已经找到产品缺文件漏洞。原始日志/metadata不改写。

Root随后授权一次窄原因诊断：同一原helper构造合法baseline、原public build-plan --export-context --json、不改timeout/前提，仅在tmp派生测试增加stdout/stderr/exit/signal/timing捕获。实际exit0、signalnull/errornull、drift[]、readyfalse/materializedtrue，invoke3618.16ms。**原exit2未复现、原因未确定；不归咎5秒Python超时。** 诊断fixture已由原afterEach清理，确认路径不存在；按Root边界没有重造baseline或执行mutation。该missing mutation继续NOT_EXERCISED；诊断0和作者106均不抵消原失败。

另做4次真实public CLI数据检查：将实际OpenSpec npm ci操作变为JS注释，validate/build-plan均exit2/RUNTIME_RECIPE_UNSAFE且不输出dockerBuild；原recipe只加安全尾部注释，两入口均exit0，build-plan仍readyfalse/provider为空。全程未执行Dockerfile。其余context负例实际通过但不能将上述21组重命名为全绿。

## 物化输入与证据

新计划SHA406a7427ada211cb57a591c2e127cdce53760d83e004246a8194e71d2b488649，执行授权为未执行/待审；旧918541暂停。独立核新context manifest SHAa612a7bf3caeccb4fe7b2a386c62ef9bfa1a84bd7b788101d71cb45427847e5a所列全部582文件/所有目录，无链接或额外项，总182715915字节size/hash匹配。并非通过本审查执行image构建或声称非root可用。

四输入：runner3987b0ab…ec5a63c；Dockerfile ac633df2…c954ee；image.lock42615678…c31e13；test319c4b42…3f4cd11。返工source-manifest SHA4df3e955ca4c0b5efc735d2fca73565af8b23a777e4537213958999f857c9bbb：4source、24报告项和23raw/20display逐项bytes/hash核对；原P2/旧计划/失败资料仍保留。

独立命令/原始输出与精确4SHA/UTC在 `/private/tmp/I02-fullrecipe-spec-qd49bwbn/`。targeted.json/stdout保留21/19/2；stdout SHA78c1748291bb5c47d4b646e4a4f219ed45636810654a4ba2afce986239a2f7d9。四个comment-only/safe-metadata JSON及源fixture均保留。baseline-invoke.json/stdout/stderr、baseline-diagnosis.test.mjs与baseline-test输出保留单次诊断的真实命令/cwd/退出；临时测试仅固定原repoRoot读取并追加捕获，不改产品或旧oracle。

28458、93489均明确终态；第一子测试exit1（外层记录器0只表示取证完成），诊断子测试0。无本审查已知未关闭句柄，外部拒绝器调用0、四输入前后不变。没有真实Docker/模型/认证/MCP/API、网络/下载/包安装、全局设置/Root锁/候选/计划写，未派agent。Root主同源回归须闭合missing点；D/E及最终角色/来源/权限/Journey各自独立验收，业务接受增量0。

审查 UTC：2026-10-26T00:19:36.475140+00:00
独立summary SHA256：`6319f15d91899796ace8bf1d618ab36056c3c03d8b3cfcc9fac7b75bf5c69d4b`。
