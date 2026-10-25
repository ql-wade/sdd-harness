# P1_2 三项公开入口返工候选

基点 `70ea6e202916aa884042633580b02df9c0932aa2`，原任务与唯一DAG不变。Root仍是唯一控制器，本候选待独立双审。`comet-managed-v2`仍为UNQUALIFIED，未启用profile或签署真实角色/旅程。

原70ea报告的81条索引项、索引自身（82个tracked文件）、原260文件缓存和全部旧raw逐字节保留。本轮证据单独位于本目录；指针在 `../../CURRENT.md`。所有日志/路径JSON都是**便携显示副本**，原始字节在ignored `.local/distribution-rework-r1/raw/`。commands.json保留真实UTC、cwd、argv、退出码和原始日志SHA；observations.json列raw/display的SHA及bytes。显示标记不可执行，也不冒充原始stdout。最终源输入摘要在final-invariants.json，新缓存与release/code/MANIFEST逐文件绑定同一输入。

## 三项修复与有效RED

1. **受管I/O**：原adapter在真实外部compiled symlink上exit0，外部sentinel摘要从03f9d265…变成5da82ae3…（red-adapter-compiled-link）。安装/卸载现共用foundation/managed_io.py；受管目录逐段通过dir_fd/O_NOFOLLOW打开，settings和compiled拒绝链接、特殊类型、多重硬链接与未管compiled。全部预检先于落盘；普通文件先暂存再原子替换，复核读取后输入，原用户mode/配置字段保留，准确归属链接才可移除。补测安装/卸载的所有5个目标/祖先、用户内容、FIFO/目录/硬链接、shell quote、原子inode替换及用户配置保留，拒绝时目标/外部树摘要不变。
2. **文件集合字典**：原完整缓存clean resolve=true，注入root/__proto__后仍resolve=true（red-cache-prototype）。所有相关资产字典使用null prototype，键按own-key枚举。合法__proto__/constructor/toString/hasOwnProperty及嵌套名、二进制原样输出/封存；改件、额外特殊名文件/目录/空目录/symlink均拒绝。
3. **真实项目代码闭包**：原私有受管源加resolver后，修改resolver未改变exportDigest、verify仍OK、cache无resolver（red-managed-code-closure）。已逐一读完实际source/import/caller并列出23代码文件、3份原package/package-lock/Comet锁元数据；原文不改，均纳入digest、release/code和cache。dependency-inventory.json保存caller行证据和原字节摘要；逐一变更/缺失/篡改均拒绝。新代码视图增件或缺helper也拒绝。无递归全仓打包或外部运行时。

最终exportDigest为 `d6ea4fea19222dca09e480b6f7c87d3a77fa3b913660ac51e237b22851583c51`；新cache有277个sealed文件加manifest，共278个。新release/code有26份原始代码/依赖元数据加manifest。原6脚本cache不改锁、不补写；新校验无法证明它的完整闭包时明确STATE_SYNC_REQUIRED，原材料保留。

## 真实复验

原53项加新增10项，最终在真实固定Node24.15.0及同PATH裸node子进程上 **63/63，0fail/0skip**。实际命令为：

```bash
node --test --test-reporter=tap test/foundation-distribution.test.js test/legacy-workflow-routing.test.js test/delivery-cases/1_2.mjs
node tools/foundation-export.mjs verify --root . --lock foundation/foundation-lock.json
bash -n tools/bootstrap.sh tools/adapters/claude-code.sh
bash scripts/agent-instructions-check.sh
bash scripts/agent-skill-check.sh
```

第一次组合61/63暴露本次迁移遗漏的两项原诊断；已恢复逐项点名与准确受管链接清理消息，未放宽旧断言。初次失败、2项窄GREEN、最终63项均保留。

跨仓正例实际复制纯资产到无Git/无node_modules目标，调用**封存副本自己的exporter/contract imports与adapter/managed_io**，export/verify/install均exit0，实际gate deny为exit2、settings matcher读回一致。最终Node使用明确外部固定宿主版本v24.15.0；没有借父源node_modules。缺Python3时实际exit1且settings/compiled摘要不变。外部npm模块/LLMWiki venv不在缓存，精确原pin元数据已绑定，完整运行环境仍需原基础设施任务证明。

五份活配置、11方法245文件、源MF/profile及正式upstream锁全部未改。原生skills-list沿用已取证的终态，本轮未重启host、无thread/turn/model/provider/API调用。无后台worker/服务。全部本轮命令句柄已退出；Root继续独立审查和串行集成。

## 未验边界

本轮没有重跑无关全仓；原70ea的533项522通过/11失败仍只是历史未通过结果，不能改称本轮全仓绿。原生trusted Hook/角色权限/真实方法应用、Kp/唯一归档/Kt、平台与权限恢复、完整同Run旅程均未验。fixture中的脚本行为与settings装配不代替宿主hook enforcement，不对parentAccepted、DAG、正式锁或业务状态写入。

Node路径核验发现宿主名为node@24的别名实际指向25.2.1；前序RED/GREEN和第一次63项是真实Node25证据，保留而不冒充24。随后使用Root确认的NVM24.15.0准确二进制，并将同bin前缀放入PATH，最终63项、Foundation verify与原始字节读回均再次通过；裸node子进程版本与execPath也实际读回一致，二进制SHA保存在final-node24-runtime.txt。没有改全局软链、HOME或版本pin。

暂存格式检查最初报两份新缓存payload的原源EOF空行；没有改源字节。按Root明确范围，在foundation/.gitattributes只对两个精确的baselines/*/source路径声明verbatim content-addressed snapshot -whitespace。原源、旧cache、新cache的两文件SHA/bytes逐字节相同；真实源、adapter/tests和cache manifest的属性仍unspecified，git diff --cached --check已exit0。此属性不豁免文件集合、SHA、行为或完整性断言。
