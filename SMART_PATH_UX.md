# Smart Path UX - Home Index with Auto-Scoping

## Overview

Rewindex now features intelligent path resolution that prioritizes a home directory index while automatically scoping searches to your current location.

## Key Changes

### 1. Binary Renamed: `rewindex-server` → `rewindex`

Cleaner, simpler name. Works for both searching and serving.

### 2. Search Shorthand

Search is now the default command:

```bash
# Old way
rewindex search "authentication"

# New way (search is implicit)
rewindex "authentication"
```

### 3. Home-First Config Discovery

Priority order:
1. **First**: Check `$HOME/.rewindex.json` (primary home index)
2. **Then**: Walk up from cwd looking for `.rewindex.json`, `.git/`, etc.
3. **Fallback**: Use current directory

### 4. Auto-Path Filtering

When using the home index, searches are automatically scoped to your current subdirectory:

**Scenario 1: In home directory**
```bash
~$ rewindex "auth"
# Searches entire home index (no filter)
```

**Scenario 2: In subdirectory**
```bash
~/repos/myproject$ rewindex "auth"
# Output: [rewindex] Searching in: repos/myproject/ (use --all to search entire index)
# Auto-applies path filter to repos/myproject
# Only shows results under current location
```

**Scenario 3: Override with --all**
```bash
~/repos/myproject$ rewindex "auth" --all
# Searches entire home index (disables auto-path)
```

**Scenario 4: Explicit path**
```bash
~/repos/myproject$ rewindex "auth" --path "repos/other"
# Explicit path overrides auto-path
```

**Scenario 5: Outside home (fallback)**
```bash
/tmp/otherproject$ rewindex "auth"
# Falls back to walking up looking for .rewindex.json
# Uses local project config if found
```

## Implementation Details

### Config Discovery (`config.py`)

**`find_project_root()`** - Updated priority logic:
```python
def find_project_root(start: Path) -> Path:
    # Priority 1: Check $HOME/.rewindex.json first
    home = Path.home()
    home_config = home / ".rewindex.json"
    if home_config.exists():
        return home

    # Priority 2: Walk up from current directory
    # ... (existing logic)
```

**`get_auto_path_filter()`** - New function to calculate relative path:
```python
def get_auto_path_filter(project_root: Path, cwd: Path) -> str | None:
    """
    Calculate automatic path filter based on current working directory.

    Example:
        project_root: /home/user
        cwd: /home/user/repos/myproject
        returns: "repos/myproject"
    """
```

### CLI Changes (`cli.py`)

**Search shorthand** in `main()`:
```python
def main(argv: list[str] | None = None) -> int:
    # If first arg isn't a subcommand, assume it's a search query
    SUBCOMMANDS = {'index', 'search', 'find-function', ...}
    if argv and not argv[0].startswith('-') and argv[0] not in SUBCOMMANDS:
        argv = ['search'] + argv
```

**Auto-path logic** in `cmd_search()`:
```python
def cmd_search(args: argparse.Namespace) -> int:
    cwd = Path.cwd()
    root = _project_root(cwd)

    # Calculate auto-path filter if not explicitly set
    path_filter = args.path
    if path_filter is None and not getattr(args, 'all', False):
        auto_path = get_auto_path_filter(root, cwd)
        if auto_path:
            path_filter = auto_path
            print(f"[rewindex] Searching in: {auto_path}/", file=sys.stderr)
```

**New `--all` flag**:
```python
sp_search.add_argument("--all", action="store_true",
    help="Search entire index (disable auto-path filtering)")
```

### Binary Naming

All references updated from `rewindex-server` to `rewindex`:
- `rewindex-server.spec` → output binary name
- `build-binary.sh` → build paths
- `create-release.sh` → release artifact names
- `install.sh` → download URLs, installation paths

**GitHub Release Assets**:
- `rewindex-Linux-x86_64`
- `rewindex-Linux-arm64`

## User Experience

### Common Workflows

**1. Daily searching from project directories**
```bash
~/repos/frontend$ rewindex "useEffect"
# Auto-scoped to repos/frontend
# Fast, relevant results

~/repos/backend$ rewindex "authenticate"
# Auto-scoped to repos/backend
# No frontend clutter
```

**2. Broad searches**
```bash
~/repos/myproject$ rewindex "TODO" --all
# Searches entire home directory
# Finds todos everywhere
```

**3. Cross-project searches**
```bash
~$ rewindex "DatabaseConnection"
# From home directory, no auto-scoping
# Searches all projects
```

**4. Server still works from home**
```bash
# Service runs from $HOME
ExecStart=%h/.local/bin/rewindex serve --host 127.0.0.1 --port 8899

# Uses $HOME/.rewindex.json
# Indexes entire home directory
# Web UI shows all files
```

## Benefits

1. **✅ Intuitive**: Search from anywhere, get scoped results
2. **✅ Fast**: Smaller result sets when working in subdirectories
3. **✅ Flexible**: `--all` flag for broad searches
4. **✅ Consistent**: Server and CLI use same home index
5. **✅ Git-like UX**: Similar to how git finds `.git` directory
6. **✅ No confusion**: Always uses home index if it exists
7. **✅ Clean CLI**: `rewindex "query"` just works

## Migration Notes

### For Users

No breaking changes! Existing workflows continue to work:

```bash
# These all still work:
rewindex search "auth"
rewindex search "auth" --limit 20
rewindex search "auth" --path "repos/myproject"

# These are new shortcuts:
rewindex "auth"              # Search shorthand
rewindex "auth" --all        # Disable auto-path
```

### For Developers

If you have scripts using `rewindex-server`:
```bash
# Old
/path/to/rewindex-server search "query"

# New
/path/to/rewindex search "query"
# Or just:
/path/to/rewindex "query"
```

## Files Modified

1. **rewindex/config.py**
   - Updated `find_project_root()` to prioritize `$HOME/.rewindex.json`
   - Added `get_auto_path_filter()` function

2. **rewindex/cli.py**
   - Added search shorthand in `main()`
   - Added `--all` flag to search command
   - Added auto-path logic in `cmd_search()`

3. **rewindex-server.spec**
   - Changed output binary name to `rewindex`

4. **build-binary.sh**
   - Updated all paths to use `rewindex`

5. **create-release.sh**
   - Changed release artifact names to `rewindex-Linux-{arch}`
   - Updated installation instructions

6. **install.sh**
   - Updated download URLs to `rewindex-Linux-{arch}`
   - Updated all binary paths
   - Updated CLI examples

## Testing

```bash
# 1. Build binary
./build-binary.sh --clean

# 2. Test search shorthand
cd ~
./dist/rewindex "test"  # Should search entire home

# 3. Test auto-path
cd ~/repos/myproject
./dist/rewindex "test"  # Should auto-scope to repos/myproject

# 4. Test --all override
cd ~/repos/myproject
./dist/rewindex "test" --all  # Should search entire home

# 5. Create release
./create-release.sh v1.0.0 --draft
```

## Documentation Updated

- Install script shows new CLI examples
- Release notes show search shorthand
- Build script shows usage examples
- This document explains the full UX

---

**Status**: ✅ Complete
**Date**: 2025-01-08
**Impact**: Major UX improvement for CLI users
