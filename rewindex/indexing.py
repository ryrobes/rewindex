from __future__ import annotations

import hashlib
import os
import time
from pathlib import PurePath
from fnmatch import fnmatch
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Callable

from .config import Config
from .extractor import SimpleExtractor
from .language import detect_language
from .es import ESClient, ensure_indices


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _match_any(patterns: List[str], rel_path: str) -> bool:
    pp = PurePath(rel_path)
    name = pp.name
    for pat in patterns:
        # Try Path.match (supports ** semantics)
        try:
            if pp.match(pat):
                return True
        except Exception:
            pass
        # Try fnmatch on full path
        if fnmatch(rel_path, pat):
            return True
        # Try basename against the pattern
        if fnmatch(name, pat):
            return True
        # If pattern starts with '**/', also test without it against basename
        if pat.startswith("**/") and fnmatch(name, pat[3:]):
            return True
    return False


def _should_index_file(path: Path, rel_path: str, cfg: Config) -> bool:
    # Exclude patterns first
    if _match_any(cfg.indexing.exclude_patterns, rel_path):
        return False

    # Include patterns: if any present, must match at least one
    if cfg.indexing.include_patterns:
        if not _match_any(cfg.indexing.include_patterns, rel_path):
            return False

    try:
        size_mb = path.stat().st_size / (1024 * 1024)
        if size_mb > cfg.indexing.max_file_size_mb:
            return False
    except FileNotFoundError:
        return False
    return True


def _is_binary_file(path: Path) -> bool:
    """Detect if a file is binary by checking for null bytes in the first 8KB."""
    try:
        with open(path, 'rb') as f:
            chunk = f.read(8192)
            # Check for null bytes (common indicator of binary content)
            if b'\x00' in chunk:
                return True
            # Check if we can decode as UTF-8
            try:
                chunk.decode('utf-8')
                return False
            except UnicodeDecodeError:
                return True
    except Exception:
        return True  # If we can't read it, treat as binary


def _read_text(path: Path) -> Optional[str]:
    """Read text file content, returning None for binary files or read errors."""
    # Skip binary files
    if _is_binary_file(path):
        return None

    try:
        return path.read_text(encoding="utf-8", errors="strict")
    except UnicodeDecodeError:
        # File looked like text in the sample but isn't valid UTF-8
        return None
    except Exception:
        return None


def iter_candidate_files(root: Path, cfg: Config) -> Iterator[Path]:
    for p in root.rglob("*"):
        if p.is_file():
            rel = str(p.relative_to(root))
            if _should_index_file(p, rel, cfg):
                yield p


def index_project(project_root: Path, cfg: Config, on_event: Optional[Callable[[Dict[str, object]], None]] = None) -> Dict[str, int]:
    extractor = SimpleExtractor()
    root = project_root.resolve()

    es = ESClient(cfg.elasticsearch.host)
    idx = ensure_indices(es, cfg.resolved_index_prefix())
    files_index = idx["files_index"]
    versions_index = idx["versions_index"]

    added = 0
    updated = 0
    skipped = 0
    present_paths: set[str] = set()
    new_hash_to_path: dict[str, str] = {}
    project_id = cfg.project.id
    for path in iter_candidate_files(root, cfg):
        rel_path = str(path.relative_to(root))
        present_paths.add(rel_path)
        content = _read_text(path)
        if content is None:
            skipped += 1
            continue
        h = sha256_hex(content.encode("utf-8", errors="ignore"))
        stat = path.stat()
        lang = detect_language(path)
        metas = extractor.extract_metadata(content, lang)

        # Retrieve existing doc by file path as doc id
        file_id = f"{project_id}:{rel_path}"
        existing = es.get_doc(files_index, file_id)
        prev_hash = None
        if existing and existing.get("_source"):
            prev_hash = existing["_source"].get("content_hash")

        body = {
            "content": content,
            "file_path": rel_path,
            "file_name": path.name,
            "extension": path.suffix,
            "language": lang,
            "size_bytes": stat.st_size,
            "line_count": content.count("\n") + 1,
            "last_modified": int(stat.st_mtime * 1000),
            "indexed_at": int(time.time() * 1000),
            "content_hash": h,
            "previous_hash": prev_hash,
            "is_current": True,
            "project_id": project_id,
            "project_root": str(root),
            **metas,
        }

        es.put_doc(files_index, file_id, body)
        new_hash_to_path[h] = rel_path

        if prev_hash is None:
            added += 1
            if on_event is not None:
                try:
                    on_event({"action": "added", "file_path": rel_path, "language": lang})
                except Exception:
                    pass
        elif prev_hash != h:
            updated += 1
            if on_event is not None:
                try:
                    on_event({"action": "updated", "file_path": rel_path, "language": lang})
                except Exception:
                    pass
        else:
            skipped += 1

        # Versioning: add a new version if changed
        if prev_hash != h:
            # mark previous not current (best-effort)
            if prev_hash:
                try:
                    es.put_doc(
                        versions_index,
                        prev_hash,
                        {
                            "file_path": rel_path,
                            "content_hash": prev_hash,
                            "previous_hash": None,
                            "created_at": int(time.time() * 1000),
                            "is_current": False,
                            "content": existing["_source"].get("content", "") if existing else "",
                            "language": lang,
                            "project_id": project_id,
                        },
                    )
                except Exception:
                    pass
            # insert current version
            es.put_doc(
                versions_index,
                h,
                {
                    "file_path": rel_path,
                    "content_hash": h,
                    "previous_hash": prev_hash,
                    "created_at": int(time.time() * 1000),
                    "is_current": True,
                    "content": content,
                    "language": lang,
                    "project_id": project_id,
                },
            )

    # Handle deletions/renames: mark any previously-current docs not present on disk as not current/deleted
    _mark_missing_as_deleted(es, files_index, project_id, present_paths, new_hash_to_path)

    # make results immediately visible
    es.refresh(files_index)
    es.refresh(versions_index)

    return {"added": added, "updated": updated, "skipped": skipped}


def _get_file_hash(*args, **kwargs):  # kept for compatibility
    return None


def poll_watch(
    project_root: Path,
    cfg: Config,
    interval_s: float = 1.0,
    stop_event: Optional["threading.Event"] = None,
    on_update: Optional[Callable[[Dict[str, int]], None]] = None,
    on_event: Optional[Callable[[Dict[str, object]], None]] = None,
) -> None:
    """Very simple polling-based watcher.

    On each tick it performs an incremental index over candidate files.
    This is naive but dependency-free.
    """
    print("[rewindex] Polling file watcher started (Ctrl+C to stop)...")
    try:
        while True:
            if stop_event is not None and stop_event.is_set():
                break
            res = index_project(project_root, cfg, on_event=on_event)
            if any(res.values()):
                print(f"[rewindex] index update: {res}")
                if on_update is not None:
                    try:
                        on_update(res)
                    except Exception:
                        pass
            time.sleep(max(interval_s, cfg.indexing.watch.debounce_ms / 1000.0))
    except KeyboardInterrupt:
        print("\n[rewindex] Watcher stopped.")
    finally:
        print("[rewindex] Watcher loop exiting.")


def _mark_missing_as_deleted(
    es: ESClient,
    files_index: str,
    project_id: str,
    present_paths: set[str],
    new_hash_to_path: dict[str, str],
) -> None:
    # Query all current docs for this project (up to 10k files)
    body = {
        "query": {
            "bool": {
                "must": [
                    {"term": {"project_id": project_id}},
                    {"term": {"is_current": True}},
                ]
            }
        },
        "size": 10000,
        "_source": ["file_path", "content_hash"],
    }
    res = es.search(files_index, body)
    hits = res.get("hits", {}).get("hits", [])
    missing = []
    for h in hits:
        src = h.get("_source", {})
        path = src.get("file_path")
        if not path:
            continue
        if path not in present_paths:
            missing.append((h.get("_id"), path, src.get("content_hash")))

    now_ms = int(time.time() * 1000)
    for doc_id, old_path, old_hash in missing:
        # Load full source, update flags
        doc = es.get_doc(files_index, doc_id)
        src = (doc or {}).get("_source", {})
        if not src:
            continue
        src["is_current"] = False
        src["deleted"] = True
        src["deleted_at"] = now_ms

        # Rename detection: if same content hash appears under a new path in this run
        if old_hash and old_hash in new_hash_to_path:
            new_path = new_hash_to_path[old_hash]
            if new_path != old_path:
                src["renamed_to"] = new_path
                # Update the new doc with renamed_from
                new_id = f"{project_id}:{new_path}"
                new_doc = es.get_doc(files_index, new_id)
                new_src = (new_doc or {}).get("_source", {})
                if new_src:
                    new_src["renamed_from"] = old_path
                    es.put_doc(files_index, new_id, new_src)

        es.put_doc(files_index, doc_id, src)
