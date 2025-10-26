from __future__ import annotations

import hashlib
import os
import time
import threading
from pathlib import PurePath
from fnmatch import fnmatch
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Callable

from .config import Config
from .extractor import SimpleExtractor
from .language import detect_language
from .es import ESClient, ensure_indices

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler, FileSystemEvent
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False


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
    from datetime import datetime

    print("[rewindex] Polling file watcher started (Ctrl+C to stop)...")
    print(f"[rewindex] Config: interval={interval_s}s, debounce={cfg.indexing.watch.debounce_ms}ms")
    print(f"[rewindex] Project root: {project_root}")

    iteration = 0
    consecutive_errors = 0
    last_update_time = datetime.now()
    total_files_updated = 0

    try:
        while True:
            iteration += 1
            iteration_start = datetime.now()

            # Heartbeat every 60 iterations (~1 minute if interval=1s)
            if iteration % 60 == 0:
                elapsed = (datetime.now() - last_update_time).total_seconds()
                print(f"[rewindex] 💓 Watcher heartbeat (iteration {iteration}, {elapsed:.1f}s since last update, {total_files_updated} total files updated)")

            if stop_event is not None and stop_event.is_set():
                print("[rewindex] Watcher stop event received")
                break

            try:
                res = index_project(project_root, cfg, on_event=on_event)
                consecutive_errors = 0  # Reset error counter on success

                if any(res.values()):
                    last_update_time = datetime.now()
                    timestamp = last_update_time.strftime("%H:%M:%S")
                    total_files_updated += sum(res.values())
                    print(f"[rewindex] [{timestamp}] index update: {res} (total updates: {total_files_updated})")
                    if on_update is not None:
                        try:
                            on_update(res)
                        except Exception as e:
                            print(f"[rewindex] WARNING: on_update callback failed: {e}")
                # Don't log when idle (reduces spam)
            except Exception as e:
                consecutive_errors += 1
                timestamp = datetime.now().strftime("%H:%M:%S")
                print(f"[rewindex] [{timestamp}] ERROR in watcher loop (error #{consecutive_errors}): {e}")
                import traceback
                traceback.print_exc()

                # If we get too many consecutive errors, something is seriously wrong
                if consecutive_errors >= 5:
                    print("[rewindex] FATAL: Too many consecutive errors, stopping watcher")
                    break

            # Log iteration timing if it's unusually slow
            iteration_duration = (datetime.now() - iteration_start).total_seconds()
            if iteration_duration > 10:
                print(f"[rewindex] ⚠️  Slow iteration: {iteration_duration:.1f}s (iteration {iteration})")

            time.sleep(max(interval_s, cfg.indexing.watch.debounce_ms / 1000.0))

    except KeyboardInterrupt:
        print("\n[rewindex] Watcher stopped by keyboard interrupt.")
    except Exception as e:
        print(f"[rewindex] FATAL: Watcher loop crashed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        print(f"[rewindex] Watcher loop exiting (ran {iteration} iterations).")


def index_single_file(
    file_path: Path,
    project_root: Path,
    cfg: Config,
    on_event: Optional[Callable[[Dict[str, object]], None]] = None,
) -> Optional[str]:
    """Index a single file and return 'added', 'updated', 'skipped', or None."""
    extractor = SimpleExtractor()
    root = project_root.resolve()

    es = ESClient(cfg.elasticsearch.host)
    idx = ensure_indices(es, cfg.resolved_index_prefix())
    files_index = idx["files_index"]
    versions_index = idx["versions_index"]
    project_id = cfg.project.id

    try:
        rel_path = str(file_path.relative_to(root))
    except ValueError:
        # File is outside project root
        return None

    # Check if file should be indexed
    if not _should_index_file(file_path, rel_path, cfg):
        return None

    if not file_path.exists():
        # File was deleted
        file_id = f"{project_id}:{rel_path}"
        existing = es.get_doc(files_index, file_id)
        if existing and existing.get("_source"):
            src = existing["_source"]
            src["is_current"] = False
            src["deleted"] = True
            src["deleted_at"] = int(time.time() * 1000)
            es.put_doc(files_index, file_id, src)
            if on_event:
                try:
                    on_event({"action": "deleted", "file_path": rel_path})
                except Exception:
                    pass
        return "skipped"

    # Read and index file
    content = _read_text(file_path)
    if content is None:
        return "skipped"

    h = sha256_hex(content.encode("utf-8", errors="ignore"))
    stat = file_path.stat()
    lang = detect_language(file_path)
    metas = extractor.extract_metadata(content, lang)

    file_id = f"{project_id}:{rel_path}"
    existing = es.get_doc(files_index, file_id)
    prev_hash = None
    if existing and existing.get("_source"):
        prev_hash = existing["_source"].get("content_hash")

    # Skip if unchanged
    if prev_hash == h:
        return "skipped"

    body = {
        "content": content,
        "file_path": rel_path,
        "file_name": file_path.name,
        "extension": file_path.suffix,
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

    action = "added" if prev_hash is None else "updated"
    if on_event:
        try:
            on_event({"action": action, "file_path": rel_path, "language": lang})
        except Exception:
            pass

    # Versioning
    if prev_hash != h:
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

    es.refresh(files_index)
    es.refresh(versions_index)

    return action


if WATCHDOG_AVAILABLE:
    class ProjectFileHandler(FileSystemEventHandler):
        """Watchdog event handler for file system changes."""

        def __init__(
            self,
            project_root: Path,
            cfg: Config,
            on_update: Optional[Callable[[Dict[str, int]], None]] = None,
            on_event: Optional[Callable[[Dict[str, object]], None]] = None,
        ):
            super().__init__()
            self.project_root = project_root
            self.cfg = cfg
            self.on_update = on_update
            self.on_event = on_event

            # Debouncing: track last event time per file
            self.last_event_time: Dict[str, float] = {}
            self.debounce_seconds = cfg.indexing.watch.debounce_ms / 1000.0

            # Stats tracking
            self.stats_lock = threading.Lock()
            self.pending_stats = {"added": 0, "updated": 0, "skipped": 0}
            self.events_processed = 0  # Total events handled
            self.events_ignored = 0  # Events filtered out by patterns
            self.pending_files: set = set()  # Files waiting to be processed

            # Logging
            self.log_indexed_files = True  # Enable file logging for debugging

            # Batch processing timer
            self.batch_timer: Optional[threading.Timer] = None

        def _should_process(self, path: str) -> bool:
            """Check if enough time has passed since last event for this file."""
            now = time.time()
            last_time = self.last_event_time.get(path, 0)

            if now - last_time < self.debounce_seconds:
                return False

            self.last_event_time[path] = now
            return True

        def _process_file(self, file_path: Path):
            """Process a single file change."""
            self.events_processed += 1
            path_str = str(file_path)

            if not self._should_process(path_str):
                # Debounced - add to pending but don't process yet
                self.pending_files.add(path_str)
                return

            # Remove from pending (if it was there)
            self.pending_files.discard(path_str)

            action = index_single_file(file_path, self.project_root, self.cfg, self.on_event)

            # Only log actual changes (added/updated), not skipped files
            if action and action != 'skipped' and self.log_indexed_files:
                from datetime import datetime
                timestamp = datetime.now().strftime("%H:%M:%S")
                # Get relative path for cleaner logging
                try:
                    rel = file_path.relative_to(self.project_root)
                    print(f"[rewindex] [{timestamp}] {action.upper()}: {rel}")
                except:
                    print(f"[rewindex] [{timestamp}] {action.upper()}: {file_path}")

            if action:
                with self.stats_lock:
                    if action in self.pending_stats:
                        self.pending_stats[action] += 1
                    self._schedule_stats_broadcast()

        def _schedule_stats_broadcast(self):
            """Schedule a broadcast of accumulated stats after a short delay."""
            if self.batch_timer:
                self.batch_timer.cancel()

            def broadcast():
                with self.stats_lock:
                    if any(self.pending_stats.values()) and self.on_update:
                        try:
                            self.on_update(dict(self.pending_stats))
                        except Exception:
                            pass
                        self.pending_stats = {"added": 0, "updated": 0, "skipped": 0}

            self.batch_timer = threading.Timer(0.5, broadcast)
            self.batch_timer.start()

        def _should_ignore_path(self, path_str: str) -> bool:
            """Check if path should be ignored by watcher."""
            # Convert absolute path to relative for pattern matching
            try:
                abs_path = Path(path_str)
                rel_path = abs_path.relative_to(self.project_root)
                rel_str = str(rel_path)
            except (ValueError, Exception):
                # Path is outside project root or invalid - ignore it
                self.events_ignored += 1
                return True

            # Use the same exclusion patterns as indexing
            # This respects .gitignore, .rewindexignore, and built-in patterns
            if _match_any(self.cfg.indexing.exclude_patterns, rel_str):
                self.events_ignored += 1
                return True

            # Also check if _should_index_file would reject it
            # This ensures watcher and indexer are in sync
            if not _should_index_file(abs_path, rel_str, self.cfg):
                self.events_ignored += 1
                return True

            return False

        def on_created(self, event: FileSystemEvent):
            if event.is_directory:
                return
            if self._should_ignore_path(event.src_path):
                return
            try:
                self._process_file(Path(event.src_path))
            except Exception as e:
                print(f"[rewindex] ERROR processing created event for {event.src_path}: {e}")
                import traceback
                traceback.print_exc()

        def on_modified(self, event: FileSystemEvent):
            if event.is_directory:
                return
            if self._should_ignore_path(event.src_path):
                return
            try:
                self._process_file(Path(event.src_path))
            except Exception as e:
                print(f"[rewindex] ERROR processing modified event for {event.src_path}: {e}")
                import traceback
                traceback.print_exc()

        def on_deleted(self, event: FileSystemEvent):
            if event.is_directory:
                return
            if self._should_ignore_path(event.src_path):
                return
            try:
                self.events_processed += 1
                # Deletion events are typically handled by _mark_missing_as_deleted in full index scans
                # Log deletion but don't process (file doesn't exist anymore)
                if self.events_processed % 50 == 0:
                    from datetime import datetime
                    timestamp = datetime.now().strftime("%H:%M:%S")
                    print(f"[rewindex] [{timestamp}] Deletion event: {event.src_path}")
            except Exception as e:
                print(f"[rewindex] ERROR processing deleted event for {event.src_path}: {e}")
                import traceback
                traceback.print_exc()

        def on_moved(self, event: FileSystemEvent):
            if event.is_directory:
                return
            # Check both src and dest paths
            if self._should_ignore_path(event.src_path):
                return
            if hasattr(event, 'dest_path') and self._should_ignore_path(event.dest_path):
                return
            try:
                # Process both old and new paths
                self._process_file(Path(event.src_path))
                if hasattr(event, 'dest_path'):
                    self._process_file(Path(event.dest_path))
            except Exception as e:
                print(f"[rewindex] ERROR processing moved event: {e}")
                import traceback
                traceback.print_exc()


def watch(
    project_root: Path,
    cfg: Config,
    stop_event: Optional[threading.Event] = None,
    on_update: Optional[Callable[[Dict[str, int]], None]] = None,
    on_event: Optional[Callable[[Dict[str, object]], None]] = None,
) -> None:
    """
    Watch project directory for file changes using OS-level file system events (watchdog).

    This is much more efficient than polling for large projects.
    Falls back to poll_watch if watchdog is not available.
    """
    if not WATCHDOG_AVAILABLE:
        print("[rewindex] watchdog not available, falling back to polling...")
        return poll_watch(project_root, cfg, 1.0, stop_event, on_update, on_event)

    print("[rewindex] File watcher started (event-driven via watchdog)")
    print(f"[rewindex] Watching: {project_root} (recursive)")

    event_handler = ProjectFileHandler(project_root, cfg, on_update, on_event)
    observer = Observer()
    observer.schedule(event_handler, str(project_root), recursive=True)
    observer.start()

    from datetime import datetime
    last_heartbeat = datetime.now()
    iteration = 0
    last_event_count = 0

    try:
        while True:
            iteration += 1

            # Heartbeat every 60 seconds
            if iteration % 60 == 0:
                elapsed = (datetime.now() - last_heartbeat).total_seconds()
                event_count = event_handler.events_processed
                events_this_period = event_count - last_event_count
                last_heartbeat = datetime.now()
                last_event_count = event_count

                pending_count = len(event_handler.pending_files)

                print(f"[rewindex] 💓 Heartbeat (iteration {iteration}, {events_this_period} events/min)")

                # Only warn if there are issues
                if pending_count > 500:
                    print(f"[rewindex]    ⚠️  {pending_count} files backlogged (watcher may be overwhelmed)")
                    # Clear stale pending files older than 60 seconds
                    now = time.time()
                    stale = [p for p, t in event_handler.last_event_time.items() if now - t > 60]
                    for p in stale:
                        event_handler.pending_files.discard(p)
                    if stale:
                        print(f"[rewindex]    🧹 Cleared {len(stale)} stale pending files")

                if not observer.is_alive():
                    print(f"[rewindex]    ❌ Observer thread died!")

            if stop_event is not None and stop_event.is_set():
                print("[rewindex] Watcher stop event received")
                break
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\n[rewindex] Watcher stopped (keyboard interrupt).")
    except Exception as e:
        print(f"[rewindex] FATAL: Watcher loop crashed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        print(f"[rewindex] Stopping watchdog observer... (processed {event_handler.events_processed} events)")
        observer.stop()
        observer.join(timeout=5.0)
        if observer.is_alive():
            print("[rewindex] WARNING: Observer did not stop cleanly")
        else:
            print("[rewindex] Watchdog observer stopped cleanly")


def purge_ignored_files(
    project_root: Path,
    cfg: Config,
    dry_run: bool = False,
    skip_confirm: bool = False,
) -> Dict[str, int]:
    """
    Remove all indexed files that match current .gitignore/.rewindexignore patterns.

    This is useful after updating ignore files to clean up already-indexed files.

    Args:
        project_root: Project root directory
        cfg: Configuration with current ignore patterns
        dry_run: If True, only report what would be deleted without deleting

    Returns:
        Dict with counts: {"files_deleted": N, "versions_deleted": N}
    """
    from .es import ESClient, ensure_indices
    import time
    import json

    print(f"[rewindex] {'DRY RUN: ' if dry_run else ''}Purging files matching ignore patterns...")
    print(f"[rewindex] Exclude patterns: {len(cfg.indexing.exclude_patterns)} total")
    print(f"[rewindex] Project root: {project_root}")
    print(f"[rewindex] Project ID: {cfg.project.id}")

    es = ESClient(cfg.elasticsearch.host)
    idx = ensure_indices(es, cfg.resolved_index_prefix())

    print(f"[rewindex] Files index: {idx['files_index']}")
    print(f"[rewindex] Versions index: {idx['versions_index']}")

    # Check total count in index first
    try:
        total_count = es.count(idx['files_index'])
        print(f"[rewindex] Total documents in files index: {total_count}")
    except:
        print(f"[rewindex] Could not get index count")

    # Query all files from this project using scroll API (no 10k limit)
    print("[rewindex] Fetching all indexed files (using scroll API)...")
    all_file_paths = []
    to_delete = []

    # Use scroll API to iterate through all documents
    from urllib.request import Request, urlopen
    import urllib.parse

    scroll_batch_size = 5000
    scroll_time = "2m"

    # Initial search with scroll parameter
    initial_body = {
        "query": {"bool": {"must": [{"term": {"project_id": cfg.project.id}}]}},
        "size": scroll_batch_size,
        "_source": ["file_path"],
    }

    try:
        # First request with scroll
        url = es._url(f"{idx['files_index']}/_search?scroll={scroll_time}")
        req = Request(url, method='POST')
        req.add_header('Content-Type', 'application/json')
        data = json.dumps(initial_body).encode('utf-8')

        with urlopen(req, data, timeout=30) as resp:
            res = json.loads(resp.read().decode('utf-8'))

        scroll_id = res.get("_scroll_id")
        hits = res.get("hits", {}).get("hits", [])
        total = res.get("hits", {}).get("total", {}).get("value", 0)

        print(f"  Initial scroll: {len(hits)} hits (total: {total})")

        # Process all batches
        batch_num = 0
        while hits:
            batch_num += 1

            for h in hits:
                src = h.get("_source", {})
                path = src.get("file_path")

                if path:
                    all_file_paths.append(path)
                    # Check if path matches any ignore pattern
                    if _match_any(cfg.indexing.exclude_patterns, path):
                        to_delete.append(path)
                        # Log first few matches
                        if len(to_delete) <= 5:
                            print(f"    ✓ Will delete: {path}")

            # Continue scrolling
            if scroll_id:
                scroll_body = {"scroll": scroll_time, "scroll_id": scroll_id}
                url = es._url("_search/scroll")
                req = Request(url, method='POST')
                req.add_header('Content-Type', 'application/json')
                data = json.dumps(scroll_body).encode('utf-8')

                with urlopen(req, data, timeout=30) as resp:
                    res = json.loads(resp.read().decode('utf-8'))

                scroll_id = res.get("_scroll_id")
                hits = res.get("hits", {}).get("hits", [])

                if batch_num % 5 == 0:  # Log every 5 batches
                    print(f"  Batch {batch_num}: {len(all_file_paths)} files scanned, {len(to_delete)} to delete")
            else:
                break

        # Clear scroll context
        if scroll_id:
            try:
                url = es._url("_search/scroll")
                req = Request(url, method='DELETE')
                req.add_header('Content-Type', 'application/json')
                data = json.dumps({"scroll_id": scroll_id}).encode('utf-8')
                urlopen(req, data, timeout=10)
            except:
                pass

        print(f"  Completed scroll: {batch_num} batches processed")

    except Exception as e:
        print(f"[rewindex] Error during scroll: {e}")
        import traceback
        traceback.print_exc()

    print(f"\n[rewindex] Scanned {len(all_file_paths)} indexed files")
    print(f"[rewindex] Found {len(to_delete)} files matching ignore patterns\n")

    if len(to_delete) == 0:
        print("[rewindex] Nothing to purge!")
        return {"files_deleted": 0, "versions_deleted": 0}

    # Show sample of what will be deleted
    print("Sample files to be purged:")
    for path in to_delete[:20]:
        print(f"  - {path}")
    if len(to_delete) > 20:
        print(f"  ... and {len(to_delete) - 20} more")

    if dry_run:
        print(f"\n[rewindex] DRY RUN: Would delete {len(to_delete)} files")
        return {"files_deleted": 0, "versions_deleted": 0}

    # Confirm deletion (unless --yes or non-interactive)
    import sys
    if not skip_confirm and sys.stdout.isatty():
        print(f"\n⚠️  This will permanently delete {len(to_delete)} files from the index!")
        response = input("Continue? (yes/no): ")
        if response.lower() not in ['yes', 'y']:
            print("[rewindex] Aborted")
            return {"files_deleted": 0, "versions_deleted": 0}

    # Delete files in batches
    print("\n[rewindex] Deleting files...")
    files_deleted = 0
    versions_deleted = 0
    errors = []

    for i, path in enumerate(to_delete):
        if (i + 1) % 100 == 0:
            print(f"  Progress: {i + 1}/{len(to_delete)} files...")

        # Delete from files_index using delete_by_query
        files_body = {
            "query": {"bool": {"must": [
                {"term": {"file_path": path}},
                {"term": {"project_id": cfg.project.id}}
            ]}}
        }
        try:
            from .es import _json_request
            url = es._url(f"{idx['files_index']}/_delete_by_query")
            del_result = _json_request("POST", url, files_body)
            files_deleted += del_result.get("deleted", 0)
            if i < 5 and del_result.get("deleted", 0) == 0:
                errors.append(f"File {path}: 0 deleted (might not exist)")
        except Exception as e:
            if i < 5:
                errors.append(f"File {path}: {str(e)}")

        # Delete all versions from versions_index
        versions_body = {
            "query": {"bool": {"must": [
                {"term": {"file_path": path}},
                {"term": {"project_id": cfg.project.id}}
            ]}}
        }
        try:
            from .es import _json_request
            url = es._url(f"{idx['versions_index']}/_delete_by_query")
            del_result = _json_request("POST", url, versions_body)
            versions_deleted += del_result.get("deleted", 0)
        except Exception as e:
            if i < 5:
                errors.append(f"Versions for {path}: {str(e)}")

    # Show errors if any
    if errors:
        print("\n[rewindex] Sample errors:")
        for err in errors[:10]:
            print(f"  {err}")

    # Refresh indices
    print("\n[rewindex] Refreshing indices...")
    es.refresh(idx["files_index"])
    es.refresh(idx["versions_index"])

    print(f"\n✅ Purge complete!")
    print(f"   Files deleted: {files_deleted}")
    print(f"   Versions deleted: {versions_deleted}")

    return {"files_deleted": files_deleted, "versions_deleted": versions_deleted}


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
