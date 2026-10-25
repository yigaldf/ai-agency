"""Google OAuth for the calendar: one-time consent, refresh token kept in the database.

Same flow as the Roger project, narrowed to read-only calendar access. Reuse Roger's
OAuth client: add this app's callback URL to it in Google Cloud → Clients.
"""

from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import KeyValue

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
CREDENTIALS_KEY = "google_credentials"
OAUTH_STATE_KEY = "google_oauth_state"

CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
TZ = ZoneInfo(os.environ.get("CALENDAR_TZ", "Asia/Jerusalem"))


class GoogleNotConnected(Exception):
    pass


def configured() -> bool:
    return bool(CLIENT_ID and CLIENT_SECRET)


def redirect_uri(fallback_base: str) -> str:
    return (PUBLIC_BASE_URL or fallback_base.rstrip("/")) + "/oauth/google/callback"


# ---------- tiny key/value store ----------
def kv_get(db: Session, key: str) -> dict | None:
    row = db.get(KeyValue, key)
    return row.value if row else None


def kv_set(db: Session, key: str, value: dict) -> None:
    row = db.get(KeyValue, key) or KeyValue(key=key)
    row.value = value
    db.add(row)
    db.commit()


# ---------- consent flow ----------
def _flow(base: str, state: str | None = None) -> Flow:
    cfg = {
        "web": {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [redirect_uri(base)],
        }
    }
    flow = Flow.from_client_config(cfg, scopes=SCOPES, state=state)
    flow.redirect_uri = redirect_uri(base)
    return flow


def authorization_url(db: Session, base: str) -> str:
    flow = _flow(base)
    url, state = flow.authorization_url(access_type="offline", prompt="consent", include_granted_scopes="true")
    kv_set(db, OAUTH_STATE_KEY, {"state": state, "code_verifier": flow.code_verifier})  # PKCE verifier must survive until the callback
    return url


def handle_callback(db: Session, base: str, authorization_response_url: str, state: str) -> None:
    saved = kv_get(db, OAUTH_STATE_KEY)
    if not saved or saved.get("state") != state:
        raise ValueError("Invalid OAuth state")
    flow = _flow(base, state=state)
    flow.code_verifier = saved.get("code_verifier")
    flow.fetch_token(authorization_response=authorization_response_url)
    _save(db, flow.credentials)
    kv_set(db, OAUTH_STATE_KEY, {})


def _save(db: Session, creds: Credentials) -> None:
    kv_set(db, CREDENTIALS_KEY, {"token": creds.token, "refresh_token": creds.refresh_token, "scopes": list(creds.scopes or SCOPES)})


def is_connected(db: Session) -> bool:
    data = kv_get(db, CREDENTIALS_KEY)
    return bool(data and data.get("refresh_token"))


def disconnect(db: Session) -> None:
    kv_set(db, CREDENTIALS_KEY, {})


def _credentials(db: Session) -> Credentials:
    data = kv_get(db, CREDENTIALS_KEY)
    if not data or not data.get("refresh_token"):
        raise GoogleNotConnected("Google Calendar is not connected")
    creds = Credentials(
        token=data.get("token"),
        refresh_token=data["refresh_token"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        scopes=data.get("scopes") or SCOPES,
    )
    if not creds.valid:
        creds.refresh(Request())
        _save(db, creds)
    return creds


# ---------- calendar read ----------
def events_between(db: Session, start: date, end: date) -> list[dict]:
    """Events (recurrences expanded by Google) from the primary calendar, start..end inclusive."""
    service = build("calendar", "v3", credentials=_credentials(db), cache_discovery=False)
    time_min = datetime.combine(start, time.min, tzinfo=TZ)
    time_max = datetime.combine(end + timedelta(days=1), time.min, tzinfo=TZ)
    resp = service.events().list(
        calendarId="primary", timeMin=time_min.isoformat(), timeMax=time_max.isoformat(),
        singleEvents=True, orderBy="startTime", maxResults=250,
    ).execute()
    out = []
    for e in resp.get("items", []):
        if e.get("status") == "cancelled":
            continue
        s, en = e.get("start", {}), e.get("end", {})
        all_day = "date" in s
        start_iso = s.get("date") if all_day else _local(s.get("dateTime"))
        end_iso = en.get("date") if all_day else _local(en.get("dateTime"))
        out.append({
            "id": e.get("id", ""),
            "title": (e.get("summary") or "").strip() or "(ללא כותרת)",
            "start": start_iso,
            "end": end_iso or start_iso,
            "date": start_iso[:10],
            "allDay": all_day,
            "recurring": bool(e.get("recurringEventId")),
            "location": e.get("hangoutLink") or e.get("location") or "",
        })
    out.sort(key=lambda x: (x["date"], not x["allDay"], x["start"]))
    return out


def _local(iso: str | None) -> str:
    if not iso:
        return ""
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ).isoformat(timespec="minutes")


RevokedError = RefreshError
