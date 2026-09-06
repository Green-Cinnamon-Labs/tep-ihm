"""
persistence.py — SQLite persistence for TEP time series capture sessions.

Flow:
  1. create_session(name)          → creates container, no recording
  2. add_chart_capture(sid, ...)   → adds chart with selected vars
  3. start_recording(session_id)   → begins writing metrics
  4. stop_session()                → ends recording
"""

import csv as csv_mod
import io
import json
import sqlite3
import time
from collections import defaultdict
from pathlib import Path
from typing import Optional

SQLITE_DB_PATH = Path("/data/sessions.db")

_conn: Optional[sqlite3.Connection]  = None
_active_session_id: Optional[int]    = None
_active_charts: list                  = []   # [{chart_id, selected_vars}]
_data_source_id: Optional[int]        = None
_last_append_wall: float              = 0.0


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        SQLITE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(str(SQLITE_DB_PATH), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA foreign_keys=ON")
    return _conn


def _migrate(conn: sqlite3.Connection) -> None:
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "chart_capture" not in tables:
        conn.executescript("DROP TABLE IF EXISTS metrics; DROP TABLE IF EXISTS capture_session;")
        conn.commit()
        return
    # Add recording_at column if the table exists but was created before this column
    cols = {r[1] for r in conn.execute("PRAGMA table_info(capture_session)")}
    if "recording_at" not in cols:
        conn.execute("ALTER TABLE capture_session ADD COLUMN recording_at INTEGER")
        conn.commit()


def init_db(db_path: Optional[str] = None) -> None:
    global SQLITE_DB_PATH
    if db_path:
        SQLITE_DB_PATH = Path(db_path)
    conn = _get_conn()
    _migrate(conn)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS data_source (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'opcua',
            address     TEXT NOT NULL,
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS capture_session (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            data_source_id INTEGER NOT NULL REFERENCES data_source(id),
            name           TEXT NOT NULL,
            description    TEXT DEFAULT '',
            started_at     INTEGER NOT NULL,
            recording_at   INTEGER,
            ended_at       INTEGER,
            t_h_start      REAL,
            t_h_end        REAL,
            notes          TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS chart_capture (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id    INTEGER NOT NULL REFERENCES capture_session(id),
            label         TEXT NOT NULL DEFAULT 'Chart',
            selected_vars TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS metrics (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            chart_id INTEGER NOT NULL REFERENCES chart_capture(id),
            t_h      REAL NOT NULL,
            ts_wall  INTEGER NOT NULL,
            data     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_metrics_chart_th ON metrics(chart_id, t_h);
    """)
    conn.commit()


def get_or_create_data_source(name: str, source_type: str, address: str) -> int:
    global _data_source_id
    conn = _get_conn()
    row = conn.execute(
        "SELECT id FROM data_source WHERE source_type=? AND address=? ORDER BY created_at DESC LIMIT 1",
        (source_type, address),
    ).fetchone()
    if row:
        _data_source_id = row["id"]
        return _data_source_id
    cur = conn.execute(
        "INSERT INTO data_source (name, source_type, address, created_at) VALUES (?,?,?,?)",
        (name, source_type, address, int(time.time())),
    )
    conn.commit()
    _data_source_id = cur.lastrowid
    return _data_source_id


# ── Step 1: create session (no recording) ─────────────────────────────────────

def create_session(name: str, description: str = "") -> int:
    if _data_source_id is None:
        raise RuntimeError("data_source not initialized")
    conn = _get_conn()
    cur = conn.execute(
        "INSERT INTO capture_session (data_source_id, name, description, started_at) VALUES (?,?,?,?)",
        (_data_source_id, name, description, int(time.time())),
    )
    conn.commit()
    return cur.lastrowid


# ── Step 2: add / remove chart captures ───────────────────────────────────────

def add_chart_capture(session_id: int, label: str, selected_vars: list) -> dict:
    conn = _get_conn()
    cur = conn.execute(
        "INSERT INTO chart_capture (session_id, label, selected_vars) VALUES (?,?,?)",
        (session_id, label, json.dumps(selected_vars)),
    )
    conn.commit()
    return {"id": cur.lastrowid, "session_id": session_id,
            "label": label, "selected_vars": selected_vars}


def remove_chart_capture(chart_id: int) -> bool:
    conn = _get_conn()
    conn.execute("DELETE FROM metrics WHERE chart_id=?", (chart_id,))
    cur = conn.execute("DELETE FROM chart_capture WHERE id=?", (chart_id,))
    conn.commit()
    return cur.rowcount > 0


# ── Step 3: start / stop recording ────────────────────────────────────────────

def start_recording(session_id: int) -> bool:
    global _active_session_id, _active_charts, _last_append_wall
    if _active_session_id is not None:
        return False
    conn = _get_conn()
    rows = conn.execute(
        "SELECT id, selected_vars FROM chart_capture WHERE session_id=?", (session_id,)
    ).fetchall()
    if not rows:
        return False
    _active_charts = [
        {"chart_id": r["id"], "selected_vars": json.loads(r["selected_vars"])}
        for r in rows
    ]
    conn.execute(
        "UPDATE capture_session SET recording_at=? WHERE id=?",
        (int(time.time()), session_id),
    )
    conn.commit()
    _active_session_id = session_id
    _last_append_wall  = 0.0
    return True


def stop_session() -> Optional[int]:
    global _active_session_id, _active_charts
    if _active_session_id is None:
        return None
    conn = _get_conn()
    conn.execute(
        "UPDATE capture_session SET ended_at=? WHERE id=?",
        (int(time.time()), _active_session_id),
    )
    conn.commit()
    sid = _active_session_id
    _active_session_id = None
    _active_charts     = []
    return sid


# ── Data append ───────────────────────────────────────────────────────────────

def _extract_vars(xmeas: list, xmv: list, var_keys: list) -> dict:
    data = {}
    for key in var_keys:
        parts = key.split("_")
        if len(parts) == 2 and parts[1].isdigit():
            idx = int(parts[1]) - 1
            if key.startswith("xmeas_"):
                data[key] = xmeas[idx] if idx < len(xmeas) else None
            elif key.startswith("xmv_"):
                data[key] = xmv[idx] if idx < len(xmv) else None
    return data


def maybe_append(snapshot: dict) -> bool:
    global _last_append_wall
    if not _active_session_id or not _active_charts:
        return False
    now = time.time()
    if now - _last_append_wall < 1.0:
        return False
    t_h = snapshot.get("t_h")
    if t_h is None:
        # Sem tempo simulado disponível (fonte OPC-UA, ver spec-tennessee-eastman#61) — a coluna
        # metrics.t_h é NOT NULL e não há eixo de tempo pra gravar; descarta a amostra.
        return False
    _last_append_wall = now
    xmeas = snapshot.get("xmeas", [])
    xmv   = snapshot.get("xmv", [])
    conn  = _get_conn()
    for chart in _active_charts:
        data = _extract_vars(xmeas, xmv, chart["selected_vars"])
        conn.execute(
            "INSERT INTO metrics (chart_id, t_h, ts_wall, data) VALUES (?,?,?,?)",
            (chart["chart_id"], t_h, int(now), json.dumps(data)),
        )
    conn.execute(
        "UPDATE capture_session SET t_h_start=COALESCE(t_h_start,?), t_h_end=? WHERE id=?",
        (t_h, t_h, _active_session_id),
    )
    conn.commit()
    return True


# ── Queries ───────────────────────────────────────────────────────────────────

def list_sessions() -> list:
    conn = _get_conn()
    rows = conn.execute("""
        SELECT cs.id, cs.name, cs.description,
               cs.started_at, cs.recording_at, cs.ended_at,
               cs.t_h_start, cs.t_h_end, cs.notes,
               ds.name AS source_name, ds.source_type, ds.address,
               COUNT(DISTINCT cc.id) AS chart_count,
               COUNT(m.id)           AS point_count
        FROM capture_session cs
        JOIN data_source ds ON ds.id = cs.data_source_id
        LEFT JOIN chart_capture cc ON cc.session_id = cs.id
        LEFT JOIN metrics m ON m.chart_id = cc.id
        GROUP BY cs.id
        ORDER BY cs.started_at DESC
    """).fetchall()
    return [dict(r) for r in rows]


def get_session(session_id: int) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute(
        """SELECT cs.*, ds.name AS source_name, ds.source_type, ds.address
           FROM capture_session cs
           JOIN data_source ds ON ds.id = cs.data_source_id
           WHERE cs.id=?""",
        (session_id,),
    ).fetchone()
    return dict(row) if row else None


def list_chart_captures(session_id: int) -> list:
    conn = _get_conn()
    rows = conn.execute(
        """SELECT cc.id, cc.session_id, cc.label, cc.selected_vars,
                  COUNT(m.id) AS point_count
           FROM chart_capture cc
           LEFT JOIN metrics m ON m.chart_id = cc.id
           WHERE cc.session_id=?
           GROUP BY cc.id ORDER BY cc.id""",
        (session_id,),
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["selected_vars"] = json.loads(d["selected_vars"])
        result.append(d)
    return result


def query_history(chart_id: int, from_th: Optional[float] = None,
                  to_th: Optional[float] = None) -> Optional[dict]:
    conn = _get_conn()
    chart = conn.execute(
        "SELECT selected_vars FROM chart_capture WHERE id=?", (chart_id,)
    ).fetchone()
    if not chart:
        return None
    var_keys = json.loads(chart["selected_vars"])
    query    = "SELECT t_h, data FROM metrics WHERE chart_id=?"
    params: list = [chart_id]
    if from_th is not None: query += " AND t_h >= ?"; params.append(from_th)
    if to_th   is not None: query += " AND t_h <= ?"; params.append(to_th)
    query += " ORDER BY t_h"
    rows   = conn.execute(query, params).fetchall()
    labels = []
    series: dict = {k: [] for k in var_keys}
    for row in rows:
        labels.append(round(row["t_h"], 4))
        data = json.loads(row["data"])
        for key in var_keys:
            val = data.get(key)
            series[key].append(round(val, 4) if val is not None else None)
    return {"chart_id": chart_id, "var_keys": var_keys, "labels": labels, "series": series}


def export_csv_str(session_id: int) -> str:
    charts = list_chart_captures(session_id)
    if not charts:
        return ""
    all_keys: list = []
    for chart in charts:
        for k in chart["selected_vars"]:
            if k not in all_keys:
                all_keys.append(k)
    conn = _get_conn()
    data_by_th: dict = defaultdict(dict)
    for chart in charts:
        for row in conn.execute(
            "SELECT t_h, data FROM metrics WHERE chart_id=? ORDER BY t_h", (chart["id"],)
        ).fetchall():
            data_by_th[row["t_h"]].update(json.loads(row["data"]))
    buf    = io.StringIO()
    writer = csv_mod.writer(buf)
    writer.writerow(["t_h"] + all_keys)
    for t_h in sorted(data_by_th.keys()):
        d = data_by_th[t_h]
        writer.writerow([round(t_h, 4)] + [d.get(k) for k in all_keys])
    return buf.getvalue()


def delete_session(session_id: int) -> bool:
    conn = _get_conn()
    chart_ids = [r[0] for r in conn.execute(
        "SELECT id FROM chart_capture WHERE session_id=?", (session_id,)
    ).fetchall()]
    for cid in chart_ids:
        conn.execute("DELETE FROM metrics WHERE chart_id=?", (cid,))
    conn.execute("DELETE FROM chart_capture WHERE session_id=?", (session_id,))
    cur = conn.execute("DELETE FROM capture_session WHERE id=?", (session_id,))
    conn.commit()
    return cur.rowcount > 0


def active_session_id() -> Optional[int]:
    return _active_session_id


def active_charts() -> list:
    return _active_charts
