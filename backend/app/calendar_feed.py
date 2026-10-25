"""Read-only Google Calendar feed via its secret iCal address.

CALENDAR_ICS_URL may be an https:// URL (Google Calendar → settings → "Secret
address in iCal format") or a local file path for development. The feed is
cached for CACHE_SECONDS so the dashboard does not hit Google on every load.
"""

from __future__ import annotations

import os
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import recurring_ical_events
from icalendar import Calendar

ICS_URL = os.environ.get("CALENDAR_ICS_URL", "")
TZ = ZoneInfo(os.environ.get("CALENDAR_TZ", "Asia/Jerusalem"))
CACHE_SECONDS = 600

_cache: dict = {"at": 0.0, "cal": None}


def enabled() -> bool:
    return bool(ICS_URL)


def _load() -> Calendar:
    now = time.time()
    if _cache["cal"] is not None and now - _cache["at"] < CACHE_SECONDS:
        return _cache["cal"]
    if ICS_URL.startswith(("http://", "https://")):
        resp = httpx.get(ICS_URL, timeout=20, follow_redirects=True)
        resp.raise_for_status()
        raw = resp.content
    else:
        with open(ICS_URL, "rb") as f:
            raw = f.read()
    cal = Calendar.from_ical(raw)
    _cache.update(at=now, cal=cal)
    return cal


def _as_local(v) -> tuple[str, bool]:
    """Returns (ISO string in local time, all_day)."""
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=TZ)
        return v.astimezone(TZ).isoformat(timespec="minutes"), False
    return v.isoformat(), True  # date


def events_between(start: date, end: date) -> list[dict]:
    """Occurrences (recurrences expanded) whose start falls in [start, end]."""
    cal = _load()
    # the expander stamps RECURRENCE-ID on every occurrence, so read recurrence off the source components
    recurring_uids = {str(c.get("UID")) for c in cal.walk("VEVENT") if c.get("RRULE") is not None or c.get("RDATE") is not None}
    out = []
    for ev in recurring_ical_events.of(cal).between(start, end + timedelta(days=1)):
        s, all_day = _as_local(ev.get("DTSTART").dt)
        e = ev.get("DTEND")
        e_iso = _as_local(e.dt)[0] if e else s
        out.append({
            "id": f"{ev.get('UID')}@{s}",
            "title": str(ev.get("SUMMARY", "")).strip() or "(ללא כותרת)",
            "start": s,
            "end": e_iso,
            "date": s[:10],
            "allDay": all_day,
            "recurring": str(ev.get("UID")) in recurring_uids,
            "location": str(ev.get("LOCATION", "") or ""),
        })
    out.sort(key=lambda x: (x["date"], not x["allDay"], x["start"]))
    return out
