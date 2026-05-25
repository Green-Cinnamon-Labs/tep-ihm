"""
persistence.py — SQLite persistence for TEP time series capture sessions.

Data is only recorded when the user manually starts a capture session.
All metrics are downsampled to ~1 point/s regardless of stream frequency.
"""

import csv as csv_mod
import io
import json
import sqlite3
import time
from pathlib import Path
from typing import Optional

SQLITE_DB_PATH = Path("/data/sessions.db")

_conn: Optional[sqlite3.Connection] = None
_active_session_id: Optional[int] = None
_data_source_id: Optional[int] = None
_last_append_wall: float = 0.0


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        SQLITE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(str(SQLITE_DB_PATH), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA foreign_keys=ON")
    return _conn


def init_db(db_path: Optional[str] = None) -> None:
    global SQLITE_DB_PATH
    if db_path:
        SQLITE_DB_PATH = Path(db_path)
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS data_source (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'grpc',
            address     TEXT NOT NULL,
            created_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS capture_session (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            data_source_id INTEGER NOT NULL REFERENCES data_source(id),
            name           TEXT NOT NULL,
            description    TEXT DEFAULT '',
            started_at     INTEGER NOT NULL,
            ended_at       INTEGER,
            t_h_start      REAL,
            t_h_end        REAL,
            notes          TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS metrics (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES capture_session(id),
            t_h        REAL NOT NULL,
            ts_wall    INTEGER NOT NULL,
            xmeas      TEXT NOT NULL,
            xmv        TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_metrics_session_th
            ON metrics(session_id, t_h);
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


def start_session(name: str, description: str = "") -> int:
    global _active_session_id, _last_append_wall
    if _data_source_id is None:
        raise RuntimeError("data_source not initialized — call get_or_create_data_source first")
    conn = _get_conn()
    cur = conn.execute(
        "INSERT INTO capture_session (data_source_id, name, description, started_at) VALUES (?,?,?,?)",
        (_data_source_id, name, description, int(time.time())),
    )
    conn.commit()
    _active_session_id = cur.lastrowid
    _last_append_wall = 0.0
    return _active_session_id


def stop_session() -> Optional[int]:
    global _active_session_id
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
    return sid


def maybe_append(snapshot: dict) -> bool:
    """Appends snapshot to the active session at ~1 point/s. Returns True if appended."""
    global _last_append_wall
    if _active_session_id is None:
        return False
    now = time.time()
    if now - _last_append_wall < 1.0:
        return False
    _last_append_wall = now
    t_h = snapshot.get("t_h", 0.0)
    xmeas = snapshot.get("xmeas", [])
    xmv = snapshot.get("xmv", [])
    conn = _get_conn()
    conn.execute(
        "INSERT INTO metrics (session_id, t_h, ts_wall, xmeas, xmv) VALUES (?,?,?,?,?)",
        (_active_session_id, t_h, int(now), json.dumps(xmeas), json.dumps(xmv)),
    )
    conn.execute(
        """UPDATE capture_session
           SET t_h_start = COALESCE(t_h_start, ?),
               t_h_end   = ?
           WHERE id=?""",
        (t_h, t_h, _active_session_id),
    )
    conn.commit()
    return True


def list_sessions() -> list:
    conn = _get_conn()
    rows = conn.execute(
        """SELECT cs.id, cs.name, cs.description, cs.started_at, cs.ended_at,
                  cs.t_h_start, cs.t_h_end, cs.notes,
                  ds.name AS source_name, ds.source_type, ds.address,
                  COUNT(m.id) AS point_count
           FROM capture_session cs
           JOIN data_source ds ON ds.id = cs.data_source_id
           LEFT JOIN metrics m ON m.session_id = cs.id
           GROUP BY cs.id
           ORDER BY cs.started_at DESC"""
    ).fetchall()
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


def query_history(
    session_id: int,
    var_keys: list,
    from_th: Optional[float] = None,
    to_th: Optional[float] = None,
) -> dict:
    """Returns {labels: [t_h...], series: {key: [values...]}} for the requested var_keys.

    var_keys: list of 'xmeas_N' or 'xmv_N' (1-indexed, e.g. 'xmeas_7').
    """
    conn = _get_conn()
    query = "SELECT t_h, xmeas, xmv FROM metrics WHERE session_id=?"
    params: list = [session_id]
    if from_th is not None:
        query += " AND t_h >= ?"
        params.append(from_th)
    if to_th is not None:
        query += " AND t_h <= ?"
        params.append(to_th)
    query += " ORDER BY t_h"
    rows = conn.execute(query, params).fetchall()

    labels = []
    series: dict = {k: [] for k in var_keys}

    for row in rows:
        labels.append(round(row["t_h"], 4))
        xmeas = json.loads(row["xmeas"])
        xmv = json.loads(row["xmv"])
        for key in var_keys:
            parts = key.split("_")
            if len(parts) == 2 and parts[1].isdigit():
                idx = int(parts[1]) - 1
                if key.startswith("xmeas_"):
                    val = xmeas[idx] if idx < len(xmeas) else None
                elif key.startswith("xmv_"):
                    val = xmv[idx] if idx < len(xmv) else None
                else:
                    val = None
            else:
                val = None
            series[key].append(round(val, 4) if val is not None else None)

    return {"labels": labels, "series": series}


def export_csv_str(session_id: int) -> str:
    xmeas_keys = [f"xmeas_{i}" for i in range(1, 42)]
    xmv_keys = [f"xmv_{i}" for i in range(1, 13)]
    data = query_history(session_id, xmeas_keys + xmv_keys)
    buf = io.StringIO()
    writer = csv_mod.writer(buf)
    writer.writerow(["t_h"] + xmeas_keys + xmv_keys)
    for j, t in enumerate(data["labels"]):
        row = [t] + [data["series"][k][j] for k in xmeas_keys + xmv_keys]
        writer.writerow(row)
    return buf.getvalue()


def delete_session(session_id: int) -> bool:
    conn = _get_conn()
    conn.execute("DELETE FROM metrics WHERE session_id=?", (session_id,))
    cur = conn.execute("DELETE FROM capture_session WHERE id=?", (session_id,))
    conn.commit()
    return cur.rowcount > 0


def active_session_id() -> Optional[int]:
    return _active_session_id
