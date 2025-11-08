Rewindex – Local Code Search (Elasticsearch) WIP

Quick start if in Omarchy Linux:

`curl -fsSL https://raw.githubusercontent.com/ryrobes/rewindex/refs/heads/master/install.sh | bash`

- Index files into Elasticsearch with per-file current doc + version history
- Extract simple metadata (imports, functions, classes, TODOs)
- CLI for indexing and search (speaks to ES)
- Minimal HTTP server exposing simple search and index status

Notes

- Requires a running Elasticsearch on `localhost:9200` (see Quickstart below). No Python client dependency is required; we use HTTP directly.
- Configuration reads defaults. If `.rewindex.json` exists, it will be loaded. `.rewindex.yml` is supported only if PyYAML is available; otherwise it’s ignored.

Quickstart

Install (developer mode):

- pip install -e .

Install globally with pipx (recommended):

- pipx install .

Build wheel/sdist and install via pipx from dist/:

- python -m build
- pipx install dist/rewindex-0.1.0-py3-none-any.whl

Or build and install from sdist/wheel via `pyproject.toml`.

1) Start Elasticsearch (Docker):

   `docker compose up -d`

2) Initialize indices (from project root):

   `python3 -m rewindex.cli index init`

   This auto-generates a unique project id (if missing), creates indices if needed, and performs an initial full index.

3) Index the project (one-shot):

   `python3 -m rewindex.cli index start`

   To keep indexing with a simple polling watcher:

   `python3 -m rewindex.cli index start --watch`

4) Search:

   `python3 -m rewindex.cli search "authentication" --lang python --limit 5`

   Highlighting is off by default for LLM-friendly output. Enable with `--highlight`:

   `python3 -m rewindex.cli search "authentication" --highlight`

5) Start HTTP server + Web UI (from the project or any subfolder):

   `python3 -m rewindex.cli serve --host 127.0.0.1 --port 8899`

   (Alternatively: `python3 -m rewindex.api_server`)

   - POST /search/simple  (JSON body: {"query": "...", "filters": {...}, "options": {...}})
   - GET  /index/status

6) Open the Web UI: `http://localhost:8899/ui`
   - Status shows `project_root` and `project_id` that the server is grounded to
   - Use "Start Watcher" to begin live indexing; toggle "Follow CLI" to visualize CLI searches

   - Pan/zoom canvas with documents as tiles (Monaco-based viewer if online; falls back to plain <pre> otherwise)
   - Sidebar shows search, results and index status

Rebuild indices after analyzer updates

If you update analyzers/mappings (e.g., to improve underscore handling), rebuild:

- Clean rebuild (drops and recreates indices):

  `python3 -m rewindex.cli index rebuild --clean`

- Reindex without dropping (keeps indices):

  `python3 -m rewindex.cli index rebuild`

Temporal and History (CLI)

- Search across all versions:

  `python3 -m rewindex.cli search "token" --all-versions`

- Search as-of a timestamp (ISO 8601):

  `python3 -m rewindex.cli search "token" --as-of 2025-01-31T12:00:00`

- Include deleted (non-current) files in results (files index):

  `python3 -m rewindex.cli search "token" --include-deleted`

- Show history for a file:

  `python3 -m rewindex.cli history path/to/file.py`

- Show a specific version by hash:

  `python3 -m rewindex.cli show path/to/file.py --version <content_hash>`

- Diff two versions by hash:

  `python3 -m rewindex.cli diff path/to/file.py <hash1> <hash2>`

Elasticsearch Quickstart (Docker)

Rewindex requires a running Elasticsearch on `localhost:9200`. Use the following to spin up a local single-node instance for development.

Option A — docker run

- Pull and run (8.x):

  `docker run --name rewindex-es -p 9200:9200 -p 9300:9300 -e discovery.type=single-node -e xpack.security.enabled=false -e ES_JAVA_OPTS="-Xms512m -Xmx512m" docker.elastic.co/elasticsearch/elasticsearch:8.12.2`

- Verify:

  `curl http://localhost:9200`

  Should return cluster info JSON with `tagline: "You Know, for Search"`.

Ports and config expectations

- Elasticsearch HTTP: `localhost:9200` (default from FRD and used by `.rewindex.json` below)
- Elasticsearch transport: `localhost:9300` (cluster-internal; exposed for completeness)
- Rewindex HTTP (this repo’s minimal API server): `localhost:8899`

Notes

- Security is disabled for local dev via `xpack.security.enabled=false`. For a secured setup, omit that flag and use the auto-generated credentials shown in container logs.
- If you need to adjust memory, change `ES_JAVA_OPTS` (e.g., `-Xms1g -Xmx1g`).
- This project now indexes to and searches from Elasticsearch directly.
