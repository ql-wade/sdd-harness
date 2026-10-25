# I02 离线 toolchain/bootstrap recipe 独立 Standards 审查

结论：**REQUEST_CHANGES，1项实证P2：注释文本可以冒充实际OpenSpec安装/固定CLI指令通过公共recipe验证。** Root不应集成当前候选或执行其full D/E。没有伪造runtime/Role/production资格：所有反例仍ready=false/UNVERIFIED；问题是坏recipe被接受为有效build-plan并取得构建argv。

候选 `7e48fbebe8af726838c84e16566e123cba125e3d`，chain `1c66edf→205aa3c→7e48`；tree `/Volumes/mac-extend/codex/worktrees/comet-delivery-contracts/sdd-harness`，前后tracked clean。只读审四owned及报告，没有改candidate/主锁/台账。

## [P2] 实际recipe操作删除后，原文字留在注释仍被接受

准确位置 `tools/infra/runner.mjs:1075–1077`（`validateRuntimeRecipe`）。函数对固定OpenSpec CLI symlink、冻结npm ci以及bootstrap symlink使用原始全文 `text.includes(...)`，没有判断命中的是实际可执行操作还是Docker/JavaScript注释。新的old737强化合同明确要求真实原tar/lock/offline install/fixedCLI语义；raw substring不能承担该判断。

本次只在独立tmp复制六份原domain输入，使用原public `build-plan --dir ... --json`，不运行Docker：

| 输入 | 实际改动 | 预期 | 实际 |
| --- | --- | --- | --- |
| baseline | 原Dockerfile/锁不变 | exit0 | exit0，argv存在 |
| comment-only-cli | 原129行真实 `ln -s …openspec …/usr/local/bin/openspec` 换为`true`；末尾加入`#`加原symlink文本 | exit2、无dockerBuild | **exit0，dockerBuild/argv仍存在** |
| comment-only-openspec-install | 原123行真实 `run('npm',['ci',…openspec-project…])` 改成JS `//`注释；其它原文/锁不变 | exit2、无dockerBuild | **exit0，dockerBuild/argv仍存在** |

两个坏recipe均没有真实被要求的执行操作，却满足同一串文本检查。没有注入在线调用、秘密、模块或假包，没有放宽原输入JSON。独立从已封存实际captures执行预期exit2断言，结果 **0pass/2fail，exit1**，不是下载/准备失败。取证wrapper exit0只表示三次记录完成，不是负例通过。

边界准确区分：baseline现有context已materialized/executable=true；两个坏recipe的新context均materialized=false/executable=false，但CLI错误地接受recipe、输出构建argv。`ready:false`、`status:UNVERIFIED`和原upGate CLOSED一直保持，未称已构建/已认证；这不消除construction层拒绝错误输入的缺陷。未执行export-context或其argv，未证实坏image实际建成。

最小修正交原作者：识别真实执行指令及here-doc内容中的操作，Docker注释和JS行/块注释不得满足required operation；不要为这两个字符串再加特殊排除分支。将本次两份确切坏输入作为负例，保留原tar/COPY/SHA、原project锁/SRI/版本/bin、离线无脚本和固定链接的正向语义及原92其余断言。不得用注释token、恢复浮动安装、删除断言或skip转绿。

## 固定输入与已读证据

当前正式报告入口是 `worker-reports/I02-toolchain-bootstrap/CURRENT.json` 指向 `continuation-formal-recipe/`。最初checkpoint README明确未闭合；当前README对106结果及fullimage未执行分别记载，不把旧checkpoint声明当当前完成。

source-manifest SHA256 `17138a470c8f3f29e79f2287434be930d3ea489940cb69c5fb1362706b21e7ac` 已独立核；四source与20报告entries的size/SHA均匹配：

- Dockerfile `ac633df2a4707914b018263e13f45333314e6e6280474798860bf2e6eac954ee`
- image.lock `426156787c00e0f2cf0b9abba7dc8536caef6c45ea074d74a628b48faec31e13`
- runner `6fd7c2727e17e4b994484b37570fad71dbc43afc7ce889f97357ca5b10917bc5`
- test `a414a02c80fe56948e023a67af9e10f5214791c63a567907f1f41b6e4fa08bc8`

合法baseline public plan实际给出bootstrap digest `83e59394c4856c99d21497f5514b50f8649069ac2695078c9352184774d8216f`，29文件/19模块与普通infra读取图，固定原 `runner-host.mjs→lib/adapters/comet-executor.js`；未冒用后来的stdio/Core。SDK fingerprint `3056292584ad17c49080c7504c1a689f1a382012e708665a8f12069d75a12a69`，原7patch含security004。共享upstream锁 SHA仍 `7d958d16aaac944017eb3db68aa18dd0d63d446fb811cb5f57608f9f86e56633`，前后不变。

读过实际recipe/同源validator数据：Node24.15/Python3.12.15双固定image、23非glibc库及owner/version/copyright/Python license、Linuxarm64、Git24个原deb、pnpm1包、Comet429、OpenSpec71唯一包、root10包、PyYAML1 wheel；项目原file tar依赖及原lock被显式封存。baseline只读检查实际public inputs并沿依赖size/SHA/SRI路径生成plan；没有安装这些包或将这些声明提升Linux组合镜像的实测。

Root主树两份Linux store REPORT已读：v2官方PM+原8ecc锁+429原tar只做allowlisted loopback GET入store和同seed offline复取；v3新目录/无node_modules/不同virtual store实际frozen offline install，429resolved/429reused/0downloaded/429added。它们没有证明完整Comet/Python/Git/OpenSpec组合image。recipe沿原PM、原lock与静态tar使用临时loopback，不造PM/index/packument；有界时间/输出、原PID终止及finally记录存在。实际full D/E、非root运行和角色资格仍未执行。

原容器路径改为image-root-relative，原secret/abs-path扫描及print没有新增宿主路径例外。旧context集合/unknown/link/special/parent-link拒绝机制保留；本次未重跑全部context矩阵，不因作者106/106直接签所有路径。原103/3、rehash-withoutSRI的真RED、原下载器AttributeError与内容重验分层都保留。106/106只是作者自检；old737经Root批准强化的语义仍应满足本报告P2负例，不能由其现有绿灯覆盖。

## 实际argv、终态与原始材料

有效反例三次argv共同为：

```text
/Users/mac/.nvm/versions/node/v24.15.0/bin/node /Volumes/mac-extend/codex/worktrees/comet-delivery-contracts/sdd-harness/tools/infra/runner.mjs build-plan --dir <本次tmp的baseline或comment-only-cli或comment-only-openspec-install> --json
```

精确每个路径/argv/UTC/input Dockerfile+lock SHA、raw stdout/stderr SHA见原receipt。Node实际24.15.0；仅补回作者已使用的既有 `/opt/homebrew/bin` Python3.14.7/PyYAML6.0.3用于宿主compose parser（不是Docker Python3.12资格）。public工具PID **91571、91594、91607** 全部communicate终态exit0；取证tool session **4926** 已终态。实际guard调用0（本次未另校准guard），无Docker/包管理安装/模型/API/网络/全局配置或主状态操作。

有效证据根 `/private/tmp/I02-fullrecipe-std-000jh1og/`：

- `receipt.json` SHA256 `9c0b5c2c41e18902c889383fb5d5643bfd43674dda2564f6fbbd0fc6744222d8`
- 三个目录的**完整修改后tmp Dockerfile/原domain输入**；三份 `.stdout.json` 和 `.stderr.txt`
- `proof-manifest.json` SHA256 `e0d9ea6aaa3ab23c410fd4b7418afd244c54c47aa64a5d61507506d613e5eb7c`，封存三次输入/日志与source-manifest核对
- `negative-assertions.py/json`：仅对已封存actual capture作预期断言，0/2、exit1，没有再次调用product
- 复跑取证入口 `/private/tmp/I02-fullrecipe-standards-probe-20261026.py`，每次新建tmp；此次不循环重试或改candidate。

首次审查env的最小PATH选中了无PyYAML的系统Python，连未改baseline都返回COMPOSE_PARSER_UNAVAILABLE/HOST_MOUNT_FORBIDDEN；该轮不是有效反例，原样保存在 `/private/tmp/I02-fullrecipe-std-qmw9x_fl/`，receipt SHA `d2ecacb0041df2a82f503ee85e5b199af6b84d49a57d0a1f6983ff6160640919`，含全部初次argv/输入/raw及setup-classification和初始脚本。恢复既有parser路径后才首次获得上表有效行为证据；没有安装PyYAML、伪造parser或把准备失败当RED。

Root已决定不集成/执行当前7e48 full D/E，退原作者修真实执行指令识别。scope仍是construction修正，fullimage/Role/source/whole与129/103不签。没有改候选、锁、原历史证据、计划或资格，也未派agent。
