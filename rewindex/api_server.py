from __future__ import annotations

import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse, parse_qs, unquote
import threading

from .config import Config, find_project_root
from .search import SearchFilters, SearchOptions, simple_search_es
from .es import ESClient, ensure_indices
from .indexing import watch, poll_watch
from .theme_watcher import OmarchyThemeWatcher

logger = logging.getLogger(__name__)


class EventBroker:
    def __init__(self) -> None:
        import queue
        self._subs: set = set()
        self._lock = threading.Lock()
        self._queue_mod = queue

    def subscribe(self):
        q = self._queue_mod.Queue()
        with self._lock:
            self._subs.add(q)
        return q

    def unsubscribe(self, q):
        with self._lock:
            self._subs.discard(q)

    def publish(self, event: Dict[str, Any]) -> None:
        dead = []
        with self._lock:
            for q in list(self._subs):
                try:
                    q.put_nowait(event)
                except Exception:
                    dead.append(q)
            for q in dead:
                self._subs.discard(q)


BROKER = EventBroker()
QUERIES: list[dict] = []
QUERIES_LOCK = threading.Lock()


def poll_theme_changes(watcher: OmarchyThemeWatcher, interval_s: float, stop_event: threading.Event):
    """
    Poll for Omarchy theme changes and broadcast updates.

    Args:
        watcher: OmarchyThemeWatcher instance
        interval_s: Polling interval in seconds
        stop_event: Event to signal stop
    """
    import time
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f" Theme polling started (interval: {interval_s}s)")

    while not stop_event.is_set():
        try:
            # Check for theme changes
            if watcher.check_for_changes():
                theme = watcher.get_current_theme()
                if theme:
                    BROKER.publish({"type": "theme-update", "theme": theme})
                    logger.info(" Theme update broadcasted to clients")
        except Exception as e:
            logger.error(f"Error polling theme: {e}")

        # Wait for interval or stop signal
        stop_event.wait(timeout=interval_s)

    logger.info(" Theme polling stopped")


def _json_response(handler: BaseHTTPRequestHandler, code: int, payload: Dict[str, Any]) -> None:
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


class RewindexHandler(BaseHTTPRequestHandler):
    server_version = "rewindex-http/0.1"
    watcher_thread: threading.Thread | None = None
    watcher_stop: threading.Event | None = None
    watcher_last_update: float = 0.0  # Timestamp of last successful watcher update
    watcher_iteration_count: int = 0  # Total watcher iterations
    beads_root: Path | None = None  # Optional beads working directory
    theme_watcher: OmarchyThemeWatcher | None = None  # Omarchy theme integration
    theme_poll_thread: threading.Thread | None = None
    theme_poll_stop: threading.Event | None = None
    # Cache config to avoid reloading on every request
    cached_config: Config | None = None
    cached_config_root: Path | None = None

    def log_message(self, format, *args):
        """Override to suppress HTTP request logging spam."""
        # Comment this out to re-enable HTTP logging:
        pass

    def do_GET(self) -> None:  # noqa: N802
        root = find_project_root(Path.cwd())
        # Use cached config if available
        if RewindexHandler.cached_config_root != root:
            RewindexHandler.cached_config = Config.load(root)
            RewindexHandler.cached_config_root = root
        cfg = RewindexHandler.cached_config
        parsed = urlparse(self.path)
        path_only = parsed.path
        qs = parse_qs(parsed.query)
        if path_only == "/index/status":
            try:
                es = ESClient(cfg.elasticsearch.host)
                idx = ensure_indices(es, cfg.resolved_index_prefix())
                watcher_alive = RewindexHandler.watcher_thread and RewindexHandler.watcher_thread.is_alive()
                watcher_status = "running" if watcher_alive else "stopped"

                # Check if watcher is stalled (alive but no updates for > 5 minutes)
                import time as time_mod
                if watcher_alive and RewindexHandler.watcher_last_update > 0:
                    elapsed = time_mod.time() - RewindexHandler.watcher_last_update
                    if elapsed > 300:  # 5 minutes
                        watcher_status = f"stalled ({int(elapsed)}s since last update)"

                out = {
                    "host": cfg.elasticsearch.host,
                    "project_root": str(root),
                    "project_id": cfg.project.id,
                    "files_index": idx["files_index"],
                    "versions_index": idx["versions_index"],
                    "counts": {
                        "files": es.count(idx["files_index"]) if es.index_exists(idx["files_index"]) else 0,
                        "versions": es.count(idx["versions_index"]) if es.index_exists(idx["versions_index"]) else 0,
                    },
                    "watcher": watcher_status,
                    "watcher_iterations": RewindexHandler.watcher_iteration_count,
                    "watcher_last_update": RewindexHandler.watcher_last_update,
                }
                _json_response(self, 200, out)
            except (URLError, HTTPError):
                _json_response(self, 503, {"error": f"Cannot reach Elasticsearch at {cfg.elasticsearch.host}"})
            return

        # Simple health
        if path_only == "/health":
            _json_response(self, 200, {"ok": True})
            return

        # Omarchy theme integration endpoints
        if path_only == "/api/system-theme":
            # Return current Omarchy theme colors (if available)
            if not RewindexHandler.theme_watcher:
                # Initialize theme watcher on first request
                RewindexHandler.theme_watcher = OmarchyThemeWatcher()

                # Auto-start theme polling if Omarchy is available
                if RewindexHandler.theme_watcher.is_available:
                    if not RewindexHandler.theme_poll_thread or not RewindexHandler.theme_poll_thread.is_alive():
                        RewindexHandler.theme_poll_stop = threading.Event()
                        t = threading.Thread(
                            target=poll_theme_changes,
                            args=(RewindexHandler.theme_watcher, 2.0, RewindexHandler.theme_poll_stop),
                            daemon=True,
                        )
                        RewindexHandler.theme_poll_thread = t
                        t.start()
                        import logging
                        logging.getLogger(__name__).info(" Theme polling auto-started")

            theme = RewindexHandler.theme_watcher.get_current_theme()
            if theme:
                # Add cache-busting hash to background URL
                bg_url = None
                if theme['background'] and theme['background_hash']:
                    bg_url = f"/api/system-theme/background?v={theme['background_hash']}"
                elif theme['background']:
                    bg_url = "/api/system-theme/background"

                _json_response(self, 200, {
                    "available": True,
                    "colors": theme['colors'],
                    "syntax": theme.get('syntax', {}),
                    "font": theme.get('font', {}),
                    "background_url": bg_url
                })
            else:
                _json_response(self, 200, {"available": False})
            return

        if path_only == "/api/system-theme/background":
            # Serve current Omarchy wallpaper
            if not RewindexHandler.theme_watcher:
                RewindexHandler.theme_watcher = OmarchyThemeWatcher()

            bg_path = RewindexHandler.theme_watcher.current_background
            if bg_path and Path(bg_path).exists():
                try:
                    # Detect content type from extension
                    ext = Path(bg_path).suffix.lower()
                    content_types = {
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.png': 'image/png',
                        '.webp': 'image/webp',
                        '.gif': 'image/gif',
                    }
                    content_type = content_types.get(ext, 'application/octet-stream')

                    with open(bg_path, 'rb') as f:
                        data = f.read()

                    self.send_response(200)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Cache-Control", "public, max-age=60")  # Cache for 1 minute
                    self.end_headers()
                    self.wfile.write(data)
                except Exception as e:
                    self.send_error(500, f"Error serving background: {e}")
            else:
                self.send_error(404, "Background not found")
            return

        # Serve basic UI and static assets
        web_dir = (Path(__file__).resolve().parent / "web").resolve()
        if path_only == "/ui":
            index_html = web_dir / "index.html"
            if index_html.exists():
                self.do_static(web_dir, "index.html")
                return
        if path_only.startswith("/static/"):
            rel = path_only[len("/static/"):]
            self.do_static(web_dir, rel)
            return

        # File endpoints
        if path_only == "/file":
            p = qs.get("path", [None])[0]
            if not p:
                self.send_error(400, "Missing path param")
                return
            try:
                es = ESClient(cfg.elasticsearch.host)
                idx = ensure_indices(es, cfg.resolved_index_prefix())
                doc_id = f"{cfg.project.id}:{p}"
                doc = es.get_doc(idx["files_index"], doc_id)
                _json_response(self, 200, (doc or {}).get("_source", {}))
            except (URLError, HTTPError):
                _json_response(self, 503, {"error": f"Cannot reach Elasticsearch at {cfg.elasticsearch.host}"})
            return

        if path_only == "/file/history":
            p = qs.get("path", [None])[0]
            if not p:
                self.send_error(400, "Missing path param")
                return
            try:
                es = ESClient(cfg.elasticsearch.host)
                idx = ensure_indices(es, cfg.resolved_index_prefix())
                body = {
                    "query": {"bool": {"must": [{"term": {"file_path": p}}]}},
                    "sort": [{"created_at": {"order": "desc"}}],
                    "size": 200,
                }
                res = es.search(idx["versions_index"], body)
                out = [h.get("_source", {}) for h in res.get("hits", {}).get("hits", [])]
                _json_response(self, 200, {"versions": out})
            except (URLError, HTTPError):
                _json_response(self, 503, {"error": f"Cannot reach Elasticsearch at {cfg.elasticsearch.host}"})
            return

        if path_only == "/version":
            h = qs.get("hash", [None])[0]
            if not h:
                self.send_error(400, "Missing hash param")
                return
            try:
                es = ESClient(cfg.elasticsearch.host)
                idx = ensure_indices(es, cfg.resolved_index_prefix())
                doc = es.get_doc(idx["versions_index"], h)
                _json_response(self, 200, (doc or {}).get("_source", {}))
            except (URLError, HTTPError):
                _json_response(self, 503, {"error": f"Cannot reach Elasticsearch at {cfg.elasticsearch.host}"})
            return

        if path_only == "/timeline/stats":
            try:
                es = ESClient(cfg.elasticsearch.host)
                idx = ensure_indices(es, cfg.resolved_index_prefix())

                # Check for file path filtering (search-scoped timeline)
                paths_param = qs.get("paths", [None])[0]
                file_paths = []
                if paths_param:
                    try:
                        file_paths = json.loads(paths_param)
                    except json.JSONDecodeError:
                        pass

                # Build query filter
                query_filter = {"match_all": {}}
                if file_paths:
                    # Filter to only versions of files in search results
                    query_filter = {"terms": {"file_path": file_paths}}
                    logger.info(f"[timeline/stats] Filtering to {len(file_paths)} file paths")

                # Use fixed 5-minute buckets instead of auto bucketing
                # Hard limit: 500 buckets max (41.7 hours at 5-min intervals)
                body = {
                    "size": 0,
                    "query": query_filter,
                    "aggs": {
                        "min_ts": {"min": {"field": "created_at"}},
                        "max_ts": {"max": {"field": "created_at"}},
                        "hist": {
                            "date_histogram": {
                                "field": "created_at",
                                "fixed_interval": "5m",  # 5-minute buckets
                                "min_doc_count": 0,  # Show empty buckets for continuity
                            }
                        },
                    }
                }

                res = es.search(idx["versions_index"], body)
                aggs = res.get("aggregations", {}) or {}
                min_ts = (aggs.get("min_ts", {}) or {}).get("value")
                max_ts = (aggs.get("max_ts", {}) or {}).get("value")
                hist_buckets = (aggs.get("hist", {}) or {}).get("buckets", [])

                # Hard limit: return max 500 buckets
                MAX_BUCKETS = 500
                original_bucket_count = len(hist_buckets)
                if original_bucket_count > MAX_BUCKETS:
                    # Downsample by taking every Nth bucket
                    stride = original_bucket_count // MAX_BUCKETS
                    hist_buckets = hist_buckets[::stride]
                    logger.info(f"[timeline/stats] Downsampled from {original_bucket_count} to {len(hist_buckets)} buckets (stride={stride})")

                series = [{"key": b.get("key"), "count": b.get("doc_count")} for b in hist_buckets]
                _json_response(self, 200, {
                    "min": min_ts,
                    "max": max_ts,
                    "series": series,
                    "bucket_count": len(series),
                    "interval": "5m",
                    "filtered": bool(file_paths),
                    "file_count": len(file_paths) if file_paths else None,
                })
            except (URLError, HTTPError):
                _json_response(self, 503, {"error": f"Cannot reach Elasticsearch at {cfg.elasticsearch.host}"})
            return

        if path_only == "/file/at":
            p = qs.get("path", [None])[0]
            ts = qs.get("ts", [None])[0]
            if not p or ts is None:
                self.send_error(400, "Missing path or ts param")
                return
            try:
                ts_val = int(ts)
            except Exception:
                self.send_error(400, "Invalid ts param")
                return
            try:
                es = ESClient(cfg.elasticsearch.host)
                idx = ensure_indices(es, cfg.resolved_index_prefix())
                body = {
                    "query": {
                        "bool": {
                            "must": [{"term": {"file_path": p}}],
                            "filter": [{"range": {"created_at": {"lte": ts_val}}}],
                        }
                    },
                    "sort": [{"created_at": {"order": "desc"}}],
                    "size": 1,
                }
                res = es.search(idx["versions_index"], body)
                hits = res.get("hits", {}).get("hits", [])
                if hits:
                    _json_response(self, 200, hits[0].get("_source", {}))
                else:
                    # fallback to current
                    doc_id = f"{cfg.project.id}:{p}"
                    doc = es.get_doc(idx["files_index"], doc_id)
                    _json_response(self, 200, (doc or {}).get("_source", {}))
            except (URLError, HTTPError):
                _json_response(self, 503, {"error": f"Cannot reach Elasticsearch at {cfg.elasticsearch.host}"})
            return

        if path_only == "/files":
            try:
                es = ESClient(cfg.elasticsearch.host)
                idx = ensure_indices(es, cfg.resolved_index_prefix())
                # Check for show_deleted parameter
                show_deleted = qs.get("show_deleted", ["false"])[0].lower() == "true"
                query = {"match_all": {}} if show_deleted else {"term": {"is_current": True}}
                body = {
                    "query": query,
                    "size": 10000,
                    "_source": ["file_path", "language", "size_bytes", "line_count", "deleted", "is_current"],
                }
                res = es.search(idx["files_index"], body)
                files = [h.get("_source", {}) for h in res.get("hits", {}).get("hits", [])]
                _json_response(self, 200, {"files": files})
            except (URLError, HTTPError):
                _json_response(self, 503, {"error": f"Cannot reach Elasticsearch at {cfg.elasticsearch.host}"})
            return

        if path_only == "/files/at":
            ts = qs.get("ts", [None])[0]
            if ts is None:
                self.send_error(400, "Missing ts param")
                return
            try:
                ts_val = int(ts)
            except Exception:
                self.send_error(400, "Invalid ts param")
                return
            try:
                es = ESClient(cfg.elasticsearch.host)
                idx = ensure_indices(es, cfg.resolved_index_prefix())
                # Get latest version for each path <= ts
                body = {
                    "query": {"range": {"created_at": {"lte": ts_val}}},
                    "sort": [{"file_path": {"order": "asc"}}, {"created_at": {"order": "desc"}}],
                    "size": 10000,
                    "_source": ["file_path", "language", "size_bytes", "line_count"],
                }
                res = es.search(idx["versions_index"], body)
                seen = {}
                for h in res.get("hits", {}).get("hits", []):
                    src = h.get("_source", {})
                    p = src.get("file_path")
                    if p and p not in seen:
                        seen[p] = {
                            "file_path": p,
                            "language": src.get("language"),
                            "size_bytes": src.get("size_bytes"),
                            "line_count": src.get("line_count"),
                        }
                files = list(seen.values())
                # Filter out deleted as of ts using current file docs' deleted_at when available
                filtered = []
                for f in files:
                    doc_id = f"{cfg.project.id}:{f['file_path']}"
                    try:
                        d = es.get_doc(idx["files_index"], doc_id)
                        s = (d or {}).get("_source", {})
                        if s.get("deleted") and s.get("deleted_at") and int(s.get("deleted_at")) <= ts_val:
                            continue
                    except Exception:
                        pass
                    filtered.append(f)
                _json_response(self, 200, {"files": filtered})
            except (URLError, HTTPError):
                _json_response(self, 503, {"error": f"Cannot reach Elasticsearch at {cfg.elasticsearch.host}"})
            return

        if path_only == "/events/indexing":
            # SSE stream of watcher/index updates
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            q = BROKER.subscribe()
            try:
                import time
                last = time.time()
                while True:
                    try:
                        evt = q.get(timeout=10.0)
                        data = json.dumps(evt)
                        # Named events by type
                        evname = evt.get("type", "message")
                        self.wfile.write(f"event: {evname}\n".encode("utf-8"))
                        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                        self.wfile.flush()
                        last = time.time()
                    except Exception:
                        # heartbeat
                        if time.time() - last > 9:
                            self.wfile.write(b": ping\n\n")
                            self.wfile.flush()
                            last = time.time()
            except Exception:
                pass
            finally:
                BROKER.unsubscribe(q)
            return

        if path_only == "/queries":
            with QUERIES_LOCK:
                items = list(QUERIES)
            _json_response(self, 200, {"queries": items})
            return

        # Beads integration endpoints
        if path_only == "/beads/check":
            import subprocess
            try:
                result = subprocess.run(
                    ["which", "bd"],
                    capture_output=True,
                    text=True,
                    timeout=2
                )
                available = result.returncode == 0
                _json_response(self, 200, {"available": available})
            except Exception:
                _json_response(self, 200, {"available": False})
            return

        if path_only == "/beads/list":
            import subprocess
            import sys
            # Priority: beads_root (if set) > query param > server root
            if RewindexHandler.beads_root:
                work_dir = RewindexHandler.beads_root
            else:
                work_dir = qs.get("project_root", [None])[0]
                if work_dir:
                    work_dir = Path(unquote(work_dir))
                    if not work_dir.is_dir():
                        _json_response(self, 400, {"error": f"Invalid project_root: {work_dir}"})
                        return
                else:
                    work_dir = root

            # Debug logging
            print(f"[beads/list DEBUG] cwd={work_dir}", file=sys.stderr)
            print(f"[beads/list DEBUG] query_param={qs.get('project_root', [None])[0]}", file=sys.stderr)
            print(f"[beads/list DEBUG] beads_root={RewindexHandler.beads_root}", file=sys.stderr)

            try:
                result = subprocess.run(
                    ["bd", "list", "--json"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    cwd=str(work_dir)
                )

                # Debug logging
                print(f"[beads/list DEBUG] returncode={result.returncode}", file=sys.stderr)
                print(f"[beads/list DEBUG] stdout={result.stdout[:200]}", file=sys.stderr)
                print(f"[beads/list DEBUG] stderr={result.stderr[:200]}", file=sys.stderr)

                if result.returncode == 0:
                    parsed = json.loads(result.stdout) if result.stdout and result.stdout.strip() else []
                    # Handle case where bd returns JSON null or non-list
                    tickets = parsed if isinstance(parsed, list) else []
                    print(f"[beads/list DEBUG] ticket_count={len(tickets)}", file=sys.stderr)
                    _json_response(self, 200, {"tickets": tickets, "_debug": {"cwd": str(work_dir), "count": len(tickets)}})
                else:
                    # bd list failed - likely not a beads project, return empty list instead of error
                    print(f"[beads/list DEBUG] bd list failed (not a beads project?)", file=sys.stderr)
                    _json_response(self, 200, {"tickets": [], "_debug": {"cwd": str(work_dir), "error": result.stderr or "bd list failed"}})
            except Exception as e:
                print(f"[beads/list DEBUG] exception={e}", file=sys.stderr)
                _json_response(self, 500, {"error": str(e), "_debug": {"cwd": str(work_dir)}})
            return

        if path_only == "/beads/ready":
            import subprocess
            # Priority: beads_root (if set) > query param > server root
            if RewindexHandler.beads_root:
                work_dir = RewindexHandler.beads_root
            else:
                work_dir = qs.get("project_root", [None])[0]
                if work_dir:
                    work_dir = Path(unquote(work_dir))
                    if not work_dir.is_dir():
                        _json_response(self, 400, {"error": f"Invalid project_root: {work_dir}"})
                        return
                else:
                    work_dir = root
            try:
                result = subprocess.run(
                    ["bd", "ready", "--json"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    cwd=str(work_dir)
                )
                if result.returncode == 0:
                    tickets = json.loads(result.stdout) if result.stdout.strip() else []
                    _json_response(self, 200, {"tickets": tickets})
                else:
                    _json_response(self, 500, {"error": result.stderr or "bd ready failed"})
            except Exception as e:
                _json_response(self, 500, {"error": str(e)})
            return

        self.send_error(404, "Not found")

    def do_POST(self) -> None:  # noqa: N802
        root = find_project_root(Path.cwd())
        # Use cached config if available
        if RewindexHandler.cached_config_root != root:
            RewindexHandler.cached_config = Config.load(root)
            RewindexHandler.cached_config_root = root
        cfg = RewindexHandler.cached_config
        if self.path == "/search/simple":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                payload = json.loads(body.decode("utf-8"))
                query = payload.get("query", "")
                filters = payload.get("filters", {})
                options = payload.get("options", {})

                # Debug logging
                if filters.get("path_prefix"):
                    logger.info(f"🔍 Received path_prefix filter: {filters.get('path_prefix')}")
                    logger.info(f"   Full filters dict: {filters}")
                if filters.get("exclude_paths"):
                    logger.info(f"🚫 Received exclude_paths filter: {filters.get('exclude_paths')}")

                es = ESClient(cfg.elasticsearch.host)
                idx = ensure_indices(es, cfg.resolved_index_prefix())
                as_of_ms = filters.get("as_of_ms") or filters.get("created_before_ms")
                index_name = idx["versions_index"] if as_of_ms else idx["files_index"]
                res = simple_search_es(
                    es,
                    index_name,
                    query,
                    SearchFilters(
                        language=filters.get("language"),
                        path_pattern=filters.get("path_pattern"),
                        path_prefix=filters.get("path_prefix"),
                        file_types=filters.get("file_types"),
                        exclude_paths=filters.get("exclude_paths"),
                        modified_after=None,
                        has_function=filters.get("has_function"),
                        has_class=filters.get("has_class"),
                        created_before_ms=as_of_ms,
                        file_paths=filters.get("file_paths"),
                    ),
                    SearchOptions(
                        limit=options.get("limit", 20),
                        context_lines=options.get("context_lines", 3),
                        highlight=options.get("highlight", False),
                        fuzziness=options.get("fuzziness"),
                        partial=options.get("partial", False),
                        show_deleted=options.get("show_deleted", False),
                    ),
                )
                _json_response(self, 200, res)
            except (URLError, HTTPError):
                _json_response(self, 503, {"error": f"Cannot reach Elasticsearch at {cfg.elasticsearch.host}"})
                return
            except Exception as e:  # pragma: no cover
                import traceback
                logger.error(f"❌ Error in /search/simple: {str(e)}")
                logger.error(traceback.format_exc())
                _json_response(self, 400, {"error": str(e)})
            return

        if self.path == "/index/start":
            # Start polling watcher in a background thread
            try:
                if RewindexHandler.watcher_thread and RewindexHandler.watcher_thread.is_alive():
                    _json_response(self, 200, {"ok": True, "watcher": "already running"})
                    return
                RewindexHandler.watcher_stop = threading.Event()
                cfg = Config.load(Path.cwd())
                def on_update(res: Dict[str, Any]):
                    import time as time_mod
                    RewindexHandler.watcher_last_update = time_mod.time()
                    RewindexHandler.watcher_iteration_count += 1
                    BROKER.publish({"type": "index", "update": res})
                def on_event(ev: Dict[str, Any]):
                    # file-level event
                    BROKER.publish({"type": "file", **ev})
                t = threading.Thread(
                    target=watch,
                    args=(Path.cwd(), cfg),
                    kwargs={"stop_event": RewindexHandler.watcher_stop, "on_update": on_update, "on_event": on_event},
                    daemon=True,
                )
                RewindexHandler.watcher_thread = t
                t.start()
                BROKER.publish({"type": "watcher", "status": "started"})
                _json_response(self, 200, {"ok": True, "watcher": "started"})
            except Exception as e:
                _json_response(self, 500, {"error": str(e)})
            return

        if self.path == "/index/stop":
            try:
                if RewindexHandler.watcher_stop is not None:
                    RewindexHandler.watcher_stop.set()
                if RewindexHandler.watcher_thread is not None:
                    RewindexHandler.watcher_thread.join(timeout=2.0)
                RewindexHandler.watcher_thread = None
                RewindexHandler.watcher_stop = None
                BROKER.publish({"type": "watcher", "status": "stopped"})
                _json_response(self, 200, {"ok": True, "watcher": "stopped"})
            except Exception as e:
                _json_response(self, 500, {"error": str(e)})
            return

        if self.path == "/events/query":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                payload = json.loads(body.decode("utf-8"))
                # Store limited history and broadcast
                with QUERIES_LOCK:
                    QUERIES.append(payload)
                    if len(QUERIES) > 50:
                        del QUERIES[0]
                BROKER.publish({"type": "query", "payload": payload})
                _json_response(self, 200, {"ok": True})
            except Exception as e:
                _json_response(self, 400, {"error": str(e)})
            return

        if self.path == "/file/save":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                payload = json.loads(body.decode("utf-8"))
                path = payload.get("path")
                content = payload.get("content")

                if not path:
                    _json_response(self, 400, {"error": "Missing path"})
                    return
                if content is None:
                    _json_response(self, 400, {"error": "Missing content"})
                    return

                # Write file relative to project root
                file_path = root / path

                # Security check: ensure path is within project root
                try:
                    file_path.resolve().relative_to(root.resolve())
                except ValueError:
                    _json_response(self, 403, {"error": "Path must be within project root"})
                    return

                # Create parent directories if needed
                file_path.parent.mkdir(parents=True, exist_ok=True)

                # Write the file
                file_path.write_text(content, encoding="utf-8")

                _json_response(self, 200, {"ok": True, "path": path})
            except Exception as e:
                _json_response(self, 500, {"error": str(e)})
            return

        # Beads POST endpoints
        if self.path == "/beads/create":
            import subprocess
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                payload = json.loads(body.decode("utf-8"))
                title = payload.get("title")
                if not title:
                    _json_response(self, 400, {"error": "Missing title"})
                    return

                # Priority: beads_root (if set) > request body > server root
                if RewindexHandler.beads_root:
                    work_dir = RewindexHandler.beads_root
                else:
                    work_dir = payload.get("project_root")
                    if work_dir:
                        work_dir = Path(work_dir)
                        if not work_dir.is_dir():
                            _json_response(self, 400, {"error": f"Invalid project_root: {work_dir}"})
                            return
                    else:
                        work_dir = root

                cmd = ["bd", "create", title, "--json"]
                priority = payload.get("priority")
                if priority is not None:
                    cmd.extend(["--priority", str(priority)])
                issue_type = payload.get("type")
                if issue_type:
                    cmd.extend(["--type", issue_type])

                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=5,
                    cwd=str(work_dir)
                )
                if result.returncode == 0:
                    ticket = json.loads(result.stdout) if result.stdout.strip() else {}
                    _json_response(self, 200, {"ticket": ticket})
                else:
                    _json_response(self, 500, {"error": result.stderr or "bd create failed"})
            except Exception as e:
                _json_response(self, 500, {"error": str(e)})
            return

        if self.path == "/beads/update":
            import subprocess
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                payload = json.loads(body.decode("utf-8"))
                ticket_id = payload.get("id")
                status = payload.get("status")
                if not ticket_id:
                    _json_response(self, 400, {"error": "Missing id"})
                    return

                # Priority: beads_root (if set) > request body > server root
                if RewindexHandler.beads_root:
                    work_dir = RewindexHandler.beads_root
                else:
                    work_dir = payload.get("project_root")
                    if work_dir:
                        work_dir = Path(work_dir)
                        if not work_dir.is_dir():
                            _json_response(self, 400, {"error": f"Invalid project_root: {work_dir}"})
                            return
                    else:
                        work_dir = root

                cmd = ["bd", "update", ticket_id, "--json"]
                if status:
                    cmd.extend(["--status", status])

                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=5,
                    cwd=str(work_dir)
                )
                if result.returncode == 0:
                    ticket = json.loads(result.stdout) if result.stdout.strip() else {}
                    _json_response(self, 200, {"ticket": ticket})
                else:
                    _json_response(self, 500, {"error": result.stderr or "bd update failed"})
            except Exception as e:
                _json_response(self, 500, {"error": str(e)})
            return

        if self.path == "/beads/close":
            import subprocess
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                payload = json.loads(body.decode("utf-8"))
                ticket_id = payload.get("id")
                if not ticket_id:
                    _json_response(self, 400, {"error": "Missing id"})
                    return

                # Priority: beads_root (if set) > request body > server root
                if RewindexHandler.beads_root:
                    work_dir = RewindexHandler.beads_root
                else:
                    work_dir = payload.get("project_root")
                    if work_dir:
                        work_dir = Path(work_dir)
                        if not work_dir.is_dir():
                            _json_response(self, 400, {"error": f"Invalid project_root: {work_dir}"})
                            return
                    else:
                        work_dir = root

                result = subprocess.run(
                    ["bd", "close", ticket_id, "--json"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    cwd=str(work_dir)
                )
                if result.returncode == 0:
                    ticket = json.loads(result.stdout) if result.stdout.strip() else {}
                    _json_response(self, 200, {"ticket": ticket})
                else:
                    _json_response(self, 500, {"error": result.stderr or "bd close failed"})
            except Exception as e:
                _json_response(self, 500, {"error": str(e)})
            return

        self.send_error(404, "Not found")

    # Static file serving helper
    def do_static(self, base: Path, rel: str) -> None:
        f = (base / rel).resolve()
        if not f.is_file() or base not in f.parents and f != base:
            self.send_error(404, "Not found")
            return
        data = f.read_bytes()
        if f.suffix == ".js":
            ctype = "application/javascript"
        elif f.suffix == ".css":
            ctype = "text/css"
        elif f.suffix == ".html":
            ctype = "text/html; charset=utf-8"
        else:
            ctype = "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def run(host: str = "127.0.0.1", port: int = 8899, beads_root: str | None = None) -> None:
    # Set beads_root on handler class if provided
    if beads_root:
        beads_path = Path(beads_root)
        if not beads_path.is_dir():
            print(f"[rewindex] ERROR: beads-root directory does not exist: {beads_root}")
            return
        RewindexHandler.beads_root = beads_path
        print(f"[rewindex] Beads root: {beads_path}")

    # Auto-start file watcher (always-on watching)
    try:
        root = find_project_root(Path.cwd())
        cfg = Config.load(root)

        RewindexHandler.watcher_stop = threading.Event()

        def on_update(res: Dict[str, Any]):
            import time as time_mod
            RewindexHandler.watcher_last_update = time_mod.time()
            RewindexHandler.watcher_iteration_count += 1
            BROKER.publish({"type": "index", "update": res})

        def on_event(ev: Dict[str, Any]):
            BROKER.publish({"type": "file", **ev})

        watcher_thread = threading.Thread(
            target=watch,
            args=(root, cfg),
            kwargs={
                "stop_event": RewindexHandler.watcher_stop,
                "on_update": on_update,
                "on_event": on_event
            },
            daemon=True,
        )
        RewindexHandler.watcher_thread = watcher_thread
        watcher_thread.start()
        print(f"[rewindex] File watcher started (auto-watching project)")
    except Exception as e:
        print(f"[rewindex] WARNING: Could not start file watcher: {e}")

    httpd = ThreadingHTTPServer((host, port), RewindexHandler)
    print(f"[rewindex] HTTP server on http://{host}:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[rewindex] HTTP server stopped.")
        # Clean shutdown of watcher
        if RewindexHandler.watcher_stop is not None:
            RewindexHandler.watcher_stop.set()
        if RewindexHandler.watcher_thread is not None:
            RewindexHandler.watcher_thread.join(timeout=2.0)


if __name__ == "__main__":
    run()
