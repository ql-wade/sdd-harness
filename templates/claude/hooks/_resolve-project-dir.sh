#!/bin/bash
# _resolve-project-dir.sh — Platform-agnostic project directory resolver
#
# Source this at the top of any SDD hook:
#   source "$(dirname "$0")/_resolve-project-dir.sh"
#
# Resolves SDD_PROJECT_DIR from platform-specific env vars with fallbacks:
#   1. CLAUDE_PROJECT_DIR  (Claude Code)
#   2. CODEX_PROJECT_DIR   (Codex)
#   3. OPENCODE_PROJECT_DIR / OPENCODE_ROOT (OpenCode)
#   4. GIT_PREFIX          (git hooks)
#   5. PWD                  (last resort)

resolve_sdd_project_dir() {
  local dir="${CLAUDE_PROJECT_DIR:-${CODEX_PROJECT_DIR:-${OPENCODE_PROJECT_DIR:-${OPENCODE_ROOT:-${GIT_PREFIX:-}}}}}"
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then
    # Walk up from PWD to find .sdd/ directory
    local current="$PWD"
    while [ "$current" != "/" ]; do
      if [ -d "${current}/.sdd" ]; then
        echo "$current"
        return 0
      fi
      current="$(dirname "$current")"
    done
    # Last resort: PWD
    echo "$PWD"
  else
    echo "$dir"
  fi
}

export SDD_PROJECT_DIR="$(resolve_sdd_project_dir)"

resolve_sdd_wiki_home() {
  if [ -n "${SDD_WIKI_HOME:-}" ]; then
    echo "$SDD_WIKI_HOME"
    return 0
  fi
  local sdd_home="${SDD_HOME:-$HOME/.sdd}"
  local common main_repo slug
  common=$(git -C "$SDD_PROJECT_DIR" rev-parse --git-common-dir 2>/dev/null || true)
  if [ -n "$common" ]; then
    main_repo=$(cd "$SDD_PROJECT_DIR/$common/.." 2>/dev/null && pwd)
  fi
  slug=$(basename "${main_repo:-$SDD_PROJECT_DIR}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')
  echo "$sdd_home/wiki/${slug:-default}"
}

export SDD_WIKI_HOME_RESOLVED="$(resolve_sdd_wiki_home)"
