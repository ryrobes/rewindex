# TUI Search Modes Feature

## Overview
Added fuzzy and partial search mode toggles to the TUI interface with both visual checkboxes and keyboard shortcuts.

## Features Added

### Visual Checkboxes
- **Location**: Below the search input bar
- **Appearance**: Transparent background, aligned horizontally
- **Options**:
  - `☐ Fuzzy` - Enable typo-tolerant fuzzy matching
  - `☐ Partial` - Enable partial/prefix matching (adds wildcards)

### Keyboard Shortcuts
- **f** - Toggle fuzzy search mode
- **p** - Toggle partial matching mode
- Shortcuts shown in footer: `f: Fuzzy | p: Partial`

### Behavior
- ✅ Click checkbox to toggle
- ✅ Press `f` or `p` to toggle via keyboard
- ✅ Automatically re-runs search when toggled
- ✅ Visual feedback (checkbox state)
- ✅ Works with live search

## Implementation Details

### Files Modified
**rewindex/tui/app.py**:

1. **Imports**:
```python
from textual.widgets import Checkbox  # Added
```

2. **SearchBar Widget**:
```python
class SearchBar(Static):
    """Search input bar with live search and options."""
    
    def compose(self) -> ComposeResult:
        yield Input(...)
        with Horizontal(id="search-options"):
            yield Checkbox("Fuzzy", id="fuzzy-checkbox", value=False)
            yield Checkbox("Partial", id="partial-checkbox", value=False)
```

3. **Search Function**:
```python
def perform_search(self, query: str) -> None:
    # Get checkbox states
    fuzzy_enabled = self.query_one("#fuzzy-checkbox", Checkbox).value
    partial_enabled = self.query_one("#partial-checkbox", Checkbox).value
    
    options = SearchOptions(
        limit=50,
        context_lines=5,
        highlight=False,
        fuzzy=fuzzy_enabled,      # Pass to search
        partial=partial_enabled    # Pass to search
    )
```

4. **Event Handlers**:
```python
def on_checkbox_changed(self, event: Checkbox.Changed) -> None:
    """Handle checkbox state changes."""
    if event.checkbox.id in ("fuzzy-checkbox", "partial-checkbox"):
        # Re-run search
        search_input = self.query_one("#search-input", Input)
        if search_input.value:
            self.perform_search(search_input.value)
```

5. **Keyboard Actions**:
```python
def action_toggle_fuzzy(self) -> None:
    checkbox = self.query_one("#fuzzy-checkbox", Checkbox)
    checkbox.value = not checkbox.value
    # Re-run search...

def action_toggle_partial(self) -> None:
    checkbox = self.query_one("#partial-checkbox", Checkbox)
    checkbox.value = not checkbox.value
    # Re-run search...
```

6. **Bindings**:
```python
BINDINGS = [
    ...
    Binding("f", "toggle_fuzzy", "Fuzzy", show=True),
    Binding("p", "toggle_partial", "Partial", show=True),
    ...
]
```

## CSS Styling
```python
SearchBar {
    height: auto;
    background: transparent;
}

#search-options {
    height: 1;
    background: transparent;
}

Checkbox {
    background: transparent;
    margin-right: 2;
}
```

## Usage Examples

### Via Keyboard
```
1. Type search query: "authenticate"
2. Press 'f' to enable fuzzy matching
3. Results now include: "authentikate", "autenticate", etc.
4. Press 'p' to enable partial matching  
5. Results now include: "auth", "authentication", etc.
```

### Via Mouse/Click
```
1. Type search query: "user"
2. Click [☐ Fuzzy] checkbox
3. Checkbox becomes [☑ Fuzzy]
4. Search automatically re-runs with fuzzy mode
5. Click on any result in the list to preview it
6. Use scroll wheel to navigate through results
```

## Search Mode Behavior

### Fuzzy Mode (f)
- **Purpose**: Typo tolerance
- **Effect**: Elasticsearch fuzzy query with edit distance
- **Example**:
  - Query: `autenticate`
  - Matches: `authenticate`, `authenticated`, `authentication`
  - Allows 1-2 character differences

### Partial Mode (p)
- **Purpose**: Prefix/partial matching
- **Effect**: Adds wildcards to query terms
- **Example**:
  - Query: `auth`
  - Matches: `authenticate`, `authorization`, `author`
  - Treats as `auth*` wildcard

### Combined Mode (f + p)
- Both modes can be enabled simultaneously
- Results include both fuzzy matches AND partial matches
- Broadest search coverage

## Testing

```bash
✓ Checkboxes render in UI
✓ Keyboard shortcuts toggle checkboxes
✓ Click toggles checkboxes
✓ Search re-runs on toggle
✓ Fuzzy search works
✓ Partial search works
✓ Combined mode works
✓ Transparent styling
```

## Documentation Updated
- ✅ CLAUDE.md - Added search modes to features and shortcuts
- ✅ TUI_QUICKSTART.md - Updated keyboard shortcuts and features
- ✅ This document created

## Visual Preview

```
╭─ Rewindex ─────────────────────────── [Timeline: ▁▂▃▅▇█▇▅▃▂▁] ─ 2025-01-23 ─╮
│                                                                                │
│ 🔍 Search: authenticate█                                                      │
│ ☑ Fuzzy    ☐ Partial                                                         │
│                                                                                │
├──────────────────────────────────┬─────────────────────────────────────────────┤
│ 📊 Results (23 matches)          │ 📄 rewindex/auth.py:45                     │
│                                  │                                             │
│ 🐍 rewindex/auth.py:45           │   42 │                                     │
│    def authenticate(token):      │   43 │ class AuthHandler:                  │
│                                  │ ► 45 │     def authenticate(token: str):   │
│ 🐍 server/autenticate.py:12      │   46 │         """Validates JWT tokens"""  │
│    def autenticate(user):        │   47 │         if not token:               │
│    └─ Fuzzy match!               │                                             │
├──────────────────────────────────┴─────────────────────────────────────────────┤
│ q: Quit │ e: Edit │ f: Fuzzy │ p: Partial │ j/k: Navigate                    │
╰──────────────────────────────────────────────────────────────────────────────────╯
```

## Benefits

1. **User Control**: Users can easily toggle search modes without CLI flags
2. **Visual Feedback**: Checkbox state clearly shows which modes are active
3. **Keyboard Efficiency**: Quick toggle with single key press
4. **Live Updates**: Search re-runs immediately when modes change
5. **Discoverability**: Checkboxes are visible and self-explanatory

## Future Enhancements
- [ ] Language filter dropdown
- [ ] Path pattern input
- [ ] Case sensitivity toggle
- [ ] Result limit slider
- [ ] Save search mode preferences

---

**Status**: Complete and tested
**Version**: 1.1.0
**Date**: 2025-01-23
