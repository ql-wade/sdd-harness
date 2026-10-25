# P1_2 mixed Hook：独立 Spec 审查

**结论：PASS_FOR_SCOPED_CONSTRUCTION；本次限定源码修复新增确认阻断0。整体P1_2、F04/B09和真实Host资格未关闭。**

候选 `d0b7c0f171dca7c5afb7f57a4db98e2397733745`，base `a497b7b885984fa70cc3220173d47cc30da86a5e`；只读审查，结束仍clean。依据：spec.md F02:171–173要求已有用户配置在初始化、重复、升级和卸载时“保留用户条目，不重复Guard，配置可回退”；原P1_2 Step3要求脚本行为和settings matcher同测、用户条目不丢；N02:506–508要求不再生退役路线并保留合法方法/无关用户条目。

- **安装保全**：adapter:423–438按handler移除有确切归属的命令，保留同组剩余user/plugin/non-command及entry元数据，再追加唯一当前项目组。实际三事件mixed组的matcher、顺序、timeout、permissions、其它事件均保留；重复组合逐字节幂等。
- **归属准确**：adapter:195–207/370–384仅完整匹配自身当前Bash和历史直接调用，plugin标记优先。路径文字、附加用户参数/命令、备份后缀、其它项目路径和非command对象不授予删除权。真实bare legacy、项目变量旧调用仍清理；原deny、quote/env及重复注册冲突断言未删除或放宽。
- **卸载保全**：adapter:218–235逐handler移除项目命令，mixed plugin不再保护应卸载的项目handler；同组用户、字面路径与附加命令保留。原settings装配及注册命令真实执行覆盖deny2/allow0、matcher并集、SessionStart注册、其它事件、重复与私有bootstrap卸载。无新phase/控制器或业务权限来源。

三组作者RED确为实际settings数据丢失/错误保留断言失败，分别GREEN；原适用输入/日志保留。bootstrap首次缺公共锁是SETUP失败，不计行为RED；随后补齐私有fixture的既有锁及原样批准tdd来源，不修改生产MF/完整profile资格。39项manifest SHA `2a4832e03c4735d1f53ea91eb62652e57dd8609f12c72588b383a90aad001aea` 与36对raw/display全匹配；两份base源码历史逐字节匹配a497。测试diff仅扩展runAdapter可传卸载参数并新增用例，原quote/env/deny断言保留。

独立命令：`/opt/homebrew/bin/python3 /private/tmp/P1_2-mixed-hook-spec-replay-20261026.py`，固定Node24.15.0，实际运行 `node --test --test-reporter=tap test/adapter-quoting.test.js test/delivery-hook-assembly.test.js`，**18/18，0fail/0skip**。11个外部拒绝器校准97、测试期间调用0；11输入前后不变。UTC19:26:16–19:26:19，session5825终态exit0，无遗留句柄。

原始证据 `/private/tmp/P1_2-mixed-spec-61w6lp8z/`；metadata SHA `3a2be1e0d14bbcdadb53a1db71a7e5f63feccbc8f9e5b4aec53b157caf4d8918`；stdout SHA `d35a74d9ff291b5c7b514a0a8df0213cd067cbbccba7102b14b86bc7bfa22be2`。aad旧分支和原24组raw SHA `156e7597…a68f6`、8220旧分支仍保留。

**未完成义务不减**：作者关联74/72/2中的完整Foundation exportDigest/code closure drift、旧Run检查silent-rebaseline-blocked均保留原失败；sealed资产可解析不等于旧Run恢复通过。本审查未重跑、更换oracle、放宽断言或认定其过时。Root需联合3056与最终adapter统一发行，并按原F04/B09实际复验；仍失败则处理真实缺陷。18项仅私有临时目标的脚本/配置构造，不证明实际install/host信任、冷Agent、角色/OS或whole；业务接受增量0。没有Docker、模型、API、下载、secret或主配置写入。
