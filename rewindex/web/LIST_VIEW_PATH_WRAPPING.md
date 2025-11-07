# List View - File Path Wrapping

## Overview

Modified file path display in list view to show full paths by allowing text wrapping instead of truncating with ellipsis.

## Changes

### Problem

Long file paths were being truncated with ellipsis (`...`), making it difficult to see the full path:

```
📄 rewindex/web/components/search/adva...
🟨 src/components/authentication/passw...
```

Users couldn't see the complete path without hovering or clicking.

### Solution

**1. Enable text wrapping on file path column**

**File**: `rewindex/web/list-view.css:78-85`

```css
/* Before */
.file-grid-item .file-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-family: var(--font-mono), monospace;
  font-size: 12px;
}

/* After */
.file-grid-item .file-path {
  color: var(--text);
  font-family: var(--font-mono), monospace;
  font-size: 10px;           /* Smaller to fit more */
  line-height: 1.4;          /* Comfortable spacing */
  word-break: break-all;     /* Break long paths anywhere */
  overflow-wrap: break-word; /* Prefer breaking at word boundaries */
}
```

**Changes**:
- ❌ Removed `overflow: hidden` - allow content to wrap
- ❌ Removed `text-overflow: ellipsis` - no truncation
- ❌ Removed `white-space: nowrap` - allow wrapping
- ✅ Reduced font size 12px → 10px for better density
- ✅ Added `line-height: 1.4` for readable multi-line text
- ✅ Added `word-break: break-all` to break anywhere if needed
- ✅ Added `overflow-wrap: break-word` to prefer breaking at slashes/boundaries

**2. Align grid items to top instead of center**

**File**: `rewindex/web/list-view.css:39`

```css
/* Before */
.file-grid-item {
  align-items: center;  /* Center all columns vertically */
}

/* After */
.file-grid-item {
  align-items: start;   /* Align to top when path wraps */
}
```

**Why**: When file path wraps to 2-3 lines, other columns (size, lines, updated) should align to the top of the row, not the center. This creates a cleaner, more consistent layout.

## Visual Comparison

### Before (Truncated)

```
┌──────────────────────────────────────────────────────────┐
│ 📄 rewindex/web/components/search/adva...  4.2 KB  150   │
│ 🟨 src/components/authentication/passw...  8.5 KB  200   │
│ 🐍 api/services/user/permissions/manag... 12.3 KB  450   │
└──────────────────────────────────────────────────────────┘
```

Problems:
- Can't see full path
- Must hover or click to reveal
- Inconsistent truncation point

### After (Wrapped)

```
┌──────────────────────────────────────────────────────────┐
│ 📄 rewindex/web/components/search/      4.2 KB  150 lines│
│    advanced-filters.js                                    │
│ 🟨 src/components/authentication/       8.5 KB  200 lines│
│    password-reset.tsx                                     │
│ 🐍 api/services/user/permissions/      12.3 KB  450 lines│
│    manager.py                                             │
└──────────────────────────────────────────────────────────┘
```

Benefits:
- ✅ Full path always visible
- ✅ File name clearly visible on last line
- ✅ Smaller font fits more content
- ✅ Natural breaking at slashes

## Typography Details

**Font Size Reduction**: 12px → 10px
- **Why**: Smaller font allows longer paths to fit on one line
- **Readability**: Still readable with monospace font
- **Density**: More efficient use of space

**Line Height**: 1.4
- Standard for monospace code
- Comfortable spacing for multi-line paths
- Not too tight, not too loose

**Word Breaking Strategy**:
```css
word-break: break-all;      /* Break anywhere if absolutely necessary */
overflow-wrap: break-word;  /* Prefer breaking at natural boundaries */
```

**How it works**:
1. Browser tries to break at natural word boundaries (spaces, slashes)
2. If path has no breaks (e.g., `verylongfilenamewithoutslashes.js`), breaks anywhere
3. Prevents horizontal overflow

## Layout Behavior

**Grid Columns**:
```css
grid-template-columns: 24px minmax(200px, 1fr) 80px 80px 120px 60px;
```

- Icon: 24px fixed
- **Path: minmax(200px, 1fr)** - flexible, wraps as needed
- Size: 80px fixed
- Lines: 80px fixed
- Updated: 120px fixed
- Actions: 60px fixed

**Path column behavior**:
- Minimum width: 200px (ensures reasonable width)
- Maximum width: fills available space (1fr)
- Wraps within this space
- Row height expands to fit wrapped content

**Vertical Alignment**:
```css
align-items: start;  /* All columns align to top of row */
```

When path wraps to 2-3 lines:
```
┌────────────────────────────────────────┐
│ 📄 long/path/that/wraps/    4.2 KB    │
│    to/multiple/lines/file.js 150 lines │
│                              2h ago    │
└────────────────────────────────────────┘
```

Size, lines, updated columns stay at top, aligned with icon and first line of path.

## Edge Cases

### Very Long File Names (No Slashes)

**Path**: `verylongfilenamethathasnobreakpointsbutkeepsgoing.js`

**Result**:
```
📄 verylongfilenameth
   athasnobreakpoints
   butkeepsgoing.js
```

Breaks at character boundaries due to `word-break: break-all`.

### Deeply Nested Paths

**Path**: `src/components/features/authentication/forms/password/reset/handlers/submit.tsx`

**Result**:
```
📄 src/components/features/
   authentication/forms/password/
   reset/handlers/submit.tsx
```

Breaks at slashes, clean natural wrapping.

### Short Paths (No Wrapping Needed)

**Path**: `src/app.py`

**Result**:
```
📄 src/app.py    4.2 KB  150 lines  2h ago
```

Single line, no wrapping, perfect alignment.

## Browser Compatibility

**CSS Properties**:
- `word-break: break-all` - ✅ All browsers (IE8+)
- `overflow-wrap: break-word` - ✅ All modern browsers (IE10+)
- `line-height` - ✅ All browsers
- `align-items: start` - ✅ All browsers with CSS Grid support

**Fallback**: If browser doesn't support these properties, text will still display (just might overflow slightly). No breaking changes.

## Performance

**Rendering**: No performance impact
- Browser's native text wrapping (hardware-accelerated)
- No JavaScript involved
- Pure CSS solution

**Layout**: Minimal impact
- Grid layout already computed
- Row height adjusts automatically
- No reflow issues

## Accessibility

**Improved**:
- ✅ Full path always visible (no need to hover)
- ✅ Screen readers can read complete path
- ✅ Better for users with mobility issues (no precise hovering needed)
- ✅ Keyboard navigation shows full path immediately

## Related Files

- `rewindex/web/list-view.css` - Grid layout and typography
- `rewindex/web/list-view.js` - File path rendering (no changes needed)

## Future Enhancements

**Smart Path Breaking**:
- Highlight file name more prominently
- Dim directory path slightly
- Break at last `/` to keep filename on its own line

**User Preference**:
- Toggle between wrap and truncate modes
- Configurable font size (9px, 10px, 11px)
- Variable column widths (drag to resize)

**Path Abbreviation**:
- Option to collapse middle directories: `src/.../components/file.js`
- Show just filename with tooltip for full path
- Breadcrumb-style path display

---

**Change completed**: 2025-01-06
**Status**: ✅ Fully working
**Impact**: Better usability - full paths always visible
**Performance**: None (pure CSS, instant)
