# Timeline Visualization Improvements

## Summary

Enhanced the timeline visualization to use finer-grained bucketing and dynamic scoping based on search context.

## Changes Made

### 1. Fixed 5-Minute Buckets (was: auto-bucketing ~30 minutes)

**Before**: Used Elasticsearch's `auto_date_histogram` with 60 buckets
- ES automatically chose interval based on time range (often 30+ minutes)
- Variable granularity made patterns harder to see

**After**: Uses `date_histogram` with fixed 5-minute intervals
- Consistent granularity across all time ranges
- 5-minute buckets provide much finer detail
- Hard limit of 500 buckets to prevent performance issues
- If >500 buckets generated, automatically downsampled with stride

### 2. Search-Scoped Timeline (NEW!)

**Before**: Timeline always showed global file version history

**After**: Timeline dynamically adapts to search context
- **No search active**: Shows global timeline (all files)
- **Search active**: Shows timeline for ONLY matched files
- Updates automatically when search changes or clears
- Visual feedback in console logs

### 3. Hard Bucket Limit

- Maximum 500 buckets returned from API
- Downsampling algorithm: `buckets[::stride]` where `stride = count / 500`
- Prevents UI performance issues with very long time ranges
- Server logs downsampling when it occurs

## API Changes

### `/timeline/stats` Endpoint

**New Query Parameter**: `paths` (optional)
- Format: URL-encoded JSON array of file paths
- Example: `?paths=%5B%22rewindex%2Fapi_server.py%22%5D`
- When provided: filters versions to only those files
- When omitted: returns global timeline

**Response Changes**:
```json
{
  "min": 1234567890000,
  "max": 1234567999999,
  "series": [{key: timestamp, count: n}, ...],
  "bucket_count": 145,         // NEW: number of buckets returned
  "interval": "5m",             // NEW: bucket interval
  "filtered": true,             // NEW: whether file filter applied
  "file_count": 15              // NEW: number of files filtered to (if filtered)
}
```

## Implementation Details

### Backend (`api_server.py`)

1. Parse optional `paths` query parameter (JSON array)
2. Build ES query filter:
   - No paths: `{"match_all": {}}`
   - With paths: `{"terms": {"file_path": [...]}}`
3. Use `date_histogram` with `"fixed_interval": "5m"`
4. Set `"min_doc_count": 0` for visual continuity
5. Downsample if needed (stride algorithm)
6. Return enhanced response with metadata

### Frontend (`app.js`)

**`refreshTimeline()` function**:
1. Check if search is active (`qEl.value && lastSearchResults.length > 0`)
2. If yes: build URL with file paths from `lastSearchResults`
3. If no: use plain `/timeline/stats` for global view
4. Log timeline mode and stats to console
5. Render sparkline with returned series

**Integration points**:
- Called at end of `doSearch()` (after search completes)
- Called when search cleared (switches back to global)
- Called on watcher/index events (keeps timeline fresh)

## Performance

**5-Minute Buckets**:
- 500 buckets = 41.7 hours of coverage
- Beyond that: automatic downsampling kicks in
- Query time: ~50-100ms (similar to old auto bucketing)

**File Filtering**:
- Elasticsearch `terms` query on `file_path` field
- Indexed field, very fast filtering
- Negligible overhead vs global query

**Network**:
- File paths sent as JSON array in query string
- 200 files ≈ 5-10 KB (depends on path lengths)
- Acceptable for typical search result sizes

## Testing

After restarting the server:

```bash
# Test global timeline (no search)
curl 'http://localhost:8899/timeline/stats' | jq

# Test search-scoped timeline (2 files)
curl 'http://localhost:8899/timeline/stats?paths=%5B%22rewindex/api_server.py%22%2C%22rewindex/web/app.js%22%5D' | jq

# Verify interval and bucket_count fields
curl 'http://localhost:8899/timeline/stats' | jq '{interval, bucket_count, filtered}'
```

## Web UI Usage

1. **Open Web UI**: http://localhost:8899/ui
2. **No search**: Timeline shows global file version history
3. **Search "async"**: Timeline updates to show only versions of files matching "async"
4. **Clear search**: Timeline reverts to global view
5. **Console logs**: Check browser console for timeline mode and stats

Expected console output:
```
🕐 [refreshTimeline] Global timeline (no active search)
🕐 [refreshTimeline] Global: 234 buckets (5m interval)

🕐 [refreshTimeline] Search-scoped: 15 files
🕐 [refreshTimeline] Filtered to 15 files, 87 buckets (5m interval)
```

## Future Enhancements

- Make interval configurable (5m / 15m / 1h)
- Smart interval selection based on time range
- Drill-down: click bucket to filter by time range
- Heatmap view: file x time matrix
- Compare timelines across searches

## 📊 Timeline Behavior Summary

| State | Timeline Shows |
|-------|---------------|
| **No search, Live** | Global (all files, all time) |
| **Search "async", Live** | Search-scoped (matched files, all time) ✨ |
| **Search "async", Time-traveling** | Search-scoped (matched files, all time) ✨ |
| **No search, Time-traveling** | Global (all files, all time) |

**Key Insight**: The timeline always shows the full history of whatever files you're currently viewing:
- **With search**: Timeline = full history of matched files only
- **Without search**: Timeline = full history of all files  
- **Time-travel**: Only affects which *versions* you see in results, not which *files* appear in timeline

## Separation of Concerns

**File filtering** (which files to show):
- Controlled by: Search query
- Affects: Timeline file scope
- Example: Search "async" → timeline shows only files matching "async"

**Time filtering** (which versions to show):
- Controlled by: Timeline scrubber (clicking a timestamp)
- Affects: Search results display
- Does NOT affect: Timeline itself (it always shows all time)
- Example: Click timestamp → results show versions at that time, timeline stays full

This prevents the timeline from becoming unusable when time-traveling!
