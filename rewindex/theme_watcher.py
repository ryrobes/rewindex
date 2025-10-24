"""
Omarchy theme integration for Rewindex.

Watches ~/.config/omarchy/current/theme for changes and broadcasts
color scheme updates to connected web clients via WebSocket.
"""

import re
import logging
from pathlib import Path
from typing import Dict, Optional, Callable

logger = logging.getLogger(__name__)


class OmarchyThemeWatcher:
    """Watches Omarchy theme files and extracts color scheme."""

    def __init__(self, on_theme_change: Optional[Callable] = None):
        """
        Initialize theme watcher.

        Args:
            on_theme_change: Callback function called with theme dict when theme changes
        """
        self.on_theme_change = on_theme_change
        self.theme_dir = Path.home() / ".config/omarchy/current/theme"
        self.walker_css = self.theme_dir / "walker.css"
        self.alacritty_toml = self.theme_dir / "alacritty.toml"
        self.background_link = Path.home() / ".config/omarchy/current/background"
        self.current_colors = None
        self.current_terminal_colors = None
        self.current_background = None
        self.current_background_hash = None

        # Check if Omarchy is installed
        self.is_available = self.theme_dir.exists() and self.walker_css.exists()

        if self.is_available:
            logger.info("🎨 Omarchy theme system detected")
            self.current_colors = self.parse_colors()
            self.current_terminal_colors = self.parse_terminal_colors()
            self.current_font = self.parse_font()
            self.current_background = self.get_background_path()
            self.current_background_hash = self._hash_background()
        else:
            logger.info("Omarchy theme system not detected (optional)")

    def parse_colors(self) -> Optional[Dict[str, str]]:
        """
        Parse @define-color definitions from walker.css.

        Returns:
            Dict mapping color names to hex values, or None if unavailable
        """
        if not self.walker_css.exists():
            return None

        colors = {}
        try:
            with open(self.walker_css) as f:
                for line in f:
                    # Match: @define-color foreground #F0F8FF;
                    match = re.match(r'@define-color\s+(\S+)\s+(#[0-9A-Fa-f]{6});', line.strip())
                    if match:
                        colors[match.group(1)] = match.group(2)

            logger.debug(f"Parsed Omarchy colors: {colors}")
            return colors
        except Exception as e:
            logger.warning(f"Failed to parse Omarchy colors: {e}")
            return None

    def parse_terminal_colors(self) -> Optional[Dict[str, str]]:
        """
        Parse terminal ANSI colors from alacritty.toml for syntax highlighting.

        Returns:
            Dict with 'normal' and 'bright' color mappings, or None if unavailable
        """
        if not self.alacritty_toml.exists():
            return None

        try:
            import re
            colors = {'normal': {}, 'bright': {}}
            current_section = None

            with open(self.alacritty_toml) as f:
                for line in f:
                    line = line.strip()

                    # Detect sections
                    if line == '[colors.normal]':
                        current_section = 'normal'
                        continue
                    elif line == '[colors.bright]':
                        current_section = 'bright'
                        continue
                    elif line.startswith('[') and current_section:
                        current_section = None

                    # Parse color assignments
                    if current_section:
                        match = re.match(r'(\w+)\s*=\s*[\'"]?(#[0-9A-Fa-f]{6})[\'"]?', line)
                        if match:
                            color_name, hex_value = match.groups()
                            colors[current_section][color_name] = hex_value

            logger.debug(f"Parsed terminal colors: {colors}")
            return colors if colors['normal'] else None
        except Exception as e:
            logger.warning(f"Failed to parse terminal colors: {e}")
            return None

    def parse_font(self) -> Optional[Dict[str, str]]:
        """
        Parse font configuration from alacritty.toml.

        Returns:
            Dict with 'family' and 'size' keys, or None if unavailable
        """
        if not self.alacritty_toml.exists():
            return None

        try:
            import re
            font = {}

            with open(self.alacritty_toml) as f:
                for line in f:
                    line = line.strip()

                    # Match font family: family = "Font Name" or { family = "Font Name", style = "..." }
                    family_match = re.search(r'family\s*=\s*[\'"]([^"\']+)[\'"]', line)
                    if family_match:
                        font['family'] = family_match.group(1)

                    # Match font size
                    size_match = re.match(r'size\s*=\s*(\d+(?:\.\d+)?)', line)
                    if size_match:
                        font['size'] = size_match.group(1)

            logger.debug(f"Parsed font: {font}")
            return font if font else None
        except Exception as e:
            logger.warning(f"Failed to parse font: {e}")
            return None

    def get_background_path(self) -> Optional[str]:
        """
        Get current wallpaper path from Omarchy background symlink.

        Returns:
            Absolute path to wallpaper image, or None if unavailable
        """
        if not self.background_link.exists():
            return None

        try:
            # Resolve symlink to actual file
            bg_path = self.background_link.resolve()
            if bg_path.exists():
                logger.debug(f"Omarchy background: {bg_path}")
                return str(bg_path)
        except Exception as e:
            logger.warning(f"Failed to resolve Omarchy background: {e}")

        return None

    def _hash_background(self) -> Optional[str]:
        """
        Compute a hash of the background file for cache-busting.

        Returns:
            Short hash string, or None if no background
        """
        if not self.current_background:
            return None

        try:
            import hashlib
            bg_path = Path(self.current_background)
            # Use file mtime + size for fast hashing (don't read whole 4K image)
            stat = bg_path.stat()
            hash_input = f"{stat.st_mtime}:{stat.st_size}".encode()
            return hashlib.md5(hash_input).hexdigest()[:8]
        except Exception:
            return None

    def map_to_css_vars(self, omarchy_colors: Dict[str, str]) -> Dict[str, str]:
        """
        Map Omarchy color names to Rewindex CSS variable names.

        Args:
            omarchy_colors: Dict from parse_colors()

        Returns:
            Dict mapping CSS variable names to color values
        """
        # Get base colors
        bg = omarchy_colors.get('background', '#13171c')
        fg = omarchy_colors.get('foreground', '#f8f8f2')
        border = omarchy_colors.get('border', '#44475a')
        accent = omarchy_colors.get('selected-text', '#39bae6')
        text_color = omarchy_colors.get('text', fg)

        # Build CSS variables
        css_vars = {
            '--bg': bg,
            '--text': text_color,
            '--muted': self._rgba_from_hex(text_color, 0.6),
            '--border': border,
            '--accent': accent,
            '--hover': self._lighten_hex(bg, 0.1),
        }

        return css_vars

    def map_to_syntax_colors(self, term_colors: Dict) -> Dict[str, str]:
        """
        Map terminal ANSI colors to syntax highlighting tokens.

        Args:
            term_colors: Dict with 'normal' and 'bright' color mappings

        Returns:
            Dict mapping token types to hex colors
        """
        normal = term_colors.get('normal', {})
        bright = term_colors.get('bright', {})

        return {
            'comment': self._rgba_from_hex(normal.get('white', '#888888'), 0.5),
            'keyword': normal.get('magenta', '#ff40a3'),
            'string': normal.get('green', '#00bfff'),
            'number': normal.get('yellow', '#6a90d2'),
            'function': bright.get('cyan', normal.get('cyan', '#00bfff')),
            'class': bright.get('yellow', normal.get('yellow', '#6a90d2')),
            'variable': normal.get('blue', '#bdbdbd'),
            'constant': bright.get('red', normal.get('red', '#ff40a3')),
            'operator': normal.get('white', '#f0f8ff'),
            'punctuation': self._rgba_from_hex(normal.get('white', '#f0f8ff'), 0.7),
        }

    def get_current_theme(self) -> Optional[Dict]:
        """
        Get current theme as a dict ready to send to clients.

        Returns:
            Dict with 'colors', 'syntax', 'background', and 'background_hash' keys
        """
        if not self.is_available:
            return None

        colors = self.current_colors or self.parse_colors()
        if not colors:
            return None

        term_colors = self.current_terminal_colors or self.parse_terminal_colors()
        syntax_colors = self.map_to_syntax_colors(term_colors) if term_colors else {}
        font = self.current_font or self.parse_font()

        return {
            'colors': self.map_to_css_vars(colors),
            'syntax': syntax_colors,
            'font': font,
            'background': self.current_background or self.get_background_path(),
            'background_hash': self.current_background_hash or self._hash_background(),
        }

    def check_for_changes(self) -> bool:
        """
        Check if theme has changed since last check.

        Returns:
            True if theme changed, False otherwise
        """
        if not self.is_available:
            return False

        new_colors = self.parse_colors()
        new_terminal_colors = self.parse_terminal_colors()
        new_font = self.parse_font()
        new_background = self.get_background_path()
        new_background_hash = self._hash_background()

        changed = (new_colors != self.current_colors or
                   new_terminal_colors != self.current_terminal_colors or
                   new_font != self.current_font or
                   new_background_hash != self.current_background_hash)

        if changed:
            logger.info("🎨 Omarchy theme changed!")
            self.current_colors = new_colors
            self.current_terminal_colors = new_terminal_colors
            self.current_font = new_font
            self.current_background = new_background
            self.current_background_hash = new_background_hash

            if self.on_theme_change:
                theme = self.get_current_theme()
                if theme:
                    self.on_theme_change(theme)

        return changed

    @staticmethod
    def _rgba_from_hex(hex_color: str, alpha: float) -> str:
        """Convert #RRGGBB to rgba(r,g,b,alpha)."""
        if not hex_color.startswith('#') or len(hex_color) != 7:
            return hex_color

        r = int(hex_color[1:3], 16)
        g = int(hex_color[3:5], 16)
        b = int(hex_color[5:7], 16)
        return f'rgba({r},{g},{b},{alpha})'

    @staticmethod
    def _lighten_hex(hex_color: str, amount: float) -> str:
        """Lighten a hex color by a percentage (0-1)."""
        if not hex_color.startswith('#') or len(hex_color) != 7:
            return hex_color

        r = int(hex_color[1:3], 16)
        g = int(hex_color[3:5], 16)
        b = int(hex_color[5:7], 16)

        # Lighten by adding to each channel
        r = min(255, int(r + (255 - r) * amount))
        g = min(255, int(g + (255 - g) * amount))
        b = min(255, int(b + (255 - b) * amount))

        return f'#{r:02x}{g:02x}{b:02x}'
