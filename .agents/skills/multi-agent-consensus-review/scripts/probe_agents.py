#!/usr/bin/env python3
"""Probe review Agent executables without starting them."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
from pathlib import Path
from typing import Dict, List, Sequence


DEFAULTS = {
    "claude-code": os.environ.get("CAR_CLAUDE_COMMAND", "claude"),
    "zcode": os.environ.get("CAR_ZCODE_COMMAND", "zcode"),
    "codex-agent": os.environ.get("CAR_CODEX_COMMAND", "codex"),
}
REQUIRED_PARTICIPANTS = {"claude-code", "zcode", "codex-agent"}


def resolve_command(command: str) -> str | None:
    parts = shlex.split(command)
    if not parts:
        return None
    executable = parts[0]
    if "/" in executable:
        path = Path(executable).expanduser()
        return str(path) if path.is_file() and os.access(path, os.X_OK) else None
    return shutil.which(executable)


def parse_overrides(values: List[str]) -> Dict[str, str]:
    overrides: Dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise SystemExit(f"--command must use agent-id=command: {value}")
        agent, command = value.split("=", 1)
        if agent not in DEFAULTS:
            raise SystemExit(f"unknown Agent ID: {agent}")
        overrides[agent] = command
    return overrides


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check required review Agent CLIs")
    parser.add_argument("--participants", default=",".join(DEFAULTS))
    parser.add_argument("--command", action="append", default=[], help="override: agent-id=command")
    args = parser.parse_args(argv)
    overrides = parse_overrides(args.command)
    participants = [item.strip() for item in args.participants.split(",") if item.strip()]
    quorum_error = None
    if set(participants) != REQUIRED_PARTICIPANTS or len(participants) != len(REQUIRED_PARTICIPANTS):
        quorum_error = "participants must be exactly claude-code,zcode,codex-agent"
    results = []
    for agent in participants:
        command = overrides.get(agent, DEFAULTS.get(agent, agent))
        resolved = resolve_command(command)
        results.append({
            "agent": agent,
            "command": command,
            "resolved": resolved,
            "available": resolved is not None,
        })
    payload = {
        "required": participants,
        "agents": results,
        "quorum_error": quorum_error,
        "all_required_available": quorum_error is None and all(item["available"] for item in results),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["all_required_available"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
