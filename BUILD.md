# Building Standalone Binaries

This document describes how to build standalone binaries of Rewindex using PyInstaller.

## Overview

Rewindex can be packaged as a standalone executable that includes:
- Python interpreter
- All Python dependencies (watchdog, optionally textual + pygments)
- Web UI assets (HTML, CSS, JS, images)
- No external Python installation required

## End-User Installation (Recommended)

For most users, the easiest way to install Rewindex is via the automated installer:

### One-Line Install

```bash
# Install Rewindex as a systemd user service
curl -fsSL https://raw.githubusercontent.com/ryanmrestivo/rewindex/main/install.sh | bash

# Or download and inspect first:
curl -fsSL https://raw.githubusercontent.com/ryanmrestivo/rewindex/main/install.sh -o install.sh
bash install.sh
```

### What the Installer Does

The installation script automatically:

1. **Checks Prerequisites**
   - Verifies Docker is installed and running
   - Checks systemd availability

2. **Sets Up Elasticsearch**
   - Detects existing Elasticsearch instance on port 9200
   - If not found, creates Docker container with:
     - Single-node configuration
     - 512MB heap size
     - Persistent data volume
     - Auto-restart enabled

3. **Installs Rewindex**
   - Downloads latest binary from GitHub releases
   - Installs to `~/.local/bin/rewindex-server`
   - Creates service wrapper script
   - Adds `~/.local/bin` to PATH

4. **Configures Systemd Service**
   - Creates user service at `~/.config/systemd/user/rewindex.service`
   - Runs from `$HOME` (indexes your home directory)
   - Logs to `~/.local/share/rewindex/rewindex.log`
   - Auto-starts on login
   - Auto-restarts on failure

5. **Starts the Service**
   - Enables and starts Rewindex immediately
   - Begins initial indexing of home directory
   - Web UI available at http://127.0.0.1:8899/ui

### Interactive Configuration

The installer prompts for:
- Whether to set up Elasticsearch (if not detected)
- Server port (default: 8899)
- Server host (default: 127.0.0.1)

### Post-Install

After installation:

```bash
# Check service status
systemctl --user status rewindex

# View logs
journalctl --user -u rewindex -f

# Access Web UI
xdg-open http://127.0.0.1:8899/ui

# Use CLI
rewindex-server search "your query"
rewindex-server tui
```

### Uninstall

```bash
# Download and run uninstall script
curl -fsSL https://raw.githubusercontent.com/ryanmrestivo/rewindex/main/uninstall.sh | bash

# Or with options:
bash uninstall.sh --keep-data --keep-elasticsearch
```

The uninstall script removes:
- Rewindex binary and service
- Configuration files (optional)
- Elasticsearch container (optional)

---

## Building from Source

The sections below are for developers who want to build Rewindex binaries from source.

## Prerequisites

### Required Dependencies

```bash
# Install PyInstaller
pip install pyinstaller

# Install Rewindex dependencies
pip install -e .

# Or install with build tools
pip install -e ".[build]"
```

### Optional: TUI Support

To include TUI support in the binary:

```bash
pip install -e ".[tui]"
```

## Building the Binary

### Quick Start

```bash
# Basic build (server + CLI only)
./build-binary.sh

# Build with TUI support
./build-binary.sh --tui

# Clean build (remove previous artifacts)
./build-binary.sh --clean
```

### Manual Build

If you prefer to run PyInstaller directly:

```bash
pyinstaller rewindex-server.spec --clean --noconfirm
```

## Build Output

The build process creates:

```
dist/
└── rewindex-server          # Standalone executable (~50-80 MB)

build/                       # Temporary build files (can be deleted)
```

## Installation

### System-Wide Installation

```bash
# Linux/macOS
sudo cp dist/rewindex-server /usr/local/bin/
sudo chmod +x /usr/local/bin/rewindex-server

# Test installation
rewindex-server --help
```

### User-Local Installation

```bash
# Linux/macOS
mkdir -p ~/.local/bin
cp dist/rewindex-server ~/.local/bin/
chmod +x ~/.local/bin/rewindex-server

# Add to PATH if needed (add to ~/.bashrc or ~/.zshrc)
export PATH="$HOME/.local/bin:$PATH"
```

## Usage

The binary works exactly like the `rewindex` command:

```bash
# Initialize and index a project
rewindex-server index init
rewindex-server index start

# Start the web server
rewindex-server serve --host 127.0.0.1 --port 8899

# Search
rewindex-server search "authentication" --lang python

# TUI (if included in build)
rewindex-server tui
```

## Distribution

### Creating a Release Package

```bash
# Build the binary
./build-binary.sh --clean --tui

# Create a tarball
VERSION=$(grep '^version' pyproject.toml | cut -d'"' -f2)
tar czf rewindex-server-${VERSION}-$(uname -s)-$(uname -m).tar.gz \
    -C dist rewindex-server \
    --transform 's,^,rewindex-server/,' \
    -C .. README.md CLAUDE.md

# Result: rewindex-server-0.1.0-Linux-x86_64.tar.gz
```

### Docker Deployment

The standalone binary is perfect for Docker images:

```dockerfile
FROM ubuntu:22.04

# Copy the pre-built binary
COPY dist/rewindex-server /usr/local/bin/rewindex-server

# Install Elasticsearch (if needed)
# ... elasticsearch setup ...

EXPOSE 8899
CMD ["rewindex-server", "serve", "--host", "0.0.0.0", "--port", "8899"]
```

## Platform-Specific Notes

### Linux

- Binary works on most Linux distributions
- Requires glibc (standard on most distros)
- Tested on: Ubuntu 20.04+, Debian 11+, Fedora 35+, Arch Linux

### macOS

- Build on the oldest macOS version you want to support
- Binary requires macOS 10.13+ (High Sierra)
- Universal binaries (Intel + Apple Silicon) require separate builds:
  ```bash
  # Build for current architecture
  ./build-binary.sh

  # For universal binary, build on both architectures and use lipo
  ```

### Windows

PyInstaller supports Windows, but requires adjustments:

1. Run build on Windows machine
2. Use `rewindex-server.exe` output
3. May need Visual C++ Redistributable

## Binary Size Optimization

The default binary is ~50-80 MB. To reduce size:

### 1. Exclude Optional Modules

Edit `rewindex-server.spec`:

```python
excludes=[
    'matplotlib',
    'numpy',
    'pandas',
    'scipy',
    'PIL',
    'tkinter',
    'pytest',
    # Add more unused packages
],
```

### 2. Use UPX Compression

```bash
# Install UPX
sudo apt-get install upx  # Ubuntu/Debian
brew install upx          # macOS

# Build with compression (already enabled in spec)
./build-binary.sh
```

### 3. Strip Debug Symbols

Edit `rewindex-server.spec`:

```python
exe = EXE(
    ...
    strip=True,    # Enable stripping
    ...
)
```

## Troubleshooting

### "Module not found" errors

If the binary fails with import errors:

1. Add missing modules to `hiddenimports` in `rewindex-server.spec`:
   ```python
   hiddenimports=[
       'rewindex',
       'your.missing.module',
   ]
   ```

2. Rebuild:
   ```bash
   ./build-binary.sh --clean
   ```

### Web assets not loading

If the web UI shows a blank page:

1. Verify web assets are bundled:
   ```bash
   # Extract and inspect
   pyinstaller-extractor dist/rewindex-server
   ```

2. Check the `datas` section in `rewindex-server.spec`

### Large binary size

- Remove unused optional dependencies before building
- Enable UPX compression
- Use `--exclude-module` for large unused packages

### Runtime errors

Run with verbose output:

```bash
./dist/rewindex-server --help 2>&1 | less
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build Binary

on:
  release:
    types: [created]

jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]

    steps:
    - uses: actions/checkout@v3

    - uses: actions/setup-python@v4
      with:
        python-version: '3.11'

    - name: Install dependencies
      run: |
        pip install -e ".[build,tui]"

    - name: Build binary
      run: ./build-binary.sh --clean --tui

    - name: Upload artifact
      uses: actions/upload-artifact@v3
      with:
        name: rewindex-server-${{ matrix.os }}
        path: dist/rewindex-server
```

## Performance Considerations

- **Startup Time**: Standalone binary adds ~100-200ms startup overhead
- **Memory**: Similar to Python script (~50-100 MB base + ES client)
- **Execution**: Runtime performance identical to Python script
- **File Size**: Binary is larger but self-contained

## Alternatives to PyInstaller

If you encounter issues with PyInstaller, consider:

- **Nuitka**: Compiles Python to C (smaller, faster)
- **cx_Freeze**: Similar to PyInstaller, different approach
- **Docker**: Full isolation, larger but portable
- **zipapp**: Python-only, requires Python installed

## Further Reading

- [PyInstaller Documentation](https://pyinstaller.org/en/stable/)
- [PyInstaller Spec Files](https://pyinstaller.org/en/stable/spec-files.html)
- [Distribution Best Practices](https://packaging.python.org/en/latest/guides/distributing-packages-using-setuptools/)
