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

# Install with TUI support (adds textual + pygments)
pip install -e ".[tui]"

# Global install with pipx (recommended)
pipx install .

# Global install with TUI support
pipx install "rewindex[tui]"

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
python3 -m rewindex.cli find-todos

# View and restore files
python3 -m rewindex.cli view path/to/file.py
python3 -m rewindex.cli view file.py --as-of "2 hours"
python3 -m rewindex.cli view file.py --as-of 2025-01-31T12:00:00 --json
python3 -m rewindex.cli restore path/to/file.py --as-of "1 day" --output restored.py
python3 -m rewindex.cli restore path/to/file.py --force

# LLM-friendly usage guide
python3 -m rewindex.cli usage

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
# With Beads integration (external task management system)
python3 -m rewindex.cli serve --host 127.0.0.1 --port 8899 --beads-root /path/to/beads/project
# Web UI available at: http://localhost:8899/ui

# Launch interactive TUI (requires: pip install rewindex[tui])
python3 -m rewindex.cli tui
python3 -m rewindex.cli tui "search query"  # Start with initial query
# Or use the rewindex command directly:
rewindex tui
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

**db.py** - SQLite database module (EXPERIMENTAL - not currently integrated)
- Parallel storage system with files/versions tables
- FTS5 full-text search support (optional)
- Functions: connect, upsert_file, stats
- Stored in `.rewindex/scope.db` per project
- May be integrated in future as ES alternative or companion

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
- Commands:
  - **Index**: init, start, status, rebuild
  - **Search**: search, find-function, find-class, find-todos
  - **Temporal**: history, show, diff, view (with --as-of), restore (with --as-of)
  - **Server**: serve (with optional --beads-root)
  - **Utility**: usage (LLM-friendly help with system status)

**api_server.py** - HTTP + WebSocket server
- Search endpoints: `/search/simple`, `/index/status`
- UI endpoints: `/ui`, `/static/*`
- Beads integration endpoints: `/beads/check`, `/beads/list`, `/beads/create`, `/beads/update`, `/beads/close`, `/beads/ready`
- File operations: `/file/save`, `/file/restore`
- WebSocket: `/ws/events` for live updates to Web UI
- Serves static assets from `rewindex/web/` (packaged with setuptools)
- Supports `--beads-root` flag to integrate with external Beads task management system

**tui/** - Terminal User Interface (Optional - requires `pip install rewindex[tui]`)
- `__init__.py`: TUI availability checking and entry point
- `app.py`: Main Textual application with reactive widgets
- `sparkline.py`: ASCII sparkline generation for timeline visualization
- `widgets/`: Placeholder for future widget modules
- **Features**:
  - **Transparent backgrounds**: Works beautifully with Hyprland + kitty/alacritty/ghostty
  - **Live search**: Search-as-you-type with debounced queries
  - **Split-pane view**: Results list (left) and preview pane (right)
  - **Timeline sparkline**: Shows 7-day file activity history using Unicode block characters
  - **Keyboard navigation**: vim-style (j/k) and arrow keys
  - **Editor integration**: Press 'e' to open in $EDITOR with line number support
  - **Syntax highlighting**: Context preview with line numbers (via Pygments)
- **Keyboard shortcuts**:
  - `j/k` or `↑/↓`: Navigate results
  - `Enter`: View full file (in preview)
  - `e`: Edit in $EDITOR (vim, nvim, code, etc.)
  - `f`: Toggle fuzzy search mode
  - `p`: Toggle partial/prefix matching
  - `/`: Focus search bar
  - `t`: Toggle timeline mode (placeholder for future time travel)
  - `?`: Help (placeholder)
  - `q`: Quit
- **Dependencies**: textual>=0.47.0, pygments>=2.17.0

**web/** - Static UI (2900+ lines - highly sophisticated)
- `index.html`: Canvas-based document tile viewer with Monaco editor (CDN) and diff editor
- `app.js` (2900+ lines): Feature-rich WebSocket client with:
  - **Results-Only Mode (DEFAULT)**: Renders ONLY search results (max 200 files) for blazing fast performance
  - **Show All Mode (optional)**: Traditional behavior showing entire codebase with ?mode=full parameter
  - **Visualization modes**: Standard tiles, treemap view, treemap folders, size by bytes
  - **Timeline/scrubber**: Temporal navigation with sparkline visualization
  - **Monaco integration**: Full code editor with syntax highlighting for inline editing
  - **Monaco diff editor**: Side-by-side comparison for historical versions
  - **File operations**: View, edit, save, restore historical versions
  - **Search modes**: Follow CLI queries, follow file updates, fuzzy matching, partial matches, include deleted files
  - **Language analytics**: Color-coded language bar and legend
  - **Beads integration**: Task/ticket management panel with filtering (all/open/working/closed)
  - **Dynamic text sizing**: Adaptive text rendering based on tile size
  - **Recent updates tracking**: Shows last 20 file modifications with action types
- `styles.css`: Comprehensive layout with modal overlays, split views, timeline controls
- Monaco provides syntax highlighting for 80+ languages automatically
- Falls back to `<pre>` tags if Monaco CDN is unavailable (offline mode)
- **Performance**: Results-Only mode provides 350x faster initial load compared to Show All mode

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

### View and Restore Operations
- **view command**: Retrieves file content from index without writing to filesystem
  - Supports exact path lookup or fuzzy filename matching
  - `--as-of` flag supports relative time (e.g., "2 hours", "3 days") or ISO 8601 timestamps
  - Queries versions index for historical content or files index for current
  - Outputs raw content (suitable for piping) or JSON with metadata
- **restore command**: Writes file content from index to filesystem
  - Same lookup logic as view (exact path or fuzzy match with --as-of)
  - `--output` flag specifies destination path (defaults to original location)
  - `--force` flag allows overwriting existing files
  - Useful for recovering deleted files or reverting to historical versions

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

## TUI (Terminal User Interface) Usage

Rewindex includes a beautiful, transparent TUI for interactive code search, perfect for tiling window managers like Hyprland.

### Launching the TUI

```bash
# Basic launch
rewindex tui

# Launch with initial search query
rewindex tui "authentication"

# Or use Python module syntax
python3 -m rewindex.cli tui
```

### TUI Layout

```
╭─ Rewindex ─────────────────────────── [Timeline: ▁▂▃▅▇█▇▅▃▂▁] ─ 2025-01-23 14:30 ─╮
│ 🔍 Search: your query here█                                  [j/k: nav  e: edit]  │
├──────────────────────────────┬───────────────────────────────────────────────────┤
│ 📊 Results (15)              │ 📄 rewindex/auth.py:45                            │
│                              │                                                    │
│ 🐍 rewindex/auth.py:45       │   42 │                                            │
│    def authenticate(token)   │   43 │ class AuthHandler:                         │
│                              │ ► 45 │     def authenticate(token: str):          │
│ 🟨 frontend/login.js:89      │   46 │         """Validates JWT tokens"""         │
│    function authenticate()   │   47 │         if not token:                      │
│                              │   48 │             return False                   │
│ 🦀 server/auth.rs:234        │                                                    │
│    fn authenticate(...)      │                                                    │
├──────────────────────────────┴───────────────────────────────────────────────────┤
│ q: Quit │ ?: Help │ /: Search │ e: Edit │ ↑↓: Navigate                          │
╰───────────────────────────────────────────────────────────────────────────────────╯
```

### Key Features

1. **Live Search**: Type in the search bar and results update in real-time
2. **Search Modes**: Fuzzy and partial matching toggles with checkboxes or keyboard shortcuts
3. **Split View**: Results on left, file preview on right
4. **Timeline Sparkline**: Shows file modification activity over the last 7 days
5. **Language Indicators**: Emoji and color-coded language markers (🐍 Python, 🟨 JavaScript, etc.)
6. **Transparent Background**: Works perfectly with terminal transparency for aesthetic integration

### Keyboard Shortcuts

**Navigation**:
- `j` or `↓`: Next result
- `k` or `↑`: Previous result
- `Ctrl+D`: Page down (future)
- `Ctrl+U`: Page up (future)

**Actions**:
- `Enter`: Update preview pane with selected file
- `e`: Edit file in $EDITOR (respects vim +line, code -g file:line syntax)
- `/`: Focus search input
- `q`: Quit application
- `Ctrl+C`: Force quit

**Search Modes**:
- `f`: Toggle fuzzy matching (typo-tolerant search)
- `p`: Toggle partial matching (prefix/wildcard search)
- Click checkboxes to toggle modes
- Changes automatically re-run search

**Mouse Support**:
- Click any result to select and preview
- Scroll wheel to navigate results
- Click checkboxes to toggle search modes
- Full mouse integration for modern terminals

**Future Features**:
- `t`: Toggle timeline mode for time-travel search
- `?`: Show help modal with all shortcuts
- `y`: Yank file path to clipboard

### Hyprland Integration

Add to your `~/.config/hypr/hyprland.conf`:

```bash
# Rewindex code search (Super + /)
bind = SUPER, slash, exec, kitty --class rewindex-tui -e rewindex tui
windowrulev2 = float, class:^(rewindex-tui)$
windowrulev2 = size 80% 80%, class:^(rewindex-tui)$
windowrulev2 = center, class:^(rewindex-tui)$
windowrulev2 = opacity 0.95, class:^(rewindex-tui)$

# Or with alacritty:
# bind = SUPER, slash, exec, alacritty --class rewindex-tui -e rewindex tui

# Or with ghostty:
# bind = SUPER, slash, exec, ghostty --class=rewindex-tui rewindex tui
```

### Customization

The TUI uses Textual's theming system. To customize colors, create a custom theme by extending `RewindexTUI` and overriding the CSS:

```python
# custom_tui.py
from rewindex.tui.app import RewindexTUI

class CustomRewindexTUI(RewindexTUI):
    CSS = RewindexTUI.CSS + """
    ResultsList {
        border: solid cyan;
    }

    PreviewPane {
        border: solid magenta;
    }
    """

if __name__ == "__main__":
    app = CustomRewindexTUI()
    app.run()
```

## Beads Integration (External Task Management)

Rewindex Web UI can integrate with Beads, an external task/ticket management system (invoked via `bd` command). This is **optional** and requires:
- The `bd` command-line tool to be installed and available in PATH
- Starting the server with `--beads-root` pointing to a Beads project directory
- If not specified, defaults to the server's working directory

### Web UI Features
- **Beads Panel**: Toggle panel showing all tickets with filters (all/open/working/closed)
- **Ticket Management**: Create, update status, close tickets via Web UI
- **Integration Status**: Shows whether `bd` command is available and functional
- **Auto-refresh**: Polls for ticket updates periodically when panel is open

### API Endpoints
- `GET /beads/check` - Check if `bd` command is available
- `GET /beads/list?project_root=...` - List all tickets for project
- `POST /beads/create` - Create new ticket (body: `{title, description?, project_root?}`)
- `POST /beads/update` - Update ticket status (body: `{ticket_id, status, project_root?}`)
- `POST /beads/close` - Close ticket (body: `{ticket_id, project_root?}`)
- `GET /beads/ready` - Check if Beads is ready (checks BD_HOME env var)

### Notes
- Beads integration is completely optional; Rewindex works without it
- If `bd` command fails or is not found, Web UI gracefully hides Beads features
- All Beads operations run `bd` CLI commands via subprocess in the specified working directory

## Web UI Viewing Modes

The Rewindex Web UI supports two viewing modes optimized for different use cases:

### Results-Only Mode (Default)

**Overview**: Renders ONLY files from search results (max 200) for optimal performance and focus.

**Behavior**:
- **Initial Load**: Clean canvas with search prompt (no files rendered)
- **After Search**: Only matching files appear on canvas
- **Layout**: Simple 3-column grid (no folder hierarchy for instant rendering)
- **Performance**: 350x faster initial load, instant layout, snappy interactions
- **Best For**: Daily code search, large codebases, focused work

**Usage**:
```bash
# Default: Results-Only Mode
http://localhost:8899/ui

# Or explicitly enable it (button in UI)
Click "Results Only" button (active state)
```

**Features**:
- ✅ All search modes work (fuzzy, partial, deleted files)
- ✅ All visualization modes work (treemap, folders, size-by-bytes)
- ✅ Timeline and time travel work
- ✅ Monaco editor, diff view, file operations
- ✅ Limits to 200 files for performance
- ✅ Clean, focused experience

### Show All Mode (Optional)

**Overview**: Traditional behavior - renders entire codebase with dimming for non-matches.

**Behavior**:
- **Initial Load**: Renders ALL files from index (may take 3-5 seconds for large codebases)
- **After Search**: Dims non-matching files (keeps them visible for context)
- **Visualization**: Full codebase overview, comprehensive treemap
- **Best For**: Exploring new codebases, understanding structure, seeing full context

**Usage**:
```bash
# Show All Mode via URL parameter
http://localhost:8899/ui?mode=full
http://localhost:8899/ui?show_all=true

# Or toggle via button in UI
Click "Results Only" button to disable it
```

**Features**:
- ✅ See entire codebase at once
- ✅ Dimming highlights matches while preserving context
- ✅ Full treemap visualizations
- ✅ Good for exploration and discovery

### Mode Comparison

| Feature | Results-Only (Default) | Show All (Optional) |
|---------|----------------------|-------------------|
| Initial Load | Instant (<10ms) | Slow (3-5 seconds) |
| Search Results | Only matches visible | Matches bright, others dimmed |
| Max Files | 200 | Unlimited |
| Performance | ⚡ Blazing fast | 🐢 Slower with large codebases |
| Best For | Daily work, focus | Exploration, context |
| Canvas State | Empty until search | Always populated |

### Switching Modes

Toggle between modes at any time:

**Via UI Button**:
```
1. Click "Results Only" button in left sidebar
2. Active (green) = Results-Only Mode
3. Inactive (gray) = Show All Mode
```

**Via URL Parameter**:
```bash
# Bookmark your preferred mode
http://localhost:8899/ui              # Results-Only (default)
http://localhost:8899/ui?mode=full    # Show All
```

### Workflow Examples

**Example 1: Quick Search (Results-Only)**
```
1. Open UI → See search prompt
2. Type "authentication" → 15 matching files appear
3. Click tile → Edit in Monaco
4. Clear search → Canvas clears
```

**Example 2: Full Exploration (Show All)**
```
1. Open UI with ?mode=full → All 2000 files render
2. Enable treemap → Visualize structure
3. Search "auth" → Non-matches dimmed
4. See how auth relates to entire codebase
```

**Example 3: Hybrid Approach**
```
1. Start in Results-Only (default)
2. Search for specific code
3. Switch to Show All for context
4. Switch back to Results-Only for speed
```

### Technical Details

**Results-Only Mode Implementation**:
- URL parameter: `resultsOnlyMode = !urlParams.get('show_all')`
- On search: Stores results in `lastSearchResults[]`
- `refreshAllTiles()` renders only `lastSearchResults.slice(0, 200)`
- `layoutSimpleGrid()` arranges tiles in 3-column grid (no folder hierarchy)
- `doSearch()` triggers canvas rebuild with limited file set
- `spawnAll()` skips initial load, shows prompt
- **Performance**: Avoids expensive `buildTree()` and complex folder layout

**Show All Mode Implementation**:
- Traditional behavior: fetch `/files` endpoint
- Renders all tiles on canvas
- Search applies dimming via CSS classes
- `renderResults()` iterates all tiles to add/remove `dim` class

For detailed implementation, see `WEB_UI_RESULTS_ONLY_MODE.md`.

## Web UI: Secondary Filter (Progressive Refinement)

The Web UI features a unique **Secondary Filter** system for intuitive query refinement through visual, progressive filtering.

### Overview

**Concept**: Instead of complex Boolean queries (`query1 AND query2`), users layer searches visually:
1. **Primary Search** (left panel) → Initial result set (e.g., "authenticate" → 50 files)
2. **Secondary Filter** (right panel) → Refine further (e.g., "token" → 12 files)
3. **Canvas** → Shows ALL primary results, highlights intersection with golden glow ⭐

**Three-Panel Layout**:
```
┌─────────────┬──────────────────────┬──────────────┐
│  Primary    │       Canvas         │  Secondary   │
│  Results    │    (File Tiles)      │  Filter      │
│  (50 files) │  ⭐ = Both queries   │  (12 files)  │
└─────────────┴──────────────────────┴──────────────┘
```

### Visual Hierarchy

**Files Matching PRIMARY Only**:
- Normal tile rendering
- Standard colors and appearance

**Files Matching BOTH Queries** (intersection):
- **Golden glow**: `box-shadow: 0 0 25px rgba(255, 215, 0, 0.6)`
- **Star badge**: ⭐ in top-right corner
- **Pulsing animation**: Gentle 2-second pulse cycle
- **Elevated appearance**: Visually "above" other tiles

### Usage

**Enable Secondary Filter**:
```
1. Perform primary search: "authenticate"
2. Click "Secondary Filter" button in control panel
3. Right panel slides in (340px wide)
4. Type refinement query: "token"
5. Files matching BOTH queries get golden glow
```

**Independent Search Options**:
- Each panel has its own fuzzy (~) and partial (*) toggles
- Primary: fuzzy enabled, partial disabled
- Secondary: fuzzy disabled, partial enabled
- **Both settings active simultaneously**

**Result Counts**:
```
Primary: 50 → Secondary: 12 results
```
Clear visual flow showing refinement impact.

### Workflow Examples

**Example 1: Error Handling in User Module**
```
Primary: "user" (partial mode) → 80 files
Secondary: "error" (fuzzy mode) → 15 files
Canvas: 80 files visible, 15 with golden glow
Result: Quickly identify user-related error handling
```

**Example 2: React Hooks Pattern**
```
Primary: "useState" → 45 components
Secondary: "useEffect" → 28 components
Canvas: Golden highlights show components using BOTH hooks
Try: Change secondary to "fetch" → 12 components with API calls
```

**Example 3: Authentication + Authorization**
```
Primary: "authenticate" → 50 files
Secondary: "permission" → 8 files
Canvas: Intersection shows files handling both concerns
Click: Any result in either panel zooms to file
```

### Technical Implementation

**Intersection Logic**:
```javascript
// Secondary search queries Elasticsearch normally
const secondaryResults = await fetchJSON('/search/simple', {
  query: 'token',
  options: { fuzziness: 'AUTO' }
});

// Client-side intersection with primary results
const primaryPaths = new Set(lastSearchResults.map(r => r.file_path));
const intersection = secondaryResults.filter(r =>
  primaryPaths.has(r.file_path)
);

// Apply visual highlighting to canvas tiles
for(const [path, tile] of tiles){
  if(intersection.has(path)){
    tile.classList.add('secondary-match');
  }
}
```

**State Management**:
```javascript
let secondaryFilterEnabled = false;
let secondarySearchQuery = '';
let secondarySearchResults = [];
let secondaryFuzzyMode = false;
let secondaryPartialMode = false;
```

**Event Flow**:
```
User types in secondary input
  ↓ (300ms debounce)
doSecondarySearch()
  ↓
Fetch from API
  ↓
Filter to primary result paths (intersection)
  ↓
Render secondary panel results
  ↓
Add .secondary-match class to tiles
  ↓
Golden glow + star appear on canvas
```

### Performance

- **Search Time**: ~100ms per query (primary + secondary)
- **Intersection**: <1ms (client-side Set filtering)
- **Highlighting**: <5ms (DOM class updates)
- **Animation**: GPU-accelerated (CSS transform/opacity)
- **Total Refinement**: ~205ms end-to-end

### Edge Cases

**Primary Search Cleared**:
- Automatically clears secondary query and highlighting
- Shows prompt in secondary panel

**Primary Search Updated**:
- Automatically re-runs secondary search to update intersection
- Highlighting updates in real-time

**Mode Switching**:
- Works in both Results-Only and Show All modes
- Highlighting applies to whichever tiles are rendered

**Time Travel**:
- Both queries respect timeline timestamp
- Intersection computed from historical results

### Compatibility

✅ Results-Only Mode
✅ Show All Mode
✅ Timeline / Time Travel
✅ Fuzzy Search (per panel)
✅ Partial Match (per panel)
✅ Deleted Files
✅ Monaco Editor
✅ Diff View
✅ Beads Panel (shifts right when secondary opens)
✅ Language Analytics

### Files Modified

**`index.html`**:
- Added secondary sidebar HTML structure
- Added "Secondary Filter" toggle button

**`styles.css`** (+180 lines):
- Secondary sidebar styles
- 3-panel layout adjustments
- `.secondary-match` visual effects (glow, star, animation)
- Workspace/beads panel shifting when secondary active

**`app.js`** (+160 lines):
- State variables for secondary filter
- `doSecondarySearch()` function (intersection logic)
- `renderSecondaryResults()` function
- Event handlers for secondary controls
- Integration with primary search workflow

For detailed implementation, see `WEB_UI_SECONDARY_FILTER.md`.

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
- `rewindex/web/index.html` - HTML structure with modals, overlays, timeline, panels
- `rewindex/web/styles.css` - Styling for tiles, treemaps, diff viewer, timeline scrubber
- `rewindex/web/app.js` (2853 lines) - Complex WebSocket client with:
  - Canvas-based tile/treemap rendering with pan/zoom
  - Timeline sparkline with scrubber for temporal navigation
  - Monaco editor integration (code editor + diff editor)
  - Language color scheme generation and legend
  - Beads panel for task management
  - Multiple view modes and search filters
- Monaco editor loaded from CDN (online), falls back to `<pre>` (offline)
- Key state variables: scale, offsetX, offsetY, currentAsOfMs, followCliMode, treemapMode, etc.

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

**Beads integration not working:**
- Verify `bd` command is installed: `which bd` or `bd --version`
- Check if Beads project is initialized in the directory
- Verify `--beads-root` points to correct directory
- Check server logs for `[beads/list DEBUG]` messages
- Check BD_HOME environment variable is set if using custom Beads installation

**Timeline/scrubber not showing data:**
- Timeline only appears when temporal data exists (file versions over time)
- Index must have version history; run indexer with `--watch` for a period of time
- Check that versions index is populated: `rewindex index status`

**TUI not available:**
- Install TUI dependencies: `pip install rewindex[tui]` or `pip install textual pygments`
- Verify installation: `python3 -c "from rewindex.tui import TUI_AVAILABLE; print(TUI_AVAILABLE)"`
- TUI requires textual>=0.47.0 and pygments>=2.17.0
- Check for errors: `rewindex tui` will show missing dependencies

**TUI transparency not working:**
- Ensure terminal supports transparency (kitty, alacritty, ghostty, wezterm, etc.)
- Check terminal emulator configuration has `background_opacity` or similar set
- Rewindex TUI uses transparent backgrounds by default (no background colors)
- If using tmux/screen, transparency may not work depending on configuration

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
