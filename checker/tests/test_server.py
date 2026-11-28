"""Offline contract tests for checker/src/server.py (GET /health, POST /check)."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from typing import Any

from src.llm_client import LlmRawResponse
from src.server import CheckerHttpServer, create_server


class _FakeHttpTransport:
    def __init__(self) -> None:
        self.last_prompt: str = ""

    def generate(self, prompt: str, model: str, timeout_seconds: float) -> LlmRawResponse:
        self.last_prompt = prompt
        return LlmRawResponse(
            text=json.dumps(
                {
                    "results": [
                        {
                            "constraint": "C2",
                            "verdict": "pass",
                            "evidence": [],
                            "reason": "Recursive merge sort implemented.",
                        }
                    ]
                }
            ),
            request_id="req_http_server_001",
            model=model,
            input_tokens=88,
            output_tokens=24,
            latency_ms=42,
        )


def _start_ephemeral_server(
    *,
    transport: Any = None,
    model_off: bool | None = None,
) -> tuple[CheckerHttpServer, threading.Thread, str]:
    server = create_server("127.0.0.1", 0, transport=transport, model_off=model_off)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, f"http://127.0.0.1:{port}"


def _http_json(
    url: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
) -> tuple[int, dict[str, Any]]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read().decode("utf-8"))


def test_health_endpoint_reports_ok_and_model_off_state() -> None:
    server, thread, base_url = _start_ephemeral_server(model_off=True)
    try:
        status, body = _http_json(f"{base_url}/health")
        assert status == 200
        assert body == {"status": "ok", "service": "checker", "modelOff": True}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_post_check_runs_hard_rules_and_llm_and_redacts_student_identifiers() -> None:
    transport = _FakeHttpTransport()
    server, thread, base_url = _start_ephemeral_server(transport=transport, model_off=False)
    try:
        status, body = _http_json(
            f"{base_url}/check",
            method="POST",
            payload={
                "submissionId": "sub_http_1",
                "statement": "# Merge Sort\nImplement merge sort.",
                "sourceCode": (
                    "// Author: Nguyen Van A (std_23120244)\n"
                    "#include <algorithm>\n"
                    "int main() { int a[2]{2,1}; std::sort(a, a+2); }\n"
                ),
                "constraints": [
                    {"id": "C1", "text": "Do not call `std::sort`."},
                    {"id": "C2", "text": "Implement merge sort yourself."},
                ],
                "studentIdentifiers": ["std_23120244", "Nguyen Van A"],
                "costCapExceeded": False,
            },
        )
        assert status == 200
        assert body["submissionId"] == "sub_http_1"
        assert body["promptVersion"] == "v1"
        assert len(body["results"]) == 2
        assert body["results"][0]["constraint"] == "C1"
        assert body["results"][0]["source"] == "HARD_RULE"
        assert body["results"][0]["verdict"] == "violation"
        assert body["results"][0]["evidence"] == [
            {"line": 3, "text": "int main() { int a[2]{2,1}; std::sort(a, a+2); }"}
        ]
        assert body["results"][1]["constraint"] == "C2"
        assert body["results"][1]["source"] == "LLM"
        assert body["results"][1]["verdict"] == "pass"
        assert len(body["callLogs"]) == 1
        assert body["callLogs"][0]["requestId"] == "req_http_server_001"
        assert "std_23120244" not in transport.last_prompt
        assert "Nguyen Van A" not in transport.last_prompt
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_post_check_respects_model_off_and_cost_cap_exceeded() -> None:
    server, thread, base_url = _start_ephemeral_server(model_off=False)
    try:
        status, body = _http_json(
            f"{base_url}/check",
            method="POST",
            payload={
                "submissionId": "sub_cap_1",
                "statement": "# Sort",
                "sourceCode": "int main() { return 0; }\n",
                "constraints": [{"id": "C2", "text": "Implement merge sort yourself."}],
                "costCapExceeded": True,
            },
        )
        assert status == 200
        assert body["callLogs"] == []
        assert body["results"][0]["verdict"] == "unsure"
        assert body["results"][0]["unsureReason"] == "COST_CAP_EXCEEDED"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_post_check_rejects_invalid_payload_with_400() -> None:
    server, thread, base_url = _start_ephemeral_server(model_off=True)
    try:
        status, body = _http_json(
            f"{base_url}/check",
            method="POST",
            payload={"submissionId": "", "sourceCode": "", "constraints": "invalid"},
        )
        assert status == 400
        assert "error" in body
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_unknown_routes_return_404() -> None:
    server, thread, base_url = _start_ephemeral_server(model_off=True)
    try:
        get_status, get_body = _http_json(f"{base_url}/unknown")
        assert get_status == 404
        assert "error" in get_body

        post_status, post_body = _http_json(f"{base_url}/unknown", method="POST", payload={})
        assert post_status == 404
        assert "error" in post_body
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
