from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class System(Base):
    __tablename__ = "systems"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    order: Mapped[int] = mapped_column(Integer, default=0)
    links: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD, client's local date


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    system_id: Mapped[str] = mapped_column(String(40), ForeignKey("systems.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(500))
    progress: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="backlog")  # backlog | active | done
    order: Mapped[int] = mapped_column(Integer, default=0)
    today_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    started_at: Mapped[str | None] = mapped_column(String(10), nullable=True)
    done_at: Mapped[str | None] = mapped_column(String(10), nullable=True)
    links: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[str | None] = mapped_column(String(10), nullable=True)


class Day(Base):
    __tablename__ = "days"

    id: Mapped[str] = mapped_column(String(10), primary_key=True)  # YYYY-MM-DD
    yesterday_text: Mapped[str] = mapped_column(Text, default="")
    today_text: Mapped[str] = mapped_column(Text, default="")
    plan: Mapped[list] = mapped_column(JSON, default=list)  # [{id, title}]
    events: Mapped[list] = mapped_column(JSON, default=list)  # [{taskId, title, from, to, at}]
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    feedback_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    saved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CoachMessage(Base):
    __tablename__ = "coach_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    role: Mapped[str] = mapped_column(String(10))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    vendor: Mapped[str] = mapped_column(String(200), default="")
    amount: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    cycle: Mapped[str] = mapped_column(String(10), default="monthly")  # monthly | yearly | weekly
    status: Mapped[str] = mapped_column(String(10), default="active")  # active | cancelled | trial
    category: Mapped[str] = mapped_column(String(50), default="")
    next_charge: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
    last_charge: Mapped[str | None] = mapped_column(String(10), nullable=True)
    payment_method: Mapped[str] = mapped_column(String(100), default="")
    cancel_url: Mapped[str] = mapped_column(String(500), default="")
    source_url: Mapped[str] = mapped_column(String(500), default="")  # the email it was found in
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str | None] = mapped_column(String(10), nullable=True)
