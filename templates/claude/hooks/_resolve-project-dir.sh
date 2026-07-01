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
