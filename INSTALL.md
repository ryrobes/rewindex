# Quick Install Guide

Fast, automated installation of Rewindex for Linux systems with Docker and systemd.

## One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/ryanmrestivo/rewindex/main/install.sh | bash
```

## What Gets Installed

- **Rewindex Server**: Standalone binary at `~/.local/bin/rewindex-server`
- **Elasticsearch**: Docker container (if not already running)
- **Systemd Service**: User service that runs on login
- **Web UI**: Available at http://127.0.0.1:8899/ui
- **Desktop Entry**: Application launcher (search "REWINDex" in your app menu)
- **Ignore Patterns**: `~/.rewindexignore` prevents indexing caches, build artifacts, browser data

## Requirements

- Linux (tested on Arch, Ubuntu, Debian, Fedora)
- Docker (installed and running)
- systemd (standard on most distros)
- curl or wget

## Installation Process

The installer will:

1. Check if Elasticsearch is running
2. Prompt to create Docker container if needed
3. Download the latest Rewindex binary
4. Install to `~/.local/bin/`
5. Create a systemd user service
6. Start indexing your home directory
7. Launch web server on port 8899

**Total time:** ~2-3 minutes (depending on download speed)

## After Installation

### Access the Web UI

```bash
# Open in default browser
xdg-open http://127.0.0.1:8899/ui

# Or visit directly
http://127.0.0.1:8899/ui
```

### Use the CLI

```bash
# Search your code
rewindex-server search "authentication"

# Launch TUI (if built with TUI support)
rewindex-server tui

# View help
rewindex-server --help
```

### Manage the Service

```bash
# Check status
systemctl --user status rewindex

# View live logs
journalctl --user -u rewindex -f

# Restart
systemctl --user restart rewindex

# Stop
systemctl --user stop rewindex

# Start
systemctl --user start rewindex
```

## Configuration

Configuration file: `~/.rewindex.json` (auto-created in your home directory)

Service runs from `$HOME` and indexes your entire home directory (respecting `.gitignore` patterns).

### Change Server Port

Edit the service file:

```bash
systemctl --user edit rewindex
```

Add:

```ini
[Service]
Environment="REWINDEX_PORT=9999"
```

Then reload and restart:

```bash
systemctl --user daemon-reload
systemctl --user restart rewindex
```

### Use Remote Elasticsearch

Edit the service file:

```bash
systemctl --user edit rewindex
```

Add:

```ini
[Service]
Environment="REWINDEX_ES_HOST=remote-server.com:9200"
```

Reload and restart as above.

### Customize Ignore Patterns

The installer creates `~/.rewindexignore` with sensible defaults for home directory indexing. This file prevents indexing of:

- Browser caches (Chrome, Brave, Firefox)
- Application caches and build artifacts
- Node modules, Python venv, package managers
- Temporary files and swap files
- Large media files (videos, ISOs)

**To customize:**

```bash
# Edit the ignore file
nano ~/.rewindexignore
# Or
code ~/.rewindexignore

# Add your custom patterns (uses .gitignore syntax)
# For example, to exclude a specific directory:
echo "Documents/large-dataset/**" >> ~/.rewindexignore

# Restart service to apply changes
systemctl --user restart rewindex
```

**Common patterns to add:**

```gitignore
# Exclude Downloads folder
Downloads/**

# Exclude specific project directories
projects/archived/**
old-repos/**

# Exclude large datasets
*.csv
*.parquet
data/**
```

**Pattern syntax** (same as `.gitignore`):
- `*` matches any characters except `/`
- `**` matches any directory depth
- `#` for comments
- Patterns are relative to home directory

See the [full .rewindexignore template](https://github.com/ryanmrestivo/rewindex/blob/main/.rewindexignore) for all defaults.

## File Locations

| Item | Location |
|------|----------|
| Binary | `~/.local/bin/rewindex-server` |
| Service File | `~/.config/systemd/user/rewindex.service` |
| Logs | `~/.local/share/rewindex/rewindex.log` |
| Config | `~/.rewindex.json` |
| Index Data | `~/.rewindex/` |
| Desktop Entry | `~/.local/share/applications/REWINDex.desktop` |
| Icon | `~/.local/share/rewindex/logo.png` |
| Ignore Patterns | `~/.rewindexignore` |
| ES Container | `rewindex-elasticsearch` (Docker) |
| ES Data Volume | `rewindex-es-data` (Docker) |

## Logs

```bash
# Live tail
journalctl --user -u rewindex -f

# Last 100 lines
journalctl --user -u rewindex -n 100

# Today's logs
journalctl --user -u rewindex --since today

# View log file directly
tail -f ~/.local/share/rewindex/rewindex.log
```

## Troubleshooting

### Service won't start

```bash
# Check service status
systemctl --user status rewindex

# View recent logs
journalctl --user -u rewindex -n 50

# Check if Elasticsearch is running
curl http://localhost:9200

# Restart Elasticsearch
docker restart rewindex-elasticsearch
```

### Elasticsearch connection refused

```bash
# Check if container is running
docker ps | grep rewindex-elasticsearch

# View Elasticsearch logs
docker logs rewindex-elasticsearch

# Restart container
docker restart rewindex-elasticsearch
```

### Web UI not loading

```bash
# Check if service is running
systemctl --user is-active rewindex

# Check if port is in use
ss -tuln | grep 8899

# Try different port
systemctl --user edit rewindex
# Add: Environment="REWINDEX_PORT=9999"
systemctl --user restart rewindex
```

### Binary not found

```bash
# Check if binary exists
ls -lh ~/.local/bin/rewindex-server

# Check PATH
echo $PATH | grep -o "$HOME/.local/bin"

# Add to PATH (if missing)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

## Uninstall

```bash
# Download and run uninstall script
curl -fsSL https://raw.githubusercontent.com/ryanmrestivo/rewindex/main/uninstall.sh | bash
```

Options:
- `--keep-data`: Keep configuration and indexed data
- `--keep-elasticsearch`: Keep Elasticsearch container

Complete removal:

```bash
# Remove everything
bash uninstall.sh

# Or manually:
systemctl --user stop rewindex
systemctl --user disable rewindex
rm -f ~/.local/bin/rewindex-server
rm -f ~/.local/bin/rewindex-service
rm -f ~/.config/systemd/user/rewindex.service
rm -rf ~/.local/share/rewindex
rm -rf ~/.rewindex
docker stop rewindex-elasticsearch
docker rm rewindex-elasticsearch
docker volume rm rewindex-es-data
```

## Advanced Usage

### Index Specific Directory

By default, Rewindex indexes from `$HOME`. To index a specific directory:

```bash
# Stop the service
systemctl --user stop rewindex

# Navigate to target directory
cd /path/to/project

# Initialize and index
rewindex-server index init
rewindex-server index start

# Or run server manually
rewindex-server serve --host 127.0.0.1 --port 8899
```

### Multiple Projects

To index multiple projects, run separate instances on different ports:

```bash
# Project 1
cd ~/projects/project1
rewindex-server serve --port 8899 &

# Project 2
cd ~/projects/project2
rewindex-server serve --port 8900 &
```

Or create separate systemd services for each project.

## Getting Help

- **Documentation**: See BUILD.md and CLAUDE.md in the repo
- **Issues**: https://github.com/ryanmrestivo/rewindex/issues
- **CLI Help**: `rewindex-server --help`
- **Usage Guide**: `rewindex-server usage` (LLM-friendly help)

## Updates

To update to the latest version:

```bash
# Stop service
systemctl --user stop rewindex

# Download new binary
curl -fsSL https://github.com/ryanmrestivo/rewindex/releases/latest/download/rewindex-server-Linux-x86_64 -o ~/.local/bin/rewindex-server
chmod +x ~/.local/bin/rewindex-server

# Restart service
systemctl --user start rewindex

# Or use the installer (will upgrade in place)
curl -fsSL https://raw.githubusercontent.com/ryanmrestivo/rewindex/main/install.sh | bash
```

## Performance Tips

- **Initial indexing**: May take 5-30 minutes depending on home directory size
- **Memory usage**: ~100-200 MB for Rewindex + 512 MB for Elasticsearch
- **Disk space**: Elasticsearch index is ~10-20% of your codebase size
- **CPU usage**: Minimal after initial indexing (<1% idle, 5-10% during searches)

## Security Notes

- Service runs as your user (not root)
- Binds to 127.0.0.1 by default (not accessible externally)
- Elasticsearch has no authentication (local-only)
- Indexed data stored in `~/.rewindex/` (user-accessible only)

To expose externally (not recommended without authentication):

```bash
systemctl --user edit rewindex
```

Add:

```ini
[Service]
Environment="REWINDEX_HOST=0.0.0.0"
```

**Warning**: This makes your code searchable on your local network!

## Next Steps

1. Wait for initial indexing to complete (check logs)
2. Open Web UI: http://127.0.0.1:8899/ui
3. Try searching for common terms in your code
4. Explore the TUI: `rewindex-server tui`
5. Read the full documentation in CLAUDE.md

Enjoy fast, LLM-friendly code search! 🚀
