from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse, parse_qs, unquote
import threading

from .config import Config, find_project_root
from .search import SearchFilters, SearchOptions, simple_search_es
from .es import ESClient, ensure_indices
from .indexing import poll_watch


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

    def do_GET(self) -> None:  # noqa: N802
        root = find_project_root(Path.cwd())
        cfg = Config.load(root)
        parsed = urlparse(self.path)
        path_only = parsed.path
        qs = parse_qs(parsed.query)
        if path_only == "/index/status":
            try:
                es = ESClient(cfg.elasticsearch.host)
                idx = ensure_indices(es, cfg.resolved_index_prefix())
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
                    "watcher": "running" if RewindexHandler.watcher_thread and RewindexHandler.watcher_thread.is_alive() else "stopped",
                }
                _json_response(self, 200, out)
            except (URLError, HTTPError):
                _json_response(self, 503, {"error": f"Cannot reach Elasticsearch at {cfg.elasticsearch.host}"})
            return

        # Simple health
        if path_only == "/health":
            _json_response(self, 200, {"ok": True})
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
                body = {
                    "size": 0,
                    "aggs": {
                        "min_ts": {"min": {"field": "created_at"}},
                        "max_ts": {"max": {"field": "created_at"}},
                        "hist": {"auto_date_histogram": {"field": "created_at", "buckets": 60}},
                    }
                }
                res = es.search(idx["versions_index"], body)
                aggs = res.get("aggregations", {}) or {}
                min_ts = (aggs.get("min_ts", {}) or {}).get("value")
                max_ts = (aggs.get("max_ts", {}) or {}).get("value")
                hist_buckets = (aggs.get("hist", {}) or {}).get("buckets", [])
                series = [{"key": b.get("key"), "count": b.get("doc_count")} for b in hist_buckets]
                _json_response(self, 200, {"min": min_ts, "max": max_ts, "series": series})
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

        self.send_error(404, "Not found")

    def do_POST(self) -> None:  # noqa: N802
        root = find_project_root(Path.cwd())
        cfg = Config.load(root)
        if self.path == "/search/simple":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                payload = json.loads(body.decode("utf-8"))
                query = payload.get("query", "")
                filters = payload.get("filters", {})
                options = payload.get("options", {})
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
                        file_types=filters.get("file_types"),
                        exclude_paths=None,
                        modified_after=None,
                        has_function=filters.get("has_function"),
                        has_class=filters.get("has_class"),
                        created_before_ms=as_of_ms,
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
                    BROKER.publish({"type": "index", "update": res})
                def on_event(ev: Dict[str, Any]):
                    # file-level event
                    BROKER.publish({"type": "file", **ev})
                t = threading.Thread(
                    target=poll_watch,
                    args=(Path.cwd(), cfg),
                    kwargs={"interval_s": 1.0, "stop_event": RewindexHandler.watcher_stop, "on_update": on_update, "on_event": on_event},
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


def run(host: str = "127.0.0.1", port: int = 8899) -> None:
    httpd = ThreadingHTTPServer((host, port), RewindexHandler)
    print(f"[rewindex] HTTP server on http://{host}:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[rewindex] HTTP server stopped.")


if __name__ == "__main__":
    run()
