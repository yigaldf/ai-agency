from __future__ import annotations

import base64
import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import ai, schemas
from .db import Base, SessionLocal, engine, get_db
from .logic import TaskTree, apply_progress
from .models import CoachMessage, Day, System, Task
from .prompts import COACH_RULES, coach_context, feedback_prompt



@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="המסע לסוכנות AI", docs_url="/api/docs", openapi_url="/api/openapi.json", lifespan=lifespan)

PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "")
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parent.parent / "static"))


# ---------- optional password (HTTP Basic Auth, any username) ----------
@app.middleware("http")
async def basic_auth(request: Request, call_next):
    if PASSWORD and request.url.path != "/healthz":
        header = request.headers.get("authorization", "")
        ok = False
        if header.startswith("Basic "):
            try:
                decoded = base64.b64decode(header[6:]).decode()
                ok = secrets.compare_digest(decoded.split(":", 1)[1] if ":" in decoded else "", PASSWORD)
            except Exception:
                ok = False
        if not ok:
            return Response("Unauthorized", status_code=401, headers={"WWW-Authenticate": 'Basic realm="dashboard"'})
    return await call_next(request)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


def now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- state ----------
@app.get("/api/state", response_model=schemas.State, response_model_by_alias=True)
def get_state(db: Session = Depends(get_db)):
    return schemas.State(
        systems=db.scalars(select(System).order_by(System.order)).all(),
        tasks=db.scalars(select(Task).order_by(Task.order)).all(),
        days=db.scalars(select(Day).order_by(Day.id.desc()).limit(60)).all(),
        coach=db.scalars(select(CoachMessage).order_by(CoachMessage.id)).all(),
        ai=schemas.AiStatus(enabled=ai.enabled(), model=ai.MODEL),
    )


# ---------- systems ----------
@app.put("/api/systems/{system_id}", response_model=schemas.SystemOut, response_model_by_alias=True)
def upsert_system(system_id: str, body: schemas.SystemIn, db: Session = Depends(get_db)):
    s = db.get(System, system_id) or System(id=system_id)
    s.name, s.order, s.created_at = body.name, body.order, body.created_at
    s.links = [l.model_dump() for l in body.links]
    db.add(s)
    db.commit()
    return s


@app.delete("/api/systems/{system_id}")
def delete_system(system_id: str, db: Session = Depends(get_db)):
    s = db.get(System, system_id)
    if not s:
        raise HTTPException(404)
    tasks = db.scalars(select(Task).where(Task.system_id == system_id)).all()
    out = {
        "system": schemas.SystemOut.model_validate(s).model_dump(by_alias=True),
        "tasks": [schemas.TaskOut.model_validate(t).model_dump(by_alias=True) for t in tasks],
    }
    for t in tasks:
        db.delete(t)
    db.delete(s)
    db.commit()
    return out


# ---------- tasks ----------
def _set_task(t: Task, body: schemas.TaskIn) -> None:
    for k, v in body.model_dump(by_alias=False).items():
        setattr(t, k, [l for l in v] if k == "links" else v)


@app.put("/api/tasks/{task_id}", response_model=schemas.TaskOut, response_model_by_alias=True)
def upsert_task(task_id: str, body: schemas.TaskIn, db: Session = Depends(get_db)):
    if not db.get(System, body.system_id):
        raise HTTPException(400, "unknown system")
    t = db.get(Task, task_id) or Task(id=task_id)
    _set_task(t, body)
    db.add(t)
    db.commit()
    return t


@app.post("/api/tasks/bulk", response_model=list[schemas.TaskOut], response_model_by_alias=True)
def upsert_tasks(body: list[schemas.TaskWithId], db: Session = Depends(get_db)):
    """Create or restore many tasks at once (pasted lists, undo of a delete). Parents first."""
    out = []
    ordered = sorted(body, key=lambda b: 0 if b.parent_id is None else 1)
    for item in ordered:
        if not db.get(System, item.system_id):
            raise HTTPException(400, f"unknown system {item.system_id}")
        t = db.get(Task, item.id) or Task(id=item.id)
        _set_task(t, schemas.TaskIn(**item.model_dump(exclude={"id"})))
        db.add(t)
        out.append(t)
    db.commit()
    return out


@app.delete("/api/tasks/{task_id}", response_model=list[schemas.TaskOut], response_model_by_alias=True)
def delete_task(task_id: str, db: Session = Depends(get_db)):
    """Deletes a task and its sub-tasks; returns the deleted rows so the client can undo."""
    all_tasks = db.scalars(select(Task)).all()
    tree = TaskTree(all_tasks, "")
    if task_id not in tree.by_id:
        raise HTTPException(404)
    ids = tree.subtree_ids(task_id)
    rows = [tree.by_id[i] for i in ids]
    out = [schemas.TaskOut.model_validate(t) for t in rows]
    for t in reversed(rows):  # children before parents
        db.delete(t)
    db.commit()
    return out


def _log_event(db: Session, today: str, t: Task, frm: int, to: int) -> None:
    if frm == to:
        return
    d = db.get(Day, today) or Day(id=today)
    d.events = (d.events or []) + [{"taskId": t.id, "title": t.title, "from": frm, "to": to, "at": now().isoformat()}]
    d.events = d.events[-60:]
    db.add(d)


@app.put("/api/tasks/{task_id}/progress", response_model=schemas.TaskOut, response_model_by_alias=True)
def set_progress(task_id: str, body: schemas.ProgressIn, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404)
    frm = t.progress or 0
    apply_progress(t, body.progress, body.today)
    _log_event(db, body.today, t, frm, t.progress)
    db.commit()
    return t


# ---------- days ----------
@app.patch("/api/days/{day_id}", response_model=schemas.DayOut, response_model_by_alias=True)
def patch_day(day_id: str, body: schemas.DayPatch, db: Session = Depends(get_db)):
    d = db.get(Day, day_id) or Day(id=day_id)
    if body.yesterday_text is not None:
        d.yesterday_text = body.yesterday_text.strip()
    if body.today_text is not None:
        d.today_text = body.today_text.strip()
    if body.plan is not None:
        d.plan = [p.model_dump() for p in body.plan]
    if body.saved:
        d.saved_at = now()
    db.add(d)
    db.commit()
    return d


# ---------- Claude: morning feedback ----------
def _plan_for(db: Session, today: str) -> list[dict]:
    tasks = db.scalars(select(Task)).all()
    tree = TaskTree(tasks, today)
    return [{"id": t.id, "title": t.title} for t in tasks if tree.is_today(t)]


@app.post("/api/feedback")
async def feedback(body: schemas.FeedbackIn):
    if not ai.enabled():
        raise HTTPException(503, "ANTHROPIC_API_KEY is not set")
    with SessionLocal() as db:
        prompt = feedback_prompt(
            db.scalars(select(System)).all(),
            db.scalars(select(Task)).all(),
            db.scalars(select(Day)).all(),
            body.today,
            body.yesterday_text,
            body.today_text,
        )

    async def gen():
        async for kind, payload in ai.stream_text([{"role": "user", "content": prompt}]):
            if kind == "text":
                yield ai.sse({"text": payload})
            elif kind == "error":
                yield ai.sse({"error": payload, "code": payload})
            else:
                with SessionLocal() as db:
                    d = db.get(Day, body.today) or Day(id=body.today)
                    d.feedback, d.feedback_at = payload, now()
                    if not d.saved_at:
                        d.yesterday_text, d.today_text = body.yesterday_text.strip(), body.today_text.strip()
                        d.plan, d.saved_at = _plan_for(db, body.today), d.feedback_at
                    db.add(d)
                    db.commit()
                yield ai.sse({"done": True})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


# ---------- Claude: mental coach ----------
@app.post("/api/coach/messages")
async def coach_send(body: schemas.CoachMessageIn):
    if not ai.enabled():
        raise HTTPException(503, "ANTHROPIC_API_KEY is not set")
    with SessionLocal() as db:
        db.add(CoachMessage(role="user", content=body.content.strip()))
        db.commit()
        history = db.scalars(select(CoachMessage).order_by(CoachMessage.id.desc()).limit(20)).all()[::-1]
        ctx = coach_context(db.scalars(select(System)).all(), db.scalars(select(Task)).all(), db.scalars(select(Day)).all(), body.today)
    turns = [{"role": "user", "content": COACH_RULES + "\n\nמצב נוכחי מהדשבורד:\n" + ctx}]
    turns += [{"role": m.role, "content": m.content} for m in history]

    async def gen():
        partial: list[str] = []
        try:
            async for kind, payload in ai.stream_text(turns):
                if kind == "text":
                    partial.append(payload)
                    yield ai.sse({"text": payload})
                elif kind == "error":
                    yield ai.sse({"error": payload, "code": payload})
                else:
                    partial = [payload]
                    yield ai.sse({"done": True})
        finally:
            text = "".join(partial).strip()
            if text:  # also keeps what arrived before the user pressed stop
                with SessionLocal() as db:
                    db.add(CoachMessage(role="assistant", content=text))
                    db.commit()

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.delete("/api/coach/messages", response_model=list[schemas.CoachMessageOut], response_model_by_alias=True)
def coach_clear(db: Session = Depends(get_db)):
    rows = db.scalars(select(CoachMessage).order_by(CoachMessage.id)).all()
    out = [schemas.CoachMessageOut.model_validate(m) for m in rows]
    for m in rows:
        db.delete(m)
    db.commit()
    return out


@app.post("/api/coach/restore", response_model=list[schemas.CoachMessageOut], response_model_by_alias=True)
def coach_restore(body: list[schemas.CoachMessageOut], db: Session = Depends(get_db)):
    rows = [CoachMessage(role=m.role, content=m.content, created_at=m.created_at) for m in body]
    db.add_all(rows)
    db.commit()
    return rows


# ---------- the React app (built into backend/static by the Dockerfile) ----------
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = STATIC_DIR / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
