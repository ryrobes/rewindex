# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Rewindex** is an Elasticsearch-backed local code search system designed specifically for LLM agents and developers. It indexes codebases with file versioning, metadata extraction, and provides fast, line-aware search results through CLI, HTTP API, and Web UI.

### Core Design Philosophy

1. **Content is the document, everything else is metadata** - The indexed document is just the file content. All other data (functions, classes, imports) are metadata fields for filtering.
2. **Fast regex over complex parsing** - Uses simple regex patterns for metadata extraction instead of ASTs. Good enough beats perfect.
3. **LLM-first** - Optimized for how LLMs search: simple commands, predictable JSON output, line-aware results with context.
4. **Zero Python dependencies** - Uses only stdlib (urllib, json, hashlib). No elasticsearch-py, requests, or external parsers.

## Development Commands

### Prerequisites
Start Elasticsearch (required):
```bash
docker compose up -d
# Verify: curl http://localhost:9200
```

### Installation
```bash
# Developer mode (editable install)
pip install -e .

# Global install with pipx (recommended)
pipx install .

# Build wheel/sdist
python -m build
```

### Common Development Workflow
```bash
# Initialize project (creates .rewindex.json, indices, and performs initial index)
python3 -m rewindex.cli index init

# Index project once
python3 -m rewindex.cli index start

# Index with live watching (polling-based)
python3 -m rewindex.cli index start --watch

# Search (JSON output for LLMs by default, highlighting off)
python3 -m rewindex.cli search "authentication" --lang python --limit 5

# Enable highlighting for human-readable output
python3 -m rewindex.cli search "authentication" --highlight

# Search with file path filter
python3 -m rewindex.cli search "useEffect" --path "src/**"

# Symbol search
python3 -m rewindex.cli find-function authenticate
python3 -m rewindex.cli find-class UserService

# Temporal queries (uses versions index)
python3 -m rewindex.cli search "token" --all-versions
python3 -m rewindex.cli search "token" --as-of 2025-01-31T12:00:00

# Version management
python3 -m rewindex.cli history path/to/file.py
python3 -m rewindex.cli show path/to/file.py --version <hash>
python3 -m rewindex.cli diff path/to/file.py <hash1> <hash2>

# Rebuild indices after schema changes
python3 -m rewindex.cli index rebuild --clean

# Start HTTP server + Web UI
python3 -m rewindex.cli serve --host 127.0.0.1 --port 8899
# Web UI available at: http://localhost:8899/ui
```

### Running Tests
```bash
# No test framework is currently set up
# When adding tests, use pytest and aim for 80%+ coverage
```

## Architecture

### Two-Index System

**1. Files Index** (`rewindex_{project_id}_files`)
- Current state of all files in the project
- Document ID format: `{project_id}:{file_path}`
- Contains: full content, metadata (functions, classes, imports), file properties
- Field `is_current`: distinguishes active vs deleted files

**2. Versions Index** (`rewindex_{project_id}_versions`)
- Historical versions of all files
- Document ID: content hash (SHA-256 hex)
- Enables temporal queries and version history
- Links versions via `previous_hash` field

### Key Modules

**config.py** - Configuration management
- Loads `.rewindex.json` or `.rewindex.yml` from project root
- Auto-generates stable project ID using UUID5 from path
- Handles pattern substitution: `${project.id}`, `${project.name}`
- Parses `.gitignore` and merges patterns with built-in exclusions
- `parse_gitignore()`: converts gitignore syntax to glob patterns
- `load_gitignore_patterns()`: reads .gitignore from project root

**es.py** - Minimal HTTP Elasticsearch client
- Uses urllib (no requests or elasticsearch-py dependency)
- Methods: index_exists, create_index, get_doc, put_doc, search, bulk
- Accepts self-signed certs for local dev

**es_schema.py** - Index mappings and settings
- Custom analyzer: `code_index_analyzer` with `word_delimiter_graph` filter
- Splits on case change, numerics, underscores: `getUserId` → `get`, `User`, `Id`
- Stop words: `the`, `and`, `or`, `if`, `then`, `else`

**language.py** - File extension → language mapping
- Simple dict-based detection (no external library)
- Comprehensive support for 80+ file types:
  - **Web**: HTML, CSS, SCSS, SASS, LESS, JavaScript, TypeScript, Vue, Svelte
  - **Systems**: C, C++, Rust, Go
  - **Application**: Python, Java, Kotlin, Scala, C#, F#, Swift, Objective-C
  - **Scripting**: Ruby, PHP, Perl, Lua, R, Shell (bash/zsh/fish), PowerShell
  - **Data/Markup**: JSON, YAML, TOML, XML, SVG, Markdown, reStructuredText, LaTeX
  - **Database**: SQL, MySQL, PostgreSQL
  - **Other**: Dockerfile, Makefile, GraphQL, Protocol Buffers, Dart, Clojure, Elixir, Erlang, Haskell, OCaml
- Special file detection (Dockerfile, Makefile, .gitignore, .env, etc.)
- Shebang-based detection for scripts without extensions

**extractor.py** - Regex-based metadata extraction
- `SimpleExtractor` class with language-specific patterns
- Extracts: imports, functions, classes, TODOs, test indicators
- Fast and dependency-free (no tree-sitter)

**indexing.py** - File scanning and indexing
- `index_project()`: scans directory, computes hashes, indexes/updates documents
- `poll_watch()`: simple polling-based file watcher (no inotify/watchdog)
- Handles deletions and renames via hash-based detection
- Returns stats: `{"added": n, "updated": n, "skipped": n}`
- `_is_binary_file()`: detects binary files via null bytes and UTF-8 validation
- `_should_index_file()`: applies include/exclude patterns and size limits

**search.py** - Search with line-aware context
- `simple_search_es()`: builds Elasticsearch query from filters/options
- `_compute_line_context()`: extracts line numbers and surrounding context
- Multi-strategy matching: marked tokens → full query → token coverage → fallback
- Returns results with `file_path`, `matches` (with line numbers, context, highlights)

**cli.py** - Command-line interface
- All commands routed through argparse subcommands
- Integrates with HTTP server via best-effort notifications to `/events/query`
- JSON output mode for LLM consumption

**api_server.py** - HTTP + WebSocket server
- Endpoints: `/search/simple`, `/index/status`, `/ui`, `/static/*`
- WebSocket: `/ws/events` for live updates to Web UI
- Serves static assets from `rewindex/web/` (packaged with setuptools)

**web/** - Static UI
- `index.html`: Canvas-based document tile viewer with Monaco editor (CDN)
- `app.js`: WebSocket client, search/status UI, watcher controls, language normalization for Monaco
- `styles.css`: Layout and tile styling
- Monaco provides syntax highlighting for all supported languages automatically
- Falls back to `<pre>` tags if Monaco CDN is unavailable (offline mode)

### Data Flow

1. **Indexing**: `cli.py` → `indexing.py` → `es.py` → Elasticsearch
   - Scans files matching include/exclude patterns
   - Computes SHA-256 hash per file
   - Extracts metadata via regex
   - Inserts/updates both files and versions indices

2. **Search**: `cli.py` → `search.py` → `es.py` → Elasticsearch
   - Builds bool query with filters (language, path, functions, classes)
   - Executes search with highlighting
   - Post-processes: maps highlights to line numbers, extracts context
   - Returns structured JSON with file paths, lines, context

3. **API Server**: `api_server.py` → `search.py`/`indexing.py` → `es.py`
   - HTTP requests → search or index operations
   - WebSocket broadcasts events to connected UI clients
   - Background thread runs poll_watch when watcher is started

### Document Structure

**Files Index Document:**
```json
{
  "_id": "{project_id}:{file_path}",
  "_source": {
    "content": "<full file content>",
    "file_path": "src/auth.py",
    "file_name": "auth.py",
    "extension": ".py",
    "language": "python",
    "size_bytes": 1234,
    "line_count": 45,
    "last_modified": 1705315800000,
    "indexed_at": 1705316000000,
    "content_hash": "a3f5c9d8...",
    "previous_hash": "b2e4d7c9...",
    "is_current": true,
    "imports": ["hashlib", "jwt"],
    "defined_functions": ["authenticate", "validate_token"],
    "defined_classes": ["AuthService"],
    "todos": ["Add rate limiting"],
    "has_tests": false,
    "project_id": "uuid-here",
    "project_root": "/path/to/project"
  }
}
```

**Versions Index Document:**
```json
{
  "_id": "<content_hash>",
  "_source": {
    "file_path": "src/auth.py",
    "content_hash": "a3f5c9d8...",
    "previous_hash": "b2e4d7c9...",
    "created_at": 1705315800000,
    "is_current": true,
    "content": "<full file content>",
    "language": "python",
    "project_id": "uuid-here"
  }
}
```

## Important Implementation Details

### Project Root and Config Discovery
- `find_project_root()` walks up from cwd looking for `.rewindex/`, `.rewindex.json`, `.rewindex.yml`, or `.git/`
- Falls back to cwd if nothing found
- `ensure_project_config()` creates `.rewindex.json` with auto-generated project ID if missing

### Content Hashing and Versioning
- SHA-256 hex of UTF-8 encoded file content
- On file change: insert new version doc, update `previous_hash` link
- Old version marked `is_current: false` in versions index
- Files index always has exactly one doc per file path (upserted)

### Binary File Detection
- Two-layer filtering approach:
  1. **Extension-based exclusion**: Fast filtering via exclude patterns (images, PDFs, executables, etc.)
  2. **Content-based detection**: Checks first 8KB for null bytes and UTF-8 validity
- `_is_binary_file()` returns `True` if:
  - File contains null bytes (`\x00`)
  - Content fails UTF-8 decoding
  - File is unreadable
- Binary files are skipped and counted in the "skipped" metric
- `.gitignore` patterns applied before binary detection for efficiency

### File Watching
- Simple polling loop (`poll_watch()`) re-indexes all candidates every interval
- Skips unchanged files (hash comparison)
- Debounce controlled by `cfg.indexing.watch.debounce_ms`
- No OS-level watchers (inotify/kqueue) to avoid dependencies

### Rename and Deletion Detection
- `_mark_missing_as_deleted()` queries all current files, compares to present_paths set
- If file missing: set `is_current: false`, `deleted: true`, `deleted_at: <timestamp>`
- If same hash appears at new path: set `renamed_to`/`renamed_from` fields

### Search Result Line Mapping
- Elasticsearch returns highlight fragments (snippets of content with `<mark>` tags)
- `_compute_line_context()` uses multiple strategies to find the matching line number:
  1. Count marked tokens in each line, pick best match
  2. Fallback: find full query string position in content
  3. Fallback: token coverage scoring
  4. Fallback: first marked/query token position
- Once line found, extract `context_lines` before/after

### Elasticsearch Analyzer Configuration
- **Tokenizer**: `standard`
- **Filter**: `word_delimiter_graph` splits on:
  - Underscores/dashes: `user_id` → `user`, `id`
  - Case changes: `getUserId` → `get`, `User`, `Id`
  - Numerics: `file2` → `file`, `2`
- **preserve_original**: true (keeps `getUserId` as single token too)
- **stop words**: minimal common English words

### HTTP API Patterns
- No FastAPI/Flask dependency: uses `http.server.HTTPServer` with custom `BaseHTTPRequestHandler`
- JSON responses: `self.send_response(200)` + `self.send_header("Content-Type", "application/json")`
- WebSocket: implemented via `websockets` library (if available) or disabled
- Static files served from package data: `importlib.resources` fallback to `pkg_resources`

## Configuration Reference

### .rewindex.json Example
```json
{
  "project": {
    "id": "auto-generated-uuid5",
    "name": "my-project",
    "root": "."
  },
  "elasticsearch": {
    "host": "localhost:9200",
    "index_prefix": "rewindex_${project.id}"
  },
  "indexing": {
    "include_patterns": ["*.py", "**/*.py", "*.js", "**/*.js"],
    "exclude_patterns": ["node_modules/**", "venv/**", "*.min.js"],
    "max_file_size_mb": 10
  },
  "search": {
    "defaults": {
      "limit": 20,
      "context_lines": 3,
      "highlight": false
    }
  }
}
```

### File Filtering and Ignore Patterns

**Automatically loaded from `.gitignore`:**
- Reads and parses `.gitignore` from project root on config load
- Merges patterns with built-in exclusions (no duplicates)
- Supports standard gitignore syntax: comments, wildcards, directory patterns
- Converts gitignore patterns to glob format for matching
- Negation patterns (starting with `!`) are currently not supported

**Built-in default exclusions:**
- Minified files: `*.min.js`, `*.min.css`
- Dependencies: `node_modules/**`, `venv/**`
- Build artifacts: `dist/**`, `build/**`, `*.pyc`, `__pycache__/**`
- Version control: `.git/**`
- Logs/DBs: `*.log`, `*.sqlite`, `*.db`
- Secrets: `.env*`, `*.key`, `*.pem`, `*.cert`
- Binary/media files: images, archives, executables, fonts, videos

**Include behavior:**
- By default, `include_patterns` is empty = index all text files
- Relies on exclude patterns + binary detection to filter
- Override via `.rewindex.json` to restrict to specific file types

## Extension Points

### Adding Language Support
1. Add extension mapping to `language.py`: `LANGUAGE_MAP`
2. Add extraction patterns to `extractor.py`: `SimpleExtractor.extract_metadata()`
   - Use regex for imports, functions, classes, exports
3. Update `es_schema.py` if new metadata fields needed

### Modifying Search Ranking
- Edit `search.py`: `simple_search_es()` query construction
- Boost fields: `"file_name.text^2"` (currently 2x boost for filename matches)
- Add boosting: `"boost": filters.boost.get("recent_files", 1.0)` (not fully implemented)

### Custom Elasticsearch Analyzers
- Edit `es_schema.py`: `FILES_INDEX_BODY["settings"]["analysis"]`
- Add synonyms: `"filter": {"code_synonym": {"type": "synonym", "synonyms": [...]}}`
- Adjust stopwords, char filters, token filters

### Web UI Customization
- `rewindex/web/index.html` - HTML structure
- `rewindex/web/styles.css` - Styling
- `rewindex/web/app.js` - WebSocket client, search UI logic
- Monaco editor loaded from CDN (online), falls back to `<pre>` (offline)

## Troubleshooting

**Elasticsearch not reachable:**
- Verify: `curl http://localhost:9200`
- Ensure Docker container running: `docker ps | grep elasticsearch`
- Check config: `.rewindex.json` has correct `elasticsearch.host`

**No results for search:**
- Verify indexing: `rewindex index status` (check counts)
- Try without filters: `rewindex search "query"`
- Enable debug mode: `rewindex search "query" --debug --json` (shows ES query)
- Check if files match include/exclude patterns in config

**Files not indexed:**
- Check file size (default limit: 10MB)
- Verify extension in `include_patterns`
- Check if excluded by pattern (e.g., `node_modules/**`)
- Look for UTF-8 decode errors (read_text uses `errors="ignore"`)

**Stale search results:**
- Indices not refreshed: `es.refresh(index_name)` called after indexing
- Try: `rewindex index rebuild` to force full reindex

**Web UI not loading:**
- Check server running: `rewindex serve --host 127.0.0.1 --port 8899`
- Navigate to: `http://localhost:8899/ui`
- Check browser console for errors
- Monaco editor requires internet (CDN); will fallback to plain text if offline

## Performance Considerations

- **Polling watcher**: Naive, scans all files every interval. Good for <10k files. For larger repos, consider OS-level watchers (future work).
- **Parallel indexing**: `cfg.indexing.parallel_workers` currently set to 1 (sequential). Increase for faster indexing.
- **Batch size**: `cfg.indexing.watch.batch_size` (not fully implemented). Use bulk API for large batches.
- **Index size**: Stores full content in both indices. For very large codebases, consider compression or content deduplication.
- **Search performance**: Elasticsearch is fast (<50ms for simple queries). Complexity comes from post-processing (line mapping).

## Future Enhancements (FRD.md)

From the Functional Requirements Document:
- Semantic search with embeddings (Phase 2)
- Cross-repository search
- Git blame integration
- Smart snippet extraction for LLM context windows
- Natural language query translation
- Tree-sitter integration (only if regex proves insufficient)
