from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen

from .config import Config, find_project_root, ensure_project_config
from .indexing import index_project, poll_watch
from .search import SearchFilters, SearchOptions, simple_search_es
from .es import ESClient, ensure_indices


def _project_root(cwd: Path) -> Path:
    return find_project_root(cwd)


def cmd_index_init(args: argparse.Namespace) -> int:
    root = _project_root(Path.cwd())
    cfg = ensure_project_config(root)
    try:
        es = ESClient(cfg.elasticsearch.host)
        idx = ensure_indices(es, cfg.resolved_index_prefix())
        files_count = es.count(idx["files_index"]) if es.index_exists(idx["files_index"]) else 0
        versions_count = es.count(idx["versions_index"]) if es.index_exists(idx["versions_index"]) else 0
        # Auto-index on init
        res_idx = index_project(root, cfg)
        print(json.dumps({
            "host": cfg.elasticsearch.host,
            "project_root": str(root),
            "project_id": cfg.project.id,
            "files_index": idx["files_index"],
            "versions_index": idx["versions_index"],
            "counts": {"files": files_count, "versions": versions_count},
            "created": idx.get("created", {}),
            "indexed": res_idx,
        }, indent=2))
    except (URLError, HTTPError) as e:
        print(f"Error: could not reach Elasticsearch at {cfg.elasticsearch.host}. Is it running?", file=sys.stderr)
        return 1
    return 0


def cmd_index_start(args: argparse.Namespace) -> int:
    root = _project_root(Path.cwd())
    cfg = Config.load(root)
    try:
        res = index_project(root, cfg)
        print(json.dumps(res))
        if args.watch:
            poll_watch(root, cfg, interval_s=1.0)
    except (URLError, HTTPError):
        print(f"Error: could not reach Elasticsearch at {cfg.elasticsearch.host}. Is it running?", file=sys.stderr)
        return 1
    return 0


def cmd_index_status(args: argparse.Namespace) -> int:
    root = _project_root(Path.cwd())
    cfg = Config.load(root)
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
            }
        }
        print(json.dumps(out, indent=2))
    except (URLError, HTTPError):
        print(f"Error: could not reach Elasticsearch at {cfg.elasticsearch.host}. Is it running?", file=sys.stderr)
        return 1
    return 0


def cmd_index_rebuild(args: argparse.Namespace) -> int:
    root = _project_root(Path.cwd())
    cfg = Config.load(root)
    try:
        es = ESClient(cfg.elasticsearch.host)
        prefix = cfg.resolved_index_prefix()
        idx = ensure_indices(es, prefix)
        files_index = idx["files_index"]
        versions_index = idx["versions_index"]
        if args.clean:
            # Delete and recreate indices with current schema
            try:
                es.delete_index(files_index)
            except Exception:
                pass
            try:
                es.delete_index(versions_index)
            except Exception:
                pass
            idx = ensure_indices(es, prefix)
        # Reindex content
        res = index_project(root, cfg)
        print(json.dumps({"indices": idx, "result": res}, indent=2))
    except (URLError, HTTPError):
        print(f"Error: could not reach Elasticsearch at {cfg.elasticsearch.host}. Is it running?", file=sys.stderr)
        return 1
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    root = _project_root(Path.cwd())
    cfg = Config.load(root)
    from .es import ensure_indices, ESClient
    try:
        es = ESClient(cfg.elasticsearch.host)
        idx = ensure_indices(es, cfg.resolved_index_prefix())

        # Temporal/versions routing
        use_versions = bool(args.all_versions or args.as_of)
        index_name = idx["versions_index"] if use_versions else idx["files_index"]

        as_of_ms = None
        if args.as_of:
            try:
                from datetime import datetime
                # try ISO8601; allow date only
                as_of_ms = int(datetime.fromisoformat(args.as_of).timestamp() * 1000)
            except Exception:
                print("[rewindex] Could not parse --as-of. Use ISO 8601 like 2025-01-31 or 2025-01-31T12:00:00", file=sys.stderr)
                return 2

        filters = SearchFilters(
            language=args.lang,
            path_pattern=args.path,
            file_types=[args.ext] if args.ext else None,
            is_current=None if (args.include_deleted or use_versions) else True,
            created_before_ms=as_of_ms,
        )
        options = SearchOptions(
            limit=args.limit,
            context_lines=args.context,
            highlight=args.highlight,
            fuzziness='AUTO' if args.fuzzy else None,
            partial=args.partial,
            show_deleted=args.include_deleted,
        )
        res = simple_search_es(es, index_name, args.query, filters, options, debug=getattr(args, 'debug', False))
        # Helpful fallback: if no results and a language filter is set (files index only), retry without it
        if not use_versions and res.get("total_hits", 0) == 0 and args.lang:
            res = simple_search_es(
                es,
                index_name,
                args.query,
                SearchFilters(path_pattern=args.path, file_types=[args.ext] if args.ext else None, is_current=filters.is_current, created_before_ms=as_of_ms),
                options,
                debug=getattr(args, 'debug', False),
            )
            if not args.json and res.get("total_hits", 0) > 0:
                print("[rewindex] No results with language filter; showing all languages.")
        # Notify UI server about this query (best-effort)
        try:
            payload = {
                "source": "cli",
                "timestamp_ms": __import__('time').time() * 1000,
                "query": args.query,
                "filters": {
                    "language": args.lang,
                    "path_pattern": args.path,
                    "file_types": [args.ext] if args.ext else None,
                    "all_versions": bool(args.all_versions),
                    "as_of": args.as_of,
                },
                "options": {"limit": args.limit, "context_lines": args.context, "highlight": args.highlight},
                "results": res.get("results", []),
            }
            data = json.dumps(payload).encode('utf-8')
            req = Request("http://127.0.0.1:8899/events/query", data=data, method="POST")
            req.add_header("Content-Type", "application/json")
            urlopen(req, timeout=0.5).read()
        except Exception:
            pass
    except (URLError, HTTPError):
        print(f"Error: could not reach Elasticsearch at {cfg.elasticsearch.host}. Is it running?", file=sys.stderr)
        return 1

    if args.files_only:
        for r in res["results"]:
            print(r["file_path"]) 
        return 0

    if args.json:
        print(json.dumps(res, indent=2))
        return 0
    elif args.oneline:
        for r in res["results"]:
            m = r["matches"][0]
            ln = f":{m['line']}" if m.get("line") else ""
            snippet = m.get("highlight", "").replace("\n", " ")[:160]
            print(f"{r['file_path']}{ln} :: {snippet}")
    else:
        for r in res["results"]:
            m = r["matches"][0]
            line_no = m.get("line")
            ln_suffix = f":{line_no}" if line_no else ""
            print(f"\n==> {r['file_path']}{ln_suffix}")
            ctx = m.get("context") or {}
            before = ctx.get("before", [])
            after = ctx.get("after", [])
            start_ln = (line_no - len(before)) if (line_no and len(before) is not None) else None

            # Print before context with gutter
            if start_ln is not None:
                n = start_ln
                for b in before:
                    print(f"     {n:>5} | {b}")
                    n += 1
                # Focus line with a clear indicator that is not typical code
                print(f"▶    {line_no:>5} | {m.get('highlight', '')}")
                # After context
                for a in after:
                    n += 1
                    print(f"     {n:>5} | {a}")
            else:
                # Fallback if no line number
                print(m.get("highlight", ""))
    return 0


def cmd_find_function(args: argparse.Namespace) -> int:
    root = Path.cwd()
    cfg = Config.load(root)
    try:
        es = ESClient(cfg.elasticsearch.host)
        idx = ensure_indices(es, cfg.resolved_index_prefix())
        q = args.name
        res = simple_search_es(es, idx["files_index"], q, SearchFilters(has_function=q))
    except (URLError, HTTPError):
        print(f"Error: could not reach Elasticsearch at {cfg.elasticsearch.host}. Is it running?", file=sys.stderr)
        return 1
    for r in res["results"]:
        print(r["file_path"]) 
    return 0


def cmd_find_class(args: argparse.Namespace) -> int:
    root = Path.cwd()
    cfg = Config.load(root)
    try:
        es = ESClient(cfg.elasticsearch.host)
        idx = ensure_indices(es, cfg.resolved_index_prefix())
        q = args.name
        res = simple_search_es(es, idx["files_index"], q, SearchFilters(has_class=q))
    except (URLError, HTTPError):
        print(f"Error: could not reach Elasticsearch at {cfg.elasticsearch.host}. Is it running?", file=sys.stderr)
        return 1
    for r in res["results"]:
        print(r["file_path"]) 
    return 0


def cmd_find_todos(args: argparse.Namespace) -> int:
    root = Path.cwd()
    cfg = Config.load(root)
    try:
        es = ESClient(cfg.elasticsearch.host)
        idx = ensure_indices(es, cfg.resolved_index_prefix())
        res = simple_search_es(es, idx["files_index"], "TODO")
    except (URLError, HTTPError):
        print(f"Error: could not reach Elasticsearch at {cfg.elasticsearch.host}. Is it running?", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(res, indent=2))
    else:
        for r in res["results"]:
            print(r["file_path"]) 
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    host = args.host
    port = args.port
    try:
        from .api_server import run
        run(host=host, port=port)
    except KeyboardInterrupt:
        pass
    return 0


def cmd_history(args: argparse.Namespace) -> int:
    root = Path.cwd()
    cfg = Config.load(root)
    try:
        es = ESClient(cfg.elasticsearch.host)
        idx = ensure_indices(es, cfg.resolved_index_prefix())
        path = args.path
        # Query versions for this file
        body = {
            "query": {"bool": {"must": [{"term": {"file_path": path}}]}},
            "sort": [{"created_at": {"order": "desc"}}],
            "size": 200,
            "_source": ["content_hash", "previous_hash", "created_at", "is_current", "language"],
        }
        res = es.search(idx["versions_index"], body)
        hits = res.get("hits", {}).get("hits", [])
        for h in hits:
            s = h.get("_source", {})
            ts = s.get("created_at")
            cur = "*" if s.get("is_current") else " "
            print(f"{cur} {s.get('content_hash')}  {ts}  lang={s.get('language')}")
        if not hits:
            print("No history found.")
        return 0
    except (URLError, HTTPError):
        print(f"Error: could not reach Elasticsearch at {cfg.elasticsearch.host}. Is it running?", file=sys.stderr)
        return 1


def cmd_show(args: argparse.Namespace) -> int:
    root = Path.cwd()
    cfg = Config.load(root)
    try:
        es = ESClient(cfg.elasticsearch.host)
        idx = ensure_indices(es, cfg.resolved_index_prefix())
        if args.version:
            # fetch from versions index by hash
            doc = es.get_doc(idx["versions_index"], args.version)
            src = (doc or {}).get("_source", {})
            print(src.get("content", ""))
        else:
            # fetch current version from files index by path id
            doc_id = f"{cfg.project.id}:{args.path}"
            doc = es.get_doc(idx["files_index"], doc_id)
            src = (doc or {}).get("_source", {})
            print(src.get("content", ""))
        return 0
    except (URLError, HTTPError):
        print(f"Error: could not reach Elasticsearch at {cfg.elasticsearch.host}. Is it running?", file=sys.stderr)
        return 1


def cmd_diff(args: argparse.Namespace) -> int:
    import difflib
    root = Path.cwd()
    cfg = Config.load(root)
    try:
        es = ESClient(cfg.elasticsearch.host)
        idx = ensure_indices(es, cfg.resolved_index_prefix())
        d1 = es.get_doc(idx["versions_index"], args.hash1)
        d2 = es.get_doc(idx["versions_index"], args.hash2)
        s1 = ((d1 or {}).get("_source", {}) or {}).get("content", "").splitlines()
        s2 = ((d2 or {}).get("_source", {}) or {}).get("content", "").splitlines()
        for line in difflib.unified_diff(s1, s2, fromfile=args.hash1, tofile=args.hash2, lineterm=""):
            print(line)
        return 0
    except (URLError, HTTPError):
        print(f"Error: could not reach Elasticsearch at {cfg.elasticsearch.host}. Is it running?", file=sys.stderr)
        return 1


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="rewindex",
        description="Rewindex: Elasticsearch-backed code search with line-aware results.",
        epilog=(
            "Examples:\n"
            "  rewindex index init\n"
            "  rewindex index start --watch\n"
            "  rewindex search \"authentication\" --limit 10\n"
            "  rewindex search \"code_synonym\" --limit 10\n"
            "  rewindex search \"useEffect\" --path 'src/**'\n"
            "  rewindex search \"UserService\" --lang python\n"
            "  rewindex find-function authenticate\n"
            "  rewindex find-class UserService\n"
        ),
        formatter_class=argparse.RawTextHelpFormatter,
    )
    sub = p.add_subparsers(dest="cmd")

    # index init
    sp = sub.add_parser("index", help="Indexing commands")
    sub_index = sp.add_subparsers(dest="subcmd")
    sp_init = sub_index.add_parser("init", help="Initialize project indexing")
    sp_init.set_defaults(func=cmd_index_init)

    sp_start = sub_index.add_parser("start", help="Start indexing")
    sp_start.add_argument("--watch", action="store_true", help="Run simple polling watcher")
    sp_start.set_defaults(func=cmd_index_start)

    sp_rebuild = sub_index.add_parser("rebuild", help="Rebuild index from scratch")
    sp_rebuild.add_argument("--clean", action="store_true", help="Delete indices before re-creating")
    sp_rebuild.set_defaults(func=cmd_index_rebuild)

    sp_status = sub_index.add_parser("status", help="Show indexing status")
    sp_status.set_defaults(func=cmd_index_status)

    # search
    sp_search = sub.add_parser("search", help="Basic search")
    sp_search.add_argument("query", help="Search query")
    sp_search.add_argument("--lang", nargs="*", help="Filter by language")
    sp_search.add_argument("--path", help="Filter by path pattern (supports * and **)")
    sp_search.add_argument("--ext", help="Filter by extension, e.g. .py")
    sp_search.add_argument("--limit", type=int, default=10, help="Maximum results (default: 10)")
    sp_search.add_argument("--context", type=int, default=2, help="Context lines around match (default: 2)")
    sp_search.add_argument("--fuzzy", action="store_true", help="Enable fuzzy matching for typo tolerance")
    sp_search.add_argument("--partial", action="store_true", help="Enable partial/prefix matching (adds wildcards)")
    sp_search.add_argument("--json", action="store_true")
    sp_search.add_argument("--oneline", action="store_true")
    sp_search.add_argument("--files-only", action="store_true")
    sp_search.add_argument("--highlight", action="store_true", help="Enable <mark> highlighting (off by default)")
    sp_search.add_argument("--debug", action="store_true", help="Include ES query in JSON output")
    sp_search.add_argument("--all-versions", action="store_true", help="Search across all versions (uses versions index)")
    sp_search.add_argument("--as-of", help="Temporal cutoff (ISO 8601). Uses versions index if set.")
    sp_search.add_argument("--include-deleted", action="store_true", help="Include non-current/deleted files in files index results")
    sp_search.set_defaults(func=cmd_search)

    # quick filters
    sp_ff = sub.add_parser("find-function", help="Find function definitions")
    sp_ff.add_argument("name")
    sp_ff.set_defaults(func=cmd_find_function)

    sp_fc = sub.add_parser("find-class", help="Find class definitions")
    sp_fc.add_argument("name")
    sp_fc.set_defaults(func=cmd_find_class)

    sp_ft = sub.add_parser("find-todos", help="Find TODO/FIXME comments")
    sp_ft.add_argument("--json", action="store_true")
    sp_ft.set_defaults(func=cmd_find_todos)

    # serve
    sp_srv = sub.add_parser("serve", help="Run the HTTP API + UI server")
    sp_srv.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    sp_srv.add_argument("--port", type=int, default=8899, help="Port (default: 8899)")
    sp_srv.set_defaults(func=cmd_serve)

    # history/show/diff
    sp_hist = sub.add_parser("history", help="Show version history for a file")
    sp_hist.add_argument("path", help="Relative file path")
    sp_hist.set_defaults(func=cmd_history)

    sp_show = sub.add_parser("show", help="Show current or specific version content")
    sp_show.add_argument("path", help="Relative file path")
    sp_show.add_argument("--version", help="Content hash of version to show")
    sp_show.set_defaults(func=cmd_show)

    sp_diff = sub.add_parser("diff", help="Diff two versions by content hash")
    sp_diff.add_argument("path", help="Relative file path (for context only)")
    sp_diff.add_argument("hash1")
    sp_diff.add_argument("hash2")
    sp_diff.set_defaults(func=cmd_diff)

    return p


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 2
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
