# Comet Runner 镜像构建声明（RunnerInfra.v1 / RoleBoundary.v1）—— 仅声明：本宿主无 container daemon（EPERM），
# 该构建从未执行，buildStatus=UNVERIFIED（见 infra/delivery/runner/image.lock.json sourceInputs.containerBuildStatus）。
# 基镜像与全部固定哈希经 --build-arg 从 infra/delivery/runner/image.lock.json 解析注入；本文件不内嵌任何 tag/digest/哈希值。
# 补丁链/工具链/确定性入口完全由 integrations/comet/upstream.lock.json 当前内容导出（RW_RUNNER_BUILD：
# 六补丁全链消费 + fingerprint 确定性入口，见 tools/infra/runner.mjs build-plan）；构建契约复用
# toolchain-baseline.json extension_delivery 的限定 build 工具（P1_1/P1_6，hostBuildFingerprint 见 lock）。
# 基镜像须提供 node 24.15.0 / pnpm 10.18.3 工具链（integrations/comet/upstream.lock.json toolchain）；其选定与认证属资源准入（up 前）。

ARG RUNNER_BASE_IMAGE
FROM ${RUNNER_BASE_IMAGE}

# 固定输入（构建入口注入，对照 integrations/comet/upstream.lock.json 与 image.lock.json sourceInputs）：
#   SOURCE_COMMIT / SOURCE_SHA256       <- upstream source.commit / source.sha256
#   EXPECTED_FINGERPRINT                <- sourceInputs.hostBuildFingerprint（archive+patches+toolchain 现算指纹）
#   OPENSPEC_VERSION / OPENSPEC_TARBALL_SHA256 <- sourceInputs.openspec（P1_1 钉定的隔离兼容候选）
#   PATCH_<n>_SHA256                    <- upstream.patches[n-1].sha256（顺序即 lock 顺序）
ARG SOURCE_COMMIT
ARG SOURCE_SHA256
ARG EXPECTED_FINGERPRINT
ARG OPENSPEC_VERSION
ARG OPENSPEC_TARBALL_SHA256
ARG PATCH_1_SHA256
ARG PATCH_2_SHA256
ARG PATCH_3_SHA256
ARG PATCH_4_SHA256
ARG PATCH_5_SHA256
ARG PATCH_6_SHA256

# 构建上下文 = 仓库根。限定工具、lock 与完整六补丁链以仓库布局镜像进容器（相对路径与 lock 逐字一致），
# 使 build.mjs 的补丁完整性检查（PATCH_INTEGRITY_MISMATCH 纪律）按原相对路径生效。
COPY tools/comet/ /build/repo/tools/comet/
COPY integrations/comet/upstream.lock.json /build/repo/integrations/comet/upstream.lock.json
COPY integrations/comet/patches/0001-matt-method-profile.patch /build/repo/integrations/comet/patches/0001-matt-method-profile.patch
COPY integrations/comet/patches/tests/1_6.patch /build/repo/integrations/comet/patches/tests/1_6.patch
COPY integrations/comet/patches/0002-managed-delivery-runtime.patch /build/repo/integrations/comet/patches/0002-managed-delivery-runtime.patch
COPY integrations/comet/patches/tests/2_4.patch /build/repo/integrations/comet/patches/tests/2_4.patch
COPY integrations/comet/patches/0003-post-archive-closeout.patch /build/repo/integrations/comet/patches/0003-post-archive-closeout.patch
COPY integrations/comet/patches/tests/4_6.patch /build/repo/integrations/comet/patches/tests/4_6.patch
COPY .sdd/cache/runner-build/comet-source.tar.gz /build/comet-source.tar.gz
COPY .sdd/cache/runner-build/openspec-${OPENSPEC_VERSION}.tgz /build/openspec.tgz

# 输入完整性：archive、openspec tarball 与六个补丁的 sha256 必须与 lock 一致，任何不一致立即终止构建。
RUN echo "${SOURCE_SHA256}  /build/comet-source.tar.gz" | sha256sum -c - \
  && echo "${OPENSPEC_TARBALL_SHA256}  /build/openspec.tgz" | sha256sum -c - \
  && echo "${PATCH_1_SHA256}  /build/repo/integrations/comet/patches/0001-matt-method-profile.patch" | sha256sum -c - \
  && echo "${PATCH_2_SHA256}  /build/repo/integrations/comet/patches/tests/1_6.patch" | sha256sum -c - \
  && echo "${PATCH_3_SHA256}  /build/repo/integrations/comet/patches/0002-managed-delivery-runtime.patch" | sha256sum -c - \
  && echo "${PATCH_4_SHA256}  /build/repo/integrations/comet/patches/tests/2_4.patch" | sha256sum -c - \
  && echo "${PATCH_5_SHA256}  /build/repo/integrations/comet/patches/0003-post-archive-closeout.patch" | sha256sum -c - \
  && echo "${PATCH_6_SHA256}  /build/repo/integrations/comet/patches/tests/4_6.patch" | sha256sum -c -

# openspec 只经已验证 tarball 隔离安装（P1_1/P1_5 钉定候选 1.11.0；绝不浮动升级、绝不全局宿主安装）。
RUN npm install --global /build/openspec.tgz

# build.mjs 的 Comet 源解包经 python3 子进程执行 bounded path/member 检查（tools/comet/source.js）；
# slim 基镜像不含 python3——真实构建第一跑即 UNSAFE_ARCHIVE（终端通道证据 i02-build-full.log），此处补齐。
RUN apt-get update && apt-get install -y --no-install-recommends python3

# 受控构建（声明）：补丁按 lock 校验应用，fingerprint 由工具按 archive+patches+toolchain 现算；
# --project /build/repo 使输出落在 /build/repo/.sdd/vendor/comet/<commit>/builds/<fingerprint>/work。
# 本步骤从未执行（UNVERIFIED）：准入时先在受控环境重建并核对 fingerprint 与 digest，再认证镜像。
RUN node /build/repo/tools/comet/build.mjs \
      --archive /build/comet-source.tar.gz \
      --project /build/repo \
      --lock /build/repo/integrations/comet/upstream.lock.json

# 非 root 运行身份与角色工作区挂载点（挂载策略见 workspace-mounts.json；控制卷只对 controller 可写）。
# 入口是确定性 fingerprint 路径：EXPECTED_FINGERPRINT 与构建工具现算值不一致时 test -f 失败、构建即拒——
# 禁止按路径搜索取首个匹配的漂移入口（历史缺陷：这类解析会静默吞掉指纹漂移，故确定性检测连注释一并禁止）。
RUN useradd --uid 10001 --user-group --create-home comet \
  && mkdir -p /comet/state /comet/receipts /comet/issuance /workspace \
  && test -f "/build/repo/.sdd/vendor/comet/${SOURCE_COMMIT}/builds/${EXPECTED_FINGERPRINT}/work/bin/comet.js" \
  && ln -s "/build/repo/.sdd/vendor/comet/${SOURCE_COMMIT}/builds/${EXPECTED_FINGERPRINT}/work/bin/comet.js" /usr/local/bin/comet-runner \
  && chown -R comet:comet /comet /workspace

USER comet
WORKDIR /workspace
ENTRYPOINT ["node", "/usr/local/bin/comet-runner"]
