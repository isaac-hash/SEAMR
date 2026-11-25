"""Optional AI weekly summary via the Anthropic Messages API.

Disabled unless LIFEOS_ANTHROPIC_API_KEY is set. The rule-based observations in the
analytics engine always work without it.
"""
from __future__ import annotations

import json
import logging

import httpx

from app.core.config import Settings

log = logging.getLogger(__name__)

SYSTEM = (
    "You are the LIFEOS performance coach. You receive a JSON weekly report of a person's tracked "
    "self-development activities. Write a concise weekly review (max 180 words) in plain English: "
    "1) one-line verdict, 2) what improved, 3) what declined and whether that looks healthy (rest/recovery) "
    "or a problem, 4) two concrete, specific adjustments for next week. Use the numbers. No fluff, no emojis."
)


async def ai_weekly_summary(report: dict, settings: Settings) -> str:
    slim = {k: report[k] for k in (
        "label", "hours_invested", "hours_change_pct", "targets_achieved_pct", "performance_change_pct",
        "time_allocation", "category_scores", "category_change_pct", "observations", "verdict",
    ) if k in report}
    slim["activities"] = [
        {k: a[k] for k in ("name", "category", "current", "previous", "change_pct", "target", "rate_label", "met")}
        for a in report.get("activities", [])
    ]
    payload = {
        "model": settings.anthropic_model,
        "max_tokens": 600,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": json.dumps(slim, default=str)}],
    }
    headers = {
        "x-api-key": settings.anthropic_api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()
        return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()
    except httpx.HTTPError as exc:  # pragma: no cover - network
        log.warning("AI summary failed: %s", exc)
        return f"AI summary unavailable ({exc.__class__.__name__}). Rule-based observations are shown instead."
