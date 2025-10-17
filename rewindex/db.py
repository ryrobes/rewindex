from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .config import ensure_scope_dir


@dataclass
class DBInfo:
    path: Path
    fts_enabled: bool


def connect(project_root: Path) -> Tuple[sqlite3.Connection, DBInfo]:
    scope_dir = ensure_scope_dir(project_root)
    db_path = scope_dir / "scope.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    fts_ok = _ensure_schema(conn)
    return conn, DBInfo(path=db_path, fts_enabled=fts_ok)


def _ensure_schema(conn: sqlite3.Connection) -> bool:
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS files (
            path TEXT PRIMARY KEY,
            name TEXT,
            extension TEXT,
            language TEXT,
            size_bytes INTEGER,
            line_count INTEGER,
            mtime REAL,
            indexed_at REAL,
            content_hash TEXT,
            metadata_json TEXT
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT,
            content_hash TEXT,
            previous_hash TEXT,
            created_at REAL,
            is_current INTEGER,
            content TEXT
        );
        """
    )

    # Try FTS5 (fallback to LIKE search if not available)
    fts_enabled = True
    try:
        cur.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
                path UNINDEXED,
                content
            );
            """
        )
    except sqlite3.DatabaseError:
        fts_enabled = False

    conn.commit()
    return fts_enabled


def upsert_file(
    conn: sqlite3.Connection,
    *,
    path: str,
    name: str,
    extension: str,
    language: str,
    size_bytes: int,
    line_count: int,
    mtime: float,
    content_hash: str,
    metadata: Dict[str, Any],
    content: str,
) -> None:
    cur = conn.cursor()

    # Determine if file exists and if hash changed
    cur.execute("SELECT content_hash FROM files WHERE path = ?", (path,))
    row = cur.fetchone()
    previous_hash = row[0] if row else None

    now = time.time()
    metadata_json = json.dumps(metadata, ensure_ascii=False)

    if row is None:
        cur.execute(
            """
            INSERT INTO files (
                path, name, extension, language, size_bytes, line_count,
                mtime, indexed_at, content_hash, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                path, name, extension, language, size_bytes, line_count,
                mtime, now, content_hash, metadata_json,
            ),
        )
    else:
        if previous_hash == content_hash:
            # Only update mtime/indexed_at/metadata if needed
            cur.execute(
                """
                UPDATE files
                SET mtime = ?, indexed_at = ?, metadata_json = ?
                WHERE path = ?
                """,
                (mtime, now, metadata_json, path),
            )
        else:
            cur.execute(
                """
                UPDATE files
                SET name=?, extension=?, language=?, size_bytes=?, line_count=?,
                    mtime=?, indexed_at=?, content_hash=?, metadata_json=?
                WHERE path = ?
                """,
                (
                    name, extension, language, size_bytes, line_count,
                    mtime, now, content_hash, metadata_json, path,
                ),
            )

    # Record version and maintain current pointer
    if previous_hash != content_hash:
        # Mark previous version not current
        cur.execute(
            "UPDATE versions SET is_current = 0 WHERE path = ? AND is_current = 1",
            (path,),
        )
        # Insert new version
        cur.execute(
            """
            INSERT INTO versions (path, content_hash, previous_hash, created_at, is_current, content)
            VALUES (?, ?, ?, ?, 1, ?)
            """,
            (path, content_hash, previous_hash, now, content),
        )

    # Update FTS if available
    if has_fts(conn):
        if row is None:
            cur.execute("INSERT INTO fts (rowid, path, content) VALUES ((SELECT rowid FROM files WHERE path = ?), ?, ?)", (path, path, content))
        else:
            # upsert: delete then insert to keep rowid mapping aligned
            cur.execute("DELETE FROM fts WHERE rowid = (SELECT rowid FROM files WHERE path = ?)", (path,))
            cur.execute("INSERT INTO fts (rowid, path, content) VALUES ((SELECT rowid FROM files WHERE path = ?), ?, ?)", (path, path, content))

    conn.commit()


def has_fts(conn: sqlite3.Connection) -> bool:
    try:
        conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='fts'")
        return True
    except sqlite3.DatabaseError:
        return False


def stats(conn: sqlite3.Connection) -> Dict[str, Any]:
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM files")
    total_files = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM versions")
    total_versions = cur.fetchone()[0]
    res = {
        "total_files": total_files,
        "total_versions": total_versions,
        "fts_enabled": has_fts(conn),
    }
    return res

