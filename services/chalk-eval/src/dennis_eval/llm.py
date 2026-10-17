"""Minimal structured-output client for the Anthropic Messages API (standard library only).

Uses a forced tool call so the model must return an object matching the JSON schema. The caller
still validates every field; model output is data, never a decision.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Protocol

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-sonnet-5-5"


class LlmError(Exception):
    """Raised when the model is unreachable or returns no usable object."""


class Llm(Protocol):
    def generate(self, *, system: str, user: str, tool_name: str, schema: dict[str, Any]) -> dict[str, Any]: ...


@dataclass
class AnthropicHttpLlm:
    api_key: str
    model: str = DEFAULT_MODEL
    timeout_s: float = 20.0
    max_tokens: int = 800
    retries: int = 1

    @staticmethod
    def from_env() -> "AnthropicHttpLlm":
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            raise LlmError("ANTHROPIC_API_KEY is not set")
        return AnthropicHttpLlm(api_key=key, model=os.environ.get("LLM_MODEL") or DEFAULT_MODEL)

    def generate(self, *, system: str, user: str, tool_name: str, schema: dict[str, Any]) -> dict[str, Any]:
        body = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": 0,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "tools": [{"name": tool_name, "description": "Return the structured result.", "input_schema": schema}],
            "tool_choice": {"type": "tool", "name": tool_name},
        }
        data = json.dumps(body).encode("utf-8")
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            req = urllib.request.Request(
                ANTHROPIC_URL,
                data=data,
                method="POST",
                headers={
                    "content-type": "application/json",
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                for block in payload.get("content", []):
                    if block.get("type") == "tool_use" and isinstance(block.get("input"), dict):
                        return block["input"]
                raise LlmError("model returned no tool_use block")
            except urllib.error.HTTPError as exc:
                last = exc
                if exc.code < 500 and exc.code != 429:
                    raise LlmError(f"anthropic http {exc.code}") from exc
            except (urllib.error.URLError, TimeoutError) as exc:
                last = exc
            if attempt < self.retries:
                time.sleep(1.0 + attempt)
        raise LlmError(f"anthropic unavailable: {type(last).__name__}")


@dataclass
class StubLlm:
    """Deterministic stand-in for tests: maps the user text to a canned object."""

    responder: Callable[[str, str], dict[str, Any]]

    def generate(self, *, system: str, user: str, tool_name: str, schema: dict[str, Any]) -> dict[str, Any]:
        return self.responder(tool_name, user)
