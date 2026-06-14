# Change Manager — Plan 2b: Review GUI + Alobar ID SSO

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the human-facing review surface to the `change-manager` app: an HTMX dashboard to review escalations and approve/defer/wontfix/reactivate them, an item-detail page with the full event history, and window-run history — all behind Alobar ID (Authentik) forward-auth SSO, with the authenticated email recorded as the decider.

**Architecture:** A new `app/web.py` router (server-rendered Jinja + HTMX), separate from the M2M-protected `/api/*` router. SSO identity arrives as a forward-auth header (Authentik sets `X-authentik-email`); a `current_user` dependency reads it (with a dev fallback). The status-transition logic is extracted from `api.py` into `app/transitions.py` so the GUI and API share one implementation. GUI actions return an HTMX row fragment that swaps in place.

**Tech Stack:** FastAPI, Jinja2 (`Jinja2Templates`), HTMX (CDN), the existing SQLAlchemy models/events. Builds on Plan 2a (the repo `~/Projects/change-manager`, GitHub `alobarquest/change-manager`).

**Spec:** `docs/superpowers/specs/2026-06-14-change-manager-design.md` → "Sub-project A — the web app" (GUI pages + Auth).

**Conventions:**
- Repo `~/Projects/change-manager`; venv `.venv`. Run tests via `cd ~/Projects/change-manager && ./.venv/bin/python -m pytest`.
- TDD; commit after each task; push to `origin/main` at the end.
- Existing tests (28) must stay green — the Task 1 refactor is guarded by them.
- The exact Authentik forward-auth header + the Traefik middleware are wired in Plan 2c; here the header name is **configurable** so 2b doesn't hard-depend on the SSO deployment.

---

## File Structure

| File | Change |
|---|---|
| `app/transitions.py` (**new**) | `decide()`, `reactivate()`, `TransitionError` — the shared status-transition service. |
| `app/api.py` (**modify**) | Decision + reactivate routes call `transitions.*` instead of the inline `_decide`. |
| `app/config.py` (**modify**) | Add `sso_user_header` + `dev_user` settings. |
| `app/web_auth.py` (**new**) | `current_user(request)` dependency (SSO header → email; dev fallback; 401). |
| `app/templates_env.py` (**new**) | `templates = Jinja2Templates("app/templates")`. |
| `app/web.py` (**new**) | The GUI router: `/`, `/items/{id}`, `/items/{id}/{action}`, `/windows`. |
| `app/templates/*.html` (**new**) | `base.html`, `dashboard.html`, `item_detail.html`, `_row.html`, `windows.html`. |
| `app/main.py` (**modify**) | Mount the web router. |
| `tests/test_*.py` (**new**) | `test_transitions.py`, `test_web_auth.py`, `test_web.py`. |

---

## Task 1: Extract the transition service (DRY refactor)

**Files:** Create `app/transitions.py`, `tests/test_transitions.py`; modify `app/api.py`.

- [ ] **Step 1: Write the failing test** — `tests/test_transitions.py`:

```python
from datetime import datetime, timezone

import pytest

from app.models import ChangeEvent, ChangeItem
from app.transitions import TransitionError, decide, reactivate


def _item(db, status):
    it = ChangeItem(identity="prod::571::a1", instance="prod", rule_key="571", resource_uuid="a1",
                    resource_name="app1", risk="caution", kind="remediation", reasoning="r", plan={},
                    status=status, first_seen_at=datetime.now(timezone.utc),
                    last_seen_at=datetime.now(timezone.utc))
    db.add(it); db.flush(); return it


def test_decide_sets_status_decider_and_event(db):
    it = _item(db, "pending")
    decide(db, it, actor="user:devon@x", new_status="approved", event_type="approved")
    assert it.status == "approved"
    assert it.decided_by == "user:devon@x"
    assert it.decided_at is not None
    assert db.query(ChangeEvent).filter_by(item_id=it.id, event_type="approved").count() == 1


def test_reactivate_requires_wontfix(db):
    it = _item(db, "pending")
    with pytest.raises(TransitionError):
        reactivate(db, it, actor="user:devon@x")


def test_reactivate_from_wontfix_goes_pending(db):
    it = _item(db, "wontfix")
    reactivate(db, it, actor="user:devon@x")
    assert it.status == "pending"
    assert db.query(ChangeEvent).filter_by(item_id=it.id, event_type="reactivated").count() == 1
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Implement `app/transitions.py`**

```python
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.events import record_event
from app.models import ChangeItem


class TransitionError(Exception):
    """An invalid status transition (e.g. reactivate from a non-wontfix item)."""


def decide(db: Session, item: ChangeItem, *, actor: str, new_status: str,
           event_type: str, detail: str | None = None) -> None:
    """Apply a human decision: set status + decider + history event. Caller need not commit (we do)."""
    prev = item.status
    item.status = new_status
    item.decided_by = actor
    item.decided_at = datetime.now(timezone.utc)
    record_event(db, item, actor=actor, event_type=event_type,
                 from_status=prev, to_status=new_status, detail=detail)
    db.commit()


def reactivate(db: Session, item: ChangeItem, *, actor: str, detail: str | None = None) -> None:
    """wontfix → pending. Raises TransitionError if the item isn't wontfix."""
    if item.status != "wontfix":
        raise TransitionError(f"reactivate only from wontfix (status={item.status})")
    decide(db, item, actor=actor, new_status="pending", event_type="reactivated", detail=detail)
```

- [ ] **Step 4: Run green** — `./.venv/bin/python -m pytest tests/test_transitions.py` → 3 passed.

- [ ] **Step 5: Refactor `app/api.py` to use the service.** Replace the `_decide` helper and the `reactivate` route body so they delegate to `app.transitions` (keeps the API behavior identical; the 2a decision tests guard it):

Replace the existing `_decide` function with:

```python
from app.transitions import TransitionError, decide as _do_decide, reactivate as _do_reactivate


def _decide(db: Session, item_id: int, body: DecisionIn, new_status: str, event_type: str) -> dict:
    it = db.get(ChangeItem, item_id)
    if it is None:
        raise HTTPException(status_code=404, detail="not found")
    _do_decide(db, it, actor=body.actor, new_status=new_status, event_type=event_type, detail=body.detail)
    return _item_dict(it)
```

And replace the `reactivate` route body with:

```python
@router.post("/items/{item_id}/reactivate")
def reactivate(item_id: int, body: DecisionIn, db: Session = Depends(get_db)) -> dict:
    it = db.get(ChangeItem, item_id)
    if it is None:
        raise HTTPException(status_code=404, detail="not found")
    try:
        _do_reactivate(db, it, actor=body.actor, detail=body.detail)
    except TransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _item_dict(it)
```

(The `approve`/`defer`/`wontfix` routes keep calling `_decide` unchanged.)

- [ ] **Step 6: Run the FULL suite** — `./.venv/bin/python -m pytest` → all green (the 2a API decision/lifecycle tests + the 3 new transition tests).

- [ ] **Step 7: Commit**

```bash
cd ~/Projects/change-manager
git add app/transitions.py app/api.py tests/test_transitions.py
git commit -q -m "refactor: shared transition service used by the API (and soon the GUI)"
```

---

## Task 2: `current_user` SSO dependency

**Files:** Modify `app/config.py`; create `app/web_auth.py`, `tests/test_web_auth.py`.

- [ ] **Step 1: Add settings** — in `app/config.py`, add two fields to `Settings`:

```python
    sso_user_header: str = "x-authentik-email"  # forward-auth header Authentik sets
    dev_user: str = ""  # local-dev fallback identity when no SSO header (empty = disabled)
```

- [ ] **Step 2: Write the failing test** — `tests/test_web_auth.py`:

```python
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

import app.web_auth as wa
from app.web_auth import current_user


def _app():
    app = FastAPI()

    @app.get("/whoami")
    def whoami(user: str = Depends(current_user)):
        return {"user": user}

    return TestClient(app)


def test_reads_user_from_sso_header():
    wa.settings.dev_user = ""
    c = _app()
    r = c.get("/whoami", headers={"X-authentik-email": "devon@x"})
    assert r.status_code == 200 and r.json() == {"user": "devon@x"}


def test_missing_header_no_dev_user_is_401():
    wa.settings.dev_user = ""
    assert _app().get("/whoami").status_code == 401


def test_dev_user_fallback_when_no_header():
    wa.settings.dev_user = "dev@local"
    r = _app().get("/whoami")
    assert r.status_code == 200 and r.json() == {"user": "dev@local"}
```

- [ ] **Step 3: Run red** → FAIL.

- [ ] **Step 4: Implement `app/web_auth.py`**

```python
from fastapi import HTTPException, Request, status

from app.config import settings


def current_user(request: Request) -> str:
    """The SSO-authenticated email from the forward-auth header, or the dev fallback. 401 if neither."""
    email = request.headers.get(settings.sso_user_header, "").strip()
    if email:
        return email
    if settings.dev_user:
        return settings.dev_user
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated (SSO)")
```

- [ ] **Step 5: Run green** → 3 passed.

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/change-manager
git add app/config.py app/web_auth.py tests/test_web_auth.py
git commit -q -m "feat: current_user SSO dependency (forward-auth header + dev fallback)"
```

---

## Task 3: Templates + dashboard route

**Files:** Create `app/templates_env.py`, `app/web.py`, `app/templates/{base,dashboard,_row}.html`; modify `app/main.py`; create `tests/test_web.py`.

- [ ] **Step 1: Write the failing test** — `tests/test_web.py`:

```python
import app.web_auth as wa
from app.models import ChangeItem

SSO = {"X-authentik-email": "devon@x"}
ESC = {"proposal_id": "571:r1", "instance": "prod",
       "target": {"provider": "coolify", "resource_type": "application", "uuid": "a1", "name": "app1"},
       "risk": "caution", "kind": "remediation", "reasoning": "needs https", "plan": {"root_cause": "x"},
       "note": None}
BODY = {"generated_at": "t", "source_report": "r.json", "escalations": [ESC]}
APIH = {"Authorization": "Bearer t"}


def _seed(client):
    import app.auth as auth
    auth.settings.m2m_token = "t"
    wa.settings.dev_user = ""
    client.post("/api/sync", json=BODY, headers=APIH)


def test_dashboard_requires_sso(client):
    _seed(client)
    assert client.get("/").status_code == 401


def test_dashboard_lists_items(client):
    _seed(client)
    r = client.get("/", headers=SSO)
    assert r.status_code == 200
    assert "app1" in r.text          # the resource shows up
    assert "needs https" in r.text   # its reasoning
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Implement `app/templates_env.py`**

```python
from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory="app/templates")
```

- [ ] **Step 4: Create `app/templates/base.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Change Manager</title>
  <script src="https://unpkg.com/htmx.org@1.9.12"></script>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
    h1 { font-size: 1.4rem; } a { color: #2563eb; }
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #eee; font-size: .9rem; }
    .tabs a { margin-right: .8rem; } .tabs a.active { font-weight: 700; }
    .badge { padding: .1rem .45rem; border-radius: .35rem; font-size: .75rem; background: #eef; }
    button { cursor: pointer; }
  </style>
</head>
<body>
  <h1><a href="/">Change Manager</a> <span class="badge">{{ user }}</span></h1>
  {% block content %}{% endblock %}
</body>
</html>
```

- [ ] **Step 5: Create `app/templates/_row.html`** (the per-item table row; returned standalone after an HTMX action)

```html
<tr id="item-{{ it.id }}">
  <td>{{ it.instance }}</td>
  <td><a href="/items/{{ it.id }}">{{ it.resource_name }}</a></td>
  <td>{{ it.rule_key }}</td>
  <td><span class="badge">{{ it.risk }}</span></td>
  <td><span class="badge">{{ it.status }}</span></td>
  <td>
    {% if it.status in ["pending", "deferred"] %}
      <button hx-post="/items/{{ it.id }}/approve" hx-target="#item-{{ it.id }}" hx-swap="outerHTML">Approve</button>
      <button hx-post="/items/{{ it.id }}/defer"   hx-target="#item-{{ it.id }}" hx-swap="outerHTML">Defer</button>
      <button hx-post="/items/{{ it.id }}/wontfix" hx-target="#item-{{ it.id }}" hx-swap="outerHTML">Won't-fix</button>
    {% elif it.status == "wontfix" %}
      <button hx-post="/items/{{ it.id }}/reactivate" hx-target="#item-{{ it.id }}" hx-swap="outerHTML">Reactivate</button>
    {% endif %}
  </td>
</tr>
```

- [ ] **Step 6: Create `app/templates/dashboard.html`**

```html
{% extends "base.html" %}
{% block content %}
<p class="tabs">
  {% for t in ["pending","approved","blocked","done","wontfix","resolved","all"] %}
    <a href="/?status={{ t }}" class="{{ 'active' if t == current_status else '' }}">{{ t }}</a>
  {% endfor %}
</p>
<table>
  <thead><tr><th>Instance</th><th>Resource</th><th>Rule</th><th>Risk</th><th>Status</th><th>Actions</th></tr></thead>
  <tbody>
    {% for it in items %}{% include "_row.html" %}{% endfor %}
    {% if not items %}<tr><td colspan="6"><em>nothing here</em></td></tr>{% endif %}
  </tbody>
</table>
{% endblock %}
```

- [ ] **Step 7: Implement `app/web.py`**

```python
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ChangeItem
from app.templates_env import templates
from app.web_auth import current_user

router = APIRouter()


@router.get("/")
def dashboard(
    request: Request,
    status: str = Query(default="pending"),
    user: str = Depends(current_user),
    db: Session = Depends(get_db),
):
    stmt = select(ChangeItem).order_by(ChangeItem.id)
    if status != "all":
        stmt = stmt.where(ChangeItem.status == status)
    items = db.scalars(stmt).all()
    return templates.TemplateResponse(
        request, "dashboard.html",
        {"items": items, "current_status": status, "user": user},
    )
```

- [ ] **Step 8: Mount the web router** — in `app/main.py`, add (after the api router include):

```python
from app.web import router as web_router

app.include_router(web_router)
```

- [ ] **Step 9: Run green** — `./.venv/bin/python -m pytest tests/test_web.py` → 2 passed. Then full suite → all green.

- [ ] **Step 10: Commit**

```bash
cd ~/Projects/change-manager
git add app/templates_env.py app/web.py app/templates/ app/main.py tests/test_web.py
git commit -q -m "feat: SSO dashboard (HTMX) listing escalations by status"
```

---

## Task 4: Item detail + event history

**Files:** Create `app/templates/item_detail.html`; modify `app/web.py`; add to `tests/test_web.py`.

- [ ] **Step 1: Append the failing test** — add to `tests/test_web.py`:

```python
def test_item_detail_shows_plan_and_history(client, db):
    _seed(client)
    iid = db.query(ChangeItem).one().id
    r = client.get(f"/items/{iid}", headers=SSO)
    assert r.status_code == 200
    assert "needs https" in r.text          # reasoning
    assert "ingested" in r.text             # the sync event in the history timeline


def test_item_detail_404(client):
    _seed(client)
    assert client.get("/items/9999", headers=SSO).status_code == 404
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Create `app/templates/item_detail.html`**

```html
{% extends "base.html" %}
{% block content %}
<p><a href="/">&larr; back</a></p>
<h2>{{ it.resource_type }} '{{ it.resource_name }}' <span class="badge">{{ it.status }}</span></h2>
<p><strong>Instance:</strong> {{ it.instance }} &middot; <strong>Rule:</strong> {{ it.rule_key }}
   &middot; <strong>Risk:</strong> {{ it.risk }} &middot; <strong>Kind:</strong> {{ it.kind }}</p>
<p><strong>Why:</strong> {{ it.reasoning }}</p>
{% if it.note %}<p><strong>Auto-fix held:</strong> {{ it.note }}</p>{% endif %}

<h3>Plan</h3>
<p><strong>Root cause:</strong> {{ it.plan.get("root_cause", "—") }}</p>
{% if it.plan.get("steps") %}<ol>{% for s in it.plan["steps"] %}<li>{{ s }}</li>{% endfor %}</ol>{% endif %}
<p><strong>Tools:</strong> {{ (it.plan.get("infraops_tools") or []) | join(", ") or "—" }}</p>
<p><strong>Rollback:</strong> {{ it.plan.get("rollback", "—") }} &middot;
   <strong>Window hint:</strong> {{ it.plan.get("cm_window_hint", "—") }}</p>

<h3>History</h3>
<table>
  <thead><tr><th>When</th><th>Actor</th><th>Event</th><th>From → To</th><th>Detail</th></tr></thead>
  <tbody>
    {% for ev in events %}
    <tr><td>{{ ev.at }}</td><td>{{ ev.actor }}</td><td>{{ ev.event_type }}</td>
        <td>{{ ev.from_status or "" }} &rarr; {{ ev.to_status or "" }}</td><td>{{ ev.detail or "" }}</td></tr>
    {% endfor %}
  </tbody>
</table>
{% endblock %}
```

- [ ] **Step 4: Add the route to `app/web.py`**

```python
from fastapi import HTTPException

from app.models import ChangeEvent


@router.get("/items/{item_id}")
def item_detail(
    request: Request, item_id: int,
    user: str = Depends(current_user), db: Session = Depends(get_db),
):
    it = db.get(ChangeItem, item_id)
    if it is None:
        raise HTTPException(status_code=404, detail="not found")
    events = db.scalars(
        select(ChangeEvent).where(ChangeEvent.item_id == item_id).order_by(ChangeEvent.id)
    ).all()
    return templates.TemplateResponse(
        request, "item_detail.html", {"it": it, "events": events, "user": user},
    )
```

- [ ] **Step 5: Run green** — `./.venv/bin/python -m pytest tests/test_web.py` → 4 passed. Full suite → green.

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/change-manager
git add app/web.py app/templates/item_detail.html tests/test_web.py
git commit -q -m "feat: item detail page with plan + event-history timeline"
```

---

## Task 5: HTMX decision actions

**Files:** Modify `app/web.py`; add to `tests/test_web.py`.

- [ ] **Step 1: Append the failing test** — add to `tests/test_web.py`:

```python
from app.models import ChangeEvent


def test_approve_action_transitions_and_records_sso_user(client, db):
    _seed(client)
    iid = db.query(ChangeItem).one().id
    r = client.post(f"/items/{iid}/approve", headers=SSO)
    assert r.status_code == 200
    assert f'id="item-{iid}"' in r.text              # returns the swapped row fragment
    it = db.get(ChangeItem, iid)
    assert it.status == "approved"
    assert it.decided_by == "devon@x"                 # the SSO email, not a literal
    assert db.query(ChangeEvent).filter_by(item_id=iid, event_type="approved").count() == 1


def test_wontfix_then_reactivate_via_gui(client, db):
    _seed(client)
    iid = db.query(ChangeItem).one().id
    client.post(f"/items/{iid}/wontfix", headers=SSO)
    assert db.get(ChangeItem, iid).status == "wontfix"
    r = client.post(f"/items/{iid}/reactivate", headers=SSO)
    assert r.status_code == 200
    assert db.get(ChangeItem, iid).status == "pending"


def test_unknown_action_is_400(client, db):
    _seed(client)
    iid = db.query(ChangeItem).one().id
    assert client.post(f"/items/{iid}/bogus", headers=SSO).status_code == 400


def test_reactivate_non_wontfix_is_409(client, db):
    _seed(client)
    iid = db.query(ChangeItem).one().id  # pending
    assert client.post(f"/items/{iid}/reactivate", headers=SSO).status_code == 409
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Add the action route to `app/web.py`** (imports: `from app.transitions import TransitionError, decide, reactivate as do_reactivate`):

```python
_ACTIONS = {  # gui action → (new_status, event_type)
    "approve": ("approved", "approved"),
    "defer": ("deferred", "deferred"),
    "wontfix": ("wontfix", "wontfixed"),
}


@router.post("/items/{item_id}/{action}")
def item_action(
    request: Request, item_id: int, action: str,
    user: str = Depends(current_user), db: Session = Depends(get_db),
):
    it = db.get(ChangeItem, item_id)
    if it is None:
        raise HTTPException(status_code=404, detail="not found")
    if action == "reactivate":
        try:
            do_reactivate(db, it, actor=user)
        except TransitionError as e:
            raise HTTPException(status_code=409, detail=str(e))
    elif action in _ACTIONS:
        new_status, event_type = _ACTIONS[action]
        decide(db, it, actor=user, new_status=new_status, event_type=event_type)
    else:
        raise HTTPException(status_code=400, detail=f"unknown action {action}")
    return templates.TemplateResponse(request, "_row.html", {"it": it, "user": user})
```

- [ ] **Step 4: Run green** — `./.venv/bin/python -m pytest tests/test_web.py` → 8 passed. Full suite → green.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/change-manager
git add app/web.py tests/test_web.py
git commit -q -m "feat: HTMX approve/defer/wontfix/reactivate actions (records SSO user)"
```

---

## Task 6: Window-run history page

**Files:** Create `app/templates/windows.html`; modify `app/web.py`; add to `tests/test_web.py`.

- [ ] **Step 1: Append the failing test** — add to `tests/test_web.py`:

```python
def test_windows_page_lists_runs(client, db):
    _seed(client)
    client.post("/api/window-runs", headers=APIH, json={"started_at": "2026-06-14T04:00:00Z"})
    r = client.get("/windows", headers=SSO)
    assert r.status_code == 200
    assert "running" in r.text


def test_windows_requires_sso(client):
    _seed(client)
    assert client.get("/windows").status_code == 401
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Create `app/templates/windows.html`**

```html
{% extends "base.html" %}
{% block content %}
<p><a href="/">&larr; back</a></p>
<h2>Window runs</h2>
<table>
  <thead><tr><th>Started</th><th>Finished</th><th>Status</th><th>Considered</th>
             <th>Applied</th><th>Failed</th><th>Blocked</th><th>Skipped</th></tr></thead>
  <tbody>
    {% for w in runs %}
    <tr><td>{{ w.started_at }}</td><td>{{ w.finished_at or "" }}</td>
        <td><span class="badge">{{ w.status }}</span></td>
        <td>{{ w.considered }}</td><td>{{ w.applied }}</td><td>{{ w.failed }}</td>
        <td>{{ w.blocked }}</td><td>{{ w.skipped }}</td></tr>
    {% endfor %}
    {% if not runs %}<tr><td colspan="8"><em>no runs yet</em></td></tr>{% endif %}
  </tbody>
</table>
{% endblock %}
```

- [ ] **Step 4: Add the route to `app/web.py`** (import `from app.models import WindowRun`):

```python
@router.get("/windows")
def windows(request: Request, user: str = Depends(current_user), db: Session = Depends(get_db)):
    runs = db.scalars(select(WindowRun).order_by(WindowRun.id.desc())).all()
    return templates.TemplateResponse(request, "windows.html", {"runs": runs, "user": user})
```

NOTE: register this route in `web.py` **above** the `/items/{item_id}/{action}` and `/items/{item_id}` routes is not required (different path), but ensure `/windows` is a distinct path — it is. No ordering conflict.

- [ ] **Step 5: Run green** — `./.venv/bin/python -m pytest tests/test_web.py` → 10 passed. Full suite → green.

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/change-manager
git add app/web.py app/templates/windows.html tests/test_web.py
git commit -q -m "feat: window-run history page"
```

---

## Task 7: Full verification + push

**Files:** none (verification + push).

- [ ] **Step 1: Full suite** — `cd ~/Projects/change-manager && ./.venv/bin/python -m pytest` → all green. Note the count (should be 28 from 2a + the new transition/web_auth/web tests).

- [ ] **Step 2: Smoke-boot the app** — confirm it imports and the routes are wired:

```bash
./.venv/bin/python -c "from app.main import app; print(sorted({r.path for r in app.routes}))"
```
Expected: includes `/`, `/items/{item_id}`, `/items/{item_id}/{action}`, `/windows`, plus the `/api/*` routes and `/api/health`.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** dashboard with status filters (Task 3); item detail + full event-history timeline (Task 4); approve/defer/wontfix/reactivate as HTMX actions recording the SSO email as `decided_by` (Task 5); window-run history (Task 6); Alobar ID forward-auth via `current_user` enforced on every GUI route, with the M2M `/api/*` path untouched (Task 2 + router separation); the shared transition service removes the API/GUI duplication (Task 1).
- **Type/name consistency:** `decide`/`reactivate`/`TransitionError` (transitions.py) are used by both `api.py` (Task 1) and `web.py` (Task 5); `current_user` returns the email string used as `actor`/`decided_by`; templates reference `it`, `items`, `events`, `runs`, `user`, `current_status` consistently with what the routes pass; `_row.html` is rendered both inside `dashboard.html` (loop) and standalone (action response) with the same `it`/`user` context.
- **Placeholder scan:** none — full code + templates for every step.
- **Known soft spots:** (1) HTMX is loaded from the unpkg CDN — fine for an internal SSO-gated tool; vendoring is a trivial later swap. (2) The GUI action route `/items/{item_id}/{action}` is intentionally generic (validates `action` against an allowlist, 400 otherwise) — keeps one handler instead of four. (3) The actual Authentik header name + Traefik forward-auth middleware are finalized in Plan 2c; `sso_user_header` is configurable so a different header needs only an env change, not code.
