# Comet / overlay / Ponytail / 基础设施可行性预研裁决

日期：2026-10-20。**裁决：REVISE。复用路线有实际基础；当前组合不具备受管团队试运行准入。** 本报告不修改实现、任务勾选、执行状态、冻结锁或架构评审票。

## 1. 实际做了什么

读取固定上游 Comet 0.4.5 / c90af44 的构建，运行官方方法来源解析、package generator、生成脚本及公开 Comet CLI；调用本机 Ponytail 5.3.2 的真实生命周期脚本；对当前 Runner/Outline 配置执行只读 qualify。

共执行20条真实命令并保留退出码、输出和独立状态读回；所有 Git/OpenSpec/Comet/Hook 写入位于隔离临时目录。没有模型调用、正式方法包发布/安装、原生宿主事件派发、业务MCP写入、容器启动或生产权限修改。

- 可复跑程序：[feasibility-probe.mjs](../../openspec/changes/delivery-foundation-rearchitecture/overlay-prestudy/feasibility-probe.mjs)
- 机器结果/逐命令记录：[feasibility-results.json](../../openspec/changes/delivery-foundation-rearchitecture/overlay-prestudy/feasibility-results.json)
- 先前基础预研：[probe.mjs](../../openspec/changes/delivery-foundation-rearchitecture/overlay-prestudy/probe.mjs)、[results.json](../../openspec/changes/delivery-foundation-rearchitecture/overlay-prestudy/results.json)

程序使用固定构建入口与已缓存的隔离 OpenSpec CLI，命令操作采用独立工作区。结果记录实际执行入口/脚本摘要。各来源方法读取内容但仅输出来源与内容hash，不对外发送资料或泄露凭据。

## 2. 现实矩阵

| 声明 | 本轮真实观察 | 结论与范围 |
| --- | --- | --- |
| 方法可以按真实来源固定 | 官方 resolver 从本仓库找到 grill-me、tdd、test-authoring、whitebox-verify，均唯一 available 且有内容hash | **已证来源解析可行**；未证明宿主真实调用或方法质量 |
| 官方 overlay 保持同一阶段权威 | 先前生成脚本预研：拒绝独立init、按原phase路由、apply不改原状态、无独立Run | **已证生成脚本层可行**；不是正式分发后全链路认证 |
| 原生canonical plan可保持唯一tasks | 原生校验器接受authority/ref计划，拒绝第二checkbox，勾选不改任务定义revision | **已证校验器层可行**；不是完整planner执行接入 |
| overlay缺方法会阻断 | 生成Guard拒绝open退出，exit 1，指出缺 required-skill:open.grill-me | **存在标记门**，不能直接解释为可信调用门 |
| 原CLI是否天然消费该方法门 | 在生成overlay仍拒绝时，公开Comet CLI open-complete返回0，独立get phase读回design | **原生推进与生成overlay判定分离已复现**；正式publish/distribute后的Hook配置尚未安装，不能据此宣称所有正式安装模式可绕过 |
| schema是否绑定当前Change | 当前Change的delta被移出匹配路径、未登记有效design_doc；仅其他Change的spec/design存在，record两个null字段，生成design Guard仍exit 0 | **生成Guard的精确产物绑定/语义不足已复现**；项目受管Gate尚未接入 |
| Ponytail方法注入脚本可用 | 真实activate/subagent输出full规则，切lite后compact保留lite，off后subagent无输出 | **已证脚本级注入/模式机制可行**；不是原生宿主事件或真实子Agent调用证明 |
| Ponytail是否与Comet状态解耦 | 上述Hook操作前后原.comet.yaml摘要相同 | **本实验范围内解耦成立** |
| 方法mode是否会话隔离 | 相同project/plugin-data作用域下，另一session形状的子角色也获得lite | **共享mode限制已复现**；不是权限绕过，需按角色隔离要求配置/验证 |
| Runner能否进入受管试运行 | 当前qualify exit 2、ready=false；runner/base缺认证镜像引用/digest | **准入阻断**；未验证真实OS/container角色拒绝 |
| Outline能否闭合真实知识义务 | 当前qualify exit 2、ready=false；app/Postgres/Redis/object-store缺认证镜像 | **准入阻断**；未验证真实权限、发布或恢复 |
| MCP能否贯通业务 | 本轮未建立受管角色的实际业务MCP会话 | **UNVERIFIED**；注册清单、工具名或其他宿主可用性不足以推断支持 |

生成包classification仍为scaffold-blocked，包含真实来源清单也没有使它自动成为已编写/评估/发布的方法能力。不能把“生成成功”当包发布资格。

## 3. 承重发现

### F-01 / P1：组合Guard与原生推进缺少已认证的共同强制点

事实链：overlay record缺方法 → exit open被拒 → 原生state transition open-complete成功 → phase独立读回design。相关源码是factory/package.ts的附加evidence检查，与classic-state-command.ts的requireOpenArtifacts/transition路径。

影响：仅要求宿主“先跑overlay Guard再调用Comet”仍依赖执行纪律，不足以满足本项目直接入口/Hook失效时的硬门禁目标。

最小方向：正式安装链先验证；对仍存在的gap，把受保护必需集合和可信回执接入同一Classic的Guard/transition/写入/恢复/archive共同谓词，不造第二phase。**阻塞受管放行**，不否定overlay的方法组合价值。

### F-02 / P1：输出合同的存在性不能当当前制品与业务质量证明

事实链：其他Change的匹配文件 + null design-summary/user-confirmation → 生成Guard通过。本轮真实复现了此前静态担忧。

最小方向：项目Gate核对当前Change、state.designDoc/state.plan、精确输入摘要、真实审查结果与oracle；原schema/最终schema冻结，禁止同ID弱化。继续复用原生canonical plan，不重写任务权威。**阻塞可信A/T/P/V接纳**。

### F-03 / P1：来源真实不等于调用真实

官方resolver能发现并hash真实方法；前次预研又表明手填completedChecks/null摘要可通过。两者证明来源和自报标记是不同证据。当前没有可信dispatch→实际启动→Skill调用→结果接纳的受管链。

最小方向：按真实execution/attempt/候选/policy绑定原始报告，worker不能写可信控制卷/签发材料；方法不可用保持blocked。**阻塞独立验收通过**，不因多个方法名称正确就签回执。

### F-04 / P1：Runner与知识服务尚未取得实际资格

qualify正确地返回非零/ready=false，未把声明配置冒充部署。Runner2项、Outline4项镜像均未认证；这证明fail-closed准入行为存在，不证明基础设施可运行。

最小方向：由原I02/I03等任务固定实际产物、身份、网络/存储与授权，再运行真实角色负向访问、知识写入/读回/恢复。**阻塞受管团队或无人值守试运行**。本轮不为转绿发明镜像、复用其他项目凭据或启动未授权服务。

### F-05 / P2：Ponytail能注入，但当前共享mode不满足会话级独立模式承诺

在相同方法状态作用域下另一会话继承切换后的级别，与源码的共享作用域说明一致。它不改变Comet phase，因此不能据此称业务权限串扰；若不同角色需要不同方法级别，就必须提供独立数据作用域并验证。

最小方向：首期固定full方法profile，角色真实注入与模式状态隔离按需认证；Hook缺失/关闭时必要Gate仍阻断。避免把模式徽章、脚本exit 0或模拟payload当真实宿主事件证明。

## 4. 可行性裁决与最短下一步

1. **可继续复用实验：**方法来源解析、官方生成器/overlay、原canonical plan和Ponytail脚本机制均有实际正向证据。无需重建方法路由、任务映射或阶段引擎。
2. **不能直接上线受管流程：**F-01至F-04阻塞项未关闭；OVR独立评审、OVQ正式组合资格、OS身份和真实MCP/平台路径尚未认证。
3. **下一步只做一个受控纵向切片：**在原Classic Run内接当前R/T或required-method回执的共同判定；真实尝试正常Guard、直接transition、写入和恢复；再用新候选重验。随后接独立角色及一个实际业务工具，最后处理知识/平台收尾。

本轮不撤销原架构方向，不把预研改成产品通过，也不修改100场景的状态。若补丁不能在原事务/恢复和所有入口保持同一不变量，应停止受管启用并复审，不靠外围Hook/第二controller掩盖缺口。

## 5. 未验证项与报告边界

未验证：正式overlay发布与原生宿主安装、真实方法/子角色执行、完整独立Whitebox Journey、UI/API/持久化业务、受保护CI/制品提升、Outline授权/撤权、宿主宕机和恢复SLO。本轮脚本自检与原生gap复现不是这些范围的验收回执；没有执行新的全票架构评审。
