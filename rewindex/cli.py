from __future__ import annotations

import argparse
import json
import sys
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen

from .config import Config, find_project_root, ensure_project_config
from .indexing import index_project, poll_watch
from .search import SearchFilters, SearchOptions, simple_search_es
from .es import ESClient, ensure_indices


def parse_relative_time(time_str: str) -> int:
    """Parse relative time string (e.g., '10 minutes', '2 hours', '1 day') or ISO 8601 to milliseconds since epoch.

    Supported formats:
    - Relative: '10s', '10 seconds', '5m', '5 minutes', '2h', '2 hours', '3d', '3 days', '1w', '1 week'
    - Absolute: ISO 8601 format like '2025-01-31' or '2025-01-31T12:00:00'

    Returns timestamp in milliseconds representing the target time.
    """
    time_str = time_str.strip()

    # Try ISO 8601 first
    try:
        dt = datetime.fromisoformat(time_str)
        return int(dt.timestamp() * 1000)
    except (ValueError, AttributeError):
        pass

    # Parse relative time
    # Pattern: number + unit (e.g., "10 minutes", "10m", "10 min")
    pattern = r'^(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks)$'
    match = re.match(pattern, time_str.lower())

    if not match:
        raise ValueError(f"Could not parse time: '{time_str}'. Use formats like '10m', '2 hours', '3 days' or ISO 8601 like '2025-01-31'")

    amount = int(match.group(1))
    unit = match.group(2)

    # Convert to seconds
    if unit in ('s', 'sec', 'second', 'seconds'):
        seconds = amount
    elif unit in ('m', 'min', 'minute', 'minutes'):
        seconds = amount * 60
    elif unit in ('h', 'hr', 'hour', 'hours'):
        seconds = amount * 3600
    elif unit in ('d', 'day', 'days'):
        seconds = amount * 86400
    elif unit in ('w', 'week', 'weeks'):
        seconds = amount * 604800
    else:
        raise ValueError(f"Unknown time unit: {unit}")

    # Calculate target time (now minus duration)
    target_time = datetime.now() - timedelta(seconds=seconds)
    return int(target_time.timestamp() * 1000)


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
                as_of_ms = parse_relative_time(args.as_of)
            except ValueError as e:
                print(f"[rewindex] {e}", file=sys.stderr)
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
                "project_root": str(root),  # Send the CLI's project root
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
        res = simple_search_es(
            es,
            idx["files_index"],
            q,
            SearchFilters(has_function=q, language=args.lang if hasattr(args, 'lang') else None)
        )
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
        res = simple_search_es(
            es,
            idx["files_index"],
            q,
            SearchFilters(has_class=q, language=args.lang if hasattr(args, 'lang') else None)
        )
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
    beads_root = args.beads_root if hasattr(args, 'beads_root') else None
    try:
        from .api_server import run
        run(host=host, port=port, beads_root=beads_root)
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
            "size": args.limit,
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


def cmd_view(args: argparse.Namespace) -> int:
    """View file content from index. Supports exact path lookup or search by filename."""
    root = Path.cwd()
    cfg = Config.load(root)
    try:
        es = ESClient(cfg.elasticsearch.host)
        idx = ensure_indices(es, cfg.resolved_index_prefix())

        # Parse --as-of if provided
        as_of_ms = None
        if args.as_of:
            try:
                as_of_ms = parse_relative_time(args.as_of)
            except ValueError as e:
                print(f"[rewindex] {e}", file=sys.stderr)
                return 2

        src = None
        matched_path = args.path

        # Try exact lookup first
        if as_of_ms:
            # Historical: search versions index for file at specific time
            body = {
                "query": {
                    "bool": {
                        "must": [{"term": {"file_path": args.path}}],
                        "filter": [{"range": {"created_at": {"lte": as_of_ms}}}],
                    }
                },
                "sort": [{"created_at": {"order": "desc"}}],
                "size": 1,
            }
            res = es.search(idx["versions_index"], body)
            hits = res.get("hits", {}).get("hits", [])
            if hits:
                src = hits[0].get("_source", {})
        else:
            # Current: fetch from files index
            doc_id = f"{cfg.project.id}:{args.path}"
            doc = es.get_doc(idx["files_index"], doc_id)
            if doc:
                src = doc.get("_source", {})

        # Fallback: search by filename/path pattern if exact lookup failed
        if not src:
            index_name = idx["versions_index"] if as_of_ms else idx["files_index"]
            filters = SearchFilters(
                path_pattern=f"*{args.path}*" if "/" not in args.path else None,
                created_before_ms=as_of_ms,
            )
            # Search using the path as query
            res = simple_search_es(es, index_name, args.path, filters, SearchOptions(limit=1, highlight=False))
            if res.get("results"):
                # Fetch full content for top match
                top_match = res["results"][0]
                matched_path = top_match["file_path"]

                if as_of_ms:
                    body = {
                        "query": {
                            "bool": {
                                "must": [{"term": {"file_path": matched_path}}],
                                "filter": [{"range": {"created_at": {"lte": as_of_ms}}}],
                            }
                        },
                        "sort": [{"created_at": {"order": "desc"}}],
                        "size": 1,
                    }
                    res = es.search(idx["versions_index"], body)
                    hits = res.get("hits", {}).get("hits", [])
                    if hits:
                        src = hits[0].get("_source", {})
                else:
                    doc_id = f"{cfg.project.id}:{matched_path}"
                    doc = es.get_doc(idx["files_index"], doc_id)
                    if doc:
                        src = doc.get("_source", {})

        if not src:
            print(f"[rewindex] File not found: {args.path}", file=sys.stderr)
            return 1

        # Output
        if args.json:
            output = {
                "file_path": src.get("file_path", matched_path),
                "content": src.get("content", ""),
                "language": src.get("language"),
                "line_count": src.get("line_count"),
                "size_bytes": src.get("size_bytes"),
            }
            if as_of_ms:
                output["created_at"] = src.get("created_at")
                output["content_hash"] = src.get("content_hash")
            print(json.dumps(output, indent=2))
        else:
            # Print content directly (suitable for piping)
            print(src.get("content", ""))

        return 0
    except (URLError, HTTPError):
        print(f"Error: could not reach Elasticsearch at {cfg.elasticsearch.host}. Is it running?", file=sys.stderr)
        return 1


def cmd_usage(args: argparse.Namespace) -> int:
    """Output LLM-agent-friendly usage guide and check system status."""
    root = Path.cwd()

    # Check prerequisites
    warnings = []
    try:
        cfg = Config.load(root)
    except Exception:
        warnings.append("⚠️  No .rewindex.json found. Run: rewindex index init")
        cfg = None

    es_ok = False
    indices_ok = False
    watcher_running = False
    files_count = 0
    versions_count = 0

    if cfg:
        try:
            es = ESClient(cfg.elasticsearch.host)
            idx = ensure_indices(es, cfg.resolved_index_prefix())
            es_ok = True

            # Check if indices exist and have data
            if es.index_exists(idx["files_index"]):
                files_count = es.count(idx["files_index"])
                indices_ok = files_count > 0

            if es.index_exists(idx["versions_index"]):
                versions_count = es.count(idx["versions_index"])

            if not indices_ok:
                warnings.append("⚠️  Indices exist but no files indexed. Run: rewindex index start")

            # Check watcher status (try to query the API if running)
            try:
                req = Request("http://localhost:8899/index/status")
                with urlopen(req, timeout=1) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    watcher_running = data.get('watcher') == 'running'
                    if not watcher_running:
                        warnings.append("⚠️  File watcher not running. Start with: rewindex serve")
            except Exception:
                # API not running - not critical for CLI usage
                pass

        except (URLError, HTTPError):
            warnings.append(f"⚠️  Cannot reach Elasticsearch at {cfg.elasticsearch.host}. Is it running?")
            es_ok = False

    # Output status
    if warnings:
        print("# REWINDEX STATUS\n")
        for w in warnings:
            print(w)
        print()

    # Output usage guide
    usage_text = f"""# REWINDEX - LLM Agent Tool Usage Guide

## System Status
✓ Elasticsearch: {"Connected" if es_ok else "Not connected"}
✓ Indices: {f"{files_count} files, {versions_count} versions" if indices_ok else "Empty or not initialized"}
✓ Watcher: {"Running" if watcher_running else "Not running (changes won't auto-index)"}

## Overview
Rewindex is an Elasticsearch-backed code search system with versioning and time-travel capabilities.
All file content is indexed with metadata (functions, classes, imports) for fast, line-aware search.

## Core Capabilities

### 1. SEARCH - Find code across the codebase
Search supports fuzzy matching, partial matching, and temporal queries.

**Basic search:**
```bash
rewindex search "authentication"
rewindex search "useEffect" --limit 50
```

**Filter by language/path:**
```bash
rewindex search "database" --lang python javascript
rewindex search "config" --path "src/**"
```

**Advanced options:**
```bash
rewindex search "imp" --partial          # Partial match (imp → import)
rewindex search "autenticate" --fuzzy    # Fuzzy match (typo tolerance)
rewindex search "token" --json           # JSON output for parsing
```

**Historical search (time-travel):**
```bash
rewindex search "auth" --as-of "2 hours"     # Code from 2 hours ago
rewindex search "config" --as-of "1 day"     # Code from 1 day ago
rewindex search "token" --as-of "10 minutes" # Code from 10 min ago
rewindex search "database" --as-of "2025-01-31T12:00:00"  # Specific time
```

**Show deleted files:**
```bash
rewindex search "auth" --include-deleted
```

**Time formats:** s/seconds, m/minutes, h/hours, d/days, w/weeks, or ISO 8601

### 2. VIEW - Display file content
View any file from the index (current or historical version).
Supports fuzzy path matching - just provide filename or partial path.

**View current file:**
```bash
rewindex view config.py                  # Exact path
rewindex view auth                       # Fuzzy match (finds auth.py, etc)
rewindex view api_server                 # Matches api_server.py
```

**View historical version:**
```bash
rewindex view config.py --as-of "1 hour"
rewindex view auth.py --as-of "3 days"
```

**JSON output (with metadata):**
```bash
rewindex view config.py --json
# Returns: {{"file_path": "...", "content": "...", "language": "...", "line_count": ...}}
```

**Use cases:**
- "Show me the current auth.py file" → `rewindex view auth.py`
- "What did config look like before the deployment?" → `rewindex view config --as-of "2 hours"`
- "Display the file content for main.py" → `rewindex view main.py`

### 3. RESTORE - Save/export files from index
Restore deleted files or save historical versions to disk.
Includes safety checks to prevent accidental overwrites.

**Restore to original location:**
```bash
rewindex restore config.py                      # Current version
rewindex restore auth.py --as-of "10 minutes"   # From 10 min ago
```

**Save to different path:**
```bash
rewindex restore config.py --output backup/config.py
rewindex restore auth.py --as-of "1 day" -o old_auth.py
```

**Overwrite existing file:**
```bash
rewindex restore config.py --force
```

**Use cases:**
- "Recover the deleted test file" → `rewindex restore test_auth.py`
- "Save a backup of config from before migration" → `rewindex restore config.json --as-of "12 hours" -o backup.json`
- "Restore auth.py to how it was this morning" → `rewindex restore auth.py --as-of "8 hours"`

### 4. FIND-FUNCTION / FIND-CLASS - Symbol search
Quickly find where functions or classes are defined.

```bash
rewindex find-function authenticate
rewindex find-class UserService
rewindex find-function parse_config --lang python
```

### 5. HISTORY - View file change history
See all versions of a file over time.

```bash
rewindex history config.py
rewindex history auth.py --limit 10
```

## Common LLM Agent Workflows

### Investigation & Analysis
```bash
# "Show me all authentication-related code"
rewindex search "authenticate" --limit 100 --json

# "Find database connection logic"
rewindex search "database connect" --lang python

# "What error handling exists in the API?"
rewindex search "try except" --path "api/**" --lang python
```

### Time-Travel Debugging
```bash
# "What changed in the config in the last hour?"
rewindex view config.py --as-of "1 hour"
rewindex view config.py

# "Search for auth code from before the bug was introduced"
rewindex search "authentication" --as-of "2 days"

# "Show me the test file from this morning"
rewindex view test_api.py --as-of "6 hours"
```

### Recovery Operations
```bash
# "Restore the deleted configuration file"
rewindex restore config.json

# "Save a copy of the working version from yesterday"
rewindex restore app.py --as-of "1 day" --output app_working.py

# "Get back the auth code from before the refactor"
rewindex restore auth.py --as-of "3 hours"
```

### Code Understanding
```bash
# "Where is the authenticate function defined?"
rewindex find-function authenticate

# "Show me all Python files with 'database' in them"
rewindex search "database" --lang python --files-only

# "List all files that import 'flask'"
rewindex search "import flask" --lang python
```

## Output Formats

All search commands support `--json` for programmatic parsing:
```bash
rewindex search "auth" --json | jq '.results[].file_path'
```

View command outputs raw content (perfect for piping):
```bash
rewindex view config.py | grep password
rewindex view auth.py --as-of "1 hour" > old_auth.py
```

## Tips for LLM Agents

1. **Use fuzzy matching** when unsure of exact names: `--fuzzy`
2. **Use partial matching** for prefix searches: `--partial` (e.g., "imp" finds "import")
3. **Always use `--json`** when parsing results programmatically
4. **Use relative times** instead of ISO 8601: "2 hours" vs "2025-01-31T12:00:00"
5. **Start with broad searches** then refine: search first, then view specific files
6. **Check file history** before restoring: `rewindex history file.py`
7. **Use --limit** to control result size: default is 10, max is practical limit
8. **Combine filters** for precision: `--lang python --path "src/**" --fuzzy`

## Troubleshooting

If searches return no results:
- Try removing filters (`--lang`, `--path`)
- Use `--partial` or `--fuzzy` for flexibility
- Check if file was deleted: add `--include-deleted`
- Verify file is indexed: check if it matches include/exclude patterns

If view/restore fails:
- File path is case-sensitive
- Use fuzzy matching: just provide filename without full path
- Check historical versions: `rewindex history file.py`

## Prerequisites

Required for rewindex to work:
1. Elasticsearch running (default: localhost:9200)
2. Project initialized: `rewindex index init` (creates .rewindex.json)
3. Files indexed: `rewindex index start` (initial index)
4. Watcher running (optional): `rewindex serve` or UI

Check status anytime: `rewindex usage`
"""

    print(usage_text)

    if not es_ok:
        print("\n⚠️  IMPORTANT: Fix Elasticsearch connection before using rewindex")
        return 1

    if not indices_ok:
        print("\n⚠️  IMPORTANT: Index your project before searching")
        print("   Run: rewindex index start")
        return 1

    return 0


def cmd_restore(args: argparse.Namespace) -> int:
    """Restore/export file from index to filesystem."""
    root = Path.cwd()
    cfg = Config.load(root)
    try:
        es = ESClient(cfg.elasticsearch.host)
        idx = ensure_indices(es, cfg.resolved_index_prefix())

        # Parse --as-of if provided
        as_of_ms = None
        if args.as_of:
            try:
                as_of_ms = parse_relative_time(args.as_of)
            except ValueError as e:
                print(f"[rewindex] {e}", file=sys.stderr)
                return 2

        src = None
        matched_path = args.path

        # Try exact lookup first
        if as_of_ms:
            # Historical: search versions index for file at specific time
            body = {
                "query": {
                    "bool": {
                        "must": [{"term": {"file_path": args.path}}],
                        "filter": [{"range": {"created_at": {"lte": as_of_ms}}}],
                    }
                },
                "sort": [{"created_at": {"order": "desc"}}],
                "size": 1,
            }
            res = es.search(idx["versions_index"], body)
            hits = res.get("hits", {}).get("hits", [])
            if hits:
                src = hits[0].get("_source", {})
        else:
            # Current: fetch from files index
            doc_id = f"{cfg.project.id}:{args.path}"
            doc = es.get_doc(idx["files_index"], doc_id)
            if doc:
                src = doc.get("_source", {})

        # Fallback: search by filename/path pattern if exact lookup failed
        if not src:
            index_name = idx["versions_index"] if as_of_ms else idx["files_index"]
            filters = SearchFilters(
                path_pattern=f"*{args.path}*" if "/" not in args.path else None,
                created_before_ms=as_of_ms,
            )
            res = simple_search_es(es, index_name, args.path, filters, SearchOptions(limit=1, highlight=False))
            if res.get("results"):
                top_match = res["results"][0]
                matched_path = top_match["file_path"]

                if as_of_ms:
                    body = {
                        "query": {
                            "bool": {
                                "must": [{"term": {"file_path": matched_path}}],
                                "filter": [{"range": {"created_at": {"lte": as_of_ms}}}],
                            }
                        },
                        "sort": [{"created_at": {"order": "desc"}}],
                        "size": 1,
                    }
                    res = es.search(idx["versions_index"], body)
                    hits = res.get("hits", {}).get("hits", [])
                    if hits:
                        src = hits[0].get("_source", {})
                else:
                    doc_id = f"{cfg.project.id}:{matched_path}"
                    doc = es.get_doc(idx["files_index"], doc_id)
                    if doc:
                        src = doc.get("_source", {})

        if not src:
            print(f"[rewindex] File not found: {args.path}", file=sys.stderr)
            return 1

        content = src.get("content", "")
        output_path = Path(args.output) if args.output else root / matched_path

        # Safety check: don't overwrite without --force
        if output_path.exists() and not args.force:
            print(f"[rewindex] File exists: {output_path}", file=sys.stderr)
            print(f"[rewindex] Use --force to overwrite", file=sys.stderr)
            return 1

        # Create parent directories
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Write file
        output_path.write_text(content, encoding="utf-8")

        time_info = ""
        if as_of_ms and src.get("created_at"):
            dt = datetime.fromtimestamp(src["created_at"] / 1000)
            time_info = f" (from {dt.isoformat()})"

        print(f"[rewindex] Restored: {matched_path} → {output_path}{time_info}")
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
            "  rewindex search \"useEffect\" --path 'src/**'\n"
            "  rewindex search \"token\" --as-of \"2 hours\"  # Historical search\n"
            "  rewindex search \"UserService\" --lang python\n"
            "  rewindex find-function authenticate\n"
            "  rewindex find-class UserService\n"
            "  rewindex view config.py                      # View current file\n"
            "  rewindex view config.py --as-of \"1 day\"      # View from 1 day ago\n"
            "  rewindex restore config.py --as-of \"10m\"     # Restore from 10 minutes ago\n"
            "  rewindex restore config.py -o backup.py     # Save to different path\n"
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
    sp_search.add_argument("--as-of", help="Temporal cutoff. Supports relative ('10m', '2 hours', '3 days') or ISO 8601 ('2025-01-31')")
    sp_search.add_argument("--include-deleted", action="store_true", help="Include non-current/deleted files in files index results")
    sp_search.set_defaults(func=cmd_search)

    # quick filters
    sp_ff = sub.add_parser("find-function", help="Find function definitions")
    sp_ff.add_argument("name")
    sp_ff.add_argument("--lang", nargs="*", help="Filter by language")
    sp_ff.set_defaults(func=cmd_find_function)

    sp_fc = sub.add_parser("find-class", help="Find class definitions")
    sp_fc.add_argument("name")
    sp_fc.add_argument("--lang", nargs="*", help="Filter by language")
    sp_fc.set_defaults(func=cmd_find_class)

    sp_ft = sub.add_parser("find-todos", help="Find TODO/FIXME comments")
    sp_ft.add_argument("--json", action="store_true")
    sp_ft.set_defaults(func=cmd_find_todos)

    # serve
    sp_srv = sub.add_parser("serve", help="Run the HTTP API + UI server")
    sp_srv.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    sp_srv.add_argument("--port", type=int, default=8899, help="Port (default: 8899)")
    sp_srv.add_argument("--beads-root", help="Directory for beads integration (defaults to server's working directory)")
    sp_srv.set_defaults(func=cmd_serve)

    # history/show/diff
    sp_hist = sub.add_parser("history", help="Show version history for a file")
    sp_hist.add_argument("path", help="Relative file path")
    sp_hist.add_argument("--limit", type=int, default=200, help="Maximum number of versions to show (default: 200)")
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

    # view
    sp_view = sub.add_parser("view", help="View file content from index (supports fuzzy path matching)")
    sp_view.add_argument("path", help="File path or filename to view")
    sp_view.add_argument("--as-of", help="View historical version. Supports relative ('10m', '2h', '3d') or ISO 8601")
    sp_view.add_argument("--json", action="store_true", help="Output as JSON with metadata")
    sp_view.set_defaults(func=cmd_view)

    # restore
    sp_restore = sub.add_parser("restore", help="Restore/export file from index to filesystem")
    sp_restore.add_argument("path", help="File path or filename to restore")
    sp_restore.add_argument("--as-of", help="Restore historical version. Supports relative ('10m', '2h', '3d') or ISO 8601")
    sp_restore.add_argument("--output", "-o", help="Output path (default: restore to original location)")
    sp_restore.add_argument("--force", "-f", action="store_true", help="Overwrite existing file")
    sp_restore.set_defaults(func=cmd_restore)

    # usage (LLM-friendly help)
    sp_usage = sub.add_parser("usage", help="Show LLM-agent-friendly usage guide with system status check")
    sp_usage.set_defaults(func=cmd_usage)

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
