#!/usr/bin/env bash
# Claude Code adapter：hooks.yaml → .claude/settings.json + hooks/.compiled.env
#
# 职责：
#   1. 编译 deny 策略为 hooks/.compiled.env（pre-tool-gate.sh 运行时读取，避免 bash 解析 YAML）
#   2. 生成 .claude/settings.json 的 hooks 段（合并已有配置，不覆盖用户其他设置）
#   3. 建立 .claude/skills/<name> → .agents/skills/<name> 软链（CC 原生技能注入）。
#      退役工作流命名（sdd-* / trinity-* / superpowers / source-command-sdd-*，
#      ADR-0015/0016）绝不建链，且任何退役残留都让安装失败关闭（只读预检，
#      拒绝时零改动）——已删除的旧业务命令不得经安装回流，也不得靠
#      "跳过 + exit 0" 冒充就绪（部分 host 无需 CC 软链即可直接枚举 .agents/skills）。
#      归属判定：只有 readlink 逐字等于本 adapter 的受管目标
#      （../../.agents/skills/<name>，相对本 TARGET_ROOT 解析）的软链才是本
#      adapter 自有；目标串“包含 .agents/skills/”不构成归属证明。按前缀删除
#      真实目录/外部链接 = 毁用户数据，绝无此路径。
#
# 幂等：重复运行安全。受管块边界：凡 command 引用 hooks/{pre-tool-gate,
# session-context,stop-reminder}.sh 且不指向插件基础设施的条目都是本 adapter
# 的受管条目——升级时整体替换（旧格式不残留、不产生第二个 Guard），用户自有
# 条目永不动。
#
# 注册分工与固定事件集（V_P1_2_PLUGIN_REGISTRATION_DIVISION，契约 §7.2/§7.3）：
#   - 插件生命周期 Hook（Ponytail 入口管理的 SessionStart/SubagentStart/
#     UserPromptSubmit 等）由插件入口注册；来源标记 = command 引用插件基础设施
#     （CLAUDE_PLUGIN_ROOT / .claude/plugins/）。插件条目不参与项目受管块的
#     移交与去重，安装/升级/卸载都不移除；项目正确性不依赖插件与项目 Hook 的
#     执行先后。
#   - 本 adapter 固定生成 PreToolUse、SessionStart(startup|resume)、Stop 三个
#     事件——不是任意事件/脚本的通用编译器。hooks.yaml 出现固定事件集之外的
#     事件（如 SubagentStart/UserPromptSubmit/PostToolUse）或携带插件来源脚本
#     时显式拒绝并列出冲突；新增事件必须修改受管生成逻辑并验证 settings
#     matcher，YAML 追加不生效。
#
# 隔离测试：SDD_TARGET_ROOT=<dir> 时，settings.json / .compiled.env / skills
# 软链都落到该目录（临时配置），源仓库的活配置不被触碰（P1_2/F02）。
# 卸载：--uninstall 移除受管条目与生成产物，用户条目保留（配置可回退）。
#
# python3 用于 YAML 的最小化解析（仅本 adapter，非运行时热路径）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET_ROOT="${SDD_TARGET_ROOT:-$ROOT}"
# 策略源：目标目录自带的 hooks.yaml（隔离/成员工作区模式），缺省回退到本仓库源。
HOOKS_YAML="$TARGET_ROOT/hooks.yaml"
[ -f "$HOOKS_YAML" ] || HOOKS_YAML="$ROOT/hooks.yaml"
SETTINGS="$TARGET_ROOT/.claude/settings.json"
COMPILED="$TARGET_ROOT/hooks/.compiled.env"

UNINSTALL=false
for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=true ;;
    *) { echo "❌ 未知参数: ${arg}（支持: --uninstall）" >&2; exit 1; } ;;
  esac
done

# ---- skills 注入（安装）/ 清除（卸载）——共享工具函数 ----

# 退役工作流入口命名（ADR-0015/0016；2026-10-24 指令清理）：9-stage 工作流的
# sdd-*、旧引擎 trinity-*、已移除的 superpowers 层，以及 .claude/commands/sdd-*
# 自动迁移出的 source-command-sdd-* 副本。命中即视为退役工作流资产：安装绝不
# 为其建立受管软链（防止已删除的旧业务命令经安装回流）。分类只认这份固定命名
# 清单——不引入新配置框架，也不波及未命中命名的用户自有技能。
retired_workflow_name() {
  case "$1" in
    sdd-*|trinity-*|source-command-sdd-*|superpowers) return 0 ;;
    *) return 1 ;;
  esac
}

# 本 adapter 为名字 <name> 生成的受管软链目标（相对 .claude/skills/ 解析到本
# TARGET_ROOT 的 .agents/skills/<name>；自 ADR-0015 重定位以来的唯一生成形态）。
managed_skill_dest() {
  printf '../../.agents/skills/%s' "$1"
}

# 受管软链归属判定：只有 readlink 结果与 managed_skill_dest(name) 逐字相等才算
# 本 adapter 自有。目标串里“包含 .agents/skills/”不是归属证明——外部路径
# （../../external/.agents/skills/custom）同样包含该子串（评审 R2 修复）。
is_managed_skill_link() {
  local link="$1"
  [ -L "$link" ] || return 1
  [ "$(readlink "$link")" = "$(managed_skill_dest "$(basename "$link")")" ]
}

# 只读退役预检（评审 R2：拒绝时零改动——settings.json/.compiled.env/软链一律
# 未写，先于任何产物生成执行）。任何退役工作流残留都让安装失败关闭：
#   R1 .agents/skills 下的退役命名技能源：部分 host 无需 CC 软链即可直接枚举
#      .agents/skills，“跳过 + exit 0”不构成就绪；源本体不删不改（上游正文
#      不可变，处置权在人工）。
#   R2 .claude/skills 下退役命名的真实目录/普通文件：归属无法证明（控制器只
#      隔离过它自己的已知资产清单，本 installer 对任意新内容没有所有权证明），
#      按前缀删除/移动会毁掉用户数据——保留原样并要求人工处置。
#   R3 .claude/skills 下退役命名、但不逐字指向本 TARGET_ROOT 对应受管目标的
#      软链：归属不明（外部/用户链接），保留原样并要求人工处置。
# 唯一例外：readlink 逐字等于 managed_skill_dest(name) 的软链是本 adapter 自己
# 的残留，安装阶段移除（见 link_skills），不构成拒绝。
audit_retired_workflow_entries() {
  local refusals=0 entry name dest
  for entry in "$TARGET_ROOT"/.claude/commands/*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    name="$(basename "$entry")"
    if retired_workflow_name "${name%.md}"; then
      echo "❌ retired command discovery input preserved: ${name}; move it out before managed installation" >&2
      refusals=$((refusals+1))
    fi
  done

  shopt -s nullglob
  for entry in "$TARGET_ROOT"/.agents/skills/*/; do
    name="$(basename "$entry")"
    if retired_workflow_name "$name"; then
      echo "❌ 退役工作流技能源仍存在于 .agents/skills: ${name} —— 部分 agent 无需软链即可直接发现该目录，安装失败关闭（ADR-0015/0016）。源本体未改动；请改名或移出后再重试安装" >&2
      refusals=$((refusals+1))
    fi
  done
  for entry in "$TARGET_ROOT"/.claude/skills/*; do
    name="$(basename "$entry")"
    retired_workflow_name "$name" || continue
    if is_managed_skill_link "$entry"; then
      continue
    fi
    if [ -L "$entry" ]; then
      dest="$(readlink "$entry")"
      echo "❌ .claude/skills/${name} 命中退役工作流命名，但不是本 adapter 的受管软链（指向 ${dest}；目标串包含 .agents/skills/ 不构成归属证明）——保留原样，请人工确认/改名后重试" >&2
    elif [ -d "$entry" ]; then
      echo "❌ .claude/skills/${name} 是退役命名的真实目录：本 adapter 无法证明归属，绝不按前缀删除/移动用户数据——保留原样，请人工处置（备份/改名/删除）后重试" >&2
    else
      echo "❌ .claude/skills/${name} 是退役命名的普通文件：归属无法证明——保留原样，请人工确认后重试" >&2
    fi
    refusals=$((refusals+1))
  done
  shopt -u nullglob
  if [ "$refusals" -gt 0 ]; then
    echo "❌ 发现 ${refusals} 处退役工作流残留，安装失败关闭；未写入任何产物（settings.json/.compiled.env/软链）。处置上述条目后重跑安装。" >&2
    return 1
  fi
  return 0
}

link_skills() {
  python3 -B - "$ROOT" "$TARGET_ROOT" "$SELECTED_SKILLS" <<'PYLINK'
import sys
sys.path.insert(0, sys.argv[1] + "/foundation")
from managed_io import ManagedOutputs
io = ManagedOutputs(sys.argv[2])
try:
    io.skills(sys.argv[3].splitlines())
finally:
    io.close()
print("✅ selected method links installed; unrelated user entries preserved")
PYLINK
}

unlink_skills() {
  python3 -B - "$ROOT" "$TARGET_ROOT" <<'PYUNLINK'
import sys
sys.path.insert(0, sys.argv[1] + "/foundation")
from managed_io import ManagedOutputs
io = ManagedOutputs(sys.argv[2])
try:
    io.skills(uninstall=True)
finally:
    io.close()
print("✅ adapter-owned method links removed; user entries preserved")
PYUNLINK
}

# Shared no-follow preflight also covers uninstall, before any settings/link mutation.
command -v python3 >/dev/null 2>&1 || { echo "❌ python3 required by claude-code adapter" >&2; exit 1; }
python3 -B - "$ROOT" "$TARGET_ROOT" <<'PYPREFLIGHT'
import sys
sys.path.insert(0, sys.argv[1] + "/foundation")
from managed_io import ManagedOutputs
io = ManagedOutputs(sys.argv[2])
try:
    io.validate()
finally:
    io.close()
PYPREFLIGHT

if [ "$UNINSTALL" = true ]; then
  command -v python3 >/dev/null 2>&1 || { echo "❌ python3 required by claude-code adapter" >&2; exit 1; }
  python3 -B - "$ROOT" "$TARGET_ROOT" "$SETTINGS" <<'PYUNINSTALL'
import json, os, re, sys

sys.path.insert(0, sys.argv[1] + "/foundation")
from managed_io import ManagedOutputs, SETTINGS
io = ManagedOutputs(sys.argv[2])
files = io.validate()
settings_path = sys.argv[3]
MANAGED_SCRIPT_RE = re.compile(r"hooks/(pre-tool-gate|session-context|stop-reminder)\.sh")
PLUGIN_SOURCE_RE = re.compile(r"CLAUDE_PLUGIN_ROOT|\.claude/plugins/")

# 来源分类（§7.2）：插件条目（命令引用插件基础设施）与用户条目一样不可移除；
# 只有本项目受管脚本条目参与卸载。
def hook_source(hook):
    text = str(hook.get("command", ""))
    if PLUGIN_SOURCE_RE.search(text):
        return "plugin"
    if MANAGED_SCRIPT_RE.search(text):
        return "managed"
    return "user"

if files[SETTINGS] is not None:
    try:
        settings = json.loads(files[SETTINGS])
    except Exception as err:
        print(f"❌ uninstall: settings.json unreadable, refusing to edit ({err})", file=sys.stderr)
        raise SystemExit(1)
    hooks = settings.get("hooks", {})
    removed = 0
    for group in list(hooks.keys()):
        entries = hooks.get(group) or []
        kept = []
        for entry in entries:
            entry_hooks = entry.get("hooks", []) if isinstance(entry, dict) else []
            sources = {hook_source(h) for h in entry_hooks}
            if "plugin" in sources:
                kept.append(entry)
            elif "managed" in sources:
                removed += 1
            else:
                kept.append(entry)
        if kept:
            hooks[group] = kept
        else:
            del hooks[group]
    if not hooks:
        settings.pop("hooks", None)
    io.write_many({SETTINGS: json.dumps(settings, ensure_ascii=False, indent=2).encode("utf-8")}, expected=files)
    print("✅ uninstall：受管 hook 条目已移除 %d 个，用户与插件条目保留（插件条目由插件入口管理）" % removed)
else:
    print("✅ uninstall：无 settings.json，无需清理")
io.remove_compiled()
io.close()
PYUNINSTALL
  unlink_skills
  exit 0
fi

command -v python3 >/dev/null 2>&1 || { echo "❌ python3 required by claude-code adapter" >&2; exit 1; }
[ -f "$HOOKS_YAML" ] || { echo "❌ hooks.yaml not found at $HOOKS_YAML" >&2; exit 1; }

# 选择只读MF登记的方法；source_path只是显示，不参与加载。
SELECTED_SKILLS="$(python3 -B - "$TARGET_ROOT" "$ROOT" <<'PYSELECT'
import json, pathlib, re, sys
sys.path.insert(0, sys.argv[2] + "/foundation")
from managed_io import ManagedOutputs
io = ManagedOutputs(sys.argv[1])
root=pathlib.Path(sys.argv[1]);skills=root/".agents/skills"
manifest=root/"openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json"
if skills.is_symlink():raise SystemExit("symlink method source root refused")
if manifest.is_file():
    data=json.loads(manifest.read_text());selected=data.get("snapshots")
else:selected=None
names=[x["name"] for x in selected] if selected is not None else ([p.name for p in skills.iterdir() if p.is_dir()] if skills.is_dir() else [])
if len(names)!=len(set(names)) or any(not re.fullmatch(r"[a-z0-9][a-z0-9-]*",n) for n in names):raise SystemExit("invalid selected methods")
io.check_skill_sources(names)
io.close()
for name in sorted(names):
    source=skills/name
    if source.is_symlink() or not (source/"SKILL.md").is_file():raise SystemExit("invalid selected source: "+name)
    target=root/".claude/skills"/name
    if target.exists() or target.is_symlink():
        if not target.is_symlink() or str(target.readlink())!="../../.agents/skills/"+name:raise SystemExit("unowned selected method preserved: "+name)
    print(name)
PYSELECT
)" || exit 1

# 只读退役预检：先于任何产物写入（settings.json / .compiled.env / 软链）执行，
# 拒绝 = 零改动退出（评审 R2：readonly preflight before refusal mutations）。
if ! audit_retired_workflow_entries; then
  exit 1
fi

python3 -B - "$HOOKS_YAML" "$COMPILED" "$SETTINGS" "$ROOT" "$TARGET_ROOT" <<'PYEOF'
import json, re, sys, os

yaml_path, compiled_path, settings_path, root, target_root = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
sys.path.insert(0, root + "/foundation")
from managed_io import ManagedOutputs, SETTINGS, COMPILED, HEADER
io = ManagedOutputs(target_root)
files = io.validate()
raw = open(yaml_path, encoding="utf-8").read()

# ---- 最小 YAML 解析（仅支持本文件的固定结构：两层列表 + 标量字段）----
policies, cur = [], None
for line in raw.splitlines():
    if line.lstrip().startswith("#") or not line.strip():
        continue
    m = re.match(r"^  - id: (.+)$", line)
    if m:
        cur = {"id": m.group(1).strip()}
        policies.append(cur)
        continue
    if cur is None:
        continue
    m = re.match(r"^    hook: (.+)$", line)
    if m: cur["hook"] = m.group(1).strip(); continue
    m = re.match(r"^    matcher: (.+)$", line)
    if m: cur["matcher"] = m.group(1).strip(); continue
    m = re.match(r"^    action: (.+)$", line)
    if m: cur["action"] = m.group(1).strip(); continue
    m = re.match(r"^    script: (.+)$", line)
    if m: cur["script"] = m.group(1).strip(); continue
    m = re.match(r"^    message: (.+)$", line)
    if m: cur["message"] = m.group(1).strip().strip('"'); continue
    m = re.match(r"^    (target|patterns):", line)
    if m:
        cur["_list_key"] = m.group(1); continue
    m = re.match(r"^      - \"?(.+?)\"?$", line)
    if m:
        list_key = cur.setdefault("_list_key", "target")
        prior = cur.get("_first_list_key")
        if prior is None:
            cur["_first_list_key"] = list_key
        elif prior != list_key:
            raise SystemExit(f"❌ policy {cur.get('id')}: multiple list keys ({prior} + {list_key}) not supported by this parser — refusing to silently miscompile")
        cur.setdefault("items", []).append(m.group(1)); continue

def field(p, key, default=""):
    return p.get(key, default)

# ---- 注册分工与固定事件集门（§7.2/§7.3，V_P1_2_PLUGIN_REGISTRATION_DIVISION）----
# 在任何产物写入之前判定：违规策略既不进 settings.json 也不进 hooks/.compiled.env。
PLUGIN_SOURCE_RE = re.compile(r"CLAUDE_PLUGIN_ROOT|\.claude/plugins/")
FIXED_EVENT_SET = ("PreToolUse", "SessionStart", "Stop")
unknown_events = [f"{field(p, 'id')} (hook: {field(p, 'hook')})" for p in policies
                  if field(p, "hook") and field(p, "hook") not in FIXED_EVENT_SET]
plugin_scripts = [f"{field(p, 'id')} (script: {field(p, 'script')})" for p in policies
                  if field(p, "script") and PLUGIN_SOURCE_RE.search(field(p, "script"))]
if unknown_events:
    raise SystemExit(
        "❌ hooks.yaml 使用了 adapter 固定事件集之外的事件: " + ", ".join(unknown_events)
        + "。本 adapter 只生成 PreToolUse/SessionStart(startup|resume)/Stop；新增事件必须"
          "修改受管生成逻辑并验证 settings matcher，YAML 追加不生效（§7.3）")
if plugin_scripts:
    raise SystemExit(
        "❌ hooks.yaml 携带插件来源的生命周期脚本（§7.2 注册分工）: " + ", ".join(plugin_scripts)
        + "。插件生命周期 Hook 由插件入口注册，项目受管块不得复制——请从 hooks.yaml 移除该条目")

# ---- 1. 编译 deny 策略 ----
kb_paths = [i.rstrip("/") + "/" for p in policies
            if field(p, "id") == "kb-write-protection" for i in p.get("items", [])]
deny_patterns = [i for p in policies
                 if field(p, "id") == "dangerous-command-blocklist" for i in p.get("items", [])]
deny_msg = next((field(p, "message") for p in policies
                 if field(p, "id") == "dangerous-command-blocklist"), "")
kb_msg = next((field(p, "message") for p in policies
               if field(p, "id") == "kb-write-protection"), "")

# ---- 2. 合并 .claude/settings.json hooks 段 ----
settings = {}
if files[SETTINGS] is not None:
    try:
        settings = json.loads(files[SETTINGS])
    except Exception as err:
        raise SystemExit(f"❌ settings.json unreadable; no changes: {err}")
if not isinstance(settings, dict) or not isinstance(settings.get("hooks", {}), dict):
    raise SystemExit("❌ invalid settings object; no changes")

MANAGED_SCRIPT_RE = re.compile(r"hooks/(pre-tool-gate|session-context|stop-reminder)\.sh")

def entry_hooks(entry):
    return [h for h in (entry.get("hooks") or []) if isinstance(h, dict)]

# 来源分类（§7.2）：插件标记优先——即使插件条目引用了与本项目同名的受管脚本，
# 只要命令指向插件基础设施就归插件入口管理，绝不参与项目受管块的移交与去重。
def hook_source(hook):
    text = str(hook.get("command", ""))
    if PLUGIN_SOURCE_RE.search(text):
        return "plugin"
    if MANAGED_SCRIPT_RE.search(text):
        return "managed"
    return "user"

def is_ours(entry):
    return any(hook_source(h) == "managed" for h in entry_hooks(entry))

def is_plugin(entry):
    return any(hook_source(h) == "plugin" for h in entry_hooks(entry))

def normalize_command(text):
    command = str(text).strip()
    # Older project registrations directly executed the same script. Preserve
    # duplicate detection across the explicit Bash caller fix, without treating
    # unrelated user/plugin shell commands as equivalent.
    project_commands = {'"$CLAUDE_PROJECT_DIR"/hooks/' + script for script in
                        ("pre-tool-gate.sh", "session-context.sh", "stop-reminder.sh")}
    if command.startswith("bash ") and command[5:].lstrip() in project_commands:
        command = command[5:].lstrip()
    return command.strip(" \t" + chr(34) + chr(39))

pre = os.path.relpath(os.path.join(root, "hooks/pre-tool-gate.sh"), root)
session = os.path.relpath(os.path.join(root, "hooks/session-context.sh"), root)
stop = os.path.relpath(os.path.join(root, "hooks/stop-reminder.sh"), root)

# matcher = 所有 PreToolUse deny 策略 matcher 的并集（顺序保留）。
# 只取第一个会让后续策略（如 dangerous-command-blocklist 的 Bash）成为死代码。
deny_matchers = []
for p in policies:
    if field(p, "hook") == "PreToolUse" and field(p, "action") == "deny":
        m = field(p, "matcher")
        if not m:
            raise SystemExit(f"❌ deny policy {field(p,'id')} has no matcher — refusing to compile")
        for part in m.split("|"):
            if part and part not in deny_matchers:
                deny_matchers.append(part)
if not deny_matchers:
    raise SystemExit("❌ no PreToolUse deny policies found in hooks.yaml")
pre_matcher = "|".join(deny_matchers)

def upsert_hook_array(group, ours):
    """受管块移交：只移除本项目受管脚本条目（来源分类 = managed，含旧格式），再追加当前格式。
    插件条目（plugin）与用户自有条目（user）永不触碰——插件 Hook 由插件入口管理，
    项目正确性不依赖对它们的改写。这样升级不会留下第二个 Guard。"""
    arr = settings.get("hooks", {}).get(group, [])
    arr = [e for e in arr if not is_ours(e)]
    arr.append(ours)
    settings.setdefault("hooks", {})[group] = arr

MANAGED_ENTRIES = {
    "PreToolUse": {"matcher": pre_matcher, "hooks": [{"type": "command", "command": 'bash "$CLAUDE_PROJECT_DIR"/' + pre}]},
    "SessionStart": {"matcher": "startup|resume", "hooks": [{"type": "command", "command": 'bash "$CLAUDE_PROJECT_DIR"/' + session}]},
    "Stop": {"hooks": [{"type": "command", "command": 'bash "$CLAUDE_PROJECT_DIR"/' + stop}]},
}
for group, ours in MANAGED_ENTRIES.items():
    upsert_hook_array(group, ours)

# ---- 相同事件/命令重复注册检查（§7.2：接入时检查，拒绝并列出冲突）----
# 组合视图写入前扫描受管事件组：插件条目按来源标记、不参与本项目去重；
# 用户条目或用户条目与本项目受管条目之间出现相同 event+command 即为重复注册。
conflicts = []
for group, ours in MANAGED_ENTRIES.items():
    ours_commands = {normalize_command(h.get("command", "")) for h in entry_hooks(ours)}
    seen = {}
    for entry in settings.get("hooks", {}).get(group, []):
        if is_ours(entry):
            continue
        for hook in entry_hooks(entry):
            source = hook_source(hook)
            command = normalize_command(hook.get("command", ""))
            if source == "plugin":
                # 插件条目不参与项目受管块的去重/移交；但若它注册了与项目受管块
                # 相同的事件+命令（例如插件包装器内嵌本项目脚本），属于双重注册，
                # 显式拒绝并列出冲突——处置权在插件入口，本 adapter 绝不改写它。
                if any(ours in command for ours in ours_commands):
                    conflicts.append((group, entry.get("matcher", ""), str(hook.get("command", "")), "plugin entry duplicates the project managed command (resolve at the plugin entry)"))
                continue
            if command in ours_commands:
                conflicts.append((group, entry.get("matcher", ""), str(hook.get("command", "")), "user entry duplicates the project managed command"))
            elif command in seen:
                conflicts.append((group, entry.get("matcher", ""), str(hook.get("command", "")), "user entry duplicates another user registration"))
            seen[command] = True
if conflicts:
    listing = "\n".join(f"  - [{group}] matcher={matcher!r} command={command!r} — {reason}" for group, matcher, command, reason in conflicts)
    raise SystemExit("❌ 相同事件/命令的重复注册，拒绝写入组合视图（§7.2）:\n" + listing
                     + "\n  请先移除重复条目（或确认其为插件入口管理的注册，移入插件配置）")

plugin_marked = sum(1 for entries in settings.get("hooks", {}).values() for entry in (entries or []) if is_plugin(entry))

# 编译期断言：每个 deny 策略的 matcher 部件必须出现在产物 matcher 中
emitted = set(pre_matcher.split("|"))
for p in policies:
    if field(p, "hook") == "PreToolUse" and field(p, "action") == "deny":
        missing = [part for part in field(p, "matcher").split("|") if part and part not in emitted]
        if missing:
            raise SystemExit(f"❌ policy {field(p,'id')} matchers {missing} missing from compiled settings — aborting")

# Values are shell-quoted data; existing unowned policy files are never overwritten.
def q(s):
    return "'" + s.replace("'", "'\\''") + "'"
compiled = HEADER + "\n" + "\n".join([
    "KB_PROTECT_PATHS=" + q(":".join(kb_paths)),
    "DENY_PATTERNS=" + q("|".join(deny_patterns)),
    "DENY_MESSAGE=" + q(deny_msg),
    "DENY_KB_MESSAGE=" + q(kb_msg),
]) + "\n"
io.write_many({COMPILED: compiled.encode("utf-8"), SETTINGS: json.dumps(settings, ensure_ascii=False, indent=2).encode("utf-8")}, expected=files)
io.close()
print("✅ hooks 策略已编译：%s + %s (%d deny 策略)%s" % (
    os.path.relpath(compiled_path, target_root),
    os.path.relpath(settings_path, target_root),
    len(kb_paths + deny_patterns),
    "" if target_root == root else "  [SDD_TARGET_ROOT 隔离模式]",
))
if plugin_marked:
    print("ℹ️  插件 Hook 条目 %d 个：按来源标记为插件注册，保留原样，不参与项目受管块移交/去重（§7.2）" % plugin_marked)
PYEOF

link_skills
