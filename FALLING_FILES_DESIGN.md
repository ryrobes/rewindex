# Falling Files Visualization Design

## Concept

When files are updated (in empty search / overview mode), they appear as colored rectangles that:
- Fall from random positions at top of screen
- Use real physics (gravity, collisions)
- Stack at bottom like tossed bricks
- Show file path and language
- Use theme colors
- Auto-cleanup after N files

## Visual Design

```
┌─────────────────────────────────────┐
│         [main.py]                   │ ← Falling
│                                     │
│                  [config.js]        │ ← Falling
│                                     │
│                                     │
│         Overview Stats              │
│         (in center)                 │
│                                     │
│                                     │
├─────────────────────────────────────┤
│ [app.js] [util.py]                 │ ← Stacked
│    [config.json]  [README.md]      │ ← Stacked
└─────────────────────────────────────┘
```

## Implementation Plan

### 1. Physics Engine: Matter.js

**Why Matter.js:**
- 2D rigid body physics
- Collision detection built-in
- Gravity, friction, restitution
- Canvas rendering
- CDN available
- ~100KB minified

**Load from CDN:**
```html
<script src="https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js"></script>
```

### 2. Physics World Setup

```javascript
// Create Matter.js engine
const engine = Matter.Engine.create({
  gravity: { x: 0, y: 1 }  // Normal gravity downward
});

// Create renderer (overlay on workspace)
const render = Matter.Render.create({
  element: workspace,
  engine: engine,
  options: {
    width: workspace.clientWidth,
    height: workspace.clientHeight,
    wireframes: false,
    background: 'transparent'
  }
});

// Ground and walls
const ground = Matter.Bodies.rectangle(
  width/2, height, width, 50, { isStatic: true }
);
const leftWall = Matter.Bodies.rectangle(0, height/2, 50, height, { isStatic: true });
const rightWall = Matter.Bodies.rectangle(width, height/2, 50, height, { isStatic: true });

Matter.World.add(engine.world, [ground, leftWall, rightWall]);
```

### 3. File Block Creation

```javascript
function createFallingFileBlock(fileData){
  const { file_path, language, action } = fileData;

  // Random X position at top
  const x = Math.random() * (workspace.clientWidth - 100) + 50;
  const y = -50; // Start above viewport

  // Block size based on filename length
  const width = Math.min(200, file_path.length * 6 + 40);
  const height = 30;

  // Create physics body
  const block = Matter.Bodies.rectangle(x, y, width, height, {
    restitution: 0.3,  // Some bounce
    friction: 0.8,
    density: 0.001,
    render: {
      fillStyle: getLanguageColor(language),
      strokeStyle: 'rgba(255, 255, 255, 0.3)',
      lineWidth: 1
    },
    label: file_path  // Store path in body
  });

  Matter.World.add(engine.world, block);

  // Render file path text on canvas (custom rendering)
  blocks.set(block.id, { path: file_path, language, action, createdAt: Date.now() });
}
```

### 4. Event Integration

```javascript
// Listen to file update events
esrc.addEventListener('file', (ev)=>{
  const data = JSON.parse(ev.data);

  // Only show falling blocks in overview mode (empty search)
  if(!qEl.value.trim() && resultsOnlyMode){
    createFallingFileBlock(data);
  }
});
```

### 5. Custom Rendering

Matter.js doesn't render text, so we overlay canvas with text:

```javascript
// After physics step, render file paths
function renderFileLabels(ctx){
  blocks.forEach((data, bodyId) => {
    const body = Matter.Composite.get(engine.world, bodyId, 'body');
    if(!body) return;

    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);

    // Draw file name
    ctx.fillStyle = '#fff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(shortenPath(data.path), 0, 4);

    ctx.restore();
  });
}
```

### 6. Cleanup & Limits

```javascript
// Limit to 50 blocks max
if(blocks.size > 50){
  // Remove oldest blocks
  const oldest = Array.from(blocks.entries())
    .sort((a, b) => a[1].createdAt - b[1].createdAt)[0];

  Matter.World.remove(engine.world, oldest[0]);
  blocks.delete(oldest[0].id);
}
```

### 7. Visual Polish

**Block styling:**
- Language color (from existing color scheme)
- Semi-transparent (0.7 opacity)
- Border stroke
- Rounded corners (if possible)
- Drop shadow

**Text:**
- Truncate long paths: `repos/.../file.py`
- White text with shadow
- Rotate with block
- Small monospace font

**Effects:**
- Random rotation on spawn (-15° to +15°)
- Slight random velocity
- Bounce on impact
- Sleep after settling (physics optimization)

### 8. Toggle Control

Add button to enable/disable falling files:

```javascript
let fallingFilesEnabled = true;

// Toggle button in UI
fallingFilesToggle.onclick = () => {
  fallingFilesEnabled = !fallingFilesEnabled;
  if(!fallingFilesEnabled){
    // Clear all blocks
    clearAllFallingBlocks();
  }
};
```

## Alternative: Simpler Implementation (No Library)

If we want to avoid Matter.js dependency:

```javascript
// Simple gravity simulation
function updateFallingBlocks(){
  blocks.forEach(block => {
    // Apply gravity
    block.vy += 0.5;
    block.y += block.vy;

    // Check collision with ground
    if(block.y > groundY){
      block.y = groundY;
      block.vy *= -0.3; // Bounce
      if(Math.abs(block.vy) < 1) block.vy = 0; // Stop
    }

    // Simple rotation
    block.rotation += block.rotationSpeed;
  });

  requestAnimationFrame(updateFallingBlocks);
}
```

But this won't have realistic stacking/collision between blocks.

## Recommendation

**Use Matter.js** for the full effect:
- Realistic physics
- Blocks collide and stack
- Well-tested library
- Worth the 100KB for the fun factor

**Make it toggleable** so users can disable if they find it distracting.

**Want me to implement this?** It'll be maybe 200 lines of code and super fun to watch! 🎮
