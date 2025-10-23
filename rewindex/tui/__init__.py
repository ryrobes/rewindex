"""TUI module for Rewindex - Interactive search interface.

This module provides a beautiful terminal UI for searching and browsing code.
It requires optional dependencies: textual and pygments.

Install with: pip install rewindex[tui]
"""

from __future__ import annotations

# Check if TUI dependencies are available
TUI_AVAILABLE = False
TUI_MISSING_DEPS = []

try:
    import textual  # noqa: F401
except ImportError:
    TUI_MISSING_DEPS.append("textual>=0.47.0")

try:
    import pygments  # noqa: F401
except ImportError:
    TUI_MISSING_DEPS.append("pygments>=2.17.0")

TUI_AVAILABLE = len(TUI_MISSING_DEPS) == 0


def check_tui_available() -> tuple[bool, list[str]]:
    """Check if TUI dependencies are available.

    Returns:
        (available, missing_deps)
    """
    return TUI_AVAILABLE, TUI_MISSING_DEPS


def run_tui(project_root=None, initial_query: str = ""):
    """Run the interactive TUI.

    Args:
        project_root: Project root directory (defaults to current directory)
        initial_query: Initial search query to populate
    """
    if not TUI_AVAILABLE:
        print("TUI dependencies not available. Install with:")
        print("  pip install rewindex[tui]")
        print()
        print("Missing dependencies:")
        for dep in TUI_MISSING_DEPS:
            print(f"  - {dep}")
        return 1

    from .app import RewindexTUI

    app = RewindexTUI(project_root=project_root, initial_query=initial_query)
    app.run()
    return 0


__all__ = ["TUI_AVAILABLE", "check_tui_available", "run_tui"]
