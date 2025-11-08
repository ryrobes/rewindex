#!/usr/bin/env python3
"""
Entry point for Rewindex CLI when run as a module or PyInstaller binary.

This uses absolute imports to avoid issues with PyInstaller.
"""

if __name__ == '__main__':
    from rewindex.cli import main
    main()
