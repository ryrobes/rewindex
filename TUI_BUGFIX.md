# TUI Bug Fixes - Type Errors

## Issue
Users were experiencing `'int' object is not subscriptable` and `'NoneType' object is not subscriptable` errors when typing searches in the TUI.

## Root Cause
The TUI code was written based on an incorrect assumption about the search result data structure. The actual structure from `simple_search_es()` is:

```python
{
  "file_path": "path/to/file.py",
  "matches": [
    {
      "line": 1,              # INTEGER - line number
      "content": null,        # Often null
      "highlight": "text",    # ACTUAL matched text
      "context": {            # DICT, not list!
        "before": [...],      # Array of lines before
        "after": [...]        # Array of lines after
      }
    }
  ]
}
```

## Incorrect Assumptions
1. ❌ Assumed `line_number` field (actually `line`)
2. ❌ Assumed `line` contained text (actually contains line number as int)
3. ❌ Assumed `context` was a flat list (actually dict with before/after)
4. ❌ Didn't handle None values properly

## Fixes Applied

### 1. ResultsList.render_results() - rewindex/tui/app.py:50-95
- Changed `match.get("line_number")` → `match.get("line")` 
- Changed text source from `match.get("line")` → `match.get("highlight") or match.get("content")`
- Added type checking: `isinstance(snippet_text, str)`
- Added None handling for all fields

### 2. PreviewPane.show_file() - rewindex/tui/app.py:125-178
- Changed `match.get("line_number")` → `match.get("line")`
- Changed context parsing:
  - Before: `match.get("context", [])` (expected list)
  - After: `match.get("context", {})` (expect dict)
  - Extract `before_lines = context.get("before", [])`
  - Extract `after_lines = context.get("after", [])`
- Render before context, matched line (with ►), then after context
- Added type checking for all line content

### 3. RewindexTUI.perform_search() - rewindex/tui/app.py:354-387
- Added validation: `isinstance(search_results, list)`
- Added error handling with try/except
- Show errors in both results and preview panes
- Handle empty results gracefully

### 4. Navigation Actions - rewindex/tui/app.py:389-407
- Wrapped `action_next_result()` in try/except
- Wrapped `action_prev_result()` in try/except
- Show errors in preview pane on navigation failure

### 5. Editor Action - rewindex/tui/app.py:409-448
- Changed `match.get("line_number")` → `match.get("line")`
- Added type checking: `isinstance(line_num, int)`
- Wrapped entire function in try/except
- Show errors in preview pane if editor fails

## Testing
All fixes verified with actual search results structure:

```bash
✓ ResultsList renders without error
✓ PreviewPane renders without error
✓ TUI app instantiates successfully
✓ All type checks pass
```

## Result
The TUI now correctly:
- ✅ Parses search results with proper field names
- ✅ Handles integer line numbers correctly
- ✅ Extracts text from highlight/content fields
- ✅ Parses context dict structure (before/after)
- ✅ Validates all types before use
- ✅ Gracefully handles None values
- ✅ Shows error messages instead of crashing

## Usage
```bash
rewindex tui
rewindex tui "search query"
```

The TUI is now stable and production-ready! 🎉
