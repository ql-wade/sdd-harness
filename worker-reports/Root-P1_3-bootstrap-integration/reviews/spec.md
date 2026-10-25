# P1_3 薄 main：独立 Spec 审查

结论：**APPROVE_THIN_MAIN_CONSTRUCTION_ONLY**，限定候选阻断项0。仅支持当前薄入口/同进程CODE对象接线，不签生产provider、issuer/OS/角色、worker frame、非Gate动作、正向冷恢复或whole P1_3。

候选9434a5edffb9ec3f3cc56a12bb3a25bc19ba769f；base884880a3d7cb27ed70fb5da2cca33eb8b3c5ea24。tree `/Volumes/mac-extend/codex/worktrees/comet-registry-qualification/sdd-harness`，前后tracked clean。审阅两份源码/测试diff、REPORT、PROVIDER-AND-PACKAGING及Root既有R1接口决定；未依赖Standards结论。

## 规格判断

- runCometHostMain(argv, executor?)只消费同一模块createCometExecutor实际创建的对象身份；复制对象、同形对象、Proxy不命中私有WeakMap，也不会调用其伪install/invoke。该身份不认证生产调用方或source/权限，文档明确保留此前置。
- 裸Node入口/固定symlink无第二参数或provider loader；有效原生state参数但无绑定对象时结构化UNVERIFIED/exit2，无物理启动。argv/env role/provider/module与stdin frame不能安装issuer。输入数量、大小、类型、稀疏/NUL、change/操作/必需字段和选项被有限语法拒绝，未新增阶段、DAG、队列或主控。
- 首次CODE委托同步安装一次，随后仅调用原scoped invokeNative；固定project/change/run约束保留。真实原Native私有Run的四次重复/并发get phase读回open、原stdout相同，再经main读run_id确认同Run。没有以直接绕开Host的读取凑正例；物理调用0。
- 原Native结果0/1/2及stdout被保留，外围资格标记固定false；坏结果/不支持退出/未知异常返回常量错误，不回显producer诊断、输入或stack。wrongchange拒绝且不创建另一个Change；保留原非零拒绝。WeakMap、Node exit0和有限读取不被当作真实资格。

## 独立执行与输入

仅复跑新增main四个父测试及其子例：

```sh
node --test --test-reporter=tap '--test-name-pattern=packaged executable|executable rejects|CODE-bound main|main distinguishes' test/comet-execution-binding.test.js
```

固定Node24.15.0，实际 **30tests/30pass/0fail/0skip，exit0**，1444.739792ms。没有重复旧35或相关52组；作者65/52继续仅是作者数据。UTC2026-10-25T21:08:16.026335Z至21:08:17.639120Z，句柄10826明确终态exit0。外部模型/容器/平台/分发拒绝器调用0，输入前后一致；仅原临时fixture与现存6da素材，没有实际Docker/model/API/secret/下载/设置或候选写。

原始命令、输入与输出在 `/private/tmp/P1_3-bootstrap-spec-2b7spo9d/metadata.json`；stdout SHA `8df7db0d44ed4ef634fedf0efbbf8ec0b05481a70bc8c4e184e3f90c24abaeaf`，stderr为空。source SHA `3d897ac473d101c751c3ae43e133f48aab48b122398a766f4cf52db600b7812e`；test SHA `b678f1fc7aede5080e1797016d585fe656752502bfc90042825bde18a745d25e`。

独立核34项静态输入、manifest60 tracked/107 raw及49组raw/display hash均匹配；manifest SHA `f3d84165e346d1c98667739ff998bf3c28e9b0ff79482993180b3c61e31f312e`。原559测试29881字节前缀等于base Git，SHA389053944465219214fb6402a35b0076dbd7d3ec8eaa52419bf9baa623269856，没有将旧链改绑3056。正例原aggregate047950…属于固定6da，新私有Run只作机械读取；此前3056变更被拒未落的原审批事实及Root后续R1许可范围均保留，不能由本审查扩大为新供应方或生产启动授权。

## 必须继续的原义务

实际受保护CODE provider与purpose-bound凭据/当前来源登记；不可变image/模块/package/依赖闭包及symlink；真实controller/worker身份与挂载/通道隔离；worker frame方法执行和原三字节结果生产；原Native非Gate/launch记录、I02只读resolve接线及正向同Run恢复；最终当前发行和真实Journey。PROVIDER-AND-PACKAGING明确这些未交付且当前main不能处理物理worker frame。没有第二权限源、文件凭据读取器或新控制器来代替它们。建设入口可由Root双审后串行消费，业务接受增量0。

审查 UTC：2026-10-25T21:09:52.179716+00:00
独立metadata SHA256：`d283cc7384a7688b224108cb0332fa5f031058749c6249b5d6342cf1d05d74aa`。
