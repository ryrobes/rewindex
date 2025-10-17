from __future__ import annotations

from pathlib import Path


LANGUAGE_MAP = {
    # Web technologies
    ".html": "html",
    ".htm": "html",
    ".xhtml": "html",
    ".css": "css",
    ".scss": "scss",
    ".sass": "sass",
    ".less": "less",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".vue": "html",  # Vue SFC, Monaco treats as HTML
    ".svelte": "html",  # Svelte, Monaco treats as HTML

    # Markup and data
    ".xml": "xml",
    ".svg": "xml",
    ".json": "json",
    ".jsonc": "json",
    ".json5": "json",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "ini",  # Monaco doesn't have TOML, INI is closest
    ".ini": "ini",
    ".cfg": "ini",
    ".conf": "ini",
    ".md": "markdown",
    ".markdown": "markdown",
    ".rst": "restructuredtext",
    ".tex": "latex",

    # Systems programming
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".hxx": "cpp",
    ".rs": "rust",
    ".go": "go",

    # Application languages
    ".py": "python",
    ".pyw": "python",
    ".pyi": "python",
    ".java": "java",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".scala": "scala",
    ".cs": "csharp",
    ".fs": "fsharp",
    ".fsx": "fsharp",
    ".vb": "vb",
    ".swift": "swift",
    ".m": "objective-c",
    ".mm": "objective-cpp",

    # Scripting languages
    ".rb": "ruby",
    ".erb": "ruby",
    ".php": "php",
    ".php3": "php",
    ".php4": "php",
    ".php5": "php",
    ".phtml": "php",
    ".pl": "perl",
    ".pm": "perl",
    ".lua": "lua",
    ".r": "r",
    ".R": "r",

    # Shell scripting
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".fish": "shell",
    ".bat": "bat",
    ".cmd": "bat",
    ".ps1": "powershell",

    # Database
    ".sql": "sql",
    ".mysql": "mysql",
    ".pgsql": "pgsql",

    # Other
    ".dockerfile": "dockerfile",
    ".graphql": "graphql",
    ".gql": "graphql",
    ".proto": "protobuf",
    ".dart": "dart",
    ".clj": "clojure",
    ".cljs": "clojure",
    ".edn": "clojure",
    ".ex": "elixir",
    ".exs": "elixir",
    ".erl": "erlang",
    ".hrl": "erlang",
    ".hs": "haskell",
    ".ml": "ocaml",
    ".mli": "ocaml",
}


def detect_language(path: Path) -> str:
    ext = path.suffix.lower()
    filename = path.name.lower()

    # Check extension first
    if ext in LANGUAGE_MAP:
        return LANGUAGE_MAP[ext]

    # Special files without extensions
    if filename == "dockerfile" or filename.startswith("dockerfile."):
        return "dockerfile"
    if filename == "makefile" or filename.startswith("makefile."):
        return "makefile"
    if filename == ".gitignore" or filename == ".dockerignore":
        return "ignore"
    if filename == ".env" or filename.startswith(".env."):
        return "properties"
    if filename in (".editorconfig", ".prettierrc", ".eslintrc"):
        return "ini"
    if filename in ("cargo.toml", "pyproject.toml"):
        return "toml"

    # Fallback: shebang for scripts
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as f:
            first_line = f.readline()
        if first_line.startswith("#!"):
            if "python" in first_line:
                return "python"
            if "node" in first_line or "javascript" in first_line:
                return "javascript"
            if "bash" in first_line or "sh" in first_line:
                return "shell"
            if "ruby" in first_line:
                return "ruby"
            if "perl" in first_line:
                return "perl"
    except Exception:
        pass

    return "plaintext"

