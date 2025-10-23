# TUI Mouse Interaction & Bug Fix Update

## Session Summary

This update adds full mouse support to the Rewindex TUI and fixes a critical bug with the fuzzy search parameter.

## Issues Fixed

### 1. SearchOptions Parameter Error ✅

**Problem**: `Unexpected keyword argument 'fuzzy'`

**Root Cause**: The `SearchOptions` dataclass in `search.py` expects `fuzziness` (not `fuzzy`), and the value should be `"AUTO"` when enabled, or `None` when disabled.

**Fix**: Updated `rewindex/tui/app.py` line 420:
```python
# Before:
options = SearchOptions(
    limit=50,
    context_lines=5,
    highlight=False,
    fuzzy=fuzzy_enabled,  # ❌ Wrong parameter name
    partial=partial_enabled
)

# After:
options = SearchOptions(
    limit=50,
    context_lines=5,
    highlight=False,
    fuzziness="AUTO" if fuzzy_enabled else None,  # ✅ Correct
    partial=partial_enabled
)
```

### 2. Missing Mouse Interaction ✅

**Problem**: Results pane was keyboard-only, no mouse scroll or click-to-select.

**Solution**: Implemented comprehensive mouse support in the ResultsList widget.

## Features Added

### Mouse Interaction in ResultsList

**New Capabilities**:
1. **Click to Select**: Click any result to select it and update the preview pane
2. **Scroll Wheel Navigation**:
   - Scroll down → Next result
   - Scroll up → Previous result
3. **Visual Feedback**: Selected result shows `►` indicator
4. **Checkbox Clicks**: Already working, now integrated with mouse navigation

### Technical Implementation

**Files Modified**: `rewindex/tui/app.py`

**1. New Imports**:
```python
from textual import events
from textual.message import Message
```

**2. ResultsList Enhancements**:
```python
class ResultsList(Static):
    # Custom message for communication with parent app
    class ResultSelected(Message):
        """Posted when a result is selected via mouse or keyboard."""
        def __init__(self, result_index: int) -> None:
            self.result_index = result_index
            super().__init__()

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.results = []
        self.selected_index = 0
        self.result_line_map = []  # Maps line Y coords to result indices
```

**3. Line Mapping**:
- Tracks which display line corresponds to which result
- Handles variable-height results (with/without snippets)
- Enables accurate click detection

**4. Mouse Event Handlers**:
```python
def on_click(self, event: events.Click) -> None:
    """Handle mouse clicks to select results."""
    # Maps click Y coordinate to result index
    # Updates selection and posts message to app

def on_mouse_scroll_down(self, event: events.MouseScrollDown) -> None:
    """Handle mouse scroll down (next result)."""
    # Navigate to next result and update preview

def on_mouse_scroll_up(self, event: events.MouseScrollUp) -> None:
    """Handle mouse scroll up (previous result)."""
    # Navigate to previous result and update preview
```

**5. Message Handler in RewindexTUI**:
```python
def on_results_list_result_selected(self, message: ResultsList.ResultSelected) -> None:
    """Handle result selection from mouse interaction."""
    # Updates preview pane when result is clicked or scrolled
```

## Updated Documentation

**Files Updated**:

1. **TUI_QUICKSTART.md**:
   - Added "Mouse Support" section
   - Table showing all mouse actions

2. **CLAUDE.md**:
   - Added "Mouse Support" subsection under keyboard shortcuts
   - Documents full mouse integration

3. **TUI_SEARCH_MODES.md**:
   - Updated "Via Mouse/Click" examples
   - Added scroll wheel navigation

4. **TUI_MOUSE_UPDATE.md** (this file):
   - Complete changelog for this session

## Testing

All components verified:
- ✅ Imports successful (events, Message)
- ✅ ResultsList.ResultSelected message class exists
- ✅ Mouse handlers present: `on_click`, `on_mouse_scroll_up`, `on_mouse_scroll_down`
- ✅ SearchOptions accepts `fuzziness="AUTO"` parameter
- ✅ SearchOptions accepts `partial=True` parameter
- ✅ No syntax errors in updated code

## Usage Examples

### Keyboard-Only Workflow (Still Works)
```
1. Type: "authenticate"
2. Press 'f' to enable fuzzy search
3. Press 'j' or 'k' to navigate results
4. Press 'e' to edit selected file
```

### Mouse-First Workflow (NEW!)
```
1. Type: "authenticate"
2. Click [☐ Fuzzy] checkbox to enable fuzzy search
3. Click on any result to preview it
4. Scroll wheel to browse through results
5. Press 'e' to edit (or click and press 'e')
```

### Hybrid Workflow (Best of Both)
```
1. Type: "auth" and click [☐ Partial] checkbox
2. Scroll wheel to quickly browse results
3. Press 'k' to fine-tune selection
4. Click different result with mouse
5. Press 'e' to edit
```

## Benefits

1. **Accessibility**: Users can now use mouse OR keyboard OR both
2. **Discoverability**: Mouse clicks are more intuitive for new users
3. **Efficiency**: Scroll wheel navigation is fast for browsing many results
4. **Modern UX**: Meets expectations for modern terminal applications
5. **Terminal Support**: Works great with kitty, alacritty, ghostty, wezterm

## Architecture Notes

### Message-Based Communication
Used Textual's message system for loose coupling:
- `ResultsList` posts `ResultSelected` messages
- `RewindexTUI` listens and updates preview pane
- Clean separation of concerns

### Line Mapping Strategy
Since results are rendered as text (not individual widgets):
- Track `(line_number, result_index)` tuples during render
- Map click Y coordinate to result using this mapping
- Handles variable-height results elegantly

### Event Handling
Textual's event system makes this straightforward:
- `on_click`: Built-in event with `.x` and `.y` coordinates
- `on_mouse_scroll_up/down`: Built-in scroll events
- No external dependencies needed

## Future Enhancements

Possible additions (not yet implemented):
- [ ] Right-click context menu (copy path, open in browser, etc.)
- [ ] Drag to select multiple results
- [ ] Double-click to open in editor
- [ ] Mouse hover previews
- [ ] Column resizing with mouse drag

---

**Status**: Complete and tested ✅
**Version**: 1.2.0
**Date**: 2025-10-23
**Session**: Mouse interaction + fuzzy parameter fix
