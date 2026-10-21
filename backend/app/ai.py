"""Streaming access to Claude. Yields SSE lines the React app parses."""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator

import anthropic

MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
_client: anthropic.AsyncAnthropic | None = anthropic.AsyncAnthropic() if os.environ.get("ANTHROPIC_API_KEY") else None


def enabled() -> bool:
    return _client is not None


def sse(obj: dict) -> str:
    return "data: " + json.dumps(obj, ensure_ascii=False) + "\n\n"


async def stream_text(messages: list[dict]) -> AsyncIterator[tuple[str, str]]:
    """Yields ("text", delta) chunks, then one ("done", full_text) or ("error", code)."""
    if _client is None:
        yield ("error", "sampling_disabled")
        return
    full: list[str] = []
    try:
        async with _client.messages.stream(
            model=MODEL,
            max_tokens=4096,
            output_config={"effort": "low"},
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                full.append(text)
                yield ("text", text)
            final = await stream.get_final_message()
        if final.stop_reason == "refusal":
            yield ("error", "refusal")
            return
        yield ("done", "".join(full))
    except anthropic.RateLimitError:
        yield ("error", "rate_limited")
    except anthropic.AuthenticationError:
        yield ("error", "not_granted")
    except anthropic.APIError:
        yield ("error", "api_error")
