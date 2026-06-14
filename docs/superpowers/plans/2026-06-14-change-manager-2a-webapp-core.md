# Change Manager — Plan 2a: Web App Core (schema + reconciliation + API)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `change-manager` FastAPI service's data + logic core — the Postgres schema, the sync reconciliation state machine, and the authenticated JSON API the mini's sync/executor will call — fully tested, no GUI and no deploy yet.

**Architecture:** A new Python repo (`change-manager`). SQLAlchemy 2.0 ORM owns four tables (`change_items`, `change_attempts`, `change_events`, `window_runs`); Alembic migrates prod Postgres. The reconciliation state machine (`reconcile.py`) is pure ORM logic and the most-tested unit. A FastAPI `APIRouter` exposes `/api/sync`, item list/get, the lifecycle transitions (claim/outcome/decisions/reactivate), and window-runs, all gated by an M2M bearer token. Tests run against in-memory SQLite (the logic is DB-agnostic); Postgres is prod-only.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2 + pydantic-settings, pytest + httpx TestClient, uvicorn.

**Spec:** `docs/superpowers/specs/2026-06-14-change-manager-design.md` → "Data model", "Sub-project A — the web app" (API section).

**Conventions:**
- New repo lives at `~/Projects/change-manager` (GitHub `alobarquest/change-manager`). This plan doc stays in the infraops repo with the other change-manager planning docs.
- Python 3.12+; verify with `python --version` after creating the venv.
- Test: `pytest -q`. Single test: `pytest tests/test_x.py::test_name -q`.
- Commit after each task. The repo starts fresh (Task 1 inits git); push to GitHub at the end.
- TDD throughout: failing test → run red → implement → run green → commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `pyproject.toml`, `.gitignore`, `README.md` | Project metadata + deps. |
| `app/config.py` | `Settings` (DATABASE_URL, M2M_TOKEN) via pydantic-settings. |
| `app/db.py` | Engine, `SessionLocal`, declarative `Base`, `get_db` dependency. |
| `app/models.py` | ORM: `ChangeItem`, `ChangeAttempt`, `ChangeEvent`, `WindowRun`. |
| `app/identity.py` | `stable_identity()`, `rule_key_of()`. |
| `app/events.py` | `record_event()` — append a `ChangeEvent` on every transition. |
| `app/schemas.py` | Pydantic request/response models. |
| `app/reconcile.py` | The sync reconciliation state machine. |
| `app/auth.py` | `require_m2m` dependency (bearer token). |
| `app/api.py` | The `/api/*` router. |
| `app/main.py` | FastAPI app; mounts the router; `/api/health`. |
| `tests/conftest.py` | SQLite engine + session + TestClient fixtures. |
| `tests/test_*.py` | Per-unit tests. |
| `alembic/`, `alembic.ini` | Prod Postgres migrations. |

---

## Task 1: Scaffold the repo + health endpoint

**Files:** Create the repo at `~/Projects/change-manager` with `pyproject.toml`, `.gitignore`, `app/{__init__,config,db,main}.py`, `tests/conftest.py`, `tests/test_health.py`.

- [ ] **Step 1: Create the project + venv**

```bash
mkdir -p ~/Projects/change-manager/{app,tests,alembic/versions}
cd ~/Projects/change-manager
python3 --version    # must be 3.12+
python3 -m venv .venv
source .venv/bin/activate
```

- [ ] **Step 2: Write `pyproject.toml`**

```toml
[project]
name = "change-manager"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.110",
  "uvicorn[standard]>=0.29",
  "sqlalchemy>=2.0",
  "alembic>=1.13",
  "psycopg[binary]>=3.1",
  "pydantic>=2.6",
  "pydantic-settings>=2.2",
  "jinja2>=3.1",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "httpx>=0.27"]

[tool.pytest.ini_options]
addopts = "-q"
testpaths = ["tests"]
```

- [ ] **Step 3: Write `.gitignore`**

```gitignore
.venv/
__pycache__/
*.pyc
.env
.pytest_cache/
*.db
```

- [ ] **Step 4: Install**

```bash
pip install -e ".[dev]"
```
Expected: installs cleanly.

- [ ] **Step 5: Write `app/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./change_manager.db"
    m2m_token: str = ""  # required in prod; empty disables auth in local dev


settings = Settings()
```

- [ ] **Step 6: Write `app/db.py`**

```python
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# SQLite needs check_same_thread=False for the threaded test client.
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 7: Write `app/main.py`**

```python
from fastapi import FastAPI

app = FastAPI(title="Change Manager")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 8: Write `app/__init__.py`** (empty file) and `tests/__init__.py` (empty file).

- [ ] **Step 9: Write `tests/conftest.py`**

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base, get_db
from app.main import app


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, future=True)
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db: Session) -> TestClient:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
```

Note: `Base.metadata.create_all` only sees tables whose models are imported. A later task imports `app.models` in conftest so all four tables exist; add that import when models land (Task 3 Step 5).

- [ ] **Step 10: Write `tests/test_health.py`**

```python
from fastapi.testclient import TestClient

from app.main import app


def test_health():
    r = TestClient(app).get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

- [ ] **Step 11: Run the test**

Run: `pytest tests/test_health.py`
Expected: 1 passed.

- [ ] **Step 12: Init git + commit**

```bash
git init -q && git add -A
git commit -q -m "chore: scaffold change-manager FastAPI service + health endpoint"
```

---

## Task 2: `identity.py` — stable identity + rule-key

**Files:** Create `app/identity.py`, `tests/test_identity.py`.

- [ ] **Step 1: Write the failing test** — `tests/test_identity.py`:

```python
from app.identity import rule_key_of, stable_identity


def test_rule_key_of_strips_the_random_suffix():
    assert rule_key_of("coolify.enable_healthcheck:deadbeef") == "coolify.enable_healthcheck"
    assert rule_key_of("572:e4f2022e") == "572"


def test_stable_identity_joins_instance_rulekey_uuid():
    assert stable_identity("prod", "572", "db1") == "prod::572::db1"
```

- [ ] **Step 2: Run red** — `pytest tests/test_identity.py` → FAIL (module missing).

- [ ] **Step 3: Implement `app/identity.py`**

```python
def rule_key_of(proposal_id: str) -> str:
    """The stable rule/remediation key — the proposal_id prefix before the random suffix."""
    return proposal_id.split(":", 1)[0]


def stable_identity(instance: str, rule_key: str, resource_uuid: str) -> str:
    """The cross-day dedup key for a drift item."""
    return f"{instance}::{rule_key}::{resource_uuid}"
```

- [ ] **Step 4: Run green** — `pytest tests/test_identity.py` → 2 passed.

- [ ] **Step 5: Commit**

```bash
git add app/identity.py tests/test_identity.py
git commit -q -m "feat: stable identity + rule-key helpers"
```

---

## Task 3: `models.py` — the four tables

**Files:** Create `app/models.py`, `tests/test_models.py`; modify `tests/conftest.py`.

- [ ] **Step 1: Write the failing test** — `tests/test_models.py`:

```python
from datetime import datetime, timezone

from app.models import ChangeAttempt, ChangeEvent, ChangeItem, WindowRun


def test_change_item_roundtrips(db):
    item = ChangeItem(
        identity="prod::572::db1", instance="prod", rule_key="572",
        resource_uuid="db1", resource_name="pg1", risk="safe", kind="question",
        reasoning="rule #572", plan={"root_cause": "x"}, status="pending",
        first_seen_at=datetime.now(timezone.utc), last_seen_at=datetime.now(timezone.utc),
    )
    db.add(item)
    db.commit()
    got = db.query(ChangeItem).filter_by(identity="prod::572::db1").one()
    assert got.status == "pending"
    assert got.plan["root_cause"] == "x"


def test_related_rows_link_to_item(db):
    item = ChangeItem(
        identity="prod::571::a1", instance="prod", rule_key="571",
        resource_uuid="a1", resource_name="app1", risk="caution", kind="remediation",
        reasoning="r", plan={}, status="approved",
        first_seen_at=datetime.now(timezone.utc), last_seen_at=datetime.now(timezone.utc),
    )
    db.add(item)
    db.flush()
    db.add(ChangeEvent(item_id=item.id, at=datetime.now(timezone.utc), actor="sync",
                       event_type="ingested", to_status="pending"))
    db.add(ChangeAttempt(item_id=item.id, started_at=datetime.now(timezone.utc), outcome="done"))
    db.add(WindowRun(started_at=datetime.now(timezone.utc), status="running"))
    db.commit()
    assert db.query(ChangeEvent).count() == 1
    assert db.query(ChangeAttempt).count() == 1
    assert db.query(WindowRun).count() == 1
```

- [ ] **Step 2: Run red** — `pytest tests/test_models.py` → FAIL.

- [ ] **Step 3: Implement `app/models.py`**

```python
from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ChangeItem(Base):
    __tablename__ = "change_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    identity: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    instance: Mapped[str] = mapped_column(String, nullable=False)
    rule_key: Mapped[str] = mapped_column(String, nullable=False)
    provider: Mapped[str | None] = mapped_column(String)
    resource_type: Mapped[str | None] = mapped_column(String)
    resource_uuid: Mapped[str] = mapped_column(String, nullable=False)
    resource_name: Mapped[str] = mapped_column(String, nullable=False)
    risk: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    reasoning: Mapped[str] = mapped_column(Text, nullable=False)
    plan: Mapped[dict] = mapped_column(JSON, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending", index=True)
    decided_by: Mapped[str | None] = mapped_column(String)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_report: Mapped[str | None] = mapped_column(String)


class ChangeAttempt(Base):
    __tablename__ = "change_attempts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("change_items.id"), nullable=False)
    window_run_id: Mapped[int | None] = mapped_column(ForeignKey("window_runs.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    outcome: Mapped[str | None] = mapped_column(String)
    detail: Mapped[str | None] = mapped_column(Text)
    tool_calls: Mapped[dict | None] = mapped_column(JSON)
    rollback: Mapped[dict | None] = mapped_column(JSON)


class ChangeEvent(Base):
    __tablename__ = "change_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("change_items.id"), nullable=False, index=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor: Mapped[str] = mapped_column(String, nullable=False)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    from_status: Mapped[str | None] = mapped_column(String)
    to_status: Mapped[str | None] = mapped_column(String)
    detail: Mapped[str | None] = mapped_column(Text)
    attempt_id: Mapped[int | None] = mapped_column(ForeignKey("change_attempts.id"))
    window_run_id: Mapped[int | None] = mapped_column(ForeignKey("window_runs.id"))


class WindowRun(Base):
    __tablename__ = "window_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    considered: Mapped[int] = mapped_column(Integer, default=0)
    applied: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    blocked: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String, nullable=False, default="running")
    report_md: Mapped[str | None] = mapped_column(Text)
```

- [ ] **Step 4: Make the test fixtures see the tables** — in `tests/conftest.py`, add `import app.models  # noqa: F401` at the top (so `Base.metadata` knows all four tables before `create_all`).

- [ ] **Step 5: Run green** — `pytest tests/test_models.py` → 2 passed.

- [ ] **Step 6: Commit**

```bash
git add app/models.py tests/test_models.py tests/conftest.py
git commit -q -m "feat: ORM models for change_items / attempts / events / window_runs"
```

---

## Task 4: Alembic — initial migration (prod Postgres)

**Files:** Create `alembic.ini`, `alembic/env.py`, `alembic/versions/0001_initial.py`; `tests/test_migration.py`.

- [ ] **Step 1: Init alembic**

Run: `cd ~/Projects/change-manager && alembic init -t generic alembic` — then replace the generated `alembic/env.py` target metadata + URL wiring with the version below (keep alembic's other boilerplate).

- [ ] **Step 2: Wire `alembic/env.py`** — ensure these lines are present (replace the metadata/url section):

```python
from app.config import settings
from app.db import Base
import app.models  # noqa: F401  (register all tables on Base.metadata)

config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata
```

- [ ] **Step 3: Autogenerate the initial migration**

Run (against a scratch SQLite so autogen sees the models): `DATABASE_URL=sqlite:///./scratch.db alembic revision --autogenerate -m "initial" -n 0001` then `rm -f scratch.db`.
Verify the generated file `alembic/versions/0001_initial.py` creates all four tables (`change_items` with the unique `identity` index, `change_attempts`, `change_events`, `window_runs`). If autogen names it differently, rename to `0001_initial.py` and set `revision = "0001"`, `down_revision = None`.

- [ ] **Step 4: Write `tests/test_migration.py`** (proves the migration builds the schema on a fresh DB):

```python
import os
import subprocess
import tempfile


def test_alembic_upgrade_head_builds_schema():
    with tempfile.TemporaryDirectory() as d:
        db = os.path.join(d, "m.db")
        env = {**os.environ, "DATABASE_URL": f"sqlite:///{db}"}
        out = subprocess.run(["alembic", "upgrade", "head"], env=env, capture_output=True, text=True)
        assert out.returncode == 0, out.stderr
        # the four tables exist
        import sqlite3
        names = {r[0] for r in sqlite3.connect(db).execute(
            "select name from sqlite_master where type='table'").fetchall()}
        assert {"change_items", "change_attempts", "change_events", "window_runs"} <= names
```

- [ ] **Step 5: Run** — `pytest tests/test_migration.py` → 1 passed.

- [ ] **Step 6: Commit**

```bash
git add alembic.ini alembic/ tests/test_migration.py
git commit -q -m "feat: alembic initial migration for the four tables"
```

---

## Task 5: `events.py` — `record_event`

**Files:** Create `app/events.py`, `tests/test_events.py`.

- [ ] **Step 1: Write the failing test** — `tests/test_events.py`:

```python
from datetime import datetime, timezone

from app.events import record_event
from app.models import ChangeEvent, ChangeItem


def _item(db):
    it = ChangeItem(identity="prod::571::a1", instance="prod", rule_key="571",
                    resource_uuid="a1", resource_name="app1", risk="caution", kind="remediation",
                    reasoning="r", plan={}, status="pending",
                    first_seen_at=datetime.now(timezone.utc), last_seen_at=datetime.now(timezone.utc))
    db.add(it); db.flush()
    return it


def test_record_event_appends_a_row_with_transition(db):
    it = _item(db)
    record_event(db, it, actor="user:devon@x", event_type="approved",
                 from_status="pending", to_status="approved", detail="approved")
    db.commit()
    ev = db.query(ChangeEvent).one()
    assert ev.item_id == it.id
    assert ev.actor == "user:devon@x"
    assert ev.event_type == "approved"
    assert (ev.from_status, ev.to_status) == ("pending", "approved")
    assert ev.at is not None
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Implement `app/events.py`**

```python
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import ChangeEvent, ChangeItem


def record_event(
    db: Session,
    item: ChangeItem,
    *,
    actor: str,
    event_type: str,
    from_status: str | None = None,
    to_status: str | None = None,
    detail: str | None = None,
    attempt_id: int | None = None,
    window_run_id: int | None = None,
) -> ChangeEvent:
    """Append one immutable history row. The caller commits."""
    ev = ChangeEvent(
        item_id=item.id, at=datetime.now(timezone.utc), actor=actor,
        event_type=event_type, from_status=from_status, to_status=to_status,
        detail=detail, attempt_id=attempt_id, window_run_id=window_run_id,
    )
    db.add(ev)
    return ev
```

- [ ] **Step 4: Run green** → 1 passed.

- [ ] **Step 5: Commit**

```bash
git add app/events.py tests/test_events.py
git commit -q -m "feat: record_event history helper"
```

---

## Task 6: `schemas.py` — API request/response models

**Files:** Create `app/schemas.py`, `tests/test_schemas.py`.

- [ ] **Step 1: Write the failing test** — `tests/test_schemas.py`:

```python
from app.schemas import SyncRequest


def test_sync_request_parses_an_escalation():
    payload = {
        "generated_at": "2026-06-14T07:00:00Z",
        "source_report": "2026-06-14.json",
        "escalations": [{
            "proposal_id": "572:e4f2022e", "instance": "prod",
            "target": {"provider": "coolify", "resource_type": "database", "uuid": "db1", "name": "pg1"},
            "risk": "safe", "kind": "question", "reasoning": "rule #572",
            "plan": {"root_cause": "x", "steps": ["s"], "infraops_tools": [], "risk": "caution",
                     "rollback": "r", "cm_window_hint": "h", "generated_by": "sonnet"},
            "note": None,
        }],
    }
    req = SyncRequest.model_validate(payload)
    assert req.escalations[0].instance == "prod"
    assert req.escalations[0].target.uuid == "db1"
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Implement `app/schemas.py`**

```python
from typing import Any

from pydantic import BaseModel


class TargetIn(BaseModel):
    provider: str | None = None
    resource_type: str | None = None
    uuid: str
    name: str


class EscalationIn(BaseModel):
    proposal_id: str
    instance: str
    target: TargetIn
    risk: str
    kind: str
    reasoning: str
    plan: dict[str, Any]
    note: str | None = None


class SyncRequest(BaseModel):
    generated_at: str
    source_report: str
    escalations: list[EscalationIn]


class SyncSummary(BaseModel):
    new: int
    refreshed: int
    resolved: int
    reopened: int


class OutcomeIn(BaseModel):
    outcome: str  # done | failed | blocked | skipped_conformant
    detail: str | None = None
    tool_calls: dict[str, Any] | None = None
    rollback: dict[str, Any] | None = None


class DecisionIn(BaseModel):
    actor: str  # the SSO email; for M2M/testing, an explicit actor
    detail: str | None = None
```

- [ ] **Step 4: Run green** → 1 passed.

- [ ] **Step 5: Commit**

```bash
git add app/schemas.py tests/test_schemas.py
git commit -q -m "feat: pydantic API schemas"
```

---

## Task 7: `reconcile.py` — the sync state machine (core)

**Files:** Create `app/reconcile.py`, `tests/test_reconcile.py`. This is the highest-value unit; test every rule.

- [ ] **Step 1: Write the failing tests** — `tests/test_reconcile.py`:

```python
from datetime import datetime, timezone

from app.models import ChangeEvent, ChangeItem
from app.reconcile import reconcile
from app.schemas import EscalationIn, SyncRequest

NOW = datetime(2026, 6, 14, 7, 0, tzinfo=timezone.utc)


def esc(uuid="db1", rule="572", instance="prod", name="pg1"):
    return EscalationIn(
        proposal_id=f"{rule}:rand", instance=instance,
        target={"provider": "coolify", "resource_type": "database", "uuid": uuid, "name": name},
        risk="safe", kind="question", reasoning=f"rule #{rule}", plan={"root_cause": "x"}, note=None,
    )


def req(escalations):
    return SyncRequest(generated_at="2026-06-14T07:00:00Z", source_report="2026-06-14.json", escalations=escalations)


def _item(db, identity, status):
    it = ChangeItem(identity=identity, instance="prod", rule_key="572", resource_uuid="db1",
                    resource_name="pg1", risk="safe", kind="question", reasoning="r", plan={},
                    status=status, first_seen_at=NOW, last_seen_at=NOW)
    db.add(it); db.commit(); return it


def test_new_escalation_inserts_pending_with_event(db):
    s = reconcile(db, req([esc()]))
    assert s.new == 1 and s.refreshed == 0
    it = db.query(ChangeItem).filter_by(identity="prod::572::db1").one()
    assert it.status == "pending"
    assert db.query(ChangeEvent).filter_by(item_id=it.id, event_type="ingested").count() == 1


def test_existing_pending_is_refreshed_not_duplicated(db):
    _item(db, "prod::572::db1", "approved")
    s = reconcile(db, req([esc()]))
    assert s.new == 0 and s.refreshed == 1
    assert db.query(ChangeItem).count() == 1
    assert db.query(ChangeItem).one().status == "approved"  # decision preserved


def test_done_item_reappearing_reopens_to_pending(db):
    _item(db, "prod::572::db1", "done")
    s = reconcile(db, req([esc()]))
    assert s.reopened == 1
    it = db.query(ChangeItem).one()
    assert it.status == "pending"
    assert db.query(ChangeEvent).filter_by(item_id=it.id, event_type="regression_reopened").count() == 1


def test_wontfix_survives_sync(db):
    _item(db, "prod::572::db1", "wontfix")
    reconcile(db, req([esc()]))
    assert db.query(ChangeItem).one().status == "wontfix"


def test_item_absent_from_report_resolves(db):
    _item(db, "prod::572::db1", "approved")
    s = reconcile(db, req([]))  # no escalations this run
    assert s.resolved == 1
    it = db.query(ChangeItem).one()
    assert it.status == "resolved"
    assert db.query(ChangeEvent).filter_by(item_id=it.id, event_type="resolved").count() == 1


def test_absent_wontfix_is_not_resolved(db):
    _item(db, "prod::572::db1", "wontfix")
    s = reconcile(db, req([]))
    assert s.resolved == 0
    assert db.query(ChangeItem).one().status == "wontfix"
```

- [ ] **Step 2: Run red** → FAIL (module missing).

- [ ] **Step 3: Implement `app/reconcile.py`**

```python
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.events import record_event
from app.identity import rule_key_of, stable_identity
from app.models import ChangeItem
from app.schemas import EscalationIn, SyncRequest, SyncSummary

# Statuses that mean "this drift is settled / closed" and should reopen if it reappears.
_CLOSED = {"done", "resolved"}


def reconcile(db: Session, req: SyncRequest) -> SyncSummary:
    now = datetime.now(timezone.utc)
    new = refreshed = resolved = reopened = 0

    seen_identities: set[str] = set()

    for e in req.escalations:
        rule_key = rule_key_of(e.proposal_id)
        identity = stable_identity(e.instance, rule_key, e.target.uuid)
        seen_identities.add(identity)

        item = db.scalar(select(ChangeItem).where(ChangeItem.identity == identity))
        if item is None:
            item = ChangeItem(
                identity=identity, instance=e.instance, rule_key=rule_key,
                provider=e.target.provider, resource_type=e.target.resource_type,
                resource_uuid=e.target.uuid, resource_name=e.target.name,
                risk=e.risk, kind=e.kind, reasoning=e.reasoning, plan=e.plan, note=e.note,
                status="pending", first_seen_at=now, last_seen_at=now,
                source_report=req.source_report,
            )
            db.add(item)
            db.flush()
            record_event(db, item, actor="sync", event_type="ingested", to_status="pending",
                         detail=f"first seen in {req.source_report}")
            new += 1
            continue

        # Existing: always refresh the latest plan/note/last_seen/source.
        item.plan, item.note = e.plan, e.note
        item.last_seen_at, item.source_report = now, req.source_report

        if item.status in _CLOSED:
            prev = item.status
            item.status = "pending"
            record_event(db, item, actor="sync", event_type="regression_reopened",
                         from_status=prev, to_status="pending",
                         detail="drift reappeared after it was closed")
            reopened += 1
        else:
            refreshed += 1  # pending/approved/deferred/blocked/failed/wontfix/in_progress: decision stands

    # Items in the queue but NOT in this report → resolved (drift cleared), except wontfix.
    open_items = db.scalars(
        select(ChangeItem).where(ChangeItem.status.notin_(["resolved", "wontfix"]))
    ).all()
    for item in open_items:
        if item.identity not in seen_identities:
            prev = item.status
            item.status = "resolved"
            record_event(db, item, actor="sync", event_type="resolved",
                         from_status=prev, to_status="resolved", detail="no longer flagged")
            resolved += 1

    db.commit()
    return SyncSummary(new=new, refreshed=refreshed, resolved=resolved, reopened=reopened)
```

- [ ] **Step 4: Run green** — `pytest tests/test_reconcile.py` → 6 passed.

- [ ] **Step 5: Commit**

```bash
git add app/reconcile.py tests/test_reconcile.py
git commit -q -m "feat: sync reconciliation state machine (new/refresh/reopen/resolve/wontfix)"
```

---

## Task 8: `auth.py` — M2M bearer dependency

**Files:** Create `app/auth.py`, `tests/test_auth.py`.

- [ ] **Step 1: Write the failing test** — `tests/test_auth.py`:

```python
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth import require_m2m


def _app(token: str):
    import app.auth as a
    a.settings.m2m_token = token  # set the expected token for the test
    app = FastAPI()

    @app.get("/protected", dependencies=[Depends(require_m2m)])
    def protected():
        return {"ok": True}

    return TestClient(app)


def test_missing_token_is_401():
    c = _app("secret")
    assert c.get("/protected").status_code == 401


def test_wrong_token_is_401():
    c = _app("secret")
    assert c.get("/protected", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_correct_token_passes():
    c = _app("secret")
    assert c.get("/protected", headers={"Authorization": "Bearer secret"}).status_code == 200
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Implement `app/auth.py`**

```python
from fastapi import Header, HTTPException, status

from app.config import settings


def require_m2m(authorization: str | None = Header(default=None)) -> None:
    """Validate the mini's M2M bearer token. Raises 401 on mismatch."""
    expected = settings.m2m_token
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not expected or token != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid M2M token")
```

Note: an empty configured `m2m_token` rejects all requests (fail-closed). Local dev sets it in `.env`.

- [ ] **Step 4: Run green** → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/auth.py tests/test_auth.py
git commit -q -m "feat: M2M bearer-token dependency (fail-closed)"
```

---

## Task 9: API — `/api/sync` + item list/get

**Files:** Create `app/api.py`; modify `app/main.py`; create `tests/test_api_sync.py`.

- [ ] **Step 1: Write the failing test** — `tests/test_api_sync.py`:

```python
import app.auth as auth

ESC = {
    "proposal_id": "572:r1", "instance": "prod",
    "target": {"provider": "coolify", "resource_type": "database", "uuid": "db1", "name": "pg1"},
    "risk": "safe", "kind": "question", "reasoning": "rule #572",
    "plan": {"root_cause": "x"}, "note": None,
}
BODY = {"generated_at": "2026-06-14T07:00:00Z", "source_report": "2026-06-14.json", "escalations": [ESC]}
H = {"Authorization": "Bearer testtok"}


def _auth():
    auth.settings.m2m_token = "testtok"


def test_sync_then_list_and_get(client):
    _auth()
    r = client.post("/api/sync", json=BODY, headers=H)
    assert r.status_code == 200
    assert r.json() == {"new": 1, "refreshed": 0, "resolved": 0, "reopened": 0}

    lst = client.get("/api/items", headers=H).json()
    assert len(lst) == 1
    item_id = lst[0]["id"]
    assert lst[0]["status"] == "pending"
    assert lst[0]["instance"] == "prod"

    one = client.get(f"/api/items/{item_id}", headers=H).json()
    assert one["resource_name"] == "pg1"
    assert one["plan"]["root_cause"] == "x"


def test_sync_requires_auth(client):
    _auth()
    assert client.post("/api/sync", json=BODY).status_code == 401


def test_list_filters_by_status(client):
    _auth()
    client.post("/api/sync", json=BODY, headers=H)
    assert len(client.get("/api/items?status=pending", headers=H).json()) == 1
    assert len(client.get("/api/items?status=approved", headers=H).json()) == 0
```

- [ ] **Step 2: Run red** → FAIL (no `/api/sync`).

- [ ] **Step 3: Implement `app/api.py`** (sync + list + get to start; later tasks append to this router)

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_m2m
from app.db import get_db
from app.models import ChangeItem
from app.reconcile import reconcile
from app.schemas import SyncRequest, SyncSummary

router = APIRouter(prefix="/api", dependencies=[Depends(require_m2m)])


def _item_dict(it: ChangeItem) -> dict:
    return {
        "id": it.id, "identity": it.identity, "instance": it.instance, "rule_key": it.rule_key,
        "resource_type": it.resource_type, "resource_uuid": it.resource_uuid,
        "resource_name": it.resource_name, "risk": it.risk, "kind": it.kind,
        "reasoning": it.reasoning, "plan": it.plan, "note": it.note, "status": it.status,
        "decided_by": it.decided_by,
    }


@router.post("/sync", response_model=SyncSummary)
def sync(req: SyncRequest, db: Session = Depends(get_db)) -> SyncSummary:
    return reconcile(db, req)


@router.get("/items")
def list_items(
    status: str | None = Query(default=None),
    instance: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = select(ChangeItem)
    if status:
        stmt = stmt.where(ChangeItem.status == status)
    if instance:
        stmt = stmt.where(ChangeItem.instance == instance)
    return [_item_dict(it) for it in db.scalars(stmt.order_by(ChangeItem.id)).all()]


@router.get("/items/{item_id}")
def get_item(item_id: int, db: Session = Depends(get_db)) -> dict:
    it = db.get(ChangeItem, item_id)
    if it is None:
        raise HTTPException(status_code=404, detail="not found")
    return _item_dict(it)
```

- [ ] **Step 4: Mount the router** — in `app/main.py`, add:

```python
from app.api import router as api_router

app.include_router(api_router)
```

- [ ] **Step 5: Run green** — `pytest tests/test_api_sync.py` → 3 passed.

- [ ] **Step 6: Commit**

```bash
git add app/api.py app/main.py tests/test_api_sync.py
git commit -q -m "feat: /api/sync + item list/get endpoints"
```

---

## Task 10: API — claim + outcome (executor lifecycle)

**Files:** Modify `app/api.py`; create `tests/test_api_lifecycle.py`.

- [ ] **Step 1: Write the failing test** — `tests/test_api_lifecycle.py`:

```python
import app.auth as auth
from app.models import ChangeEvent, ChangeAttempt, ChangeItem

H = {"Authorization": "Bearer t"}
ESC = {
    "proposal_id": "571:r1", "instance": "prod",
    "target": {"provider": "coolify", "resource_type": "application", "uuid": "a1", "name": "app1"},
    "risk": "caution", "kind": "remediation", "reasoning": "rule #571",
    "plan": {"root_cause": "x"}, "note": None,
}
BODY = {"generated_at": "t", "source_report": "2026-06-14.json", "escalations": [ESC]}


def _approved(client, db):
    auth.settings.m2m_token = "t"
    client.post("/api/sync", json=BODY, headers=H)
    it = db.query(ChangeItem).one()
    it.status = "approved"; db.commit()
    return it.id


def test_claim_flips_approved_to_in_progress_then_409_on_second(client, db):
    iid = _approved(client, db)
    assert client.post(f"/api/items/{iid}/claim", headers=H).status_code == 200
    assert db.get(ChangeItem, iid).status == "in_progress"
    assert client.post(f"/api/items/{iid}/claim", headers=H).status_code == 409  # not approved anymore


def test_outcome_records_attempt_and_transitions(client, db):
    iid = _approved(client, db)
    client.post(f"/api/items/{iid}/claim", headers=H)
    r = client.post(f"/api/items/{iid}/outcome", headers=H,
                    json={"outcome": "done", "detail": "applied", "tool_calls": {"calls": []}})
    assert r.status_code == 200
    assert db.get(ChangeItem, iid).status == "done"
    assert db.query(ChangeAttempt).filter_by(item_id=iid).count() == 1
    assert db.query(ChangeEvent).filter_by(item_id=iid, event_type="attempt_done").count() == 1


def test_outcome_blocked_sets_blocked(client, db):
    iid = _approved(client, db)
    client.post(f"/api/items/{iid}/claim", headers=H)
    client.post(f"/api/items/{iid}/outcome", headers=H, json={"outcome": "blocked", "detail": "no S3"})
    assert db.get(ChangeItem, iid).status == "blocked"
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Append to `app/api.py`**

```python
from datetime import datetime, timezone

from app.events import record_event
from app.models import ChangeAttempt
from app.schemas import OutcomeIn

# outcome → resulting item status + the event type to record
_OUTCOME_STATUS = {
    "done": ("done", "attempt_done"),
    "failed": ("failed", "attempt_failed"),
    "blocked": ("blocked", "attempt_blocked"),
    "skipped_conformant": ("resolved", "resolved"),
}


@router.post("/items/{item_id}/claim")
def claim(item_id: int, db: Session = Depends(get_db)) -> dict:
    it = db.get(ChangeItem, item_id)
    if it is None:
        raise HTTPException(status_code=404, detail="not found")
    if it.status != "approved":
        raise HTTPException(status_code=409, detail=f"not approved (status={it.status})")
    it.status = "in_progress"
    record_event(db, it, actor="executor", event_type="claimed",
                 from_status="approved", to_status="in_progress")
    db.commit()
    return _item_dict(it)


@router.post("/items/{item_id}/outcome")
def outcome(item_id: int, body: OutcomeIn, db: Session = Depends(get_db)) -> dict:
    it = db.get(ChangeItem, item_id)
    if it is None:
        raise HTTPException(status_code=404, detail="not found")
    if body.outcome not in _OUTCOME_STATUS:
        raise HTTPException(status_code=422, detail=f"unknown outcome {body.outcome}")
    new_status, event_type = _OUTCOME_STATUS[body.outcome]
    now = datetime.now(timezone.utc)
    attempt = ChangeAttempt(item_id=it.id, started_at=now, finished_at=now,
                            outcome=body.outcome, detail=body.detail,
                            tool_calls=body.tool_calls, rollback=body.rollback)
    db.add(attempt)
    db.flush()
    prev = it.status
    it.status = new_status
    record_event(db, it, actor="executor", event_type=event_type,
                 from_status=prev, to_status=new_status, detail=body.detail, attempt_id=attempt.id)
    db.commit()
    return _item_dict(it)
```

- [ ] **Step 4: Run green** — `pytest tests/test_api_lifecycle.py` → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/api.py tests/test_api_lifecycle.py
git commit -q -m "feat: claim (409 guard) + outcome endpoints with attempt + event"
```

---

## Task 11: API — decision transitions (approve/defer/wontfix/reactivate)

**Files:** Modify `app/api.py`; create `tests/test_api_decisions.py`.

- [ ] **Step 1: Write the failing test** — `tests/test_api_decisions.py`:

```python
import app.auth as auth
from app.models import ChangeEvent, ChangeItem

H = {"Authorization": "Bearer t"}
ESC = {"proposal_id": "571:r1", "instance": "prod",
       "target": {"provider": "coolify", "resource_type": "application", "uuid": "a1", "name": "app1"},
       "risk": "caution", "kind": "remediation", "reasoning": "r", "plan": {}, "note": None}
BODY = {"generated_at": "t", "source_report": "r.json", "escalations": [ESC]}
DEC = {"actor": "user:devon@x"}


def _pending(client, db):
    auth.settings.m2m_token = "t"
    client.post("/api/sync", json=BODY, headers=H)
    return db.query(ChangeItem).one().id


def test_approve_sets_approved_with_decider(client, db):
    iid = _pending(client, db)
    assert client.post(f"/api/items/{iid}/approve", json=DEC, headers=H).status_code == 200
    it = db.get(ChangeItem, iid)
    assert it.status == "approved"
    assert it.decided_by == "user:devon@x"
    assert db.query(ChangeEvent).filter_by(item_id=iid, event_type="approved").count() == 1


def test_defer_and_wontfix(client, db):
    iid = _pending(client, db)
    client.post(f"/api/items/{iid}/defer", json=DEC, headers=H)
    assert db.get(ChangeItem, iid).status == "deferred"
    client.post(f"/api/items/{iid}/wontfix", json=DEC, headers=H)
    assert db.get(ChangeItem, iid).status == "wontfix"


def test_reactivate_only_from_wontfix(client, db):
    iid = _pending(client, db)
    # not wontfix yet → 409
    assert client.post(f"/api/items/{iid}/reactivate", json=DEC, headers=H).status_code == 409
    client.post(f"/api/items/{iid}/wontfix", json=DEC, headers=H)
    assert client.post(f"/api/items/{iid}/reactivate", json=DEC, headers=H).status_code == 200
    it = db.get(ChangeItem, iid)
    assert it.status == "pending"
    assert db.query(ChangeEvent).filter_by(item_id=iid, event_type="reactivated").count() == 1
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Append to `app/api.py`**

```python
from app.schemas import DecisionIn


def _decide(db: Session, item_id: int, body: DecisionIn, new_status: str, event_type: str) -> dict:
    it = db.get(ChangeItem, item_id)
    if it is None:
        raise HTTPException(status_code=404, detail="not found")
    prev = it.status
    it.status = new_status
    it.decided_by = body.actor
    it.decided_at = datetime.now(timezone.utc)
    record_event(db, it, actor=body.actor, event_type=event_type,
                 from_status=prev, to_status=new_status, detail=body.detail)
    db.commit()
    return _item_dict(it)


@router.post("/items/{item_id}/approve")
def approve(item_id: int, body: DecisionIn, db: Session = Depends(get_db)) -> dict:
    return _decide(db, item_id, body, "approved", "approved")


@router.post("/items/{item_id}/defer")
def defer(item_id: int, body: DecisionIn, db: Session = Depends(get_db)) -> dict:
    return _decide(db, item_id, body, "deferred", "deferred")


@router.post("/items/{item_id}/wontfix")
def wontfix(item_id: int, body: DecisionIn, db: Session = Depends(get_db)) -> dict:
    return _decide(db, item_id, body, "wontfix", "wontfixed")


@router.post("/items/{item_id}/reactivate")
def reactivate(item_id: int, body: DecisionIn, db: Session = Depends(get_db)) -> dict:
    it = db.get(ChangeItem, item_id)
    if it is None:
        raise HTTPException(status_code=404, detail="not found")
    if it.status != "wontfix":
        raise HTTPException(status_code=409, detail=f"reactivate only from wontfix (status={it.status})")
    return _decide(db, item_id, body, "pending", "reactivated")
```

- [ ] **Step 4: Run green** — `pytest tests/test_api_decisions.py` → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/api.py tests/test_api_decisions.py
git commit -q -m "feat: approve/defer/wontfix/reactivate decision endpoints"
```

---

## Task 12: API — window-runs + full suite + push

**Files:** Modify `app/api.py`; create `tests/test_api_windows.py`; create `README.md`; push to GitHub.

- [ ] **Step 1: Write the failing test** — `tests/test_api_windows.py`:

```python
import app.auth as auth

H = {"Authorization": "Bearer t"}


def test_create_then_finish_window_run(client):
    auth.settings.m2m_token = "t"
    r = client.post("/api/window-runs", headers=H, json={"started_at": "2026-06-14T04:00:00Z"})
    assert r.status_code == 200
    wid = r.json()["id"]
    assert r.json()["status"] == "running"
    p = client.patch(f"/api/window-runs/{wid}", headers=H,
                     json={"status": "done", "considered": 3, "applied": 1, "failed": 0,
                           "blocked": 2, "skipped": 0, "report_md": "# digest"})
    assert p.status_code == 200
    assert p.json()["status"] == "done" and p.json()["applied"] == 1
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Append to `app/api.py`** (add a `WindowStart`/`WindowPatch` schema inline or in `schemas.py`; shown here inline for locality):

```python
from pydantic import BaseModel

from app.models import WindowRun


class WindowStart(BaseModel):
    started_at: str  # ISO; stored as-is via fromisoformat


class WindowPatch(BaseModel):
    status: str | None = None
    considered: int | None = None
    applied: int | None = None
    failed: int | None = None
    blocked: int | None = None
    skipped: int | None = None
    report_md: str | None = None


def _window_dict(w: WindowRun) -> dict:
    return {"id": w.id, "status": w.status, "considered": w.considered, "applied": w.applied,
            "failed": w.failed, "blocked": w.blocked, "skipped": w.skipped}


@router.post("/window-runs")
def create_window(body: WindowStart, db: Session = Depends(get_db)) -> dict:
    started = datetime.fromisoformat(body.started_at.replace("Z", "+00:00"))
    w = WindowRun(started_at=started, status="running")
    db.add(w)
    db.commit()
    return _window_dict(w)


@router.patch("/window-runs/{window_id}")
def patch_window(window_id: int, body: WindowPatch, db: Session = Depends(get_db)) -> dict:
    w = db.get(WindowRun, window_id)
    if w is None:
        raise HTTPException(status_code=404, detail="not found")
    for field in ("status", "considered", "applied", "failed", "blocked", "skipped", "report_md"):
        val = getattr(body, field)
        if val is not None:
            setattr(w, field, val)
    if body.status in {"done", "error"}:
        w.finished_at = datetime.now(timezone.utc)
    db.commit()
    return _window_dict(w)
```

- [ ] **Step 4: Run green** — `pytest tests/test_api_windows.py` → 1 passed.

- [ ] **Step 5: Write `README.md`** (short: what it is, `pip install -e ".[dev]"`, `pytest`, `uvicorn app.main:app --reload`, env vars `DATABASE_URL`/`M2M_TOKEN`, "GUI + deploy land in plans 2b/2c").

- [ ] **Step 6: Run the FULL suite + commit**

```bash
pytest
git add app/api.py tests/test_api_windows.py README.md
git commit -q -m "feat: window-runs endpoints; README"
```
Expected: all tests pass (health, identity, models, migration, events, schemas, reconcile, auth, sync, lifecycle, decisions, windows).

- [ ] **Step 7: Create the GitHub repo + push** (only when the user confirms)

```bash
gh repo create alobarquest/change-manager --private --source=. --remote=origin
git push -u origin main
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** data model — all four tables (Task 3) + migration (Task 4); reconciliation rules — every branch in the spec's §Reconciliation (Task 7); API — `/api/sync` (9), items list/get (9), claim with 409 (10), outcome→attempt+event (10), approve/defer/wontfix/reactivate (11), window-runs (12), `/api/health` (1), M2M auth on all `/api/*` (8, applied via the router dependency in 9); history events on every transition (events.py + each endpoint). GUI + SSO + deploy are explicitly plans 2b/2c, not here.
- **Type/name consistency:** `_item_dict`, `record_event`, `reconcile`, `stable_identity`/`rule_key_of`, `require_m2m`, the `_OUTCOME_STATUS`/`_decide` helpers, and the `SyncRequest`/`EscalationIn`/`OutcomeIn`/`DecisionIn` schemas are defined once and reused; the router carries `Depends(require_m2m)` so every `/api/*` route inherits auth (sync test asserts the 401).
- **Placeholder scan:** none — every code step is complete and runnable.
- **Known soft spots:** (1) the M2M tests mutate `auth.settings.m2m_token` directly — acceptable for unit tests; 2b/2c wire the real token from env. (2) `WindowStart`/`WindowPatch` are defined inline in `api.py` for locality; move to `schemas.py` if it grows. (3) tests use SQLite; the one Postgres-specific concern (the `identity` unique index) is exercised by the migration test (Task 4) and the unique constraint holds on both engines.
