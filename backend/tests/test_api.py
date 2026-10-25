import os
import tempfile

os.environ.setdefault("DATABASE_URL", "sqlite:///" + os.path.join(tempfile.mkdtemp(), "test.db"))
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ["SEED_FILE"] = "/nonexistent/seed.json"  # tests exercise /api/import explicitly

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)
TODAY = "2026-10-21"


def test_full_flow():
    with client:
        assert client.get("/healthz").json() == {"ok": True}

        r = client.put("/api/systems/s1", json={"name": "מערכת א", "order": 1, "createdAt": TODAY})
        assert r.status_code == 200 and r.json()["name"] == "מערכת א"

        base = {"systemId": "s1", "progress": 0, "status": "backlog", "createdAt": TODAY}
        assert client.put("/api/tasks/t1", json={**base, "title": "משימה", "order": 1}).status_code == 200
        r = client.post("/api/tasks/bulk", json=[
            {**base, "id": "t2", "parentId": "t1", "title": "תת א", "order": 1},
            {**base, "id": "t3", "parentId": "t1", "title": "תת ב", "order": 2},
        ])
        assert r.status_code == 200 and len(r.json()) == 2

        # progress transitions + event log on today's row
        r = client.put("/api/tasks/t2/progress", json={"progress": 40, "today": TODAY})
        assert r.json()["status"] == "active" and r.json()["startedAt"] == TODAY
        r = client.put("/api/tasks/t2/progress", json={"progress": 100, "today": TODAY})
        assert r.json()["status"] == "done" and r.json()["doneAt"] == TODAY
        state = client.get("/api/state").json()
        day = next(d for d in state["days"] if d["id"] == TODAY)
        assert [e["to"] for e in day["events"]] == [40, 100]
        assert state["ai"]["enabled"] is False

        # unknown system rejected
        assert client.put("/api/tasks/tx", json={**base, "systemId": "nope", "title": "x"}).status_code == 400

        # day patch
        r = client.patch(f"/api/days/{TODAY}", json={"yesterdayText": " היה טוב ", "plan": [{"id": "t3", "title": "תת ב"}], "saved": True})
        assert r.json()["yesterdayText"] == "היה טוב" and r.json()["savedAt"]

        # delete subtree returns rows, bulk restores them
        r = client.delete("/api/tasks/t1")
        assert {t["id"] for t in r.json()} == {"t1", "t2", "t3"}
        assert client.get("/api/state").json()["tasks"] == []
        assert client.post("/api/tasks/bulk", json=r.json()).status_code == 200
        assert len(client.get("/api/state").json()["tasks"]) == 3

        # delete system cascades
        r = client.delete("/api/systems/s1")
        assert len(r.json()["tasks"]) == 3
        assert client.get("/api/state").json()["systems"] == []

        # AI endpoints are disabled without a key
        assert client.post("/api/feedback", json={"today": TODAY}).status_code == 503
        assert client.post("/api/coach/messages", json={"content": "hi", "today": TODAY}).status_code == 503

        # coach clear/restore
        client.post("/api/coach/restore", json=[{"id": 0, "role": "user", "content": "שלום", "createdAt": "2026-10-21T08:00:00Z"}])
        r = client.delete("/api/coach/messages")
        assert [m["content"] for m in r.json()] == ["שלום"]
        assert client.get("/api/state").json()["coach"] == []


def test_subscriptions():
    with client:
        sub = {"name": "Claude Pro", "vendor": "Anthropic", "amount": 20, "currency": "usd", "cycle": "monthly", "nextCharge": "2026-11-01"}
        r = client.put("/api/subscriptions/sub1", json=sub)
        assert r.status_code == 200 and r.json()["currency"] == "USD" and r.json()["status"] == "active"
        r = client.post("/api/subscriptions/bulk", json=[
            {"id": "sub2", "name": "Railway", "amount": 5, "cycle": "monthly"},
            {"id": "sub3", "name": "Domain", "amount": 60, "currency": "ILS", "cycle": "yearly", "status": "cancelled"},
        ])
        assert r.status_code == 200 and len(r.json()) == 2
        assert [s["id"] for s in client.get("/api/subscriptions").json()] == ["sub1", "sub2", "sub3"]
        assert client.put("/api/subscriptions/bad", json={**sub, "cycle": "daily"}).status_code == 422
        assert client.delete("/api/subscriptions/sub3").json()["name"] == "Domain"
        assert client.delete("/api/subscriptions/sub3").status_code == 404
        assert len(client.get("/api/subscriptions").json()) == 2


def test_seed_file_imports_into_empty_db(tmp_path):
    """The repo's seed file must load cleanly: parents before children, FKs intact."""
    import json
    from pathlib import Path

    seed = Path(__file__).resolve().parent.parent / "seed" / "initial_data.json"
    payload = json.loads(seed.read_text(encoding="utf-8"))
    with client:
        # wipe anything earlier tests left behind so the import endpoint is exercised on its own
        for s in client.get("/api/state").json()["systems"]:
            client.delete(f"/api/systems/{s['id']}")
        r = client.post("/api/import", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["systems"] == len(payload["systems"]) and r.json()["tasks"] == len(payload["tasks"])
        state = client.get("/api/state").json()
        assert len(state["systems"]) == len(payload["systems"])
        assert len(state["tasks"]) == len(payload["tasks"])
        assert {t["parentId"] for t in state["tasks"] if t["parentId"]} <= {t["id"] for t in state["tasks"]}
        assert len(state["coach"]) >= len(payload["coach"])
        # idempotent: importing again does not duplicate systems/tasks
        client.post("/api/import", json={**payload, "coach": []})
        assert len(client.get("/api/state").json()["tasks"]) == len(payload["tasks"])


def test_import_subscriptions():
    subs = [
        {"id": "sub-nba", "name": "NBA League Pass", "vendor": "NBA", "amount": 419.99, "currency": "ILS", "cycle": "yearly", "nextCharge": "2027-10-03"},
        {"id": "sub-claude-max", "name": "Claude Max", "vendor": "Anthropic", "amount": 100, "currency": "usd", "cycle": "monthly"},
    ]
    with client:
        r = client.post("/api/import", json={"subscriptions": subs})
        assert r.status_code == 200, r.text
        assert r.json()["subscriptions"] == 2
        got = {s["id"]: s for s in client.get("/api/subscriptions").json()}
        assert got["sub-nba"]["cycle"] == "yearly" and got["sub-nba"]["amount"] == 419.99
        assert got["sub-claude-max"]["currency"] == "USD" and got["sub-claude-max"]["status"] == "active"


def test_routines():
    with client:
        r = client.put("/api/routines/r1", json={"title": "מדיטציה", "days": [], "order": 1})
        assert r.status_code == 200 and r.json()["days"] == []
        r = client.put("/api/routines/r2", json={"title": "ריצה", "days": [0, 2, 4, 2]})
        assert r.json()["days"] == [0, 2, 4]
        assert client.put("/api/routines/r3", json={"title": "x", "days": [7]}).status_code == 422
        assert client.post("/api/routines/r1/check", json={"date": "2026-10-24"}).json()["date"] == "2026-10-24"
        client.post("/api/routines/r1/check", json={"date": "2026-10-24"})  # idempotent
        client.post("/api/routines/r2/check", json={"date": "2026-10-23"})
        s = client.get("/api/routines", params={"start": "2026-10-18", "end": "2026-10-24"}).json()
        assert len(s["routines"]) == 2 and len(s["checks"]) == 2
        assert client.post("/api/routines/r1/check", json={"date": "2026-10-24", "done": False}).json() is None
        s = client.get("/api/routines", params={"start": "2026-10-18", "end": "2026-10-24"}).json()
        assert len(s["checks"]) == 1
        d = client.delete("/api/routines/r2").json()
        assert d["routine"]["title"] == "ריצה" and d["checks"] == ["2026-10-23"]
        client.put("/api/routines/r2", json=d["routine"])
        assert client.post("/api/routines/r2/restore-checks", json=d["checks"]).json() == 1
        assert client.delete("/api/routines/nope").status_code == 404


def test_calendar_feed_from_ics_file(monkeypatch):
    from pathlib import Path

    from app import calendar_feed

    monkeypatch.setattr(calendar_feed, "ICS_URL", str(Path(__file__).parent / "fixtures" / "sample.ics"))
    calendar_feed._cache.update(at=0, cal=None)
    with client:
        r = client.get("/api/calendar", params={"start": "2026-10-25", "end": "2026-10-31"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["enabled"] is True and body["error"] is None
        titles = [(e["date"], e["title"], e["allDay"], e["recurring"]) for e in body["events"]]
        assert ("2026-10-25", "גיטרה עם אוהד ויקי", False, True) in titles
        assert ("2026-10-28", "גלישה", True, True) in titles
        assert ("2026-10-26", "יגאל x סשה - פגישה מס׳ 2", False, False) in titles
        guitar = next(e for e in body["events"] if e["title"].startswith("גיטרה"))
        assert guitar["start"].startswith("2026-10-25T16:20")

    monkeypatch.setattr(calendar_feed, "ICS_URL", "")
    with client:
        assert client.get("/api/calendar", params={"start": "2026-10-25", "end": "2026-10-31"}).json()["enabled"] is False


def test_google_oauth_not_configured():
    with client:
        st = client.get("/api/google/status").json()
        assert st == {"configured": False, "connected": False}
        assert client.get("/oauth/google/start", follow_redirects=False).status_code == 503
        assert client.post("/api/google/disconnect").json()["connected"] is False
