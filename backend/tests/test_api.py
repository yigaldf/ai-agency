import os
import tempfile

os.environ.setdefault("DATABASE_URL", "sqlite:///" + os.path.join(tempfile.mkdtemp(), "test.db"))
os.environ.pop("ANTHROPIC_API_KEY", None)

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
