# I02 execution-slot：并发夹具返工

父候选6870e685保持不变，本轮只改test/infra-runner-isolation.test.js及本新增报告。产品tools/infra/runner.mjs仍为837751b28f1bc25ff55e5b40673e4138cbd0797acabf115f33f20363808a7072；原端口合同不变，不新增状态表、主控、Docker或镜像动作。

独立Standards的8项7通过/1失败和确定性截断实验已保全，报告原SHA为9be040362c411c8097dcbb1388ce73fda955338e24688b484ecc6be034496dc9。旧作者89/89没有覆盖该失败；原6870的37项manifest、33对raw/display和整个旧证据包原样保留。preservation-intake与final-freeze实际核对86份旧文件不变。

修复仅在fake engine：完整JSON写同目录唯一临时文件后rename发布，已有读者不会被截断；每个CLI调用发布独立不可变trace，取消聚合读改写；stdin完成时重读最新状态并仅更新原容器，防止旧快照覆盖中间更新。无JSON异常吞掉、sleep、测试重试或skip。IPC/FIFO仅提供确定性测试屏障，不改变产品接口、命令结果或实际Docker行为。

| 实际作者检查 | 结果 |
| --- | --- |
| 已打开旧状态读者、双成功调用trace丢失 | 有效RED：2失败，exit1 |
| 真正保持stdin未结束时，中途新增peer/字段被旧回写丢失 | 有效RED：1失败，exit1 |
| 上述三项最小修复后 | 3/3，0skip |
| 原8项slot与新增3项 | 11/11，0skip |
| 原完整89项与新增3项，同一I02文件 | 92/92，0fail/0skip，exit0 |

原8项测试主体除新增更强的“一条start trace”断言外逐字节相同，原即刻fresh重入仍在await首次terminal之前；没有先结束first来规避并发。新增两个CLI在同一真实文件发布边界等待双方ready后释放，精确验证两事件均保留；完成写回测试真实打开stdin，在running已发布后写入独立更新，再关闭stdin。所有子进程await close并清理仅自身tmp。该夹具不提供任意并发mutator互斥或OS原子claim保证；产品唯一claim仍是原Comet CAS。

完整92运行UTC 2026-10-25T20:51:38.910221Z至20:52:15.533888Z，PID91423/session31801已终态；raw stdout SHA256为0eea06f6f23238c8bbf6f8f6f4a29e4085be5fd3f8ec08bdac988a705b2d706b。Node精确24.15.0，同bin优先PATH；HOME未重设。11个外部工具拒绝器实际校准97，运行额外调用0。原8份锁/策略/计划输入不变。既有公有Comet archive与OpenSpec1.11.0 tar仅只读核size/完整SHA并复制到自身fixture；没有下载、构建或真实Docker/model/API/secret/全局配置操作。

可复跑原窄组与完整文件：

```sh
node --test --test-reporter=tap '--test-name-pattern=execution slot' test/infra-runner-isolation.test.js
I02_ACCEPTED_ARTIFACT_ROOT=/actual/accepted/public/artifact/root node --test --test-reporter=tap test/infra-runner-isolation.test.js
```

使用精确Node24.15.0和已校准拒绝器PATH；完整文件前需按public-artifact-intake核验已批准公有缓存，不能借该入口补建环境。evidence/全部是便携展示副本，不冒充raw stdout；原始字节、argv/cwd/PATH/UTC/pid/退出、source前后SHA与private TestPack留在本树ignored .local/I02-execution-slot/rework-atomic-fixture。evidence-index记录每对raw/display size/SHA及规范化规则。命名为author-pack-structure的原日志实际只记录Node --version，不作为结构校验；真正author-pack-validation执行既有只读validator，输出PACK_STRUCTURE_VALID。三用例ready_for_acceptance只表示作者交接，绝不签验收。

本轮结果只覆盖夹具与原I02组件回归。真实Runner/bootstrap、OS/principal/角色、原Comet CAS接线、可信恢复与wholeI02均未签；不消费后续Python镜像资源探针，不更新任何正式锁。交Root独立双审及串行集成。
