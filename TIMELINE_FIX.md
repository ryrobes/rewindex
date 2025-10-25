# Timeline Fix: Base Query vs Time-Filtered Results

## The Problem

When time-traveling, the timeline was getting filtered to the time-travel results instead of staying on the base query results.

### Example of the Problem:
1. Search "async" at Live → 15 files match
2. Timeline shows versions of those 15 files ✅
3. Click timestamp "2 hours ago" → Search runs with `as_of_ms`
4. Only 10 files existed 2 hours ago → `lastSearchResults` = 10 files
5. Timeline gets filtered to those 10 files ❌
6. Timeline loses 5 files that were part of the original query!

## The Solution

Separate **timeline file scope** from **current search results**:

### Two Variables:
- `lastSearchResults` - What you're currently viewing (may be time-filtered)
- `timelineFilePaths` - File paths for timeline (base query, NO time filter)

### Update Logic:

```javascript
// In doSearch():
if(!currentAsOfMs){
  // Live search: update timeline file paths
  timelineFilePaths = results.map(r => r.file_path);
} else {
  // Time-traveling: keep existing timeline file paths
  // (don't update based on time-filtered results)
}

// In refreshTimeline():
// Always use timelineFilePaths (base query) not lastSearchResults
if(hasActiveSearch){
  const pathsParam = encodeURIComponent(JSON.stringify(timelineFilePaths));
  url = `/timeline/stats?paths=${pathsParam}`;
}
```

## Behavior Now

| Action | lastSearchResults | timelineFilePaths | Timeline Shows |
|--------|------------------|-------------------|----------------|
| Search "async" (Live) | 15 files | 15 files | All versions of 15 files ✅ |
| Click timestamp | 10 files (at that time) | 15 files (unchanged) | All versions of 15 files ✅ |
| Change query to "auth" | 20 files | 20 files | All versions of 20 files ✅ |
| Click timestamp again | 18 files (at that time) | 20 files (unchanged) | All versions of 20 files ✅ |
| Clear search | 0 files | 0 files | All files (global) |

## Key Points

1. **Timeline = Full history of base query** (never time-filtered)
2. **Results = Current view** (may be time-filtered)
3. **Tick position = Where you are in time**
4. **Timeline scope = Which files' history to show**

This keeps the timeline useful for navigation while maintaining search context!
