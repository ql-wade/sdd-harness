#!/usr/bin/env python3
"""Resolve and verify the high-tier model policy for each review Agent.

The provider CLIs do not expose one stable, cross-provider "highest model"
API.  This module therefore uses each provider's own local model catalog or
cache as the discovery source, then applies an explicit high-tier policy and
fails closed when the selected model cannot be verified.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, Iterable, Tuple


ZCODE_HIGH_TIER_MODEL = "bigmodel/GLM-5.3"
CLAUDE_HIGH_TIER_MODEL = "glm-5.3"
CLAUDE_HIGH_TIER_EFFORT = "max"
CODEX_HIGH_TIER_MODEL = "gpt-5.6-sol"
CODEX_HIGH_TIER_EFFORT = "max"


class ModelPolicyError(ValueError):
    """Raised when high-tier model selection cannot be verified."""


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise ModelPolicyError(f"cannot read model catalog {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ModelPolicyError(f"model catalog root must be an object: {path}")
    return value


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def _catalog_path(variable: str, default: Path) -> Path:
    override = os.environ.get(variable, "").strip()
    return Path(override).expanduser() if override else default.expanduser()


def _source(path: Path) -> Dict[str, str]:
    if not path.is_file():
        raise ModelPolicyError(
            f"model catalog is unavailable: {path}; "
            "provide a refreshed provider catalog before starting consensus"
        )
    return {"path": str(path), "sha256": _sha256_file(path)}


def _same_model(left: str, right: str) -> bool:
    return left.strip().casefold() == right.strip().casefold()


def _model_setting(variable: str, expected: str) -> str:
    requested = os.environ.get(variable, expected).strip()
    if not _same_model(requested, expected):
        raise ModelPolicyError(
            f"consensus agent setting {variable} is pinned to {expected!r}; "
            f"refusing a lower-tier override {requested!r}"
        )
    return expected


def _iter_zcode_candidates(config: Dict[str, Any]) -> Iterable[Tuple[str, str, Dict[str, Any]]]:
    providers = config.get("provider")
    if not isinstance(providers, dict):
        return
    for provider_id, provider in providers.items():
        if not isinstance(provider_id, str) or not isinstance(provider, dict):
            continue
        if provider.get("enabled") is False:
            continue
        if "bigmodel" not in provider_id.casefold():
            continue
        models = provider.get("models")
        if not isinstance(models, dict):
            continue
        for model_id, metadata in models.items():
            if isinstance(model_id, str) and isinstance(metadata, dict):
                yield provider_id, model_id, metadata


def _zcode_selection() -> Dict[str, Any]:
    model = _model_setting("CAR_ZCODE_MODEL", ZCODE_HIGH_TIER_MODEL)
    lite_model = _model_setting("CAR_ZCODE_LITE_MODEL", ZCODE_HIGH_TIER_MODEL)
    catalog_path = _catalog_path(
        "CAR_ZCODE_MODEL_CATALOG",
        Path.home() / ".zcode" / "v2" / "config.json",
    )
    catalog = _read_json(catalog_path)
    source = _source(catalog_path)
    expected_id = model.split("/", 1)[1]
    matches = []
    for provider_id, model_id, metadata in _iter_zcode_candidates(catalog):
        if not _same_model(model_id, expected_id):
            continue
        reasoning = metadata.get("reasoning")
        variants = reasoning.get("variants", []) if isinstance(reasoning, dict) else []
        if not isinstance(variants, list) or "max" not in {str(item).casefold() for item in variants}:
            raise ModelPolicyError(
                f"ZCode catalog contains {model}, but it does not advertise max reasoning: "
                f"{catalog_path}"
            )
        if reasoning.get("enabled") is not True:
            raise ModelPolicyError(
                f"ZCode catalog contains {model}, but reasoning is not enabled: {catalog_path}"
            )
        matches.append(provider_id)
    if not matches:
        raise ModelPolicyError(
            f"high-tier ZCode model {model} is not available in enabled BigModel providers: "
            f"{catalog_path}"
        )
    return {
        "model": model,
        "lite_model": lite_model,
        "effort": "max",
        "verified": True,
        "catalog": source,
        "capabilities": {
            "reasoning_enabled": True,
            "max_reasoning": True,
            "providers": sorted(set(matches)),
        },
    }


def _codex_selection() -> Dict[str, Any]:
    model = _model_setting("CAR_CODEX_MODEL", CODEX_HIGH_TIER_MODEL)
    effort = _model_setting("CAR_CODEX_EFFORT", CODEX_HIGH_TIER_EFFORT)
    codex_home = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))).expanduser()
    catalog_path = _catalog_path(
        "CAR_CODEX_MODEL_CATALOG",
        codex_home / "models_cache.json",
    )
    catalog = _read_json(catalog_path)
    source = _source(catalog_path)
    models = catalog.get("models")
    if not isinstance(models, list):
        raise ModelPolicyError(f"Codex model catalog has no models list: {catalog_path}")
    entry = next(
        (
            item for item in models
            if isinstance(item, dict) and _same_model(str(item.get("slug", "")), model)
        ),
        None,
    )
    if entry is None or entry.get("supported_in_api") is not True:
        raise ModelPolicyError(
            f"high-tier Codex model {model} is not available in the API catalog: {catalog_path}"
        )
    supported = entry.get("supported_reasoning_levels")
    supported_efforts = {
        str(item.get("effort", "")).casefold()
        for item in supported
        if isinstance(item, dict)
    } if isinstance(supported, list) else set()
    if effort.casefold() not in supported_efforts:
        raise ModelPolicyError(
            f"Codex model {model} does not advertise {effort} reasoning: {catalog_path}"
        )
    return {
        "model": model,
        "effort": effort,
        "verified": True,
        "catalog": source,
        "capabilities": {
            "supported_in_api": True,
            "max_reasoning": True,
            "context_window": entry.get("context_window"),
            "max_context_window": entry.get("max_context_window"),
        },
    }


def _claude_selection() -> Dict[str, Any]:
    model = _model_setting("CAR_CLAUDE_MODEL", CLAUDE_HIGH_TIER_MODEL)
    effort = _model_setting("CAR_CLAUDE_EFFORT", CLAUDE_HIGH_TIER_EFFORT)
    catalog_path = _catalog_path(
        "CAR_CLAUDE_MODEL_CATALOG",
        Path.home() / ".claude" / "settings.json",
    )
    catalog = _read_json(catalog_path)
    source = _source(catalog_path)
    values = []
    configured_model = catalog.get("model")
    if isinstance(configured_model, str):
        values.append(configured_model)
    env = catalog.get("env")
    if isinstance(env, dict):
        values.extend(value for value in env.values() if isinstance(value, str))
    normalized_values = {
        value.split("[", 1)[0].strip().casefold()
        for value in values
    }
    if model.casefold() not in normalized_values:
        raise ModelPolicyError(
            f"high-tier Claude model {model} is not present in the configured model catalog: "
            f"{catalog_path}"
        )
    return {
        "model": model,
        "effort": effort,
        "verified": True,
        "catalog": source,
        "capabilities": {"configured_model": True, "max_effort": True},
    }


def resolve_model_selection() -> Dict[str, Dict[str, Any]]:
    """Discover and verify all high-tier models before any Agent starts."""
    return {
        "claude-code": _claude_selection(),
        "zcode": _zcode_selection(),
        "codex-agent": _codex_selection(),
    }
