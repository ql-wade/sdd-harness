# I02 comment-only recipe P2 独立 Standards 复审

结论：**PASS，原P2在construction边界闭合，无新增阻断。** 独立18次公共CLI调用全部符合预期；原合法输入仍0，原两个“仅注释保留操作”坏输入现2且无dockerBuild/argv。没有运行Docker、安装或重新验证完整image；whole/Role/source/129/103不签。

## 固定对象

候选 `7bdb16dbfce5507943bb7d3099d191e7b719cffc`，parent `7e48fbebe8af726838c84e16566e123cba125e3d`；tree `/Volumes/mac-extend/codex/worktrees/comet-delivery-contracts/sdd-harness`，前后tracked clean。仅runner、同test的一项扩展、CURRENT及新报告变化。

- source-manifest SHA256 `4df3e955ca4c0b5efc735d2fca73565af8b23a777e4537213958999f857c9bbb`
- runner SHA256 `3987b0abfba1b8907e26ac3956a11d1ab1f9f1c07c369dbf7ffd9d087ec5a63c`
- test SHA256 `319c4b42d2c494bf72c27a30c12ef18749c66c3a8257772877aaed0853f4cd11`
- Dockerfile仍24569字节/SHA256 `ac633df2a4707914b018263e13f45333314e6e6280474798860bf2e6eac954ee`
- image.lock仍SHA256 `426156787c00e0f2cf0b9abba7dc8536caef6c45ea074d74a628b48faec31e13`

四源、报告及索引raw/display共72项size/SHA检查匹配；Dockerfile/image.lock与parent逐字节相同。原独立三CLI的receipt SHA `9c0b5c2c41e18902c889383fb5d5643bfd43674dda2564f6fbbd0fc6744222d8`亦重核，未修改历史。

## 根因修复核对

`validateRuntimeRecipe`不再试图从任意Dockerfile的全文substring推断执行操作。`RUNNER_RECIPE_TEMPLATE`由受保护runner CODE固定24569字节和上述Dockerfile SHA，未从输入lock、环境、CLI、文件里的自填摘要选择模板。

它对UTF8正文前24569字节完整散列，**包含全部here-doc/注释/空白**，不strip再hash；因此JS注释、字符串、false分支、shell noop或替换真实操作，即使原文本还在都不能通过。以后执行模板升级必须改受保护CODE pin并重审，输入lock自行重hash不能洗白。

模板结束处为完整ENTRYPOINT及换行；其后仅允许完整空白行或`#`非执行metadata行。末尾RUN/FROM/heredoc、独立续行、不完整行、syntax/escape/check parser directive拒绝。合法metadata没有被剥除，仍按完整原字节进入context摘要。host路径/secret-pattern扫描移到comment跳过之前，注释没有例外，不回显合成敏感文本。

公共调用仍共享同一validateDockerfileChain/recipe检查，没有另开弱入口。qualify按原category说明拒绝；standalone stop无原handle、executed=false，不把这一拒绝伪称已验证实际停止能力。主ready仍false、upGate CLOSED，CODE或哈希形状不能提升Runtime/Role资格。

## 独立实际检查：18/18，一次有效执行

原三次build-plan输入Dockerfile的SHA与原独立反例逐一相同，只有实际被调runner版本变化：

| 场景 | 实际退出 | 构建argv |
| --- | --- | --- |
| 原合法baseline | 0 | 存在，仍ready=false |
| 原CLI链接仅留Docker注释 | 2 | 无 |
| 原npm ci仅留JS注释 | 2 | 无 |

另检查真实npm ci放在if(false)、追加RUN/FROM、追加syntax directive、独立续行、未结束comment，均2且无dockerBuild。安全metadata实际0且context中的Dockerfile SHA等于完整附加后文件SHA；合成host路径/secret-pattern comment均2、无构建输出且无原文本泄漏。

原坏npm-ci注释还实际覆盖validate、qualify、up、probe、stop、build-plan --export-context六个其他公共调用；全部2、不ready、无dockerBuild。除stop固有无handle拒绝和metadata扫描场景，已核拒绝原因为RUNTIME_RECIPE_UNSAFE，不是无PyYAML等无关准备错误。

精确命令由Python argv数组执行，形式为：

```text
/Users/mac/.nvm/versions/node/v24.15.0/bin/node /Volumes/mac-extend/codex/worktrees/comet-delivery-contracts/sdd-harness/tools/infra/runner.mjs <实际command及参数> --dir <独立tmp场景目录> --json
```

全部18份原argv/cwd/UTC/pid/actual+expected exit、输入Dockerfile/lock SHA和原stdout/stderr SHA在receipt。UTC `2026-10-26T00:07:43.007779+00:00` 至 `00:07:46.419061+00:00`。Node24.15.0；使用作者既有Python3.14.7/PyYAML6.0.3宿主parser，未安装或修改它。11种外部工具guard实际校准97，测试额外调用0。

原三工具PID **12495、12535、12539**；余15个PID亦逐项记录，全部communicate终态。tool session **73175** 已终态0。没有重试任何实际行为失败、触发Docker或执行plan输出；负export在检查阶段拒绝，没有物化坏context。

## 原测试/历史保全与限制

程序化对比7e48 test：被扩展的online-acquisition用例之前和之后的所有测试正文逐字节相同，原online负例及其code/no-command约束保留并加强。未修改old737已批准语义或原92其它assert。作者17变体×7callers及完整106/106属于作者结果，本次没有重跑全106或包管理/大体积Linux机制。旧103/3、原P2坏recipe原0结果、其后真RED及测试装配错误均保留，不改写历史。

本次验证脚本初次在公共CLI派发前错误假定index所有记录均有displayPath；实际上含raw-only记录，KeyError前置失败保留 `/private/tmp/I02-fullrecipe-r2-std-ckhamnd7/`（publicCallsDispatched=false）。修正仅核对有display的记录后，才首次派发上述18次；不是行为重试转绿。

独立材料根 `/private/tmp/I02-fullrecipe-r2-std-bi60o7ej/`：

- `receipt.json` SHA256 `eb64e52d9b6a832517ccf2ae537833465f5b83c05f47146b87694992b805f07e`
- 每场景完整domain/Dockerfile、原stdout.json/stderr.txt、guard-calibration.txt
- `additional-proof.json` SHA256 `2d9c7150e99695a0b7aef66b05a7b63e09993c09e7dc668d1c861650f47c5b0c`：原三输入同字节、其他test正文不变及拒绝原因校验
- 入口 `/usr/bin/python3 /private/tmp/I02-fullrecipe-standards-r2-run-20261026.py`，每次新建独立tmp

合法public plan实际bootstrap digest `55ac772e81495c5575ccae0dacb9ef7ff140383b10d9516b39f3885ab93fb9f3`，SDK仍原3056/7patch；该源仍是原1c66 bootstrap，没有借用后来stdio/Core。新406a计划/582输入未执行，旧918541不能重用。本次仅支持construction串行集成；Root仍须独立Spec、current主树复验及具体D/E授权/实际镜像资格。provider/SourceReader/issuer/workerframe/OS/角色、sameRun业务和whole仍未验。
