# Filter Panel Positioning Fix

## Problem

Filter panels were positioned from the LEFT edge (`left: 435px`), causing them to overlay the list view preview panel from the left side, making it appear as if the preview was "resizing to the left" instead of "resizing to the right".

## Root Cause

**Before Fix**: `styles.css:107-116`

```css
#filterPanelsContainer {
  position: fixed;
  left: 435px;  /* ❌ Positioned from left, after sidebar */
  top: 0;
  bottom: 0;
  z-index: 98;
  display: flex;
  flex-direction: row;  /* ❌ Stack left-to-right */
}
```

**Visual behavior**:
```
┌─────────────────────────────────────────────────────┐
│ Sidebar │ Filter 1 │ Preview Panel                  │
│         │ (covers) │                                 │
└─────────────────────────────────────────────────────┘
```

Filter panels started at `left: 435px` (right after sidebar) and extended to the right, overlaying the preview panel from its left edge.

## Solution

Position filter panels from the RIGHT edge and stack them right-to-left.

**After Fix**: `styles.css:107-115`

```css
#filterPanelsContainer {
  position: fixed;
  right: 0;  /* ✅ Positioned from right edge */
  top: 0;
  bottom: 0;
  z-index: 98;
  display: flex;
  flex-direction: row-reverse;  /* ✅ Stack right-to-left */
  pointer-events: none;
}
```

**Visual behavior**:
```
┌─────────────────────────────────────────────────────┐
│ Sidebar │      Preview Panel          │  Filter 1   │
│         │                              │             │
└─────────────────────────────────────────────────────┘
```

Filter panels now start at the right edge and extend to the left.

## How It Works Now

### Adding Filter Panels

**Panel Stacking** (with `flex-direction: row-reverse`):

```
No filters:
┌──────────────────────────────────────────────────┐
│ Sidebar │          Preview (full width)         │
└──────────────────────────────────────────────────┘

Add Filter 1:
┌──────────────────────────────────────────────────┐
│ Sidebar │      Preview Panel       │  Filter 1  │
│         │                           │  (360px)   │
└──────────────────────────────────────────────────┘

Add Filter 2:
┌──────────────────────────────────────────────────┐
│ Sidebar │   Preview   │ Filter 2 │  Filter 1    │
│         │             │ (360px)  │  (360px)     │
└──────────────────────────────────────────────────┘

Add Filter 3:
┌──────────────────────────────────────────────────┐
│ Sidebar │ Preview │Filter 3│Filter 2│ Filter 1  │
│         │         │ 360px  │ 360px  │ 360px     │
└──────────────────────────────────────────────────┘
```

### Z-Index Layering

```
Bottom layer (z-index: 0): Canvas
Middle layer (z-index: 1): List View Container
  └── Preview Panel (fills container)
Top layer (z-index: 98): Filter Panels Container
  └── Filter panels (stacked right-to-left)
```

### Container Sizing

**List View Container**:
- `left: 435px` (after sidebar)
- `right: 360px × filterCount` (dynamically adjusted)
- Width = viewport_width - 435 - (360 × filterCount)

**Preview Panel**:
- `flex: 1` (fills container)
- Automatically sized to container width

**Result**: As filter panels are added from the right, the list view container shrinks from the right, and the preview panel (filling the container) naturally shrinks from the right.

## Technical Details

### Row-Reverse Behavior

`flex-direction: row-reverse` reverses the order of flex items:
- **Normal `row`**: Items added left-to-right
- **`row-reverse`**: Items added right-to-left

**Filter Panel Order**:
```javascript
filterPanels = [Panel1, Panel2, Panel3]

// Rendered as (right-to-left):
[Panel1] [Panel2] [Panel3]
   ↑         ↑        ↑
 oldest   middle   newest
```

Newest panel appears on the right, older panels shift left.

### Fixed Positioning

`position: fixed` positions relative to the viewport, not the parent:
- `right: 0` means 0px from right edge of viewport
- Stays in place when scrolling
- Independent of other elements

### Pointer Events

`pointer-events: none` on container allows clicks to pass through:
- Container itself doesn't capture events
- Individual panels have `pointer-events: all`
- Allows interaction with elements behind the container

## Edge Cases

### Canvas Mode with Filters

**Scenario**: User has filters open in canvas mode, switches to list view.

**Result**:
- Filter panels remain at right edge
- List view container adjusts `right` offset
- Preview panel correctly sized from the start
- No repositioning flash

### Removing Middle Panel

**Scenario**: User has 3 panels (Panel1, Panel2, Panel3), removes Panel2.

**Result**:
- Panel2 removed from DOM
- Panel1 and Panel3 remain
- Container recalculates: `right = 2 × 360px = 720px`
- Preview panel expands by 360px from the right

### Small Screens

**Scenario**: Viewport width < 1200px with multiple filters.

**Result**:
- Panels still position from right
- May overlap sidebar on very small screens
- Responsive CSS (already in place) adjusts layout

## Browser Compatibility

**Flexbox row-reverse**: ✅ All modern browsers (IE11+)
**Fixed positioning**: ✅ All browsers
**Right-edge positioning**: ✅ All browsers

## Testing Checklist

- [x] Filter panels appear from right edge
- [x] Preview panel shrinks from right when filters added
- [x] Preview panel expands from right when filters removed
- [x] Multiple filters stack correctly (right-to-left)
- [x] No overlay on preview panel from left
- [x] Switching between canvas and list view maintains correct positioning
- [x] Removing middle filter doesn't break layout

## Related Files

- `rewindex/web/styles.css` - Filter panel container positioning
- `rewindex/web/list-view.css` - Preview panel styling (removed border-left)
- `rewindex/web/list-view.js` - Container right offset calculation
- `rewindex/web/app.js` - Filter panel management

---

**Fix completed**: 2025-01-06
**Status**: ✅ Fully working
**Impact**: Critical - fixes incorrect resize direction
**Complexity**: Simple (changed 2 properties)
