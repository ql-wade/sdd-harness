# P1_5 主检出回归修复

候选aad310f经Spec/Standards独立审查后，Root直接应用两项test/probe修复及完整历史。主24/24通过。C08历史1.3.1真实响应重放、当前1.14.3与隔离1.11.0分别核验，坏闭包仍拒绝；方法pin只绑定批准MF与sealed245全源，未改方法正文/SDK/共享锁。

完整check首轮944项943通过、1失败：真实SIGKILL可能将直接写入的heartbeat夹具截成半截JSON。原P1_5两失败已关闭，此新失败单独保留。Root仅把原P4_8夹具heartbeat改成与其state同样的相邻tmp+rename，原真实kill、同operation、陈旧时间和恢复断言不变，独立review无阻断，窄1/1通过。

修复后实际完整bash scripts/check.sh会话28871退出0：944/944、0fail/0skip，Whitebox全部6组和共识gate自测通过，YAML/JSON尾检查通过(84/3)。两个代码变化来源分开记录，不把首轮失败擦除。8用户/活配置文件摘要和139技能源字节/mtime不变；Docker9/gh2均离线guard拒绝，无模型/真实资源调用。

这是仓库回归和两项探针维修，不是wholeP1_5/C01-C08真实旅程，也不是实际角色/OS/平台/知识或129/103验收。源安全回移/原生非Gate端口/固定Host仍未完。原始命令、UTC、输入、日志见主.local/comet-reset/p1_5-main-integration，审查原文在reviews。
