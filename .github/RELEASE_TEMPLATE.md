# Rewindex v{VERSION}

Fast, LLM-friendly code search powered by Elasticsearch.

## 🚀 Quick Install

**Linux users with Docker + systemd:**

```bash
curl -fsSL https://raw.githubusercontent.com/ryanmrestivo/rewindex/main/install.sh | bash
```

This installs Rewindex as a systemd user service that:
- Automatically sets up Elasticsearch (if needed)
- Indexes your home directory on startup
- Runs a web server on http://127.0.0.1:8899/ui
- Auto-starts on login

**See [INSTALL.md](INSTALL.md) for details.**

---

## 📦 Manual Installation

### Download Binary

Choose your platform:

- **Linux x86_64**: [rewindex-server-Linux-x86_64](https://github.com/ryanmrestivo/rewindex/releases/download/v{VERSION}/rewindex-server-Linux-x86_64)
- **Linux ARM64**: [rewindex-server-Linux-arm64](https://github.com/ryanmrestivo/rewindex/releases/download/v{VERSION}/rewindex-server-Linux-arm64)
- **macOS Intel**: [rewindex-server-Darwin-x86_64](https://github.com/ryanmrestivo/rewindex/releases/download/v{VERSION}/rewindex-server-Darwin-x86_64)
- **macOS Apple Silicon**: [rewindex-server-Darwin-arm64](https://github.com/ryanmrestivo/rewindex/releases/download/v{VERSION}/rewindex-server-Darwin-arm64)

### Install

```bash
# Download and make executable
curl -L https://github.com/ryanmrestivo/rewindex/releases/download/v{VERSION}/rewindex-server-Linux-x86_64 -o rewindex-server
chmod +x rewindex-server

# Move to PATH
sudo mv rewindex-server /usr/local/bin/
# Or user-local:
mv rewindex-server ~/.local/bin/
```

### Prerequisites

Before running Rewindex, you need Elasticsearch:

```bash
# Docker (recommended)
docker run -d \
  --name rewindex-elasticsearch \
  --restart unless-stopped \
  -p 9200:9200 \
  -e "discovery.type=single-node" \
  -e "xpack.security.enabled=false" \
  -e "ES_JAVA_OPTS=-Xms512m -Xmx512m" \
  docker.elastic.co/elasticsearch/elasticsearch:8.11.0

# Verify Elasticsearch is running
curl http://localhost:9200
```

### Usage

```bash
# Initialize project (creates .rewindex.json)
rewindex-server index init

# Start indexing
rewindex-server index start

# Start web server
rewindex-server serve --host 127.0.0.1 --port 8899

# Search via CLI
rewindex-server search "authentication" --lang python

# Launch TUI (if TUI support included)
rewindex-server tui
```

---

## ✨ What's New in v{VERSION}

### Features
- {FEATURE_1}
- {FEATURE_2}

### Improvements
- {IMPROVEMENT_1}
- {IMPROVEMENT_2}

### Bug Fixes
- {BUGFIX_1}
- {BUGFIX_2}

### Breaking Changes
- {BREAKING_CHANGE_1} (if any)

---

## 📚 Documentation

- **Quick Install**: [INSTALL.md](INSTALL.md)
- **Building from Source**: [BUILD.md](BUILD.md)
- **Developer Guide**: [CLAUDE.md](CLAUDE.md)
- **Full README**: [README.md](README.md)

## 🎯 Key Features

- **Fast Search**: Elasticsearch-powered full-text search with line-aware results
- **LLM-Optimized**: JSON output, simple commands, predictable results
- **Web UI**: Canvas-based document viewer with Monaco editor
- **Terminal UI**: Beautiful transparent TUI for tiling window managers
- **File Versioning**: Time-travel through code history
- **Live Watching**: Auto-indexes changes via filesystem events
- **Minimal Dependencies**: Just watchdog required, no heavyweight parsers

## 🏗️ Architecture

- **Two-Index System**: Current files + version history
- **Regex-Based Extraction**: Fast metadata extraction (functions, classes, imports)
- **Line-Aware Context**: Search results include surrounding code context
- **Custom Analyzer**: Splits camelCase, snake_case, handles code tokens

## 🖥️ System Requirements

- **OS**: Linux, macOS (Windows with WSL2)
- **Memory**: 1GB RAM minimum (2GB recommended)
- **Disk**: 100MB for binary + ~10-20% of codebase size for index
- **Elasticsearch**: Required (bundled via Docker in installer)

## 🔧 Configuration

Default config file: `.rewindex.json`

```json
{
  "project": {
    "id": "auto-generated-uuid5",
    "name": "my-project",
    "root": "."
  },
  "elasticsearch": {
    "host": "localhost:9200"
  },
  "indexing": {
    "exclude_patterns": ["node_modules/**", "venv/**"],
    "max_file_size_mb": 10
  }
}
```

Override Elasticsearch host:

```bash
export REWINDEX_ES_HOST="remote-server:9200"
```

## 🐛 Troubleshooting

### Elasticsearch not reachable

```bash
# Check if running
curl http://localhost:9200

# Check Docker container
docker ps | grep elasticsearch
docker logs rewindex-elasticsearch

# Restart
docker restart rewindex-elasticsearch
```

### Service won't start (systemd installation)

```bash
# Check status
systemctl --user status rewindex

# View logs
journalctl --user -u rewindex -f

# Restart
systemctl --user restart rewindex
```

### No search results

```bash
# Check indexing status
rewindex-server index status

# Verify files are being indexed (check exclusion patterns)
# Force reindex
rewindex-server index rebuild --clean
```

## 📊 Performance Benchmarks

- **Indexing Speed**: ~1000 files/second (Python/JS codebases)
- **Search Latency**: <50ms for simple queries, <200ms with context extraction
- **Memory Usage**: ~100MB base + ~1KB per indexed file
- **Startup Time**: <200ms (standalone binary overhead)

## 🌐 Integrations

- **Omarchy**: Auto-detects system theme, syncs colors and fonts
- **Beads**: Optional task management integration via `bd` CLI
- **Monaco Editor**: Full code editing in Web UI
- **$EDITOR**: TUI opens files in your preferred editor

## 🤝 Contributing

See [BUILD.md](BUILD.md) for development setup.

## 📄 License

{LICENSE_INFO}

## 🙏 Acknowledgments

- Elasticsearch team for the search engine
- Textual for the TUI framework
- Monaco Editor for the web code editor
- watchdog for filesystem events

---

**Installation Support:**
- Automated installer: Arch, Ubuntu 20.04+, Debian 11+, Fedora 35+
- Manual installation: Any Linux/macOS with Docker

**Questions?** Open an issue: https://github.com/ryanmrestivo/rewindex/issues

**Updates?** Re-run the installer or download the latest binary.

Enjoy fast, powerful code search! 🔍✨
