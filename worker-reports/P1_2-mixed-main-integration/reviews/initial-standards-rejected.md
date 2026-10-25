# P1_2 mixed hook：独立 Standards 审查

**结论：REQUEST_CHANGES；一项已确认的源码/装配阻断。** 仅是handler保全候选，不认证实际Host/角色/OS或whole P1_2。Spec原18/18不能覆盖本反例。

候选 `d0b7c0f171dca7c5afb7f57a4db98e2397733745`，base `a497b7b885984fa70cc3220173d47cc30da86a5e`；worktree HEAD匹配、开始时clean。范围只读adapter/test/精简证据，不改候选。

## [P2] 非command handler被当成空命令重复，合法mixed保全无法完成

位置：`tools/adapters/claude-code.sh:455–474`，与421–438的新handler保全流程相接。

新流程保留mixed组中的非command用户handler是正确方向；但后续重复注册扫描遍历每个dict handler，无论type，都对缺少command取空字符串、执行normalize并加入seen。两个内容不同的prompt handler因此都变成 command=''，被误判为重复命令。结果不是丢数据，而是有效的mixed用户配置不能安装/组合；不能要求用户删除不同prompt来修复不存在的重复命令。

已用纯tmp、真实adapter确认：Stop组包含一个本项目legacy command、两个不同 `type: prompt` handler（不同prompt/timeout），实际exit1，错误为 `user entry duplicates another user registration`、command=''。settings原字节保持。没有执行prompt或模型，没有调用真实Host或写真实settings。

最小修正：event+command重复检查只处理真正 `type == command` 的handler；非command用户内容仍完整保留。继续原有真正command的项目/用户/plugin冲突规则，不能为此取消command重复检查。补mixed中两个不同非command handler的安装、重复运行、卸载保全用例，再复跑原quote/deny/legacy/user与matcher装配。

## 反例与输入绑定

- 原始proof：`/private/tmp/P1_2-mixed-standards-hfku6087/proof.json`；SHA256 `db5d87861f317896ea729eeaf20872124f48148546f02ca8f0640bc0706d344c`。
- 原始输入：`/private/tmp/P1_2-mixed-standards-hfku6087/input-settings.json`；SHA256 `ad67ab2cdb3f7702105ab2fe984d24110c2cfca4cd442f6bf87e6f6f72809077`。
- 实际TARGET_ROOT：`/private/tmp/P1_2-mixed-standards-hfku6087/target`，原settings仍在，source adapter SHA256 `c62d3393b1d0cb9594688a9ac1b1530c747525b5111b6ab5ef17113c05f9953b`。
- 同目录stdout/stderr均留存；实际argv/env/cwd/UTC/exit在proof中。该反例是装配失败，不是prompt执行、模型身份或OS权限验证。

## 其余核对与保留结论

完整命令fullmatch取代子串search，安装/卸载共享同一识别模式，排除路径文字、附加user命令/参数、其它项目路径、备份名与非command；对命中的项目handler按粒度移除，其余handler及组matcher/metadata顺序保留。deny策略汇总matcher、SessionStart startup|resume、quote编译与原ManagedOutputs原子写边界均未放宽，也未新增调度/权限来源。原quote/deny/legacy/user断言仍在，runAdapter只扩展可传卸载参数的已有helper。

证据核验：manifest SHA `2a4832e03c4735d1f53ea91eb62652e57dd8609f12c72588b383a90aad001aea`，39项bytes/hash匹配，异常 `[]`；raw/display索引36组逐项匹配，异常 `[]`；两份原adapter/test历史对a497b7b Git字节匹配：`{'tools/adapters/claude-code.sh': True, 'test/adapter-quoting.test.js': True}`。三条有效RED与各自GREEN、08缺fixture锁的SETUP失败保持分开。18/18是已有作者/Spec测试结果，不升级为本Standards已通过完整装配；本轴实际执行的是上面的纯tmp反例。

关联74total/72pass/2fail仍明确保留：Foundation完整code/exportDigest closure及oldRun silent-rebaseline-blocked语义尚未闭合。不认定oracle过时，不改F04/B09、不重签共享锁，不用72绿冲抵两失败。Root在新3056源与最终adapter统一发行后按原语义复验；若仍失败继续处理真实缺陷。

可消费范围：当前仅作为原P1_2返工输入和精确保留的历史证据；修正类型区分、重新独立审查后才可接纳本handler保全源码。没有Whole/Host/role/OS/实际方法资格增量。

本审查未修改源/锁/主计划/台账、未执行Docker/model/API/secret/下载或真实全局设置。已保全反例原件；不扩展其它审计，交回原作者同任务修复。
