"""Internal HTTP server exposing POST /check and GET /health for judge-worker (Task N1).

Isolates GEMINI_API_KEY inside the checker container so neither judge-worker nor the
C++ sandbox ever sees LLM provider credentials.
"""

from __future__ import annotations

import json
import os
import signal
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from src.llm_client import DEFAULT_TIMEOUT_SECONDS, LlmTransport
from src.models import CheckerResult, ConstraintInput
from src.semantic_checker import check_submission, is_model_off

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8000
MAX_REQUEST_BYTES = 1_048_576  # 1 MiB safety cap for internal check requests


class CheckerRequestError(ValueError):
    """Raised when a POST /check payload violates the internal contract."""


def parse_check_request(payload: Any) -> dict[str, Any]:
    """Validate and normalize a JSON payload for POST /check."""
    if not isinstance(payload, dict):
        raise CheckerRequestError("Request body must be a JSON object.")

    submission_id = payload.get("submissionId")
    if not isinstance(submission_id, str) or not submission_id.strip():
        raise CheckerRequestError("Field 'submissionId' must be a non-empty string.")

    source_code = payload.get("sourceCode")
    if not isinstance(source_code, str) or not source_code.strip():
        raise CheckerRequestError("Field 'sourceCode' must be a non-empty string.")

    statement = payload.get("statement", "")
    if not isinstance(statement, str):
        raise CheckerRequestError("Field 'statement' must be a string.")

    raw_constraints = payload.get("constraints")
    if not isinstance(raw_constraints, list):
        raise CheckerRequestError("Field 'constraints' must be an array.")

    constraints: list[ConstraintInput] = []
    for idx, item in enumerate(raw_constraints):
        if not isinstance(item, dict):
            raise CheckerRequestError(f"constraints[{idx}] must be an object.")
        cid = item.get("id")
        ctext = item.get("text")
        if not isinstance(cid, str) or not cid.strip():
            raise CheckerRequestError(f"constraints[{idx}].id must be a non-empty string.")
        if not isinstance(ctext, str) or not ctext.strip():
            raise CheckerRequestError(f"constraints[{idx}].text must be a non-empty string.")
        constraints.append({"id": cid.strip(), "text": ctext.strip()})

    raw_identifiers = payload.get("studentIdentifiers", [])
    if not isinstance(raw_identifiers, list) or not all(
        isinstance(x, str) for x in raw_identifiers
    ):
        raise CheckerRequestError("Field 'studentIdentifiers' must be an array of strings.")

    cost_cap_exceeded = payload.get("costCapExceeded", False)
    if not isinstance(cost_cap_exceeded, bool):
        raise CheckerRequestError("Field 'costCapExceeded' must be a boolean.")

    timeout_raw = payload.get("timeoutSeconds", DEFAULT_TIMEOUT_SECONDS)
    if (
        isinstance(timeout_raw, bool)
        or not isinstance(timeout_raw, (int, float))
        or timeout_raw <= 0
    ):
        raise CheckerRequestError("Field 'timeoutSeconds' must be a positive number.")

    model = payload.get("model")
    if model is not None and (not isinstance(model, str) or not model.strip()):
        raise CheckerRequestError("Field 'model' must be a non-empty string when provided.")

    return {
        "submission_id": submission_id.strip(),
        "statement": statement,
        "source_code": source_code,
        "constraints": constraints,
        "student_identifiers": [x for x in raw_identifiers if x.strip()],
        "cost_cap_exceeded": cost_cap_exceeded,
        "timeout_seconds": float(timeout_raw),
        "model": model.strip() if isinstance(model, str) else None,
    }


class CheckerHttpServer(ThreadingHTTPServer):
    """ThreadingHTTPServer storing optional injected transport and model_off flag for tests."""

    allow_reuse_address = True

    def __init__(
        self,
        server_address: tuple[str, int],
        *,
        transport: LlmTransport | None = None,
        model_off: bool | None = None,
    ) -> None:
        self.transport = transport
        self.model_off = model_off
        super().__init__(server_address, CheckerRequestHandler)


class CheckerRequestHandler(BaseHTTPRequestHandler):
    """HTTP handler implementing GET /health and POST /check."""

    server: CheckerHttpServer

    def log_message(self, format: str, *args: Any) -> None:
        # Emit concise single-line structured logs without ever logging prompts or secrets.
        sys.stderr.write(f"[checker-http] {self.address_string()} - {format % args}\n")

    def _send_json(self, status: HTTPStatus, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(int(status))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            off = is_model_off() if self.server.model_off is None else self.server.model_off
            self._send_json(
                HTTPStatus.OK,
                {"status": "ok", "service": "checker", "modelOff": off},
            )
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not Found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/check":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not Found"})
            return

        content_length_raw = self.headers.get("Content-Length", "")
        try:
            content_length = int(content_length_raw)
        except ValueError:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "Missing or invalid Content-Length header."},
            )
            return

        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": f"Request body size must be between 1 and {MAX_REQUEST_BYTES} bytes."},
            )
            return

        raw_body = self.rfile.read(content_length)
        try:
            parsed_json = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": f"Invalid JSON payload: {exc}"},
            )
            return

        try:
            req = parse_check_request(parsed_json)
        except CheckerRequestError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return

        result: CheckerResult = check_submission(
            submission_id=req["submission_id"],
            statement=req["statement"],
            source_code=req["source_code"],
            constraints=req["constraints"],
            student_identifiers=req["student_identifiers"],
            transport=self.server.transport,
            model=req["model"],
            timeout_seconds=req["timeout_seconds"],
            model_off=self.server.model_off,
            cost_cap_exceeded=req["cost_cap_exceeded"],
        )
        self._send_json(HTTPStatus.OK, dict(result))


def create_server(
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    *,
    transport: LlmTransport | None = None,
    model_off: bool | None = None,
) -> CheckerHttpServer:
    """Create a configured CheckerHttpServer instance."""
    return CheckerHttpServer((host, port), transport=transport, model_off=model_off)


def main() -> int:
    """Run the internal checker HTTP server until SIGTERM/SIGINT."""
    host = os.environ.get("CHECKER_HOST", DEFAULT_HOST).strip() or DEFAULT_HOST
    port_raw = os.environ.get("CHECKER_PORT", str(DEFAULT_PORT)).strip() or str(DEFAULT_PORT)
    port = int(port_raw)
    server = create_server(host, port)

    def _handle_shutdown(_signum: int, _frame: Any) -> None:
        server.shutdown()

    signal.signal(signal.SIGTERM, _handle_shutdown)
    signal.signal(signal.SIGINT, _handle_shutdown)

    sys.stderr.write(
        f"[checker-http] Listening on http://{host}:{port} (modelOff={is_model_off()})\n"
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
