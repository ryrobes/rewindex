from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Set


DEFAULT_IGNORE_PATTERNS = [
    "*.min.js",
    "*.min.css",
    "node_modules/**",
    "venv/**",
    ".git/**",
    "*.pyc",
    "__pycache__/**",
    "dist/**",
    "build/**",
    "*.lock",
    "*.log",
    "*.sqlite",
    "*.db",
    ".env*",
    "*.key",
    "*.pem",
    "*.cert",
    # Binary/media files
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.bmp",
    "*.ico",
    "*.pdf",
    "*.zip",
    "*.tar",
    "*.gz",
    "*.bz2",
    "*.7z",
    "*.rar",
    "*.exe",
    "*.dll",
    "*.so",
    "*.dylib",
    "*.bin",
    "*.dat",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.eot",
    "*.mp3",
    "*.mp4",
    "*.avi",
    "*.mov",
    "*.wav",
]


def parse_gitignore(gitignore_path: Path) -> List[str]:
    """Parse a .gitignore file and return a list of glob patterns.

    Handles:
    - Comments (lines starting with #)
    - Blank lines
    - Directory patterns (ending with /)
    - Converts to glob-style patterns compatible with our matcher

    Note: Negation patterns (starting with !) are currently ignored.
    """
    patterns = []

    if not gitignore_path.exists():
        return patterns

    try:
        lines = gitignore_path.read_text(encoding='utf-8', errors='ignore').splitlines()
    except Exception:
        return patterns

    for line in lines:
        # Strip whitespace
        line = line.strip()

        # Skip empty lines and comments
        if not line or line.startswith('#'):
            continue

        # Skip negation patterns (would require complex logic to handle properly)
        if line.startswith('!'):
            continue

        # Convert gitignore patterns to our glob format
        pattern = line

        # If pattern ends with /, it matches directories
        if pattern.endswith('/'):
            pattern = pattern.rstrip('/') + '/**'
        # If pattern doesn't contain /, it matches at any level
        elif '/' not in pattern:
            patterns.append(pattern)  # Match filename anywhere
            pattern = '**/' + pattern  # Also match as path pattern
        # If pattern starts with /, it's from root (our root is project root)
        elif pattern.startswith('/'):
            pattern = pattern.lstrip('/')

        patterns.append(pattern)

    return patterns


def load_gitignore_patterns(project_root: Path) -> List[str]:
    """Load patterns from .gitignore file in project root."""
    gitignore_path = project_root / '.gitignore'
    return parse_gitignore(gitignore_path)


def load_rewindexignore_patterns(project_root: Path) -> List[str]:
    """Load patterns from .rewindexignore file in project root."""
    rewindexignore_path = project_root / '.rewindexignore'
    return parse_gitignore(rewindexignore_path)  # Same format as .gitignore


@dataclass
class IndexingWatch:
    enabled: bool = True
    debounce_ms: int = 500
    batch_size: int = 50


@dataclass
class IndexingExtract:
    functions: bool = True
    classes: bool = True
    imports: bool = True
    todos: bool = True


@dataclass
class IndexingConfig:
    # Empty include_patterns = index all files (rely on exclude patterns + binary detection)
    include_patterns: List[str] = field(default_factory=list)
    exclude_patterns: List[str] = field(default_factory=lambda: [*DEFAULT_IGNORE_PATTERNS])
    max_file_size_mb: int = 10
    max_index_size_gb: int = 5
    index_binaries: bool = False  # Index binary files (metadata only, no content)
    binary_preview_max_kb: int = 50  # Max image size for base64 preview generation (not enforced for thumbnails)
    watch: IndexingWatch = field(default_factory=IndexingWatch)
    extract: IndexingExtract = field(default_factory=IndexingExtract)
    parallel_workers: int = 4  # Parallel workers for faster indexing (images, metadata extraction)
    use_cache: bool = True


@dataclass
class SearchDefaults:
    limit: int = 20
    context_lines: int = 3
    highlight: bool = False


@dataclass
class SearchConfig:
    defaults: SearchDefaults = field(default_factory=SearchDefaults)
    boost: Dict[str, float] = field(default_factory=lambda: {
        "file_name": 2.0,
        "recent_files": 1.5,
    })


@dataclass
class VersioningConfig:
    keep_all_versions: bool = True
    max_versions_per_file: int = 50
    cleanup_after_days: int = 90


@dataclass
class MonitoringConfig:
    log_level: str = "INFO"
    metrics_enabled: bool = False
    metrics_port: int = 9090


@dataclass
class ProjectConfig:
    id: str = "default"
    name: str = "project"
    root: str = "."


@dataclass
class ElasticConfig:
    host: str = "localhost:9200"
    index_prefix: str = "rewindex_${project.id}"


@dataclass
class Config:
    project: ProjectConfig = field(default_factory=ProjectConfig)
    elasticsearch: ElasticConfig = field(default_factory=ElasticConfig)
    indexing: IndexingConfig = field(default_factory=IndexingConfig)
    search: SearchConfig = field(default_factory=SearchConfig)
    versioning: VersioningConfig = field(default_factory=VersioningConfig)
    monitoring: MonitoringConfig = field(default_factory=MonitoringConfig)

    @staticmethod
    def load(project_root: Path) -> "Config":
        cfg = Config()

        # Prefer .rewindex.json if present (no dependencies required)
        json_path = project_root / ".rewindex.json"
        if json_path.exists():
            try:
                data = json.loads(json_path.read_text())
                _apply_dict(cfg, data)
            except Exception:
                pass

        # Try .rewindex.yml only if PyYAML is available
        yml_path = project_root / ".rewindex.yml"
        if yml_path.exists():
            try:
                import yaml  # type: ignore

                data = yaml.safe_load(yml_path.read_text())
                if isinstance(data, dict):
                    _apply_dict(cfg, data)
            except Exception:
                # Ignore YAML errors silently to keep MVP robust
                pass

        # Load .gitignore patterns and merge with exclude_patterns
        gitignore_patterns = load_gitignore_patterns(project_root)
        if gitignore_patterns:
            # Merge gitignore patterns with existing exclude patterns (avoid duplicates)
            existing = set(cfg.indexing.exclude_patterns)
            for pattern in gitignore_patterns:
                if pattern not in existing:
                    cfg.indexing.exclude_patterns.append(pattern)

        # Load .rewindexignore patterns (same format as .gitignore)
        rewindexignore_patterns = load_rewindexignore_patterns(project_root)
        if rewindexignore_patterns:
            existing = set(cfg.indexing.exclude_patterns)
            for pattern in rewindexignore_patterns:
                if pattern not in existing:
                    cfg.indexing.exclude_patterns.append(pattern)
            print(f"[config] Loaded {len(rewindexignore_patterns)} patterns from .rewindexignore")

        # If binary indexing is enabled, remove binary file extensions from exclude patterns
        if cfg.indexing.index_binaries:
            binary_extensions = [
                "*.png", "*.jpg", "*.jpeg", "*.gif", "*.bmp", "*.ico", "*.svg",
                "*.pdf", "*.zip", "*.tar", "*.gz", "*.bz2", "*.7z", "*.rar",
                "*.exe", "*.dll", "*.so", "*.dylib", "*.bin", "*.dat",
                "*.woff", "*.woff2", "*.ttf", "*.eot", "*.otf",
                "*.mp3", "*.mp4", "*.avi", "*.mov", "*.wav", "*.mkv", "*.webm",
                "*.doc", "*.docx", "*.xls", "*.xlsx", "*.ppt", "*.pptx"
            ]
            original_count = len(cfg.indexing.exclude_patterns)
            cfg.indexing.exclude_patterns = [
                p for p in cfg.indexing.exclude_patterns if p not in binary_extensions
            ]
            removed = original_count - len(cfg.indexing.exclude_patterns)
            if removed > 0:
                print(f"[config] Binary indexing enabled: removed {removed} binary extension patterns from exclusions")

        return cfg

    def resolved_index_prefix(self) -> str:
        prefix = self.elasticsearch.index_prefix
        # simple substitution for ${project.id} and ${project.name}
        prefix = prefix.replace("${project.id}", self.project.id)
        prefix = prefix.replace("${project.name}", self.project.name)
        return prefix


def _apply_dict(obj: Any, data: Dict[str, Any]) -> None:
    """Recursively apply a nested dict to a dataclass instance."""
    for k, v in data.items():
        if not hasattr(obj, k):
            continue
        cur = getattr(obj, k)
        if isinstance(cur, (ProjectConfig, ElasticConfig, IndexingConfig, IndexingWatch,
                            IndexingExtract, SearchConfig, SearchDefaults, VersioningConfig,
                            MonitoringConfig)):
            if isinstance(v, dict):
                _apply_dict(cur, v)
        else:
            setattr(obj, k, v)


def ensure_rewindex_dir(project_root: Path) -> Path:
    d = project_root / ".rewindex"
    d.mkdir(exist_ok=True)
    return d


def find_project_root(start: Path) -> Path:
    """Resolve the project root by walking up until we find .rewindex/ or .git/ or a config file.
    Falls back to the starting directory if nothing else is found.
    """
    cur = start.resolve()
    prev = None
    while prev != cur:
        if (cur / ".rewindex").exists() or (cur / ".rewindex.json").exists() or (cur / ".rewindex.yml").exists() or (cur / ".rewindex").exists() or (cur / ".rewindex.json").exists() or (cur / ".rewindex.yml").exists() or (cur / ".git").exists():
            return cur
        prev = cur
        cur = cur.parent
    return start.resolve()


def generate_project_id(project_root: Path) -> str:
    # Stable id derived from absolute path using UUID5
    try:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"rewindex:{project_root.as_posix()}"))
    except Exception:
        return str(uuid.uuid4())


def ensure_project_config(project_root: Path) -> Config:
    """Ensure a .rewindex/.rewindex.json exists with a unique project id and defaults.
    Returns the loaded/updated Config.
    """
    cfg = Config.load(project_root)
    # Initialize defaults if necessary
    changed = False
    if not cfg.project.id or cfg.project.id == "default":
        cfg.project.id = generate_project_id(project_root)
        changed = True
    if not cfg.project.name or cfg.project.name == "project":
        cfg.project.name = project_root.name
        changed = True
    # Ensure .rewindex dir exists
    ensure_rewindex_dir(project_root)
    # Write minimal .rewindex.json if missing or changed
    json_path = project_root / ".rewindex.json"
    if changed or not json_path.exists():
        data = {
            "project": {
                "id": cfg.project.id,
                "name": cfg.project.name,
                "root": ".",
            },
            "elasticsearch": {
            "host": cfg.elasticsearch.host,
            "index_prefix": "rewindex_${project.id}",
            },
    }
    try:
            json_path.write_text(json.dumps(data, indent=2))
    except Exception:
            pass
    return cfg
