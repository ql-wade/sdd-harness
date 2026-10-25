# P1_3 薄 main 独立 Standards 审查

结论：**PASS，无新增 P 级阻断**。仅接纳固定 CODE 对象与原 Native install/invoke 的薄入口 construction；whole P1_3、production provider、真实 bootstrap/image/Host/roles/OS、源资格、非 Gate 执行与正向冷恢复继续 UNVERIFIED。此次没有绑定或消费新3056。

## 固定输入与授权边界

候选 `9434a5edffb9ec3f3cc56a12bb3a25bc19ba769f`，base `884880a3d7cb27ed70fb5da2cca33eb8b3c5ea24`，tree `/Volumes/mac-extend/codex/worktrees/comet-registry-qualification/sdd-harness`。审查前后 HEAD精确匹配、tracked clean。改动仅 executor、binding test与新报告。读取 AGENTS、REPORT、PROVIDER-AND-PACKAGING、R1/先前拒绝记录、manifest及Root主树 `worker-reports/Root-P1_3-bootstrap-interface/decision.json`。

Root R1明确仅同模块CODE身份、原install/invoke/project/change/run限制，以及临时旧6da Native读取正例；批准不代表资源、凭据、生产provider、source/OS或SDK新材料资格。原3056尝试自动拒绝未落地，准确原因和历史提案均保全。本次没有重试该被拒动作。

源码SHA256：

- `lib/adapters/comet-executor.js`：`3d897ac473d101c751c3ae43e133f48aab48b122398a766f4cf52db600b7812e`
- `test/comet-execution-binding.test.js`：`b678f1fc7aede5080e1797016d585fe656752502bfc90042825bde18a745d25e`
- 唯一正例Native旧6da aggregate：`04795080295d7174af82913757254426b82037ea5028296a3602b86d200559dd`

## Standards 源码结论

- `comet-executor.js:21,295–299,332–349` 的 WeakMap只保存本模块构造的 frozen executor→原invoke闭包。拷贝、Proxy、同形对象不匹配；它不签actor、source、principal、OS或issuer资格。constructor依旧要求原Native、authority、固定registration及同步source CODE端口；本次不放宽任何参数。检索全部constructor/main调用，只有原测试及新测试增加调用，没有新增生产provider或第二实现。
- main经闭包同步检查installed，调用既有install一次，然后复用原invoke；原invoke固定projectRoot/invocationCwd/change，原Native/Host负责Run与原写守卫。未加入loop、DAG、phase/action ledger、queue、lease、重试、动态模块或启动查询。既有public executor接口保留，历史调用不需要伪造新token。
- `309–330`：输入至多64项，每项4096字符/无NUL，累计64KiB；Array.from检查稀疏项，且严格限制原state操作、change/field、各操作参数数目和仅首位--json。无输入、坏形状、缺get字段、重复/错位选项、自由provider/role/module/project/cwd和外部转发被拒。CLI只将自身argv传给main，不提供第二参；不读stdin/环境/文件以创建provider。
- `332–349`：先验证输入再判断缺provider；缺资格exit2，坏输入/伪CODE对象exit1。只接受Native exit0/1/2、string stdout且最多8MiB；未知异常、无效返回或不支持退出码映射静态错误，不回显producer消息、stack、输入路径或任意code。已知范围错误也只输出固定码。有效Native stdout按原合同透传，并非任意producer文本审查器；outer metadata固定 `productionQualified:false`/`managedClosureEligible:false`，未把类型验证升为资格。
- `352–360`：realpath判定使固定symlink进入同一个原模块，import本身不选择provider。I02将来必须保持相对模块布局；候选不创建 `/opt/sdd/runner-host.mjs`、不修改Dockerfile或安装全局入口。
- PROVIDER-AND-PACKAGING如实列出生产注册为空、secretRef未provision、没有真实source reader/issuer、未实现worker `{dispatch,job}` frame消费、非Gate/launch/resolve未接线等缺口。其静态closure清单明确是proposal，未冒充image完整性。当前CLI持续拒绝缺provider，符合本construction交付范围，不能作为whole完成。

## 原测试与证据保全

manifest SHA256 `f3d84165e346d1c98667739ff998bf3c28e9b0ff79482993180b3c61e31f312e`，index SHA256 `c5aa58c39dc4a2c1cb1a314f0adb2bb3f02690129b4a141e05205f0af095c9c4`。**60 tracked报告、107 raw、49 raw/display对**逐条SHA匹配；再核34当前文件、21材料及preservation record，共321项内容摘要校验均匹配。材料只读来自现有主检出公有缓存，未下载或升级。

原559 binding测试完整29881字节，SHA256 `389053944465219214fb6402a35b0076dbd7d3ec8eaa52419bf9baa623269856`，精确为新文件前缀，未改旧Gate fixture/断言。旧586份ignored叶文件只核既有lstat size/mtime/mode记录，没有读取其内容、秘密或业务数据；均匹配，报告没有把元数据保全伪称内容认证。

原真RED、错误的中间GREEN（脱离Host直接Native读取被拒）、缺get字段/稀疏输入修复历史、早期pack-structure捕获时机限制均保留。作者65/65和52/52的raw/source输入前后摘要及正常pack-structure-r2结果存在，作者报告明确为自检；本次没有重跑它们，亦未用它们代替本次入口检查。

## 独立实际执行

一次执行新增4个顶层组及26个子检查，**30/30，0fail、0skip，exit0**，没有重试。准确argv：

```text
/Users/mac/.nvm/versions/node/v24.15.0/bin/node --test --test-reporter=tap --test-name-pattern=the packaged executable|the executable rejects|the CODE-bound main|the main distinguishes test/comet-execution-binding.test.js
```

Shell复跑时应将整个 `--test-name-pattern=...` 参数单引号包围；实际执行通过Python argv数组，无shell pipe。执行记录入口 `/private/tmp/P1_3-bootstrap-standards-run-20261026.py`，精确UTC/argv/cwd/输入前后SHA保存在receipt。

实际旧Native新临时Run：`899b2168-a0ab-4d5e-8292-3acde16b7014`，四次重复/并发读取得到 `open`，再经同main核对相同run_id。原生状态只在fixture私有tmp，finally清理。正例明确 `sourceQualification:ABSENT`、physicalCommandAttempts0、productionQualifiedfalse。不是物理角色、语义Gate或完整旅程。

其他实际检查：真实原文件及symlink CLI在环境role/module标签下仍缺provider拒绝；22种输入负例；精确CODE对象/副本/Proxy/伪对象/异Change；抛异常、错误结果、exit64静态拒绝，原Native exit2保留。outer资格标记不能被producer metadata抬高。8MiB上限本次仅源码检查，没有另加大输出执行用例，不夸大覆盖。

Node实际v24.15.0，runner PID **46883**，tool session **96091** 已exit0终态。11种外部工具guard实际校准97，随后调用0；原fixture的物理CLI拒绝器调用0。独立父环境只保留必要PATH/语言/TZ/tmp/CI、Git禁系统/global、已有HOME与测试公有artifact root。原授权测试在子进程内将HOME指向自身tmp并finally恢复，未改任何真实HOME文件或活配置。

原始独立证据：

- `/private/tmp/P1_3-bootstrap-standards-20261026/receipt.json`，SHA256 `a5b248006f26f0ecc6a390f7872fee0822e22cf602bd1c25a8f86c000d26f2df`
- `/private/tmp/P1_3-bootstrap-standards-20261026/stdout.txt` 与 `stderr.txt`
- `/private/tmp/P1_3-bootstrap-standards-20261026/guard-calibration.txt`

作者原始证据仍在该tree `.local/P1_3-bootstrap-entry/`，精确对应关系见 `worker-reports/P1_3-bootstrap-entry/raw-display-index.json`。输入前后34文件内容不变，tracked clean；未执行Docker/model/API/secret/安装/下载/全局配置写或改源码、锁、任务、台账。不得由本PASS提升whole P1_3或3056绑定资格。
