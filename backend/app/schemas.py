from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Camel(BaseModel):
    """JSON uses camelCase (what the React app speaks); Python uses snake_case."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class Link(Camel):
    label: str = ""
    url: str


class SystemIn(Camel):
    name: str = Field(min_length=1, max_length=200)
    order: int = 0
    links: list[Link] = []
    created_at: str | None = None


class SystemOut(SystemIn):
    id: str


class TaskIn(Camel):
    system_id: str
    parent_id: str | None = None
    title: str = Field(min_length=1, max_length=500)
    progress: int = Field(default=0, ge=0, le=100)
    status: str = Field(default="backlog", pattern="^(backlog|active|done)$")
    order: int = 0
    today_date: str | None = None
    started_at: str | None = None
    done_at: str | None = None
    links: list[Link] = []
    created_at: str | None = None


class TaskOut(TaskIn):
    id: str


class TaskWithId(TaskIn):
    id: str


class ProgressIn(Camel):
    progress: int = Field(ge=0, le=100)
    today: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class PlanItem(Camel):
    id: str
    title: str


class DayPatch(Camel):
    yesterday_text: str | None = None
    today_text: str | None = None
    plan: list[PlanItem] | None = None
    saved: bool = False  # set saved_at = now


class DayOut(Camel):
    id: str
    yesterday_text: str = ""
    today_text: str = ""
    plan: list[PlanItem] = []
    events: list[dict] = []
    feedback: str | None = None
    feedback_at: datetime | None = None
    saved_at: datetime | None = None


class CoachMessageOut(Camel):
    id: int
    role: str
    content: str
    created_at: datetime


class CoachMessageIn(Camel):
    content: str = Field(min_length=1, max_length=4000)
    today: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class FeedbackIn(Camel):
    today: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    yesterday_text: str = ""
    today_text: str = ""


class AiStatus(Camel):
    enabled: bool
    model: str


class State(Camel):
    systems: list[SystemOut]
    tasks: list[TaskOut]
    days: list[DayOut]
    coach: list[CoachMessageOut]
    ai: AiStatus


class SubscriptionIn(Camel):
    name: str = Field(min_length=1, max_length=200)
    vendor: str = ""
    amount: float = Field(default=0, ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    cycle: str = Field(default="monthly", pattern="^(monthly|yearly|weekly)$")
    status: str = Field(default="active", pattern="^(active|cancelled|trial)$")
    category: str = ""
    next_charge: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    last_charge: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    payment_method: str = ""
    cancel_url: str = ""
    source_url: str = ""
    notes: str = ""
    created_at: str | None = None


class SubscriptionOut(SubscriptionIn):
    id: str


class SubscriptionWithId(SubscriptionIn):
    id: str


class CoachMessageImport(Camel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str
    created_at: datetime | None = None


class ImportPayload(Camel):
    """Full export of the original claude.ai dashboard (or of this app)."""

    systems: list[SystemWithId] = []
    tasks: list[TaskWithId] = []
    days: list[DayOut] = []
    coach: list[CoachMessageImport] = []
    subscriptions: list[SubscriptionWithId] = []


class SystemWithId(SystemIn):
    id: str
