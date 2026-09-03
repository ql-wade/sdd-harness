#!/usr/bin/env python3
from __future__ import annotations

import re

TOKENS = {
    "PLAN_PATH": None,
    "ARCH_PATH": None,
    "DAG_PATH": None,
    "LOCK_PATH": None,
    "PLAN_SHA256": None,
    "ARCH_SHA256": None,
}
HASH_RE = re.compile(r"^[0-9a-f]{64}$")


def render_prompt(
    template: str,
    plan_path: str,
    architecture_path: str,
    dag_path: str,
    lock_path: str,
    plan_sha256: str,
    architecture_sha256: str,
) -> str:
    values = {
        "PLAN_PATH": plan_path,
        "ARCH_PATH": architecture_path,
        "DAG_PATH": dag_path,
        "LOCK_PATH": lock_path,
        "PLAN_SHA256": plan_sha256,
        "ARCH_SHA256": architecture_sha256,
    }
    for key in TOKENS:
        if "{{" + key + "}}" not in template:
            raise ValueError(f"missing token: {key}")
    for key in ("PLAN_SHA256", "ARCH_SHA256"):
        if not HASH_RE.fullmatch(values[key]):
            raise ValueError(f"{key} must be lowercase SHA-256")
    result = template
    for key, value in values.items():
        result = result.replace("{{" + key + "}}", value)
    if "{{" in result or "}}" in result:
        raise ValueError("unresolved template token")
    return result
