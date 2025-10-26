# Binary File Support Implementation

## Summary

Rewindex now supports indexing binary files (images, videos, PDFs, etc.) with metadata only - no content storage. This allows name-based search for ALL files while keeping the index efficient.

## Backend Implementation

### New Functions (`indexing.py`)

**`_get_binary_type(extension)`** - Categorizes binaries:
- `image`: .png, .jpg, .gif, .webp, etc.
- `video`: .mp4, .avi, .mkv, .mov, etc.
- `audio`: .mp3, .wav, .flac, .ogg, etc.
- `archive`: .zip, .tar, .gz, .7z, etc.
- `document`: .pdf, .doc, .xlsx, .ppt, etc.
- `font`: .ttf, .otf, .woff, etc.
- `executable`: .exe, .dll, .so, etc.
- `binary`: everything else

**`_generate_image_preview(path, max_size_kb)`** - Creates base64 thumbnails:
- Only for images <50KB (configurable)
- Uses PIL if available → 100x100 thumbnail
- Falls back to raw base64 for <20KB images
- Returns `data:image/png;base64,...`
- Stored in `preview_base64` field (not searchable)

**`_index_binary_file(...)`** - Indexes binary metadata:
```python
{
  "file_path": "assets/logo.png",
  "file_name": "logo.png",
  "extension": ".png",
  "language": "binary-image",
  "content": "",  # Empty!
  "is_binary": true,
  "binary_type": "image",
  "preview_base64": "data:image/png;base64,...",  # If small enough
  "size_bytes": 45678,
  "content_hash": "abc123...",  # For version tracking
  // ... standard fields
}
```

### New Endpoint (`api_server.py`)

**`GET /file/download?path=<rel_path>`**:
- Serves actual file from filesystem
- Security: validates path is within project_root
- Sets proper MIME type and Content-Disposition
- Works for images, PDFs, videos, etc.

### Configuration

**`.rewindex.json`:**
```json
{
  "indexing": {
    "index_binaries": false,  // Set to true to enable
    "binary_preview_max_kb": 50  // Max image size for thumbnail
  }
}
```

**Default: OFF** - Must explicitly enable binary indexing.

## Frontend Implementation (TODO)

### Results Panel Changes:

**Binary file display:**
```html
<div class="result-file binary">
  <span class="binary-type-badge">PNG</span>
  <span class="file-name">screenshot.png</span>
  <span class="file-size">524 KB</span>
  <img src="data:image/png;base64,..." class="binary-preview" />
</div>
```

**Text labels (no emojis):**
- PNG, JPG, MP4, PDF, ZIP, etc.
- Badges styled like language chips
- Muted/gray styling to distinguish from text files

### Canvas Behavior:

**Binary files NOT rendered on canvas:**
```javascript
// In refreshAllTiles():
const textFiles = results.filter(r => !r.is_binary);
// Only render text files as tiles
```

### Click Handlers:

**Binary file clicked:**
```javascript
if(file.is_binary){
  if(file.binary_type === 'image' && file.preview_base64){
    // Show image preview modal
    showImagePreview(file);
  } else {
    // Download file
    window.open(`/file/download?path=${encodeURIComponent(file.file_path)}`);
  }
} else {
  // Normal text file behavior
  openTile(file.file_path);
}
```

### Image Preview Modal:

For images with base64 previews, show inline:
```html
<div class="image-preview-modal">
  <img src="data:image/png;base64,..." />
  <div class="image-info">
    screenshot.png · 524 KB · Modified 2h ago
  </div>
  <button onclick="download()">Download Full Size</button>
</div>
```

## Use Cases

### 1. Find Images by Name
```
Search: "logo"
Results:
  - logo.png (PNG · 45 KB)
  - logo.svg (IMAGE · 12 KB)
  - brand_logo.pdf (PDF · 234 KB)
  - logo_utils.py (Python file with code preview)
```

### 2. Asset Inventory
```
Search: * + Filter: binary-image
Results: All images in index
Can download or preview
```

### 3. Version Tracking
Binary files track hash and size changes:
```
Version 1: 2.3 MB (hash abc123)
Version 2: 2.5 MB (hash def456)
Version 3: 2.1 MB (hash ghi789)
```

## Implementation Status

✅ **Backend Complete:**
- Binary detection and categorization
- Metadata-only indexing
- Base64 thumbnail generation (PIL optional)
- `/file/download` endpoint
- Config options

⏳ **Frontend TODO:**
- Filter binaries from canvas rendering
- Show in results panel with type badges
- Click handlers for download/preview
- Image preview modal
- "Show Binaries" toggle (optional)

## Testing

**Enable binary indexing:**
```json
// .rewindex.json
{
  "indexing": {
    "index_binaries": true
  }
}
```

**Reindex:**
```bash
rewindex index rebuild --clean
```

**Search:**
```bash
rewindex search "screenshot"
# Should find screenshot.png, screenshot.py, etc.
```

## Future Enhancements

- Video thumbnails (ffmpeg integration)
- PDF preview (pdf.js)
- Audio waveforms
- Archive contents listing
- Smart mime type detection beyond extension
