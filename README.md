# Rewindex

Fast, local code search powered by Elasticsearch. Index your entire home directory and search from anywhere.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/ryrobes/rewindex/refs/heads/master/install.sh | bash
```

This will:
- Install Elasticsearch via Docker
- Download and install the `rewindex` binary
- Set up a systemd service for auto-indexing
- Index your home directory

## Usage

### Web UI

Open in your browser:
```
http://localhost:8899/ui
```

Features:
- Visual canvas of search results
- Real-time search with filters
- Timeline view for file history
- Monaco editor for viewing/editing files
- Treemap visualization

### CLI Search

Search from anywhere in your home directory:

```bash
# Simple search (auto-scoped to current directory)
rewindex "authentication"

# Search entire home directory
rewindex "authentication" --all

# With filters
rewindex "useEffect" --lang javascript --limit 20

# Fuzzy search (typo-tolerant)
rewindex "athentication" --fuzzy

# Partial/prefix matching
rewindex "auth" --partial
```

**Smart path scoping**: When you search from a subdirectory, results are automatically filtered to that location:

```bash
~/repos/myproject$ rewindex "config"
# Auto-scoped to: repos/myproject/
# Only shows results under current directory

~/repos/myproject$ rewindex "config" --all
# Searches entire home directory
```

### Common Commands

```bash
# Search with options
rewindex "query" --limit 20            # Limit results
rewindex "query" --lang python         # Filter by language
rewindex "query" --path "repos/**"     # Filter by path pattern
rewindex "query" --highlight           # Enable highlighting

# Find symbols
rewindex find-function authenticate
rewindex find-class UserService
rewindex find-todos

# View file history
rewindex history path/to/file.py
rewindex view path/to/file.py --as-of "2 hours"

# Service management
systemctl --user status rewindex       # Check status
systemctl --user restart rewindex      # Restart
journalctl --user -u rewindex -f       # View logs
```

## Configuration

The service indexes your home directory by default. Configuration lives in `~/.rewindex.json`.

### Exclude Patterns

Add patterns to `~/.rewindexignore` (gitignore syntax):

```
# Ignore large directories
node_modules/
.venv/
build/

# Ignore file types
*.log
*.tmp
```

### Elasticsearch

Default: `http://localhost:9200`

To use a remote Elasticsearch server:
```bash
export REWINDEX_ES_HOST="remote-server:9200"
```

## Features

- **Fast Search**: Elasticsearch-powered full-text search
- **Auto-Indexing**: Background watcher keeps index up-to-date
- **Version History**: Travel back in time to see old versions
- **Smart Scoping**: Auto-filters to current directory
- **Web + CLI**: Use whichever interface you prefer
- **Metadata Extraction**: Finds functions, classes, imports, TODOs
- **Multi-Language**: Supports 80+ programming languages

## Uninstall

```bash
systemctl --user stop rewindex
systemctl --user disable rewindex
rm -f ~/.local/bin/rewindex
rm -f ~/.local/bin/rewindex-service
rm -f ~/.config/systemd/user/rewindex.service
systemctl --user daemon-reload

# Docker commands (add 'sudo' if needed on your system)
docker stop rewindex-elasticsearch
docker rm rewindex-elasticsearch
```

## Help

```bash
rewindex --help              # General help
rewindex search --help       # Search options
rewindex index --help        # Indexing commands
```

## Documentation

For development documentation, architecture details, and advanced configuration, see:
- [CLAUDE.md](CLAUDE.md) - Developer guide
- [SMART_PATH_UX.md](SMART_PATH_UX.md) - Smart path feature details

## License

MIT
