# Rewindex Launcher Integration

Fast code search directly from your application launcher (Rofi, Walker, Wofi, dmenu).

## Quick Start

### Rofi/Wofi Integration

Search your codebase from Rofi or Wofi:

```bash
# Search interactively
rewindex-rofi

# Direct search
rewindex-rofi "authentication"

# Bind to keyboard shortcut (Hyprland example)
bind = SUPER, S, exec, rewindex-rofi
```

### Walker Integration (Omarchy)

If using Walker, the plugin is auto-installed to `~/.config/walker/scripts/rewindex.sh`.

**Setup:**

1. Add to `~/.config/walker/config.toml`:

```toml
[[plugin]]
name = "rewindex"
src = "~/.config/walker/scripts/rewindex.sh"
prefix = "rw"
```

2. Reload Walker

**Usage in Walker:**

```
rw authentication      # Search for "authentication"
rw useEffect          # Search for "useEffect"
rw TODO               # Find all TODOs
rw status             # Check Rewindex status
```

## Features

### Visual Search Results

Results display with:
- 🐍 Language icons (Python, JavaScript, Rust, etc.)
- 📄 File path and line number
- 📝 Code snippet preview

Example:
```
🐍 rewindex/auth.py:45  │  def authenticate(token: str):
🟨 frontend/login.js:12 │  function handleLogin() {
🦀 server/main.rs:234   │  fn authenticate_user(req: Request) -> Result
```

### Smart Editor Detection

Opens files in your preferred editor with line number support:

1. **omarchy-edit** (Omarchy users)
2. **VS Code** (`code --goto file:line`)
3. **Neovim/Vim** (in terminal with `+line`)
4. **Nano** (in terminal with `+line`)
5. **$EDITOR** (fallback to environment variable)

### Keyboard Shortcuts

**In Rofi:**
- `Enter` - Open file in editor
- `Ctrl+Y` - Copy file path to clipboard (future)
- `Escape` - Cancel

## Installation

### Automatic (with Omarchy)

If Omarchy 3.x+ is detected, launcher integrations are installed automatically during installation.

### Manual Installation

#### Rofi/Wofi

```bash
# Download script
curl -fsSL https://raw.githubusercontent.com/ryrobes/rewindex/main/rofi-ui.sh \
  -o ~/.local/bin/rewindex-rofi
chmod +x ~/.local/bin/rewindex-rofi

# Bind to keyboard shortcut
# Example for Hyprland (~/.config/hypr/hyprland.conf):
bind = SUPER, S, exec, rewindex-rofi
```

#### Walker

```bash
# Download plugin
mkdir -p ~/.config/walker/scripts
curl -fsSL https://raw.githubusercontent.com/ryrobes/rewindex/main/walker-ui.sh \
  -o ~/.config/walker/scripts/rewindex.sh
chmod +x ~/.config/walker/scripts/rewindex.sh

# Add to ~/.config/walker/config.toml:
[[plugin]]
name = "rewindex"
src = "~/.config/walker/scripts/rewindex.sh"
prefix = "rw"
```

## Configuration

### Environment Variables

```bash
# Server connection
export REWINDEX_HOST="127.0.0.1"
export REWINDEX_PORT="8899"

# Editor preference
export EDITOR="nvim"
```

### Terminal Preference

For terminal editors (vim, nano), the scripts auto-detect:
1. **kitty** (preferred)
2. **alacritty**
3. **ghostty**
4. **fallback** (runs in current terminal)

## Hyprland Integration Example

Add to `~/.config/hypr/hyprland.conf`:

```bash
# Rewindex search (Super + S)
bind = SUPER, S, exec, rewindex-rofi

# Or with wofi
bind = SUPER, S, exec, LAUNCHER=wofi rewindex-rofi

# Walker (if using)
bind = SUPER, SPACE, exec, walker

# Then type: rw <query>
```

## i3/Sway Integration Example

Add to `~/.config/i3/config` or `~/.config/sway/config`:

```bash
# Rewindex search
bindsym $mod+s exec rewindex-rofi

# Or specify launcher
bindsym $mod+s exec env LAUNCHER=wofi rewindex-rofi
```

## Troubleshooting

### No results shown

```bash
# Check if Rewindex is running
systemctl --user status rewindex

# Test API directly
curl http://localhost:8899/index/status

# Run with debug
rewindex-rofi "test" 2>&1 | less
```

### Wrong editor opens

Set your preferred editor:

```bash
export EDITOR="nvim"
# Or for Omarchy
export EDITOR="omarchy-edit"
```

### Launcher not found

Install one of these:
```bash
# Arch/Manjaro
sudo pacman -S rofi wofi

# Ubuntu/Debian
sudo apt install rofi wofi

# Fedora
sudo dnf install rofi wofi
```

## Advanced Usage

### Custom Launcher

The scripts auto-detect launchers in this order:
1. rofi
2. wofi
3. dmenu

Override with environment variable:

```bash
LAUNCHER="wofi --dmenu -i" rewindex-rofi "query"
```

### Search with Filters

Currently searches entire index. Future versions will support:
- Language filtering
- Path scoping
- Fuzzy matching
- Partial matching

For now, use CLI for filtered searches:
```bash
rewindex "query" --lang python --limit 50
```

## Files

- `rofi-ui.sh` - Universal launcher integration (Rofi/Wofi/dmenu)
- `walker-ui.sh` - Walker plugin for Omarchy

## See Also

- [README.md](README.md) - General usage
- [SMART_PATH_UX.md](SMART_PATH_UX.md) - Smart path scoping
- [CLAUDE.md](CLAUDE.md) - Developer documentation
