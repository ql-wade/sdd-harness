# P1_2 分发目录根与祖先返工候选

基点358736ee303d15127a6d50a4ea5700db0ba5eb94；原任务/分支/DAG不变，Root唯一控制器。本轮仅补同一分发路径边界，待独立复审；父节点与comet-managed-v2仍UNQUALIFIED。

Standards原脚本SHA为3fd1f9414150c16418a38af69505424fea0913be326ef906a07d9afdce32ed03，本目录保留相同字节。旧码真实结果是baselineOK=true、symlinkSelectedBodyAccepted=true、exportFollowedSelectedDirectoryLink=true（red-standards-original）；新增公开seam实际RED退出1。该原脚本只是观察器，exit0不代表正确。

共享rejectLinkedPath现在校验目录根、每级祖先和叶类型；walkFiles不再跟随目录根链接。export把全部release输出先收齐并预检已有release树/每个目标，之后才创建缓存和写入；writeIfChanged拒绝链接、特殊文件和多重硬链接，独占暂存并原子替换。verify在读锁/视图前预检包根和release树，所有输出读取接同一guard及O_NOFOLLOW，完整方法目录根不能借另一checkout的源冒充。path-caller-audit.json列原函数的所有相关caller/行证据。没有新安全服务、CLI、工作流或依赖。

公开seam覆盖21个位置：包根/祖先、锁、skills根/方法根/正文/manifest、hooks、MCP、profile、code根/祖先/文件/manifest及hardlink/FIFO。所有拒绝场景都对比整个私有fixture前后路径类型、链接目标及文件SHA，既不修改外部用户字节，也不删除用户链接或先生成其他缓存/视图来通过。source文件名/正文和旧断言不放宽。Darwin标准根命名空间仅接受准确的系统目标映射，用户路径别名一律拒绝。

最终固定Node24.15.0及同PATH裸node子进程上，原63项加新增3项 **66/66、0fail/0skip**。最终UTC 2026-10-25T05:47:11.964506+00:00 至 2026-10-25T05:47:34.854662+00:00，原始完整回归日志SHA `e4ee2afa2454ef188935fae9d1d6a5b05bbfb59c189419532077ad4f859deea6`。Foundation verify也通过。首轮66通过后补齐所有输出叶读取再次跑同66，两个版本日志均保留；前一版本本轮新cache只存ignored历史，未冒充最终候选。

最终exportDigest：`2a2b2a3b9cd114a4b270a474cfe2d029d7f793d2e1c62b3822d506b07ffa6398`；新封存cache共278文件，发布视图、cache和代码输入SHA已重算一致。358的旧完整cache仍能按原锁解析；70ea/358原cache和历史报告不更新。684个旧tracked报告/cache文件、133个旧raw记录逐字节未变；CURRENT仅作为本轮指针更新，其旧字节在358 Git及ignored previous-CURRENT.md保留。11方法245文件、MF/profile、正式upstream锁、两个精确verbatim属性及5份活配置均未改。

本目录日志/路径JSON为**便携显示副本**，不冒充原始stdout。原件在ignored .local/distribution-rework-r2/raw/；commands保存UTC、cwd、argv、退出码和原日志SHA，observations保存raw/display SHA与bytes。最终输入、Node二进制SHA和裸node版本在final-probe.json。初次保全探针因历史intake位于raw父目录而未定位，修的是路径映射，仍要求准确SHA；失败日志保留，不计行为RED或PASS。

未重跑无关全仓/冷skills host，未调用模型、provider/API或服务。本轮不签trusted Hook、真实角色/方法应用、权限、Kp/唯一归档/Kt或完整同Run交付，不改台账、正式锁、业务phase/ACL或parentAccepted。全部本工人会话结束后交Root独立复审。
