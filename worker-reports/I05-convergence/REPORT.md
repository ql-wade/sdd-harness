# I05 最小建设批次

基点 afae696eb0fc8a93ef5c1e0fe5deb5472d4589f0。沿原 I05 / 唯一 DAG，候选待独立双审；whole I05、真实生成、认证 API/MCP、Comet 旅程和恢复仍未验收，业务 case 接纳0。原控制器要求先交出此最小批次并释放评审槽，部署/生成留在同 I05 续接，不缩原最终范围。

## 已完成的机制与真实观察

- 五条公开路径共享输入形状和语义准入，再访问对象/数组或进入 probe。null/非数组/空元素/未知版本/重复组件等受控拒绝；I01 refs validator 直接复用。未知/重复/缺值 option、非 loopback origin 和 userinfo/query/path 拒绝；不再默认读取环境 endpoint 或隐式发 API。
- 来源 entry 必须同时匹配当前 registry 的 repoId1285806550 / ql-wade/sdd-harness，以及独立 codewiki-source-read 用途。相同 project 标签不能把 rpamis/PAV/上游仓库结果冒充本项目。身份元数据只作观察，approvedSources 仍为空，不签发或升级任何 grant。
- Graph 可以缺席 profile/lock条目；Wiki Compose 不再要求 Graph 镜像。配置探针实际重跑声明校验，明确 proofLayer=component-configuration、graph.runtimeVerified=false，不能签实际正确性/检索旅程。
- 公开连接器实际读取 AsyncFuncAI/deepwiki-open repo975318071，固定源码3e0f503b0cc815c1525a063911524d233bda2400。17份源码的原始 Git blob SHA 全部相符，MIT，无 release 列表项。真实 OCI index固定90a0cfa…，arm64配置revision与该commit匹配，另有amd64清单；没有下载/启动镜像，签名、运行、备份兼容性仍未资格化。
- 自托管模板改为源码实际 frontend3000 / API8001、loopback17400/17402、独立internal网络、具名数据/日志卷；没有 source/provider/auth key。真实 Docker Compose config编译通过，未pull/up/build。镜像布尔标记只作RECORDED，不产生VERIFIED/ready或动作权限。

## 实际验证

精确 NVM Node24.15.0，PATH先离线守卫、再同一Node bin。docker/gh/npm/curl/wget/fetch六项阳性控制通过。每组UTC/argv/cwd/PATH/输入/二进制SHA/实际exit及raw/display分开摘要见 run-results.json；tracked元数据使用显式便携占位映射，raw从未改写。最终I05原14+新增7项=21/21，相关共享registry41/41，0fail/skip。最终I05输入摘要e0261115363af7d6ac89f0158a99b836f3768ff8dbdd32ec91987691b41d1142；registry直接消费的I01文件未变，之后只有I05诊断文本纠正并重跑最终21项。未跑无关全仓或完整旅程。

先真实RED再GREEN：共享输入矩阵；Graph删除；错误当前来源/镜像布尔资格/endpoint；真实上游布局；named-volume容器目标与宿主源区分。原14项中的旧UNSELECTED、rpamis fixture和7400→7400端口断言依据实际源/镜像读回纠正，保留原负例，关键变异检查实际命中。临时fixture统一afterEach清理。

曾有一次“直接删除整行主机路径检查”的补丁被自动审批拒绝，未执行。安全替代保留全局门，只区分固定codewiki-data→容器/root/.adalflow，并只接受两组已声明具名映射；/Users、/Volumes、/root、docker.sock、相对逃逸、伪named、long/flow bind均有真实受控拒绝。原拒绝及替代结果见 approval-history.json。

## 明确未完成

没有部署、摄入、模型/embedding调用、secret读取或MCP注册变更。原生源码默认浅克隆、缓存键不含immutable ID/commit，读接口逐项目鉴权未证明，无原生MCP路径；这些不是健康或静态选型能替代的能力。完整manifest输入/来源/coverage/未来时间检查、受控source snapshot生产者、实际生成/API/MCP读回及完整错误/分页处理仍属于后续I05；现有本地freshness声明通过不能授权或签live知识门。

三个purpose refs仍NOT_PROVISIONED；没有复用旧三方材料许可、Outline一次owner-key许可、其它项目资源或旧缓存。下一步固定主体/源commit与包digest、generator与embedder实际目的地、资源/费用上限和回滚，按已有明确范围授权由原控制器核对后执行。具体资源与读写边界见 RUNTIME-QUALIFICATION-PLAN.md。

typed-case-binding-advice.json 仅供root写唯一caseplan：原F01/F03/A20/C06/N05，5case/15条必需断言，全部实际终态UNVERIFIED；精确当前source/image/模块SHA、已有CLI与尚缺producer、冻结空值和预期产物路径均列出。没有修改canonical或新增case/controller。

仅七个独占文件和本报告目录变更。旧I01/I03原始资料、一次性脚本与历史Git不触碰；ignored .local/I05-convergence 保存本轮原始证据/17份上游body，归档工作树前必须保全。当前所有命令已结束，没有运行中的部署/worker/test句柄。
