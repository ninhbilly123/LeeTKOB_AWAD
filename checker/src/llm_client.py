"""Gemini API HTTP client and transport abstraction for offline testing."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite-preview"
DEFAULT_TIMEOUT_SECONDS = 20.0

# Reference paid-tier USD rates per 1M tokens for cost estimation (free-tier actual spend is $0).
_ESTIMATED_RATES_PER_1M: dict[str, tuple[float, float]] = {
    "gemini-3.1-flash-lite": (0.10, 0.40),
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-2.0-flash": (0.10, 0.40),
}


@dataclass(frozen=True, slots=True)
class LlmRawResponse:
    """Raw provider response with token/request metadata."""

    text: str
    request_id: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: int


class LlmTransport(Protocol):
    """Transport protocol so unit tests can inject offline fake models."""

    def generate(self, prompt: str, model: str, timeout_seconds: float) -> LlmRawResponse: ...


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate paid-tier USD cost from token counts for reporting."""
    in_rate, out_rate = (0.10, 0.40)
    lower = model.lower()
    for prefix, rates in _ESTIMATED_RATES_PER_1M.items():
        if prefix in lower:
            in_rate, out_rate = rates
            break
    cost = (input_tokens * in_rate + output_tokens * out_rate) / 1_000_000.0
    return round(cost, 8)


class GeminiHttpTransport:
    """Calls Google Gemini REST API using GEMINI_API_KEY from environment only."""

    def __init__(self, api_key: str | None = None, base_url: str | None = None) -> None:
        self._api_key = api_key if api_key is not None else os.environ.get("GEMINI_API_KEY", "")
        self._base_url = (
            base_url
            or os.environ.get(
                "GEMINI_API_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"
            )
        ).rstrip("/")

    def generate(self, prompt: str, model: str, timeout_seconds: float) -> LlmRawResponse:
        if not self._api_key:
            raise RuntimeError("GEMINI_API_KEY is not configured in the backend environment.")

        url = f"{self._base_url}/models/{model}:generateContent"
        payload: dict[str, Any] = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.0,
                "responseMimeType": "application/json",
            },
        }
        body_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url=url,
            data=body_bytes,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": self._api_key,
            },
        )

        started = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
                raw_bytes = resp.read()
                resp_headers = {k.lower(): v for k, v in resp.headers.items()}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            raise RuntimeError(f"Gemini HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, TimeoutError):
                raise TimeoutError("Gemini request timed out") from exc
            raise RuntimeError(f"Gemini network error: {exc.reason}") from exc

        latency_ms = int((time.monotonic() - started) * 1000)
        parsed = json.loads(raw_bytes.decode("utf-8"))

        candidates = parsed.get("candidates") or []
        text = ""
        if candidates:
            parts = (candidates[0].get("content") or {}).get("parts") or []
            text = "".join(str(p.get("text", "")) for p in parts if isinstance(p, dict))

        usage = parsed.get("usageMetadata") or {}
        input_tokens = int(usage.get("promptTokenCount") or 0)
        output_tokens = int(usage.get("candidatesTokenCount") or 0)
        request_id = str(
            parsed.get("responseId")
            or resp_headers.get("x-goog-request-id")
            or resp_headers.get("request-id")
            or ""
        )
        resolved_model = str(parsed.get("modelVersion") or model)

        return LlmRawResponse(
            text=text,
            request_id=request_id,
            model=resolved_model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
        )
