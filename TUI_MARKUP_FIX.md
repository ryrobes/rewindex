# TUI Markup Parsing Error Fix

## Issue
Users were getting errors like:
```
Search error: Expected markup value (found '="901" height="481" xlink\n'
```

## Root Cause
Textual/Rich was trying to parse file content as markup. When content contained:
- Square brackets `[` `]` (interpreted as Rich markup tags like `[bold]`)
- Special characters in SVG/HTML files
- JSON, code arrays, etc.

Textual would fail trying to parse them as Rich console markup.

## Solution
Use Rich's `Text` class instead of raw strings. `Text` objects are treated as plain text with no markup parsing.

### Changes Made

**File**: `rewindex/tui/app.py`

1. **Import Rich Text**:
```python
from rich.text import Text
```

2. **ResultsList.render_results()**:
```python
# Before: self.update("".join(lines))
# After:
text = Text()
text.append(content...)
self.update(text)
```

3. **PreviewPane.show_file()**:
```python
# Before: self.update("".join(lines))
# After:
text = Text()
text.append(content...)
self.update(text)
```

4. **All error messages**:
```python
# Before: self.update(f"Error: {e}")
# After:  self.update(Text(f"Error: {e}"))
```

5. **All static messages**:
```python
# Before: self.update("📄 No file selected")
# After:  self.update(Text("📄 No file selected"))
```

## Testing

Rich Text correctly handles all problematic content:

```python
✓ Handled: width="901" height="481" xlink:href="[something]"
✓ Handled: <div class="[container]" data-value="[test]">[content]</div>
✓ Handled: [bold]not actually bold[/bold]
✓ Handled: array[0] = value[1]
✓ Handled: {"key": "value"}
```

## Result

The TUI now works correctly with **all file types**:
- ✅ SVG files with attributes
- ✅ HTML files with classes/data attributes
- ✅ JavaScript/Python with array brackets
- ✅ JSON files with curly braces
- ✅ Any code containing `[`, `]`, `{`, `}`, etc.

## Usage

No changes needed - just use the TUI normally:

```bash
rewindex tui
rewindex tui "search query"
```

The TUI will now search and display **any file content** without markup parsing errors! 🎉

---

**Technical Note**: Rich's `Text` class is specifically designed for plain text that should not be interpreted as markup. When passed to Textual widgets, it's rendered as-is without any parsing.
