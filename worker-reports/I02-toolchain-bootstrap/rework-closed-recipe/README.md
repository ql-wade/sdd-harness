# I02 封闭 recipe 返工交接

本次从7e48继续，只改 runner.mjs 与同一测试文件的一个既有新增用例；Dockerfile、image.lock 和原7patch/3056上游锁未变。独立 Standards 的 P2 原文、原三次 CLI 与7e48/205aa历史报告/原始字节均保留。本包仅交源码与作者自检，不签父任务完成。

根因是全文 includes 把注释中的固定 OpenSpec 链接/npm ci 当成执行操作。当前由受保护 runner 源码持有完整既定模板的24569字节和SHA ac633df2…954ee；校验完整正文原字节，不剥注释、不解释任意 Docker/JS/shell，也不让输入lock自填摘要洗白。以后模板改动必须连同源码pin、测试和独立review受控更新。模板完整 ENTRYPOINT 换行之后，只容许完整非执行Docker注释/空白；新FROM/RUN/heredoc、续行、不完整行及parser指令均拒绝。host路径/秘密格式按原规则扫描全部行，注释不豁免，错误只回静态code。

原评审三次public build-plan由作者原样重放：合法0，两个坏输入旧0→新2且不输出dockerBuild。三次均实际进程终态，不把取证wrapper的0当负例通过。新测试先在validate取得真RED（坏CLI注释0≠2），再GREEN；首轮测试误按validate形状读取qualify回执的失败独立保留为测试装配错误。当前17种实际伪装×7调用（validate/qualify/up/probe/stop/build-plan/export-context）及尾部metadata正反例执行通过。qualify从既有category理由核对拒绝code；standalone stop始终无handle/不执行，不因此声称真实停止能力。

新增矩阵包括JS //与块注释、字符串、if(false)、shell false、Python heredoc被true消费、bootstrap链接注释、末尾新stage/指令/heredoc及parser指令。安全metadata继续逐原字节进入context摘要；注释中的合成用户路径与密钥格式被拒且不回显。预期源自固定安装/离线项目锁/CLI行为要求与独立P2，没有修改包原文或恢复浮动解析。

完整同一文件只复跑一次：Node24.15.0，`node --test --test-reporter=tap test/infra-runner-isolation.test.js`，106/106、0fail、0skip；原92及其它既有用例断言保留，前112099字节与扩展用例之后的全部测试正文一致。UTC00:00:03.245552Z→00:01:37.009811Z，session65071/PID3439终态0，原stdoutSHA fdd4ed5b…e66a9，运行前后源码/保护输入/外部guard计数一致。17变体在同一整文件中真实执行；所有原context/noFollow/链接/FIFO/slot/权限拒绝检查没有放宽。

新上下文已物化并独立枚举size/SHA：582文件182715915字节，仅runner.mjs相对旧context变化，原recipe/公共依赖/方法及SDK链未变。新bootstrap聚合55ac772e…fb9f3，固定CODE仍1c66的3d897ac4…12e，不消费Main新transport；SDK fingerprint仍30562925…12a69。准确新D/E计划见ignored `.local/I02-toolchain-bootstrap/recipe-rework/full-image-candidate/plan.json`，摘要与582清单见freeze/index。旧918541计划暂停，**新计划未执行且未获执行授权**；Root独立双审后再批准具体构建。固定公共base、pullfalse/netnone、无mount/secret/model及资源界限保持；局部context/106不等于完整镜像、Git/OpenSpec/PyYAML/Comet实际组合构建、Source/issuer/provider/workerframe/角色或sameRun/whole资格，upGate不变。

51旧报告与124旧raw在返工前后逐SHA比对；CURRENT仅转向本包，旧CURRENT原字节另存history。新显示副本按normalization-rules明确去机器前缀/行尾空白，绝非raw stdout或可执行argv；完整真实argv/cwd/PATH/UTC/PID/exit及坏输入保存在ignored rawPath。当前作者全部句柄终态，无Docker/模型/API/新下载或活配置操作。
