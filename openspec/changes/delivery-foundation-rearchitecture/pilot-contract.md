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

## 冻结登记（P3_1，机读）

Task P3_1（run impl-dfr-20261020-r1，分支 impl/p3-1-journey-runner，2026-10-20）将本登记结构化：试点仓库=本仓库（用户已授权，execution-state.pilot_environment_choice）、owner 登记引用 I01 registry（`infra/delivery/registry.json`，project `sdd-harness-pilot`）、目标验证环境=本地隔离（本 worktree + `$TMPDIR`）、身份=运行时观测。Product/Design/TestContract/PlanBundle 四件以文件指针+摘要方式冻结（引用已接纳工件，不复制内容）；PlanBundle 摘要与 `lib/delivery/baseline.js` 的 `taskDefinitionDigest` 同一归一化——checkbox 勾选状态不构成计划漂移，定义文本变更构成漂移。`tools/verify/delivery-journey.mjs` 以下方 ```pilot-contract 机读块为唯一冻结基线来源：任一工件缺失/漂移即结构化拒绝派发并列缺项（A01 语义），PlanBundle 摘要校验绑定计划冻结（A15 语义）。重冻结程序：任何被冻结工件变更后，必须显式更新本块 sha256 并留下可审计 diff，不存在自动续期。 重冻结记录 1：2026-10-20 P3_1 评审修复合并 master（f57ead9）带入 P1_3 接纳后的 proposal/design/spec/tasks 变更，四件摘要按程序显式更新（本条即审计记录）。

### 试点负向 AC 面板（首个实际业务试点的四类负向边界）

- **UI（交互面，本试点为 CLI/诊断面）**：缺登记、缺前置或基线漂移时不得显示成功/就绪，必须结构化拒绝并列缺项（A01）；任何成功提示必须可被独立读回证伪，显示成功不构成事实（A15）；未知场景/未知 profile 不得落入默认成功路径。
- **API（CLI/进程/HTTP 入口）**：未登记来源/主体的动作请求被拒绝并留审计，public 可读不构成放权；caller 自报身份或自写 pass JSON 不作为认证与验收证据（A05/A06）；输入/前置无效以退出码 1 显式拒绝，语义验证失败以退出码 2 表达，缺失环境显式 UNVERIFIED，不静默降级。
- **持久化**：任何"已保存"声明必须以独立落盘读回证明，未落盘即 Journey 失败（A15）；冻结工件任一漂移即拒绝派发，重冻结必须是显式登记变更；内存态、回显或静态清单不得替代持久化/行为证据，零有效执行（0 tests/全 skip）不得判 PASS。
- **权限**：worker/诊断进程对控制平面（hooks.yaml、settings.json、受管状态、Comet 权威状态）无写权限，越权写必须失败并留痕；登记/权限缺失只阻断对应动作，不得把计划字段当作已满足，不得以提权重试替代登记；认证账号管理员可读不替代目标受众核验，readback 成功前不执行需要授权的动作。

```pilot-contract
{
  "schemaVersion": 1,
  "profile": "managed-pilot",
  "pilot": {
    "repository": "sdd-harness（本仓库工作树；I01 registry project id: sdd-harness-pilot；repoId 1285806550）",
    "ownerRegistry": "infra/delivery/registry.json#project.sdd-harness-pilot（owner ql-wade，principalId 262266039；authority.readbackStatus=UNVERIFIED，执行时读回成功前不执行需要授权的动作）",
    "environment": "local-isolated-worktree-tmpdir（本 worktree + $TMPDIR，loopback-only；无生产写入、无远端分支保护修改、不复用其他项目资源）",
    "identity": "runtime-observed（身份运行时观测登记；未登记只阻断对应动作，不把计划字段当已满足）"
  },
  "frozenArtifacts": {
    "product": {
      "path": "openspec/changes/delivery-foundation-rearchitecture/proposal.md",
      "sha256": "7cf2cfc360501f08845ce50b883a5a8da23a4066b6cb4455d515728025f3e4ba"
    },
    "design": {
      "path": "openspec/changes/delivery-foundation-rearchitecture/design.md",
      "sha256": "bf43383f68b81e2af5515ec284df4b412c8fc74316a30d4aa98f3a74823c155e"
    },
    "testContract": {
      "path": "openspec/changes/delivery-foundation-rearchitecture/specs/delivery-foundation/spec.md",
      "sha256": "a3a7763cb3f4131b9b4a33ab1934a268a0a429d1653ad280de9ca33a7b176c1e"
    },
    "planBundle": {
      "path": "openspec/changes/delivery-foundation-rearchitecture/tasks.md",
      "sha256": "eb7ed2cb2823e62344ad1152efdce2845d2fb3568b867e0ea9c70dad558a8508",
      "digestNormalization": "checkbox-state-agnostic（与 lib/delivery/baseline.js taskDefinitionDigest 同一归一化；勾选状态不构成计划漂移）"
    }
  },
  "negativeAc": {
    "ui": [
      "缺登记、缺前置或基线漂移时不得显示成功/就绪；必须结构化拒绝并列缺项（A01 语义）",
      "任何成功提示必须可被独立读回证伪；显示成功不构成事实（A15 语义）",
      "未知场景/未知 profile 的请求不得落入默认成功路径；必须显式 NOT-EXERCISED 或拒绝"
    ],
    "api": [
      "未登记来源/主体的动作请求被拒绝并留审计；public 可读不构成放权",
      "caller 自报身份或自写 pass JSON 不作为认证与验收证据（A05/A06 语义）",
      "输入/前置无效以退出码 1 显式拒绝，语义验证失败以退出码 2 表达，缺失环境显式 UNVERIFIED；不静默降级"
    ],
    "persistence": [
      "任何已保存声明必须以独立落盘读回证明；未落盘即 Journey 失败（A15 语义）",
      "冻结工件（Product/Design/TestContract/PlanBundle）任一漂移即拒绝派发；重冻结必须是显式登记变更，不自动续期",
      "内存态、回显或静态清单不得替代持久化/行为证据；零有效执行（0 tests/全 skip）不得判 PASS"
    ],
    "permissions": [
      "worker/诊断进程对控制平面（hooks.yaml、settings.json、受管状态、Comet 权威状态）无写权限；越权写必须失败并留痕",
      "登记/权限缺失只阻断对应动作；不得把计划字段当作已满足，不得以提权重试替代登记",
      "认证账号管理员可读不替代目标受众核验；readback 成功前不执行需要授权的动作（I01 registry authority.readbackStatus=UNVERIFIED）"
    ]
  },
  "qualification": {
    "status": "NOT_QUALIFIED_FOR_REAL_JOURNEY",
    "owner_task": "P3_1/P3_2/I01-I08",
    "requires": "actual identities, environment, real Change, sources and managed Outline collection read back; no LOCAL_FIXTURE substitution"
  }
}
```
