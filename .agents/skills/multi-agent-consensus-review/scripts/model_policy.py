#!/usr/bin/env python3
"""Resolve and verify the high-tier model policy for each review Agent.

The provider CLIs do not expose one stable, cross-provider "highest model"
API.  This module therefore discovers each reviewer's flagship model
automatically from the provider's own local catalog: a candidate must
advertise maximum reasoning, light variants (flash/mini/...) are excluded,
and the highest version number wins.  When the top version is shared by
distinct codenames the catalog alone cannot rank them, so the resolver fails
closed and asks for an explicit ``CAR_*_MODEL`` pin.  A pin is accepted only
when the named model itself passes the same flagship checks, so a reviewer
can never be silently downgraded.  Claude has no rankable catalog; the
Opus-tier mapping in the user's settings is the configured flagship and the
policy follows it.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple


CLAUDE_HIGH_TIER_EFFORT = "max"
CODEX_HIGH_TIER_EFFORT = "max"
# Claude: follow the configured Opus-tier (flagship) mapping in settings.
CLAUDE_FLAGSHIP_SETTINGS = (
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
)
# Tokens marking a lighter sibling of a flagship family, not a flagship.
LIGHT_MODEL_TOKENS = (
    "flash", "mini", "nano", "lite", "air", "haiku", "instant", "fast", "small",
)


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


def _pinned_model(variable: str) -> Optional[str]:
    return os.environ.get(variable, "").strip() or None


def _required_effort(variable: str, expected: str) -> str:
    requested = os.environ.get(variable, expected).strip()
    if requested and not _same_model(requested, expected):
        raise ModelPolicyError(
            f"consensus agent setting {variable} is pinned to {expected!r}; "
            f"refusing a lower-effort override {requested!r}"
        )
    return expected


def _version_key(model_id: str) -> Tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", model_id.split("[", 1)[0]))


def _is_light_model(model_id: str) -> bool:
    tokens = {token.casefold() for token in re.split(r"[^A-Za-z0-9]+", model_id) if token}
    return any(token in tokens for token in LIGHT_MODEL_TOKENS)


def _pick_flagship(
    catalog_label: str,
    candidates: Sequence[str],
    catalog_path: Path,
    pin: Optional[str],
) -> Tuple[str, List[str]]:
    """Apply the auto-flagship policy and return (chosen, ranked candidates)."""
    ordered = sorted(set(candidates))
    if pin is not None:
        if pin not in ordered:
            raise ModelPolicyError(
                f"pinned {catalog_label} model {pin!r} is not an available "
                f"max-reasoning model in {catalog_path}; refusing a downgrade"
            )
        if _is_light_model(pin):
            raise ModelPolicyError(
                f"pinned {catalog_label} model {pin!r} is a light variant; "
                "consensus reviewers must stay flagship-tier"
            )
        return pin, ordered
    flagship = [model_id for model_id in ordered if not _is_light_model(model_id)]
    if not flagship:
        raise ModelPolicyError(
            f"{catalog_label} catalog exposes no non-light max-reasoning model: {catalog_path}"
        )
    top = max(_version_key(model_id) for model_id in flagship)
    winners = [model_id for model_id in flagship if _version_key(model_id) == top]
    if len(winners) > 1:
        raise ModelPolicyError(
            f"{catalog_label} catalog ties {sorted(winners)} at version "
            f"{'.'.join(str(part) for part in top)}; the catalog cannot rank "
            f"them, pin one via the CAR_*_MODEL environment variable ({catalog_path})"
        )
    return winners[0], ordered


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
    pin = _pinned_model("CAR_ZCODE_MODEL")
    pin_id = pin.split("/", 1)[1].strip() if pin and "/" in pin else pin
    catalog_path = _catalog_path(
        "CAR_ZCODE_MODEL_CATALOG",
        Path.home() / ".zcode" / "v2" / "config.json",
    )
    catalog = _read_json(catalog_path)
    source = _source(catalog_path)
    providers_by_model: Dict[str, Set[str]] = {}
    for provider_id, model_id, metadata in _iter_zcode_candidates(catalog):
        reasoning = metadata.get("reasoning")
        if not isinstance(reasoning, dict) or reasoning.get("enabled") is not True:
            continue
        variants = reasoning.get("variants", [])
        if not isinstance(variants, list) or "max" not in {str(item).casefold() for item in variants}:
            continue
        providers_by_model.setdefault(model_id, set()).add(provider_id)
    chosen, candidates = _pick_flagship("ZCode", sorted(providers_by_model), catalog_path, pin_id)
    model = f"bigmodel/{chosen}"
    lite_pin = _pinned_model("CAR_ZCODE_LITE_MODEL")
    if lite_pin is not None and not _same_model(lite_pin, model):
        raise ModelPolicyError(
            f"CAR_ZCODE_LITE_MODEL must match the selected flagship {model!r}; got {lite_pin!r}"
        )
    return {
        "model": model,
        "lite_model": model,
        "effort": "max",
        "verified": True,
        "catalog": source,
        "selection_rule": "highest-version non-light model with max reasoning",
        "candidates": candidates,
        "capabilities": {
            "reasoning_enabled": True,
            "max_reasoning": True,
            "providers": sorted(providers_by_model[chosen]),
        },
    }


def _codex_selection() -> Dict[str, Any]:
    pin = _pinned_model("CAR_CODEX_MODEL")
    effort = _required_effort("CAR_CODEX_EFFORT", CODEX_HIGH_TIER_EFFORT)
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
    entries: Dict[str, Dict[str, Any]] = {}
    for item in models:
        if not isinstance(item, dict) or item.get("supported_in_api") is not True:
            continue
        supported = item.get("supported_reasoning_levels")
        supported_efforts = {
            str(level.get("effort", "")).casefold()
            for level in supported
            if isinstance(level, dict)
        } if isinstance(supported, list) else set()
        if effort.casefold() not in supported_efforts:
            continue
        slug = str(item.get("slug", "")).strip()
        if slug:
            entries[slug] = item
    chosen, candidates = _pick_flagship("Codex", sorted(entries), catalog_path, pin)
    entry = entries[chosen]
    return {
        "model": chosen,
        "effort": effort,
        "verified": True,
        "catalog": source,
        "selection_rule": "highest-version non-light model with max reasoning",
        "candidates": candidates,
        "capabilities": {
            "supported_in_api": True,
            "max_reasoning": True,
            "context_window": entry.get("context_window"),
            "max_context_window": entry.get("max_context_window"),
        },
    }


def _claude_selection() -> Dict[str, Any]:
    pin = _pinned_model("CAR_CLAUDE_MODEL")
    effort = _required_effort("CAR_CLAUDE_EFFORT", CLAUDE_HIGH_TIER_EFFORT)
    catalog_path = _catalog_path(
        "CAR_CLAUDE_MODEL_CATALOG",
        Path.home() / ".claude" / "settings.json",
    )
    catalog = _read_json(catalog_path)
    source = _source(catalog_path)
    env = catalog.get("env") if isinstance(catalog.get("env"), dict) else {}
    configured_model = catalog.get("model")
    values: List[str] = []
    if isinstance(configured_model, str):
        values.append(configured_model)
    # Membership is checked against every declared value, but only *_MODEL
    # values are recorded as candidates so secrets never reach the run file.
    values.extend(value for value in env.values() if isinstance(value, str))
    normalized_values = {
        value.split("[", 1)[0].strip().casefold()
        for value in values
    }
    model_values = [
        value.split("[", 1)[0].strip()
        for key, value in env.items()
        if "MODEL" in key and isinstance(value, str) and value.strip()
    ]
    flagship: Optional[str] = None
    for key in CLAUDE_FLAGSHIP_SETTINGS:
        candidate = env.get(key)
        if isinstance(candidate, str) and candidate.strip():
            flagship = candidate.split("[", 1)[0].strip()
            break
    if flagship is None and isinstance(configured_model, str) and configured_model.strip():
        flagship = configured_model.split("[", 1)[0].strip()
    if flagship is None:
        raise ModelPolicyError(
            "no flagship model is configured for Claude "
            f"(missing ANTHROPIC_DEFAULT_OPUS_MODEL_NAME and model): {catalog_path}"
        )
    model = pin if pin is not None else flagship
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
        "selection_rule": "Opus-tier mapping from Claude settings",
        "candidates": sorted(set(model_values) | {flagship}),
        "capabilities": {"configured_model": True, "max_effort": True},
    }


def resolve_model_selection() -> Dict[str, Dict[str, Any]]:
    """Discover and verify all high-tier models before any Agent starts."""
    return {
        "claude-code": _claude_selection(),
        "zcode": _zcode_selection(),
        "codex-agent": _codex_selection(),
    }
