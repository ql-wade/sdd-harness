#!/usr/bin/env python3
"""Tests for provider-specific high-tier model discovery and policy guards."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from dispatch_round import write_or_verify_model_selection
from model_policy import ModelPolicyError, resolve_model_selection


POLICY_ENV = (
    "CAR_CLAUDE_MODEL",
    "CAR_CLAUDE_EFFORT",
    "CAR_CODEX_MODEL",
    "CAR_CODEX_EFFORT",
    "CAR_ZCODE_MODEL",
    "CAR_ZCODE_LITE_MODEL",
    "CAR_CLAUDE_MODEL_CATALOG",
    "CAR_CODEX_MODEL_CATALOG",
    "CAR_ZCODE_MODEL_CATALOG",
)


def _max_reasoning() -> dict:
    return {"enabled": True, "variants": ["low", "high", "max"]}


class ModelPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self._saved_env = {name: os.environ.get(name) for name in POLICY_ENV}
        for name in POLICY_ENV:
            os.environ.pop(name, None)

        self.claude = self.root / "claude-settings.json"
        self._write_claude({"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "glm-5.3"})
        self.codex = self.root / "codex-models.json"
        self._write_codex([
            {"slug": "gpt-5.6-sol", "supported_in_api": True,
             "supported_reasoning_levels": [{"effort": "max"}]},
            {"slug": "gpt-5.2-sol", "supported_in_api": True,
             "supported_reasoning_levels": [{"effort": "max"}]},
            {"slug": "gpt-5.2-mini", "supported_in_api": True,
             "supported_reasoning_levels": [{"effort": "max"}]},
        ])
        self.zcode = self.root / "zcode-config.json"
        self._write_zcode({
            "GLM-5.3": _max_reasoning(),
            "GLM-5.3-Flash": _max_reasoning(),
        })
        os.environ.update({
            "CAR_CLAUDE_MODEL_CATALOG": str(self.claude),
            "CAR_CODEX_MODEL_CATALOG": str(self.codex),
            "CAR_ZCODE_MODEL_CATALOG": str(self.zcode),
        })

    def _write_claude(self, env: dict) -> None:
        self.claude.write_text(json.dumps({"env": env}), encoding="utf-8")

    def _write_codex(self, models: list) -> None:
        self.codex.write_text(json.dumps({"models": models}), encoding="utf-8")

    def _write_zcode(self, models: dict) -> None:
        wrapped = {model_id: {"reasoning": reasoning} for model_id, reasoning in models.items()}
        self.zcode.write_text(
            json.dumps({"provider": {"builtin:bigmodel-coding-plan": {
                "enabled": True, "models": wrapped,
            }}}),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        for name, value in self._saved_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        self.temp.cleanup()

    def test_resolves_verified_high_tier_models(self) -> None:
        selection = resolve_model_selection()
        self.assertEqual(selection["zcode"]["model"], "bigmodel/GLM-5.3")
        self.assertEqual(selection["claude-code"]["model"], "glm-5.3")
        self.assertEqual(selection["codex-agent"]["model"], "gpt-5.6-sol")
        self.assertTrue(all(item["verified"] for item in selection.values()))

    def test_light_models_are_excluded(self) -> None:
        selection = resolve_model_selection()
        self.assertNotIn("bigmodel/GLM-5.3-Flash", selection["zcode"]["model"])
        self.assertNotEqual(selection["codex-agent"]["model"], "gpt-5.2-mini")

    def test_prefers_highest_version(self) -> None:
        self._write_zcode({
            "GLM-5.3": _max_reasoning(),
            "GLM-5.4": _max_reasoning(),
        })
        selection = resolve_model_selection()
        self.assertEqual(selection["zcode"]["model"], "bigmodel/GLM-5.4")

    def test_codename_tie_fails_closed(self) -> None:
        self._write_codex([
            {"slug": "gpt-6-sol", "supported_in_api": True,
             "supported_reasoning_levels": [{"effort": "max"}]},
            {"slug": "gpt-6-astra", "supported_in_api": True,
             "supported_reasoning_levels": [{"effort": "max"}]},
        ])
        with self.assertRaises(ModelPolicyError):
            resolve_model_selection()

    def test_claude_follows_opus_mapping(self) -> None:
        self._write_claude({
            "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "glm-6",
            "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "glm-6-flash",
        })
        selection = resolve_model_selection()
        self.assertEqual(selection["claude-code"]["model"], "glm-6")

    def test_pin_to_verified_model_is_allowed(self) -> None:
        os.environ["CAR_CODEX_MODEL"] = "gpt-5.2-sol"
        selection = resolve_model_selection()
        self.assertEqual(selection["codex-agent"]["model"], "gpt-5.2-sol")
        self.assertTrue(selection["codex-agent"]["verified"])

    def test_pin_to_light_model_is_rejected(self) -> None:
        os.environ["CAR_ZCODE_MODEL"] = "bigmodel/GLM-5.3-Flash"
        with self.assertRaises(ModelPolicyError):
            resolve_model_selection()

    def test_zcode_requires_max_reasoning(self) -> None:
        self._write_zcode({
            "GLM-5.3": {"enabled": True, "variants": ["low"]},
            "GLM-5.3-Flash": _max_reasoning(),
        })
        with self.assertRaises(ModelPolicyError):
            resolve_model_selection()

    def test_codex_requires_max_reasoning(self) -> None:
        self._write_codex([
            {"slug": "gpt-5.6-sol", "supported_in_api": True,
             "supported_reasoning_levels": [{"effort": "high"}]},
            {"slug": "gpt-5.2-sol", "supported_in_api": True,
             "supported_reasoning_levels": [{"effort": "high"}]},
        ])
        with self.assertRaises(ModelPolicyError):
            resolve_model_selection()

    def test_lower_tier_override_is_rejected(self) -> None:
        os.environ["CAR_ZCODE_MODEL"] = "bigmodel/glm-4.7"
        with self.assertRaises(ModelPolicyError):
            resolve_model_selection()

    def test_missing_catalog_is_blocked(self) -> None:
        os.environ["CAR_CODEX_MODEL_CATALOG"] = str(self.root / "missing.json")
        with self.assertRaises(ModelPolicyError):
            resolve_model_selection()

    def test_candidates_are_recorded_for_audit(self) -> None:
        selection = resolve_model_selection()
        self.assertIn("GLM-5.3-Flash", selection["zcode"]["candidates"])
        self.assertIn("gpt-5.2-sol", selection["codex-agent"]["candidates"])

    def test_model_selection_is_frozen_across_rounds(self) -> None:
        selection = resolve_model_selection()
        run_dir = self.root / "run"
        first_digest = write_or_verify_model_selection(run_dir, selection)
        self.assertTrue(first_digest)
        changed = json.loads(json.dumps(selection))
        changed["zcode"]["model"] = "bigmodel/GLM-4.7"
        with self.assertRaises(ModelPolicyError):
            write_or_verify_model_selection(run_dir, changed)


if __name__ == "__main__":
    unittest.main()
