from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import re

from .es import ESClient


@dataclass
class SearchFilters:
    language: Optional[List[str]] = None
    path_pattern: Optional[str] = None
    file_types: Optional[List[str]] = None
    exclude_paths: Optional[str] = None
    modified_after: Optional[float] = None
    has_function: Optional[str] = None
    has_class: Optional[str] = None
    is_current: Optional[bool] = True
    created_before_ms: Optional[int] = None  # as-of filter


@dataclass
class SearchOptions:
    limit: int = 20
    context_lines: int = 3
    highlight: bool = True


def simple_search_es(
    es: ESClient,
    index: str,
    query: str,
    filters: Optional[SearchFilters] = None,
    options: Optional[SearchOptions] = None,
    debug: bool = False,
) -> Dict[str, Any]:
    filters = filters or SearchFilters()
    options = options or SearchOptions()

    must: List[Dict[str, Any]] = []
    if query and query.strip() and query.strip() != "*":
        must.append({
            "multi_match": {
                "query": query,
                "operator": "and",
                "fields": [
                    "content^1",
                    "file_name.text^2"
                ],
            }
        })

    filter_clauses: List[Dict[str, Any]] = []
    if filters.is_current is not None:
        filter_clauses.append({"term": {"is_current": filters.is_current}})
    if filters.language:
        filter_clauses.append({"terms": {"language": filters.language}})
    if filters.file_types:
        filter_clauses.append({"terms": {"extension": filters.file_types}})
    if filters.path_pattern:
        # Convert ** to * for ES wildcard
        pat = filters.path_pattern.replace("**", "*")
        filter_clauses.append({"wildcard": {"file_path": pat}})
    if filters.has_function:
        filter_clauses.append({"term": {"defined_functions": filters.has_function}})
    if filters.has_class:
        filter_clauses.append({"term": {"defined_classes": filters.has_class}})
    # As-of support: choose a date field based on index naming convention
    if filters.created_before_ms:
        date_field = "created_at" if index.endswith("_versions") else "last_modified"
        filter_clauses.append({"range": {date_field: {"lte": filters.created_before_ms}}})

    body: Dict[str, Any] = {
        "query": {
            "bool": {
                "must": must if must else [{"match_all": {}}],
                "filter": filter_clauses,
            }
        },
        "size": max(1, options.limit),
        "_source": {
            "includes": [
                "file_path",
                "language",
                "size_bytes",
                "defined_functions",
                "defined_classes",
                "imports",
                "content",
            ]
        },
    }

    if options.highlight:
        body["highlight"] = {
            "pre_tags": ["<mark>"],
            "post_tags": ["</mark>"],
            "fields": {
                "content": {
                    "type": "unified",
                    "number_of_fragments": 10,
                    "fragment_size": max(120, options.context_lines * 120),
                }
            },
        }

    res = es.search(index, body)
    hits = res.get("hits", {}).get("hits", [])
    results: List[Dict[str, Any]] = []
    for h in hits:
        src = h.get("_source", {})
        hl_list = h.get("highlight", {}).get("content", [])
        content = src.get("content", "")

        matches: List[Dict[str, Any]] = []
        used_lines = set()
        # Build matches from highlight fragments when available
        for frag in hl_list[:10]:
            line_no, before_ctx, after_ctx, line_highlight = _compute_line_context(
                content, frag, query, options.context_lines, apply_markup=options.highlight
            )
            if line_no and line_no not in used_lines:
                used_lines.add(line_no)
                matches.append({
                    "line": line_no,
                    "content": None,
                    "highlight": line_highlight or frag,
                    "context": {"before": before_ctx, "after": after_ctx},
                })

        # Fallback: ensure at least one match by using query-based matching
        if not matches:
            line_no, before_ctx, after_ctx, line_highlight = _compute_line_context(
                content, "", query, options.context_lines, apply_markup=options.highlight
            )
            matches.append({
                "line": line_no,
                "content": None,
                "highlight": line_highlight or "",
                "context": {"before": before_ctx, "after": after_ctx},
            })

        results.append({
            "file_path": src.get("file_path"),
            "score": h.get("_score", 0.0),
            "language": src.get("language"),
            "matches": matches,
            "metadata": {
                "size_bytes": src.get("size_bytes"),
                "functions": src.get("defined_functions", []),
                "classes": src.get("defined_classes", []),
                "imports": src.get("imports", []),
            },
        })

    out: Dict[str, Any] = {"total_hits": len(results), "results": results}
    if debug:
        out["debug"] = {"query": body, "took": res.get("took")}
    return out


def _compute_line_context(content: str, highlight_fragment: str, query: str, context_lines: int, apply_markup: bool = True):
    if not content:
        return None, [], [], None

    lines = content.splitlines()

    # Try to determine the best matching line by marked tokens
    marked_tokens = _all_marked_tokens(highlight_fragment)
    best_line = None
    best_score = -1
    if marked_tokens:
        lowered_tokens = [t.lower() for t in marked_tokens if t]
        for i, line in enumerate(lines):
            l = line.lower()
            score = sum(1 for t in lowered_tokens if t in l)
            if score > best_score:
                best_score = score
                best_line = i
        if best_score > 0 and best_line is not None:
            idx_line = best_line
            line_no = idx_line + 1
            line_text = lines[idx_line]
            # build line highlight by marking all tokens
            hl_line = line_text
            if apply_markup:
                for tok in sorted(set(lowered_tokens), key=len, reverse=True):
                    pattern = re.compile(re.escape(tok), re.IGNORECASE)
                    hl_line = pattern.sub(lambda m: f"<mark>{m.group(0)}</mark>", hl_line)
            start_ctx = max(0, idx_line - max(0, int(context_lines)))
            end_ctx = min(len(lines), idx_line + 1 + max(0, int(context_lines)))
            before = lines[start_ctx:idx_line]
            after = lines[idx_line + 1:end_ctx]
            return line_no, before, after, hl_line

    # Fallback 1: direct substring match of the full query (case-insensitive)
    q_full = (query or "").strip()
    if q_full:
        pos_full = content.lower().find(q_full.lower())
        if pos_full >= 0:
            line_no = content.count("\n", 0, pos_full) + 1
            idx_line = line_no - 1
            if 0 <= idx_line < len(lines):
                line_text = lines[idx_line]
                hl_line = line_text
                if apply_markup and q_full:
                    pattern = re.compile(re.escape(q_full), re.IGNORECASE)
                    hl_line = pattern.sub(lambda m: f"<mark>{m.group(0)}</mark>", hl_line)
                start_ctx = max(0, idx_line - max(0, int(context_lines)))
                end_ctx = min(len(lines), idx_line + 1 + max(0, int(context_lines)))
                before = lines[start_ctx:idx_line]
                after = lines[idx_line + 1:end_ctx]
                return line_no, before, after, hl_line

    # Fallback 2: token coverage by query tokens
    q_tokens = _query_tokens(query)
    if q_tokens:
        lowered_tokens = [t.lower() for t in q_tokens if t]
        best_line = None
        best_score = -1
        for i, line in enumerate(lines):
            l = line.lower()
            score = sum(1 for t in lowered_tokens if t in l)
            if score > best_score:
                best_score = score
                best_line = i
        if best_score > 0 and best_line is not None:
            idx_line = best_line
            line_no = idx_line + 1
            line_text = lines[idx_line]
            hl_line = line_text
            if apply_markup:
                for tok in sorted(set(lowered_tokens), key=len, reverse=True):
                    pattern = re.compile(re.escape(tok), re.IGNORECASE)
                    hl_line = pattern.sub(lambda m: f"<mark>{m.group(0)}</mark>", hl_line)
            start_ctx = max(0, idx_line - max(0, int(context_lines)))
            end_ctx = min(len(lines), idx_line + 1 + max(0, int(context_lines)))
            before = lines[start_ctx:idx_line]
            after = lines[idx_line + 1:end_ctx]
            return line_no, before, after, hl_line

    # Fallback 3: locate fragment or a single marked/query token
    frag_plain = _strip_mark_tags(highlight_fragment).strip()
    pos = content.find(frag_plain) if frag_plain else -1

    token = _first_marked_token(highlight_fragment)
    if pos < 0 and token:
        pos = content.lower().find(token.lower())
    if pos < 0:
        # fallback to first term of query
        qtok = _first_query_token(query)
        if qtok:
            pos = content.lower().find(qtok.lower())

    if pos < 0:
        return None, [], [], None

    # compute line number from character offset
    line_no = content.count("\n", 0, pos) + 1
    idx_line = line_no - 1
    if idx_line < 0 or idx_line >= len(lines):
        return None, [], [], None

    line_text = lines[idx_line]

    # Build highlight for the line using the chosen token
    hl_line = line_text
    tok = token or _first_query_token(query)
    if tok and apply_markup:
        pattern = re.compile(re.escape(tok), re.IGNORECASE)
        hl_line = pattern.sub(lambda m: f"<mark>{m.group(0)}</mark>", line_text)

    start_ctx = max(0, idx_line - max(0, int(context_lines)))
    end_ctx = min(len(lines), idx_line + 1 + max(0, int(context_lines)))
    before = lines[start_ctx:idx_line]
    after = lines[idx_line + 1:end_ctx]

    return line_no, before, after, hl_line


def _strip_mark_tags(s: str) -> str:
    return re.sub(r"</?mark>", "", s or "")


def _first_marked_token(s: str) -> Optional[str]:
    m = re.search(r"<mark>(.*?)</mark>", s or "")
    return m.group(1) if m and m.group(1) else None


def _all_marked_tokens(s: str) -> List[str]:
    return re.findall(r"<mark>(.*?)</mark>", s or "")


def _first_query_token(q: str) -> Optional[str]:
    if not q:
        return None
    m = re.search(r"[A-Za-z0-9_]+", q)
    return m.group(0) if m else None


def _query_tokens(q: str) -> List[str]:
    if not q:
        return []
    return re.findall(r"[A-Za-z0-9_]+", q)

