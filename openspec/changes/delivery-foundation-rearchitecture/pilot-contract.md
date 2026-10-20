# 本仓库受管试点登记

状态：用户已授权在本仓库配置；尚未启用真实交付或知识发布。该登记不是平台验收回执。

## 已核验范围

- 试点仓库：ql-wade/sdd-harness，远端 https://github.com/ql-wade/sdd-harness.git，默认分支 master。
- GitHub 资料域登记对象：仓库 ID 1285806550。实际 API 读回为 public；当前认证账号与 owner 均为 ql-wade，主体 ID 262266039，具有 admin/maintain/push/pull 权限。认证账号管理员可读不替代目标受众核验。
- 受管 Runner 目标：本仓库的固定单实例 Comet Classic；当前原版源码可构建，但 managed Runtime/角色隔离尚未认证，不将当前交互式宿主直接标记安全 Runner。
- 本机 Docker Server 已实际读回 29.6.2。使用专用项目 sdd-harness-pilot；不复用其他项目容器、卷、网络或凭据。
- 用户指示配置落在本仓库。分发配置使用相对路径和版本锁；本地实例、持久状态及秘密只在忽略目录/运行时秘密源，实例缺失保持未就绪。

## 允许建设与启用边界

建设项目自有的配置、受管启动与只读诊断入口；诊断只报告事实，不派发角色、不重试业务、不拥有第二阶段账本。只使用独立命名、loopback 暴露的本地试点资源；生产写入、远端分支保护修改和对外正式知识发布不由本登记自动授权。

Comet 权威状态、策略、签发材料由受管主体保护；worker 无控制文件写权限、无 Docker socket 或宿主凭据挂载。若尚不能证明此隔离，只能报 cooperative-local，不能声明防篡改主控。source/目标主体、权限闭包和发布/隔离 grant 在启用相关动作前分别登记并读回。

## 业务与验证分母

复用原92场景身份，不把配置有效、Docker可用或原版CLI可运行提升为端到端验收。首个实际业务试点需独立 UI/API/持久化与权限负向案例；测试作者、Builder、独立验收各守其角色，真实 Comet 派发和恢复必须读回。同 Run 的项目知识、规格归档、Outline团队发布和整体完成分别观察。

配置检查按 configValid、infrastructureObserved、controllerReady、actionReadiness、deliveryVerified 分层。未知/未登记/分页不全/版本不符阻断对应动作，不能从前层自动推导后层。R10 A 保留未完成工作区，G15 A 仅在健康依赖下目标5分钟隔离；故障暴露与违约必须留痕。
