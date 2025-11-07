# List View - Correct Filter Panel Positioning

## Overview

Fixed preview panel to correctly shrink from the LEFT side when filter panels are added on the left, rather than shrinking from the right.

## Problem

The preview panel was adjusting its `right` edge when filter panels were added, causing it to shrink from the RIGHT side instead of the LEFT side where the filter panels actually appear.

**Incorrect Behavior**:
```
No filters:
┌──────────────────────────────────────────────────┐
│ Sidebar │         Preview Panel                  │
└──────────────────────────────────────────────────┘

Add Filter 1 (appears on left after sidebar):
┌──────────────────────────────────────────────────┐
│ Sidebar│Filter 1│    Preview Panel        [gap]  │
│        │        │                                │
└──────────────────────────────────────────────────┘
         ↑                                   ↑
    Filter panel                    Preview shrunk from RIGHT
     on LEFT                        (wrong side!)
```

The preview panel was shrinking from the right edge, leaving a gap on the right, when it should have been shrinking from the left to make room for the left-side filter panels.

## Root Cause

**File**: `list-view.js:633-642` (before fix)

```javascript
function updateContainerPosition(filterPanelCount = 0){
  if(!listViewMode) return;

  const FILTER_PANEL_WIDTH = 360;
  const rightOffset = filterPanelCount * FILTER_PANEL_WIDTH;

  listViewContainer.style.right = `${rightOffset}px`;  // ❌ Adjusting RIGHT edge
  console.log('[List View] Updated container position: right =', rightOffset);
}
```

This was adjusting the `right` property of the container, which moved the right edge inward, making the preview panel shrink from the right.

**What was happening**:
- Container: `left: 435px` (fixed), `right: 0px → 360px → 720px` (dynamic)
- Container width decreased from the right side
- Preview panel filled container, so it also shrunk from right

## Solution

Adjust the `left` edge of the container instead of the `right` edge, so it shrinks from the LEFT side where the filter panels are located.

**File**: `list-view.js:633-643` (after fix)

```javascript
function updateContainerPosition(filterPanelCount = 0){
  if(!listViewMode) return;

  const SIDEBAR_WIDTH = 435;
  const FILTER_PANEL_WIDTH = 360;
  const leftOffset = SIDEBAR_WIDTH + (filterPanelCount * FILTER_PANEL_WIDTH);

  listViewContainer.style.left = `${leftOffset}px`;  // ✅ Adjusting LEFT edge
  console.log('[List View] Updated container position: left =', leftOffset);
}
```

**What happens now**:
- Container: `left: 435px → 795px → 1155px` (dynamic), `right: 0px` (fixed)
- Container width decreases from the left side
- Preview panel fills container, so it shrinks from left

## Visual Behavior (Correct)

### No Filter Panels

```
┌──────────────────────────────────────────────────┐
│ Sidebar │         Preview Panel                  │
│ (435px) │         (fills remaining space)        │
└──────────────────────────────────────────────────┘

Container: left: 435px, right: 0
```

### With 1 Filter Panel

```
┌──────────────────────────────────────────────────┐
│ Sidebar│Filter 1│      Preview Panel             │
│ (435px)│ (360px)│      (fills remaining space)   │
└──────────────────────────────────────────────────┘

Container: left: 795px (435 + 360), right: 0
Preview starts at 795px, shrunk from LEFT ✅
```

### With 2 Filter Panels

```
┌──────────────────────────────────────────────────┐
│ Sidebar│Filter 1│Filter 2│   Preview Panel       │
│ (435px)│ (360px)│ (360px)│   (remaining space)   │
└──────────────────────────────────────────────────┘

Container: left: 1155px (435 + 720), right: 0
Preview starts at 1155px, shrunk from LEFT ✅
```

### With 3 Filter Panels

```
┌──────────────────────────────────────────────────┐
│Sidebar│Filter1│Filter2│Filter3│  Preview Panel   │
│(435px)│(360px)│(360px)│(360px)│  (remaining)     │
└──────────────────────────────────────────────────┘

Container: left: 1515px (435 + 1080), right: 0
Preview starts at 1515px, shrunk from LEFT ✅
```

## Layout Hierarchy

```
Viewport (full width)
├── Sidebar (fixed, 435px from left)
├── Filter Panels Container (fixed, left: 435px)
│   ├── Filter Panel 1 (360px)
│   ├── Filter Panel 2 (360px)
│   └── Filter Panel 3 (360px)
└── List View Container (absolute)
    ├── left: 435px + (360px × filterCount)
    ├── right: 0px
    └── Preview Panel (flex: 1, fills container)
```

## Calculation

**Left Offset Formula**:
```javascript
leftOffset = SIDEBAR_WIDTH + (filterPanelCount × FILTER_PANEL_WIDTH)
leftOffset = 435 + (filterPanelCount × 360)
```

**Examples**:
- 0 panels: `435 + (0 × 360) = 435px`
- 1 panel: `435 + (1 × 360) = 795px`
- 2 panels: `435 + (2 × 360) = 1155px`
- 3 panels: `435 + (3 × 360) = 1515px`
- 5 panels: `435 + (5 × 360) = 2235px`

**Preview Panel Width**:
```
previewWidth = viewportWidth - leftOffset
previewWidth = viewportWidth - 435 - (filterPanelCount × 360)
```

## Code Changes Summary

### Changed Files

**1. `list-view.js:633-643`**
- Changed: Adjust `left` instead of `right`
- Added: `SIDEBAR_WIDTH` constant (435)
- Changed: Formula to `SIDEBAR_WIDTH + (filterPanelCount × FILTER_PANEL_WIDTH)`

**2. `styles.css:107-116`** (reverted)
- Back to: `left: 435px` (filter panels on left)
- Back to: `flex-direction: row` (normal left-to-right stacking)

**3. `list-view.css:147-156`**
- Re-added: `border-left: 2px solid var(--border)` (visual separator)

## Testing Results

- [x] Preview panel starts at correct position with no filters
- [x] Preview panel shrinks from LEFT when filter added
- [x] Preview panel expands from LEFT when filter removed
- [x] Multiple filters stack correctly on left
- [x] No gap on right side
- [x] Border appears correctly on left edge of preview
- [x] Works when switching from canvas mode with existing filters

## Related Files

- `rewindex/web/list-view.js` - Container position calculation
- `rewindex/web/list-view.css` - Preview panel styling
- `rewindex/web/styles.css` - Filter panels container (reverted)
- `rewindex/web/app.js` - Calls updateContainerPosition()

---

**Fix completed**: 2025-01-06
**Status**: ✅ Correctly working now
**Impact**: Critical - preview now shrinks from correct side
**Complexity**: Simple (one property change)
