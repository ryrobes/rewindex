# Rewindex TUI Quickstart

## Installation

```bash
# Install with TUI support
pip install rewindex[tui]

# Or if already installed
pip install textual pygments
```

## Launch

```bash
# Basic launch
rewindex tui

# With initial search
rewindex tui "function_name"
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` or `↓` | Next result |
| `k` or `↑` | Previous result |
| `Enter` | Preview selected file |
| `e` | Edit in $EDITOR |
| `f` | Toggle fuzzy search |
| `p` | Toggle partial matching |
| `/` | Focus search bar |
| `q` | Quit |
| `Ctrl+C` | Force quit |

## Mouse Support

The TUI fully supports mouse interaction:

| Action | Effect |
|--------|--------|
| **Click on result** | Select result and show preview |
| **Scroll wheel up** | Previous result |
| **Scroll wheel down** | Next result |
| **Click checkbox** | Toggle search mode (fuzzy/partial) |

## Features

- ✨ **Transparent backgrounds** - Perfect for Hyprland/tiling WMs
- 🔍 **Live search** - Results update as you type
- 🎛️ **Search modes** - Fuzzy and partial matching with checkboxes
- 📊 **Timeline sparkline** - See file activity over last 7 days
-  **Language indicators** - Color-coded file types
- ⌨️  **Vim bindings** - j/k navigation
- 📝 **Editor integration** - Opens at exact line number

## Hyprland Integration

Add to `~/.config/hypr/hyprland.conf`:

```bash
bind = SUPER, slash, exec, kitty --class rewindex-tui -e rewindex tui
windowrulev2 = float, class:^(rewindex-tui)$
windowrulev2 = size 80% 80%, class:^(rewindex-tui)$
windowrulev2 = center, class:^(rewindex-tui)$
windowrulev2 = opacity 0.95, class:^(rewindex-tui)$
```

Now press `Super+/` to search your code!

## Language Emoji Guide

- 🐍 Python
- 🟨 JavaScript
- 🔷 TypeScript
- 🦀 Rust
- 🔵 Go
- ☕ Java
- ©️ C/C++
- 📄 Other languages

## Requirements

- Elasticsearch running on `localhost:9200`
- Project indexed: `rewindex index init`
- Terminal with transparency support (optional but recommended):
  - kitty
  - alacritty
  - ghostty
  - wezterm
  - foot

## Troubleshooting

**TUI won't start:**
```bash
# Check dependencies
python3 -c "from rewindex.tui import TUI_AVAILABLE; print(TUI_AVAILABLE)"

# Should print: True
```

**No results:**
```bash
# Make sure project is indexed
rewindex index status

# If counts are 0, run:
rewindex index init
```

**Timeline is empty:**
- Timeline shows last 7 days of file changes
- Run indexer with `--watch` to generate version history
- Or make some file changes and re-index

## Advanced Usage

**Custom editor:**
```bash
export EDITOR="code"  # VS Code
export EDITOR="nvim"  # Neovim
rewindex tui
```

**Search syntax:**
- `auth` - Simple text search
- `def authenticate` - Multi-word search
- Future: `lang:python path:src/** auth` - Filtered search (coming soon)

## What's Next?

- [ ] Filter syntax in search bar (lang:, path:, etc.)
- [ ] Time travel mode (press `t` to scrub through history)
- [ ] Help modal (press `?`)
- [ ] Clipboard integration (press `y` to yank path)
- [ ] Syntax highlighting in preview pane (Pygments)
- [ ] Page up/down (Ctrl+U/D)

---

For full documentation, see [CLAUDE.md](./CLAUDE.md)
