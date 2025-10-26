# Muuri.js Integration Plan

## Overview

Replace custom layout algorithms with Muuri.js masonry library for:
- Automatic variable-sized tile positioning
- Better bin-packing (no overlaps)
- Smooth animations
- Simplified codebase

## Current State

### What Works:
- ✅ Binary files indexed with `is_binary: true`
- ✅ Image previews generated as base64 (ImageMagick)
- ✅ Preview dimensions stored (`preview_width`, `preview_height`)
- ✅ Search results include binary fields
- ✅ `fileMeta` map populated with preview dimensions
- ✅ Images render in tiles with `object-fit: cover`

### What's Broken:
- ❌ All tiles render at same size (600x400)
- ❌ Images don't use natural aspect ratios
- ❌ Attempted variable sizing broke grid (rows of 3, stacking issues)

### Current Layout System:

**`layoutSimpleGrid(paths)`**:
- Calculates positions manually
- Square-ish grid (ceil(sqrt(n)) columns)
- Uniform 600x400 tiles
- Stores in `filePos` map: `{x, y}`
- Tiles positioned with `position: absolute`

**`layoutTreemap(paths)`**:
- Complex bin-packing algorithm
- Variable sizes based on file size
- Spiral/curved patterns
- Stores in `filePos` map: `{x, y, w, h}`

**`openTile(path)`**:
- Creates tile DOM element
- Reads position from `filePos`
- Sets `style.left`, `style.top`, `style.width`, `style.height`

## Muuri.js Solution

### Library Details:
- **CDN**: `https://cdn.jsdelivr.net/npm/muuri@0.9.5/dist/muuri.min.js`
- **Size**: ~50KB minified
- **Already Loaded**: ✅ Added to index.html, backed up as `window.MuuriBackup`

### How Muuri Works:

```javascript
// Initialize grid
const grid = new Muuri('#canvas', {
  items: '.tile',              // Selector for items
  layoutDuration: 400,         // Animation duration
  layoutEasing: 'ease-out',
  dragEnabled: false,          // Disable for now
  layout: {
    fillGaps: true,            // Optimal bin-packing
    horizontal: false,         // Top-to-bottom flow
    alignRight: false,
    alignBottom: false
  }
});

// After adding/removing tiles:
grid.add(elements);        // Add new tiles
grid.remove(elements);     // Remove tiles
grid.refreshItems();       // Detect size changes
grid.layout();            // Re-calculate positions
```

**Muuri handles:**
- Positioning (no manual `filePos` map!)
- Animations (built-in)
- Variable sizes (reads from `tile.style.width/height`)
- Bin-packing (better than our algorithm)
- Responsive (auto-reflow on window resize)

## Implementation Steps

### Step 1: Initialize Muuri (in app.js)

**After Matter.js init**, add:

```javascript
// Restore Muuri and initialize
setTimeout(() => {
  if(typeof Muuri === 'undefined' && typeof window.MuuriBackup !== 'undefined'){
    window.Muuri = window.MuuriBackup;
  }

  if(typeof Muuri !== 'undefined'){
    console.log('✅ Muuri.js ready');
    initMuuriGrid();
  }
}, 1500);

function initMuuriGrid(){
  const canvas = document.getElementById('canvas');
  if(!canvas) return;

  window.muuriGrid = new Muuri(canvas, {
    items: '.tile',
    layoutDuration: 300,
    layoutEasing: 'ease-out',
    dragEnabled: false,
    layout: {
      fillGaps: true,
      horizontal: false,
      alignRight: false,
      alignBottom: false,
      rounding: true
    }
  });

  console.log('✅ Muuri grid initialized');
}
```

### Step 2: Modify Tile Creation

**Change `openTile(path)` to NOT set position:**

```javascript
// OLD:
const pos = filePos.get(path);
tile.style.left = `${pos.x}px`;
tile.style.top = `${pos.y}px`;

// NEW:
// Don't set position - Muuri will handle it!
// Just set width/height for variable sizing

const meta = fileMeta.get(path) || {};

if(meta.is_binary && meta.preview_width && meta.preview_height){
  const aspect = meta.preview_width / meta.preview_height;

  if(aspect > 1.3){
    // Landscape
    tile.style.width = '450px';
    tile.style.height = '280px';
  } else if(aspect < 0.75){
    // Portrait
    tile.style.width = '210px';
    tile.style.height = '520px';
  } else {
    // Square
    tile.style.width = '300px';
    tile.style.height = '300px';
  }
} else {
  // Text files: standard size
  tile.style.width = '600px';
  tile.style.height = '400px';
}

// Don't set position - Muuri handles it
canvas.appendChild(tile);
```

### Step 3: Replace Layout Functions

**Delete/simplify:**
```javascript
function layoutSimpleGrid(paths){
  // OLD: Calculate positions manually
  // NEW: Just clear, Muuri will layout

  for(const [, el] of folders){ el.remove(); }
  folders.clear();
  filePos.clear();  // May not need this anymore!
  fileFolder.clear();

  console.log(`📐 [layoutSimpleGrid] Letting Muuri handle layout for ${paths.length} tiles`);
  // That's it! Muuri does the rest
}

function layoutTreemap(paths){
  // Same - just clear, Muuri handles it
  for(const [, el] of folders){ el.remove(); }
  folders.clear();
  filePos.clear();
  fileFolder.clear();

  console.log(`📐 [layoutTreemap] Letting Muuri handle layout`);
}
```

### Step 4: Trigger Muuri Layout

**After tiles are created:**

```javascript
async function refreshAllTiles(ts){
  // ... existing code to create tiles ...

  // OLD:
  // if(treemapMode){
  //   layoutTreemap(list);
  // } else {
  //   layoutSimpleGrid(list);
  // }

  // NEW:
  if(window.muuriGrid){
    // Tell Muuri about all tiles
    const tiles = Array.from(document.querySelectorAll('#canvas .tile'));
    window.muuriGrid.add(tiles);

    // Trigger layout
    window.muuriGrid.refreshItems();
    window.muuriGrid.layout();
  }
}
```

### Step 5: Handle Tile Removal

```javascript
// When clearing tiles:
if(window.muuriGrid){
  const items = window.muuriGrid.getItems();
  window.muuriGrid.remove(items, {removeElements: true});
}

// Then clear maps
tiles.clear();
filePos.clear();
```

### Step 6: CSS Changes

**Remove absolute positioning from tiles:**

```css
/* OLD: */
.tile {
  position: absolute;  /* ← Remove this */
  /* ... */
}

/* NEW: */
.tile {
  position: relative;  /* Muuri needs relative/static */
  /* Muuri will apply transforms for positioning */
}
```

## Testing Plan

### Test Cases:

**1. Mixed Content Search:**
```
Search: "*"
Expected:
- Text files: 600x400 (landscape)
- Landscape images: 450x280 (wide)
- Portrait images: 210x520 (tall)
- Square images: 300x300
- Clean packing, no overlaps
```

**2. Image-Only Search:**
```
Search: "*.jpg"
Expected:
- Variable-sized tiles based on aspect
- Masonry layout
- No gaps
```

**3. Text-Only Search:**
```
Search: "*.js"
Expected:
- Uniform 600x400 tiles
- Square-ish grid
- Works like before
```

**4. Treemap Mode:**
```
Enable treemap
Expected:
- Sizes based on file size/lines
- Muuri packs efficiently
- Better than old algorithm
```

## Migration Checklist

- [ ] Restore Muuri from backup (like Matter)
- [ ] Initialize Muuri grid on page load
- [ ] Modify `openTile()` to set size, not position
- [ ] Update `layoutSimpleGrid()` to use Muuri
- [ ] Update `layoutTreemap()` to use Muuri
- [ ] Update `refreshAllTiles()` to call Muuri.layout()
- [ ] Handle tile removal with Muuri.remove()
- [ ] Change `.tile` CSS to `position: relative`
- [ ] Test all layout modes
- [ ] Test pan/zoom (may need adjustment)
- [ ] Test filtering
- [ ] Test animations

## Potential Issues & Solutions

### Issue 1: Pan/Zoom Transform
- **Problem**: Muuri uses transforms, we use transforms
- **Solution**: Apply our transform to `#canvas`, Muuri transforms individual tiles

### Issue 2: Tile Size Changes
- **Problem**: When loading content, tile might need resize
- **Solution**: Call `grid.refreshItems()` after content loads

### Issue 3: Performance
- **Problem**: 300 tiles with animations
- **Solution**: Disable animations for >100 tiles: `layoutDuration: 0`

### Issue 4: Folder Hierarchy
- **Problem**: Current treemap has folder containers
- **Solution**: May need to disable folder mode, or use Muuri groups

## Code Size Impact

**Remove (~800 lines):**
- Complex position calculation in `layoutTreemap()`
- Spiral packing algorithm
- Folder positioning logic
- Manual position tracking

**Add (~100 lines):**
- Muuri initialization
- Muuri layout triggers
- Size calculation for tiles

**Net: -700 lines!**

## Future Enhancements (Post-Muuri)

Once Muuri is integrated:
- ✅ Enable drag & drop (rearrange tiles!)
- ✅ Filtering animations (smooth hide/show)
- ✅ Sorting (by size, date, language)
- ✅ Responsive grid (auto-adjusts to window size)
- ✅ Different layout algorithms (rows, columns, etc.)

## Next Session TODO

1. Start with clean codebase
2. Implement Muuri init
3. Update one layout mode at a time
4. Test thoroughly before moving to next
5. Keep old code commented out as fallback

## Notes

- Muuri is already loaded and backed up
- Binary fields now included in search results
- Preview generation with ImageMagick works
- Just need to wire up the layout system

Good luck! This will make the canvas much more flexible and maintainable. 🎨
