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

        # delete system cascades, but only once it is archived
        assert client.delete("/api/systems/s1").status_code == 409
        client.put("/api/systems/s1", json={"name": "מערכת א", "order": 1, "status": "archived"})
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
            client.put(f"/api/systems/{s['id']}", json={**s, "status": "archived"})
            client.delete(f"/api/systems/{s['id']}")
        r = client.post("/api/import", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["systems"] == len(payload["systems"]) and r.json()["tasks"] == len(payload["tasks"])
        state = client.get("/api/state").json()
        assert len(state["systems"]) == len(payload["systems"])
        assert len(state["tasks"]) == len(payload["tasks"])
        assert {t["parentId"] for t in state["tasks"] if t["parentId"]} <= {t["id"] for t in state["tasks"]}
        # the seed has no statuses: systems with started work come back active, the rest new
        started = {t["systemId"] for t in payload["tasks"] if t["progress"] > 0 or t["status"] in ("active", "done")}
        assert {s["id"]: s["status"] for s in state["systems"]} == {s["id"]: ("active" if s["id"] in started else "new") for s in payload["systems"]}
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


def test_google_oauth_not_configured():
    with client:
        c = client.get("/api/calendar", params={"start": "2026-10-25", "end": "2026-10-31"}).json()
        assert c["enabled"] is False and c["events"] == []
        st = client.get("/api/google/status").json()
        assert st == {"configured": False, "connected": False}
        assert client.get("/oauth/google/start", follow_redirects=False).status_code == 503
        assert client.post("/api/google/disconnect").json()["connected"] is False


def test_task_dates():
    with client:
        client.put("/api/systems/sd", json={"name": "תאריכים", "order": 9})
        base = {"systemId": "sd", "title": "עם יעד", "progress": 0, "status": "backlog", "createdAt": "2026-11-01"}
        r = client.put("/api/tasks/td1", json={**base, "dueDate": "2026-11-20"})
        assert r.status_code == 200 and r.json()["dueDate"] == "2026-11-20"
        assert client.put("/api/tasks/td2", json={**base, "dueDate": "20/11/2026"}).status_code == 422
        # finishing stamps today's date as done_at; it can then be edited
        r = client.put("/api/tasks/td1/progress", json={"progress": 100, "today": "2026-11-04"})
        assert r.json()["doneAt"] == "2026-11-04" and r.json()["dueDate"] == "2026-11-20"
        r = client.put("/api/tasks/td1", json={**r.json(), "doneAt": "2026-11-03"})
        assert r.json()["doneAt"] == "2026-11-03" and r.json()["status"] == "done"


def test_system_statuses():
    with client:
        sys = {"name": "סטטוסים", "order": 20}
        assert client.put("/api/systems/st1", json=sys).json()["status"] == "new"
        assert client.put("/api/systems/st1", json={**sys, "status": "paused"}).status_code == 422

        status = lambda: next(s["status"] for s in client.get("/api/state").json()["systems"] if s["id"] == "st1")  # noqa: E731
        base = {"systemId": "st1", "progress": 0, "status": "backlog", "createdAt": TODAY}

        # a task with no progress is not activity; progress above 0 moves new -> active
        client.put("/api/tasks/st-t1", json={**base, "title": "א", "order": 1})
        assert status() == "new"
        client.put("/api/tasks/st-t1/progress", json={"progress": 10, "today": TODAY})
        assert status() == "active"

        # manual move; saving the system without a status (rename, reorder) keeps it
        client.put("/api/systems/st1", json={**sys, "status": "inactive"})
        client.put("/api/systems/st1", json={**sys, "name": "סטטוסים 2"})
        assert status() == "inactive"

        # reordering or lowering progress is not activity
        t = client.get("/api/state").json()["tasks"]
        t1 = next(x for x in t if x["id"] == "st-t1")
        client.post("/api/tasks/bulk", json=[{**t1, "order": 5}])
        client.put("/api/tasks/st-t1/progress", json={"progress": 0, "today": TODAY})
        assert status() == "inactive"

        # pausing a task ("השהה") is not activity; starting it again ("התחל") is: inactive -> active
        client.put("/api/tasks/st-t1", json={**t1, "progress": 0, "status": "backlog"})
        assert status() == "inactive"
        client.put("/api/tasks/st-t1", json={**t1, "progress": 0, "status": "active"})
        assert status() == "active"

        # an archived system never wakes up by itself, and is hidden from the AI and the daily plan
        client.put("/api/systems/st1", json={**sys, "status": "archived"})
        client.put("/api/tasks/st-t1/progress", json={"progress": 60, "today": TODAY})
        assert status() == "archived"
        from app.db import SessionLocal
        from app.main import live_data

        with SessionLocal() as db:
            systems, tasks = live_data(db)
        assert "st1" not in {s.id for s in systems} and "st-t1" not in {x.id for x in tasks}

        # only archived systems can be deleted
        assert client.delete("/api/systems/st1").status_code == 200
        assert client.delete("/api/systems/st1").status_code == 404
