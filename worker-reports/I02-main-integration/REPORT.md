# I02 主检出建设集成

最终候选 `636dfb83acc94e901192875c0feeec8e5f47f128`，原始基线 `cbde39e`。原 `70a2` 的 context 白名单 P1 已由作者返工，并经两份独立审查确认；Root 直接应用最终合并差异，没有先激活有缺陷的中间版本。

- [Spec](reviews/spec.md) 独立执行 54 次 CLI，覆盖 17 类异常在 plan/export 下的拒绝及精确复用。
- [Standards](reviews/standards.md) 独立复现首次导出成功、追加无秘密 `.env` 后拒绝，未知字节保留且不输出 Docker 构建命令。
- Root 确认 154 项候选路径字节与冻结 Git 候选一致；8 项用户既有文件/活配置摘要不变。
- 主 I02 81/81、关联 I01 41/41，零跳过。最终全仓 941 项，939 通过、2 失败、零跳过；原 I02 六处失败关闭，没有新增产品失败位置。剩余两项仍是原 P1_5 的 OpenSpec 负例版本与方法快照登记问题，总检查仍未通过。

最初全仓 941/938/3 还包含 Root 取证环境移除现有 HOME 导致的登录 shell fixture 错误。Root 只恢复继承的真实 HOME，没有改产品或断言；窄检查 8/8 后重新执行全仓，得到上述 941/939/2。首轮与校准证据均保留，没有将其算作产品行为 RED。

每次 Root 运行先校准六个离线拒绝 guard。I02 owned 外部调用 0；I01/全仓的 9 次 Docker、2 次 gh 尝试均由 guard 实际拒绝。没有模型 CLI 或真实 Docker/API 调用，也没有当前镜像、OS、独立角色或权限资格。

原始 Root 命令、UTC、输入前后摘要和日志见 `.local/comet-reset/i02-main-integration/`；汇总见 [integration.json](integration.json)。原作者 65/41、返工 81/41、原失败及两轮 manifest/raw 保留。

只接纳通用准入、完整 context 检查和物理 start/observe/stop 端口建设。完整树检查是时间点证明；实际构建消费者仍须在消费边界复验或保护快照。当前 Run/可信身份/固定 host 由 P1_3 核验，物理端口不成为第二调度者。whole I02、真实 Runner 及全部 129/103 业务义务继续未验，业务接纳增量 0。
