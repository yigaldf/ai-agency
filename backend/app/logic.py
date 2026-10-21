"""Pure domain logic shared by the API and the prompt builders.

Mirrors the rules the dashboard uses in the browser: leaves carry their own
progress, parents average their children, a task counts as "today" when it is
planned for today and not done.
"""

from __future__ import annotations

from datetime import date, timedelta

from .models import Task

HE_DAYS = ["יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת", "יום ראשון"]
HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]


def he_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{HE_DAYS[d.weekday()]}, {d.day} ב{HE_MONTHS[d.month - 1]}"


def yesterday_of(iso: str) -> str:
    return (date.fromisoformat(iso) - timedelta(days=1)).isoformat()


class TaskTree:
    def __init__(self, tasks: list[Task], today: str):
        self.tasks = tasks
        self.today = today
        self.by_id = {t.id: t for t in tasks}
        self.kids: dict[str | None, list[Task]] = {}
        for t in tasks:
            self.kids.setdefault(t.parent_id, []).append(t)
        for v in self.kids.values():
            v.sort(key=lambda t: t.order)

    def children(self, task_id: str) -> list[Task]:
        return self.kids.get(task_id, [])

    def is_leaf(self, t: Task) -> bool:
        return not self.children(t.id)

    def progress(self, t: Task) -> int:
        c = self.children(t.id)
        if not c:
            return max(0, min(100, t.progress or 0))
        return round(sum(self.progress(x) for x in c) / len(c))

    def is_done(self, t: Task) -> bool:
        if self.is_leaf(t):
            return t.status == "done" or (t.progress or 0) >= 100
        return all(self.is_done(x) for x in self.children(t.id))

    def is_today(self, t: Task) -> bool:
        return t.today_date == self.today and not self.is_done(t)

    def leaves(self) -> list[Task]:
        return [t for t in self.tasks if self.is_leaf(t)]

    def open_leaves(self) -> list[Task]:
        return [t for t in self.leaves() if not self.is_done(t)]

    def wip(self) -> list[Task]:
        return [t for t in self.open_leaves() if t.status == "active"]

    def top_tasks(self, system_id: str) -> list[Task]:
        return sorted((t for t in self.tasks if t.system_id == system_id and not t.parent_id), key=lambda t: t.order)

    def subtree_ids(self, task_id: str) -> list[str]:
        out = [task_id]
        for c in self.children(task_id):
            out.extend(self.subtree_ids(c.id))
        return out


def apply_progress(t: Task, to: int, today: str) -> None:
    """Same transitions as the dashboard's setProgress()."""
    to = max(0, min(100, int(to)))
    t.progress = to
    if to >= 100:
        t.status = "done"
        t.done_at = today
    else:
        if t.status == "done":
            t.status = "active"
        t.done_at = None
        if to > 0 and t.status != "active":
            t.status = "active"
    if not t.started_at and to > 0:
        t.started_at = today
