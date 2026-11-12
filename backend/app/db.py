import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", "sqlite:///./data/dev.db")
    # Railway hands out postgres:// or postgresql://; SQLAlchemy 2 + psycopg3 wants postgresql+psycopg://
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL = _database_url()

if DATABASE_URL.startswith("sqlite"):
    os.makedirs(os.path.dirname(DATABASE_URL.replace("sqlite:///", "")) or ".", exist_ok=True)
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_columns() -> None:
    """Add columns that create_all cannot add to tables that already exist (no Alembic yet)."""
    from sqlalchemy import inspect, text

    wanted = {"tasks": {"due_date": "VARCHAR(10)"}, "systems": {"status": "VARCHAR(20)"}}
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in wanted.items():
            if table not in insp.get_table_names():
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
