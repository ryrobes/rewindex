(function(){
  const canvas = document.getElementById('canvas');
  const workspace = document.getElementById('workspace');
  const resultsEl = document.getElementById('results');
  const resultsHeaderEl = document.getElementById('resultsHeader');
  const statusEl = document.getElementById('status');
  const qEl = document.getElementById('q');
  const searchBarEl = document.getElementById('searchBar');
  const clearSearchBtn = document.getElementById('clearSearch');
  const pathFilterInput = document.getElementById('pathFilter');
  const pathExcludeInput = document.getElementById('pathExclude');
  const browseFoldersBtn = document.getElementById('browseFolders');
  const contentToggleBtn = document.getElementById('contentToggle');
  const nameToggleBtn = document.getElementById('nameToggle');
  const binaryToggleBtn = document.getElementById('binaryToggle');
  const deletedToggleBtn = document.getElementById('deletedToggle');
  const partialToggleBtn = document.getElementById('partialToggle');
  const fuzzyToggleBtn = document.getElementById('fuzzyToggle');
  const resultsOnlyBtn = document.getElementById('resultsOnly');
  const treemapModeBtn = document.getElementById('treemapMode');
  const treemapFoldersBtn = document.getElementById('treemapFolders');
  // const sizeByBytesBtn = document.getElementById('sizeByBytes'); // Removed - always use bytes
  const followCliBtn = document.getElementById('followCli');
  const followUpdatesBtn = document.getElementById('followUpdates');
  const dynTextBtn = document.getElementById('dynText');
  const systemThemeToggleBtn = document.getElementById('systemThemeToggle');
  const languageBarEl = document.getElementById('languageBar');
  const languageLegendEl = document.getElementById('languageLegend');
  const sparklineEl = document.getElementById('sparkline');
  const asofLabel = document.getElementById('asofLabel');
  const sparkTick = document.getElementById('sparkTick');
  const sparkHover = document.getElementById('sparkHover');
  const goLiveBtn = document.getElementById('goLive');
  const overlayEditorEl = document.getElementById('overlayEditor');
  const overlayFilePathEl = document.getElementById('overlayFilePath');
  const overlayEditorContainer = document.getElementById('overlayEditorContainer');
  const saveOverlayBtn = document.getElementById('saveOverlay');
  const cancelOverlayBtn = document.getElementById('cancelOverlay');
  const fileTimelineEl = document.getElementById('fileTimeline');
  const fileTimelineMarkersEl = document.getElementById('fileTimelineMarkers');
  const versionHistorySidebar = document.getElementById('versionHistorySidebar');
  const versionHistoryContent = document.getElementById('versionHistoryContent');
  const diffOverlayEl = document.getElementById('diffOverlay');
  const diffTimelineEl = document.getElementById('diffTimeline');
  const diffTimelineMarkersEl = document.getElementById('diffTimelineMarkers');
  const diffVersionHistorySidebar = document.getElementById('diffVersionHistorySidebar');
  const diffVersionHistoryContent = document.getElementById('diffVersionHistoryContent');
  const diffFilePathEl = document.getElementById('diffFilePath');
  const diffEditorContainer = document.getElementById('diffEditorContainer');
  const restoreDiffBtn = document.getElementById('restoreDiff');
  const closeDiffBtn = document.getElementById('closeDiff');
  const confirmModalEl = document.getElementById('confirmModal');
  const confirmRestoreBtn = document.getElementById('confirmRestore');
  const cancelRestoreBtn = document.getElementById('cancelRestore');
  const confirmMessageEl = document.getElementById('confirmMessage');
  const beadsPanelEl = document.getElementById('beadsPanel');
  const beadsPanelToggleBtn = document.getElementById('beadsPanelToggle');
  const beadsPanelTabBtn = document.getElementById('beadsPanelTab');
  const beadsTicketsEl = document.getElementById('beadsTickets');
  const beadsFilterBtns = document.querySelectorAll('.beads-filter-btn');

  let timelineMin = null, timelineMax = null;
  let currentAsOfMs = null;
  let scrubTimer = null;
  let sparkKeys = [];

  // Parse URL parameters to determine initial mode
  const urlParams = new URLSearchParams(window.location.search);
  const showAllParam = urlParams.get('show_all') === 'true' || urlParams.get('mode') === 'full';

  let followCliMode = false;
  let followUpdatesMode = false;
  let treemapMode = false;
  let treemapFoldersMode = false;
  const sizeByBytes = true; // Always use bytes for treemap sizing
  let contentSearchEnabled = true;  // Search file contents (default ON)
  let nameSearchEnabled = true;     // Search file names (default ON)
  let showBinaries = true;          // Include binary files in results (default ON)
  let fuzzyMode = false;
  let partialMode = false;
  let deletedMode = false;
  let dynTextMode = true; // Default ON for dynamic text sizing
  let resultsOnlyMode = !showAllParam; // Default TRUE (results only), unless URL param says otherwise
  let lastSearchResults = []; // Store last search results for results-only mode
  let timelineFilePaths = []; // Store file paths for timeline (base query, no time filter)
  let currentLanguageFilter = null; // Currently active language filter (e.g., "python", "javascript")
  let languageColors = {}; // Map of language -> color
  let languageList = []; // Ordered list of discovered languages
  let currentThemeColors = null; // Current theme colors (for gradient generation)
  let currentTerminalColors = null; // Current terminal ANSI colors (for spectrum palette)
  let recentUpdates = []; // Track recent file updates [{path, action, timestamp}]
  const MAX_RECENT_UPDATES = 20;
  let overviewRefreshTimer = null; // Debounce timer for overview refresh on file updates
  let overlayEditor = null; // Monaco editor instance for overlay
  let overlayEditorPath = null; // Current file path being edited
  let diffEditor = null; // Monaco diff editor instance
  let diffEditorPath = null; // Current file path in diff mode
  let diffHistoricalContent = null; // Historical content for restore
  let diffSelectedHash = null; // Currently selected version hash in diff mode
  let currentProjectRoot = null; // Current project root directory
  // DISABLED: Beads integration (commented out for now)
  // let beadsAvailable = false;
  // let beadsInitialized = false;
  // let beadsTickets = [];
  // let beadsCurrentFilter = 'all';
  // let beadsPollInterval = null;

  // Multi-Panel Filter System
  // Each filter panel represents a refinement layer
  // filterPanels = [{id, query, results, fuzzyMode, partialMode, element}]
  let filterPanels = []; // Array of active filter panels
  let nextFilterId = 1; // Auto-increment ID for panels
  const MAX_FILTER_PANELS = 5; // Limit to prevent UI clutter

  // Background content pre-loading
  let preloadAbortController = null; // Allow cancelling in-progress preload
  let preloadCache = new Map(); // Cache fetched file data: path -> {content, language, ...}

  // ==================== Input History Management ====================
  // Manages persistent history for search input, path filter, and exclude filter
  class InputHistoryManager {
    constructor(maxItems = 20) {
      this.maxItems = maxItems;
    }

    add(key, value) {
      if (!value || !value.trim()) return;
      const trimmed = value.trim();
      let history = this.get(key);
      // Remove if exists (we'll add to front for MRU ordering)
      history = history.filter(v => v !== trimmed);
      // Add to front
      history.unshift(trimmed);
      // Limit size
      if (history.length > this.maxItems) {
        history = history.slice(0, this.maxItems);
      }
      try {
        localStorage.setItem(key, JSON.stringify(history));
      } catch(e) {
        console.warn('Failed to save input history:', e);
      }
    }

    get(key) {
      try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : [];
      } catch(e) {
        console.warn('Failed to load input history:', e);
        return [];
      }
    }

    remove(key, value) {
      let history = this.get(key);
      history = history.filter(v => v !== value);
      try {
        localStorage.setItem(key, JSON.stringify(history));
      } catch(e) {
        console.warn('Failed to update input history:', e);
      }
    }

    clear(key) {
      try {
        localStorage.removeItem(key);
      } catch(e) {
        console.warn('Failed to clear input history:', e);
      }
    }
  }

  const historyManager = new InputHistoryManager(20);
  const HISTORY_KEYS = {
    search: 'rewindex_search_history',
    path: 'rewindex_path_history',
    exclude: 'rewindex_exclude_history'
  };

  let currentHistoryPanel = null;

  function showHistoryPanel(inputEl, historyKey, onSelect) {
    hideHistoryPanel(); // Hide any existing panel

    const history = historyManager.get(historyKey);
    if (history.length === 0) return; // No history to show

    const panel = document.createElement('div');
    panel.className = 'history-panel';

    history.forEach(value => {
      const item = document.createElement('div');
      item.className = 'history-item';

      const text = document.createElement('span');
      text.className = 'history-text';
      text.textContent = value;
      text.addEventListener('click', () => {
        onSelect(value);
        hideHistoryPanel();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'history-delete';
      deleteBtn.textContent = '×';
      deleteBtn.title = 'Remove from history';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        historyManager.remove(historyKey, value);
        item.remove();
        // Hide panel if no items left
        if (panel.querySelectorAll('.history-item').length === 0) {
          hideHistoryPanel();
        }
      });

      item.appendChild(text);
      item.appendChild(deleteBtn);
      panel.appendChild(item);
    });

    // Position below input
    const rect = inputEl.getBoundingClientRect();
    panel.style.top = `${rect.bottom + 2}px`;
    panel.style.left = `${rect.left}px`;
    panel.style.width = `${rect.width}px`;

    document.body.appendChild(panel);
    currentHistoryPanel = panel;

    // Prevent panel clicks from immediately triggering blur
    panel.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent input blur
    });
  }

  function hideHistoryPanel() {
    if (currentHistoryPanel) {
      currentHistoryPanel.remove();
      currentHistoryPanel = null;
    }
  }

  function saveCurrentInputsToHistory() {
    // Save current values to history when a search is performed
    if (qEl.value.trim()) {
      historyManager.add(HISTORY_KEYS.search, qEl.value.trim());
    }
    if (pathFilterInput && pathFilterInput.value.trim()) {
      historyManager.add(HISTORY_KEYS.path, pathFilterInput.value.trim());
    }
    if (pathExcludeInput && pathExcludeInput.value.trim()) {
      historyManager.add(HISTORY_KEYS.exclude, pathExcludeInput.value.trim());
    }
  }
  // ==================== End Input History Management ====================

  // PERFORMANCE MONITORING: Track memory usage
  let perfMemoryCheckInterval = null;
  function startMemoryMonitoring(){
    if(perfMemoryCheckInterval) return;
    perfMemoryCheckInterval = setInterval(() => {
      console.log('💾 [MEMORY SNAPSHOT]', {
        tiles: tiles.size,
        tileContent: tileContent.size,
        filePos: filePos.size,
        fileFolder: fileFolder.size,
        fileLanguages: fileLanguages.size,
        folders: folders.size,
        fileMeta: fileMeta.size,
        filterPanels: filterPanels.length,
        canvasChildren: canvas.children.length,
        resultsChildren: resultsEl ? resultsEl.children.length : 0,
        activeAnimations: activeAnimationCount,
        currentAnimId: currentAnimationId,
        preloadCacheSize: preloadCache.size
      });
    }, 50000); // Every 50 seconds
  }

  // Background file content preloader (non-blocking)
  async function startBackgroundPreload(filePaths){
    // Cancel any existing preload
    if(preloadAbortController){
      preloadAbortController.abort();
      console.log('🛑 [preload] Cancelled previous preload');
    }

    preloadAbortController = new AbortController();
    const signal = preloadAbortController.signal;

    console.log('🔄 [preload] Starting background preload & render', {
      files: filePaths.length,
      cacheSize: preloadCache.size
    });

    const BATCH_SIZE = 5; // Load 5 files at a time
    const YIELD_MS = 50; // Yield to main thread every 50ms

    let loaded = 0;
    let rendered = 0;
    let cached = 0;
    let failed = 0;

    for(let i = 0; i < filePaths.length; i += BATCH_SIZE){
      // Check if cancelled
      if(signal.aborted){
        console.log('⏹️  [preload] Aborted', { loaded, rendered, cached, failed });
        return;
      }

      // Process batch
      const batch = filePaths.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async path => {
        // Skip if already cached AND rendered
        if(preloadCache.has(path) && tileContent.has(path)){
          cached++;
          return;
        }

        try {
          const data = await fetchJSON('/file?path=' + encodeURIComponent(path));
          if(!signal.aborted){
            preloadCache.set(path, data);
            loaded++;

            // RENDER content into tile (non-blocking, async)
            // Only render if tile exists (user hasn't navigated away)
            if(tiles.has(path)){
              await loadTileContent(path, data, null, null); // No focus, no search query
              rendered++;
            }
          }
        } catch(e){
          failed++;
          console.warn(`[preload] Failed to load ${path}:`, e.message);
        }
      });

      await Promise.all(promises);

      // Yield to main thread (allows UI to stay responsive)
      if(i + BATCH_SIZE < filePaths.length){
        await new Promise(resolve => setTimeout(resolve, YIELD_MS));
      }
    }

    console.log('✅ [preload] Complete', {
      loaded,
      rendered,
      cached,
      failed,
      totalCacheSize: preloadCache.size
    });
    preloadAbortController = null;
  }

  let scale = 1.0;
  let offsetX = 40;
  let offsetY = 40;
  let isAnimating = false;
  let animHandle = null;
  let currentAnimationId = 0; // Track animation generations to prevent callback hell
  let activeAnimationCount = 0; // DEBUG: Count simultaneously running animations
  let dragging = false;
  let dragStart = [0,0];

  function applyTransform(){
    canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }
  applyTransform();

  workspace.addEventListener('wheel', (e)=>{
    // Ignore zooming when interacting with search bar
    if(e.target.closest('#searchBar')) return;
    e.preventDefault();
    const rect = workspace.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    // World coords under mouse before zoom
    const worldX = (mouseX - offsetX) / scale;
    const worldY = (mouseY - offsetY) / scale;

    const delta = -Math.sign(e.deltaY) * 0.05;
    const newScale = Math.min(2.5, Math.max(0.01, scale + delta));
    // Adjust offsets so the world point under the mouse stays fixed
    offsetX = mouseX - worldX * newScale;
    offsetY = mouseY - worldY * newScale;
    scale = newScale;
    applyTransform();
  }, {passive:false});

  workspace.addEventListener('pointerdown', (e)=>{
    // cancel any animation
    isAnimating = false;
    if(animHandle) cancelAnimationFrame(animHandle);
    // ignore drags on search bar and its children
    if(e.target.closest('#searchBar')) return;
    // Don't drag when clicking buttons or other interactive elements
    if(e.target.closest('button')) return;
    // Don't drag when interacting with the search input
    if(e.target === qEl) return;
    dragging = true;
    dragStart = [e.clientX - offsetX, e.clientY - offsetY];
    workspace.setPointerCapture(e.pointerId);
  });
  workspace.addEventListener('pointermove', (e)=>{
    if(!dragging) return;
    offsetX = e.clientX - dragStart[0];
    offsetY = e.clientY - dragStart[1];
    applyTransform();
  });
  workspace.addEventListener('pointerup', ()=>{
    dragging = false;
  });

  async function fetchJSON(url, opts){
    const r = await fetch(url, opts);
    if(!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }

  function debounce(func, wait){
    let timeout;
    return function(...args){
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  function adjustSearchBarLeft(){
    const sidebar = document.getElementById('sidebar');
    const left = sidebar ? sidebar.offsetWidth : 445;
    if(searchBarEl) searchBarEl.style.left = left + 'px';
    if(workspace) workspace.style.left = 0 + 'px';
  }
  window.addEventListener('resize', adjustSearchBarLeft);
  adjustSearchBarLeft();

  async function refreshStatus(){
    try{
      const s = await fetchJSON('/index/status');
      statusEl.innerHTML = '';
      function row(k,v){ const div=document.createElement('div'); div.className='kv'; const ks=document.createElement('span'); ks.className='k'; ks.textContent=k+':'; const vs=document.createElement('span'); vs.className='v'; vs.textContent=String(v??''); div.appendChild(ks); div.appendChild(vs); statusEl.appendChild(div); }

      // Store current project root for beads integration
      const projectRootChanged = s.project_root && s.project_root !== currentProjectRoot;
      if(s.project_root){
        console.log('[beads DEBUG] refreshStatus setting currentProjectRoot=', s.project_root);
        currentProjectRoot = s.project_root;
      }

      // Initialize beads on first load after we have project root
      // DISABLED: Beads integration
      // if(currentProjectRoot && !beadsInitialized){
      //   console.log('[beads DEBUG] First load - checking beads availability');
      //   beadsInitialized = true;
      //   checkBeadsAvailable();
      // }

      // Simplified status display
      row('Host', s.host);
      row('Root', s.project_root);
      row('ID', s.project_id);
      const files = (s.counts&&s.counts.files)||0;
      const versions=(s.counts&&s.counts.versions)||0;
      row('Files', files);
      row('Versions', versions);

      // Update search placeholder with project directory
      if(s.project_root && qEl){
        const projectName = s.project_root.split('/').pop() || s.project_root;
        qEl.placeholder = `search ${projectName}`;
      }
    }catch(e){
      statusEl.textContent = 'status unavailable';
    }
  }

  async function doSearch(){
    const perfStart = performance.now();
    const spinner = document.getElementById('primarySpinner');

    console.log('🔍 [doSearch] START', {
      query: qEl.value,
      existingTiles: tiles.size,
      filterPanels: filterPanels.length,
      cachedFiles: preloadCache.size
    });

    // Clear preload cache for new search (different result set)
    if(preloadCache.size > 0){
      console.log('🗑️  [doSearch] Clearing preload cache', { size: preloadCache.size });
      preloadCache.clear();
    }

    if(followCliMode) return; // disabled in follow CLI mode

    // Show spinner
    if(spinner) spinner.style.display = 'flex';
    resultsEl.innerHTML = '';

    if(!qEl.value.trim()) {
      // Hide spinner for empty query
      if(spinner) spinner.style.display = 'none';

      // Clear search results
      lastSearchResults = [];
      timelineFilePaths = []; // Also clear timeline file paths

      // Clear results header (match count display)
      if(resultsHeaderEl) resultsHeaderEl.innerHTML = '';

      // Clear all filter panels when primary is cleared
      while(filterPanels.length > 0){
        removeFilterPanel(filterPanels[0].id);
      }

      // Update timeline back to global view (no search active)
      refreshTimeline().catch(e => {
        console.warn('[doSearch] Timeline refresh failed:', e);
      });

      // In results-only mode, clear canvas and show overview
      if(resultsOnlyMode){
        // Clear canvas
        for(const [p, tile] of tiles){ tile.remove(); }
        tiles.clear(); tileContent.clear(); filePos.clear(); fileFolder.clear(); fileLanguages.clear();
        for(const [, el] of folders){ el.remove(); } folders.clear();

        // Show codebase overview stats in empty state (instead of blank message)
        // Show physics canvas for falling files in overview mode
        const pCanvas = document.getElementById('physicsCanvas');
        if(pCanvas) pCanvas.style.display = 'block';

        renderCodebaseOverview();
        return;
      }

      // In show-all mode, just clear the message
      resultsEl.innerHTML = '<div class="results-count" style="color: #888;">Enter a search query to see results</div>';

      // In show-all mode, clear dimming on all tiles
      for(const [,tile] of tiles){ tile.classList.remove('dim'); }
      for(const [,el] of folders){ el.classList.remove('dim'); }
      // Clear tracking sets
      if(window._dimmedTiles) window._dimmedTiles.clear();
      if(window._dimmedFolders) window._dimmedFolders.clear();
      // Don't show recent updates - falling blocks show updates visually!
      return;
    }

    // Build filters object
    const filters = currentAsOfMs ? { as_of_ms: currentAsOfMs } : {};

    // Add language filter if active
    if(currentLanguageFilter){
      filters.language = [currentLanguageFilter];
      console.log('🎨 [doSearch] Language filter:', currentLanguageFilter);
    }

    // Add path prefix filter if specified
    const pathPrefix = pathFilterInput?.value?.trim();
    if(pathPrefix){
      filters.path_prefix = pathPrefix;
      console.log('🔍 [doSearch] Path prefix filter:', pathPrefix);
      console.log('   Full filters object:', filters);
    }

    // Add path exclude filter
    const pathExclude = pathExcludeInput?.value?.trim();
    if(pathExclude){
      filters.exclude_paths = pathExclude;
      console.log('🚫 [doSearch] Path exclude filter:', pathExclude);
    }

    const body = {
      query: qEl.value,
      filters: filters,
      options: {
        limit: 300,
        context_lines: 2,
        highlight: true,
        fuzziness: fuzzyMode ? 'AUTO' : undefined,
        partial: partialMode,
        show_deleted: deletedMode,
        search_content: contentSearchEnabled,
        search_name: nameSearchEnabled
      }
    };

    // Debug: log the request payload
    console.log('📤 [doSearch] Request payload:', JSON.stringify(body, null, 2));

    const res = await fetchJSON('/search/simple', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
    const results = res.results || [];

    console.log(`📊 [doSearch] Received ${results.length} results (total: ${res.total || 0})`);
    if(pathPrefix){
      console.log(`   ℹ️  With path filter: "${pathPrefix}"`);
      if(results.length > 0){
        console.log(`   First result path: ${results[0].file_path}`);
        console.log(`   Does it start with "${pathPrefix}"? ${results[0].file_path.startsWith(pathPrefix)}`);
      }
    }

    // Hide spinner
    if(spinner) spinner.style.display = 'none';

    // Filter binary files if toggle is off
    let displayResults = results;
    if(!showBinaries){
      displayResults = results.filter(r => !r.is_binary);
      const filteredCount = results.length - displayResults.length;
      if(filteredCount > 0){
        console.log(`📦 [doSearch] Filtered out ${filteredCount} binary files`);
      }
    }

    // Store search results for results-only mode
    lastSearchResults = displayResults;

    // Store timeline file paths (base query without time filter)
    // IMPORTANT: Only update timeline paths when NOT time-traveling
    // This ensures timeline shows full history of base query, not time-filtered results
    if(!currentAsOfMs){
      timelineFilePaths = results.map(r => r.file_path);
      console.log(`🕐 [doSearch] Updated timeline file paths: ${timelineFilePaths.length} files (base query)`);
    } else {
      console.log(`🕐 [doSearch] Keeping timeline file paths: ${timelineFilePaths.length} files (time-traveling, not updating)`);
    }

    // Hide physics canvas and clear blocks when showing search results
    const pCanvas = document.getElementById('physicsCanvas');
    if(pCanvas) pCanvas.style.display = 'none';
    if(typeof window.clearAllFallingBlocks === 'function'){
      window.clearAllFallingBlocks();
    }

    // RESULTS-ONLY MODE: Rebuild canvas with only search results
    if(resultsOnlyMode){
      await refreshAllTiles(currentAsOfMs);
      // Render results sidebar (pass both filtered and original counts)
      renderResults(displayResults, res.total||0, true, results.length); // Pass original count
    }
    // SHOW ALL MODE: Render results and apply dimming to non-matches
    else {
      renderResults(displayResults, res.total||0, false, results.length);
    }

    // Trigger filter panel updates (they need to re-compute based on new primary results)
    // PERFORMANCE: Update all panels first, THEN update highlighting once at the end
    for(const panel of filterPanels){
      if(panel.query){
        await updateFilterPanel(panel.id, true); // Pass skipHighlighting=true
      }
    }
    // Update highlighting once after all panels updated (instead of once per panel)
    // PERFORMANCE: Defer highlighting to next animation frame (non-blocking)
    if(filterPanels.length > 0){
      requestAnimationFrame(() => updateAllFilterHighlighting());
    }

    const perfEnd = performance.now();
    console.log('✅ [doSearch] END', {
      duration: `${(perfEnd - perfStart).toFixed(2)}ms`,
      resultCount: results.length,
      tilesNow: tiles.size
    });

    // Save search inputs to history
    saveCurrentInputsToHistory();

    // Start background preload of file content (non-blocking)
    if(results.length > 0){
      const filePaths = results.map(r => r.file_path);
      // Don't await - let it run in background
      startBackgroundPreload(filePaths).catch(e => {
        console.error('[preload] Error:', e);
      });
    }

    // Update timeline to show search-scoped or global timeline
    // (Will show only versions of matched files when search is active)
    refreshTimeline().catch(e => {
      console.warn('[doSearch] Timeline refresh failed:', e);
    });
  }

  function renderResults(results, total, skipDimming = false, originalCount = null){
    resultsEl.innerHTML = '';

    // Track if binaries were filtered
    const binaryFiltered = originalCount && originalCount > results.length;
    const hiddenCount = binaryFiltered ? originalCount - results.length : 0;

    // DEBUG: Log raw results BEFORE grouping
    // console.log('🔍 [renderResults] Raw results from API:', results.length);

    // Print full structure of first 5 results
    // console.log('🔍 [renderResults] First 5 results structure:');
    results.slice(0, 5).forEach((r, idx) => {
      console.log(`\n--- Result ${idx + 1} ---`);
      console.log('file_path:', r.file_path);
      console.log('score:', r.score);
      console.log('score_pct:', r.score_pct);
      console.log('deleted:', r.deleted);
      console.log('matches:', r.matches ? r.matches.length : 0);
      if(r.matches && r.matches.length > 0){
        console.log('matches detail:');
        r.matches.forEach((m, mIdx) => {
          console.log(`  Match ${mIdx + 1}:`, {
            line: m.line,
            highlight: m.highlight ? m.highlight.substring(0, 80) + '...' : null,
            context_before: m.context_before ? m.context_before.length : 0,
            context_after: m.context_after ? m.context_after.length : 0
          });
        });
      }
    });

    // Count duplicates (same file appearing multiple times)
    const filePathCounts = new Map();
    results.forEach(r => {
      filePathCounts.set(r.file_path, (filePathCounts.get(r.file_path) || 0) + 1);
    });
    // console.log('\n🔍 [renderResults] Files appearing multiple times in results array:',
    //   Array.from(filePathCounts.entries())
    //     .filter(([path, count]) => count > 1)
    //     .map(([path, count]) => `${path.substring(path.lastIndexOf('/') + 1)}: ${count} times`)
    // );

    // Check if ANY results have multiple matches within them
    const multiMatchFiles = results.filter(r => r.matches && r.matches.length > 1);
    // console.log('\n🔍 [renderResults] Files with multiple matches within one result:', multiMatchFiles.length);
    if(multiMatchFiles.length > 0){
      console.log('Examples:');
      multiMatchFiles.slice(0, 3).forEach(r => {
        console.log(`  - ${r.file_path.substring(r.file_path.lastIndexOf('/') + 1)}: ${r.matches.length} matches`);
      });
    }

    // GROUP RESULTS BY FILE: Combine multiple result sets from same file
    const groupedByFile = new Map();
    results.forEach(r => {
      if(!groupedByFile.has(r.file_path)){
        groupedByFile.set(r.file_path, []);
      }
      groupedByFile.get(r.file_path).push(r);
    });

    // Sort each file's results by score descending
    for(const [path, fileResults] of groupedByFile){
      fileResults.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    // Convert to array and sort by highest score in each file
    const groupedResults = Array.from(groupedByFile.entries()).map(([path, fileResults]) => {
      const highestScore = Math.max(...fileResults.map(r => r.score || 0));
      const highestScorePct = Math.max(...fileResults.map(r => r.score_pct || 0));

      // DEBUG: Log first 3 files' scores
      const fileName = path.substring(path.lastIndexOf('/') + 1);
      if(groupedByFile.size <= 5){
        console.log(`[Score Debug] ${fileName}:`, {
          raw_score: highestScore.toFixed(2),
          score_pct: highestScorePct.toFixed(1),
          result_sets: fileResults.length,
          all_scores: fileResults.map(r => r.score_pct || r.score)
        });
      }

      return {
        file_path: path,
        resultSets: fileResults,
        highestScore: highestScorePct || highestScore, // Use score_pct if available
        // Count total occurrences (using match_count if available)
        totalMatches: fileResults.reduce((sum, r) => {
          if(!r.matches) return sum;
          return sum + r.matches.reduce((mSum, m) => mSum + (m.match_count || 1), 0);
        }, 0),
        deleted: fileResults[0].deleted // Take from first result
      };
    });

    // Sort files by highest score
    groupedResults.sort((a, b) => b.highestScore - a.highestScore);

    // Add result count to header (always visible)
    resultsHeaderEl.innerHTML = ''; // Clear previous count
    if(groupedResults.length > 0){
      const countDiv = document.createElement('div');
      countDiv.className = 'results-count';
      const fileCount = groupedResults.length;
      const matchCount = groupedResults.reduce((sum, g) => sum + g.totalMatches, 0);
      const resultSetCount = results.length;
      const modeInfo = resultsOnlyMode ? ' ' : '';

      let countText;
      if(resultSetCount > fileCount){
        countText = `${matchCount} matches in ${fileCount} files (${resultSetCount} result sets)${modeInfo}`;
      } else {
        countText = `${matchCount} matches in ${fileCount} files${modeInfo}`;
      }

      // Add binary filter note if applicable
      if(hiddenCount > 0){
        countText += ` · ${hiddenCount} binary hidden`;
      }

      countDiv.textContent = countText;
      resultsHeaderEl.appendChild(countDiv);

      // Add chevron button to add filter panel
      const addFilterBtn = document.createElement('button');
      addFilterBtn.className = 'add-filter-btn';
      addFilterBtn.innerHTML = '›';
      addFilterBtn.title = 'Add filter panel';
      addFilterBtn.onclick = () => addFilterPanel();
      resultsHeaderEl.appendChild(addFilterBtn);
    }

    // In results-only mode, skip dimming logic (only matching files are rendered)
    if(skipDimming) {
      // Just render the results sidebar
    }
    // In show-all mode, apply dimming to non-matching tiles
    else {
      const matches = new Set(results.map(r => r.file_path));

      // Dim non-matching tiles - only update tiles that changed state
      // Track currently dimmed tiles to avoid unnecessary DOM operations
      if(!window._dimmedTiles) window._dimmedTiles = new Set();
      const currentlyDimmed = window._dimmedTiles;

      // Add 'dim' to non-matches (only if not already dimmed)
      for(const [p, tile] of tiles){
        if(!matches.has(p)){
          if(!currentlyDimmed.has(p)){
            tile.classList.add('dim');
            currentlyDimmed.add(p);
          }
        } else {
          if(currentlyDimmed.has(p)){
            tile.classList.remove('dim');
            currentlyDimmed.delete(p);
          }
        }
      }

      // Dim folders with no matching tiles - same optimization
      if(!window._dimmedFolders) window._dimmedFolders = new Set();
      const currentlyDimmedFolders = window._dimmedFolders;
      const folderMatch = new Map();
      for(const p of matches){
        const f = fileFolder.get(p) || '';
        folderMatch.set(f, true);
      }

      for(const [fp, el] of folders){
        const hasMatch = folderMatch.get(fp);
        if(!hasMatch){
          if(!currentlyDimmedFolders.has(fp)){
            el.classList.add('dim');
            currentlyDimmedFolders.add(fp);
          }
        } else {
          if(currentlyDimmedFolders.has(fp)){
            el.classList.remove('dim');
            currentlyDimmedFolders.delete(fp);
          }
        }
      }
    }
    // Results list: grouped by file, showing all matches per file
    groupedResults.forEach((fileGroup, idx)=>{
      const grp = document.createElement('div');
      grp.className = 'result-group';
      grp.setAttribute('data-file-path', fileGroup.file_path);

      // File header with score badge
      const fileHeader = document.createElement('div');
      fileHeader.className = 'result-file-header';

      const file = document.createElement('div');
      file.className = 'result-file';
      if(fileGroup.deleted) file.classList.add('deleted');

      // Check if binary file
      const isBinary = fileGroup.resultSets[0].is_binary;
      const binaryType = fileGroup.resultSets[0].binary_type;

      if(isBinary){
        file.classList.add('binary');
        // Show type badge + filename
        const badge = document.createElement('span');
        badge.className = 'binary-type-badge';
        badge.textContent = (binaryType || 'BIN').toUpperCase();
        file.appendChild(badge);

        const nameSpan = document.createElement('span');
        nameSpan.textContent = fileGroup.file_path;
        file.appendChild(nameSpan);
      } else {
        file.textContent = fileGroup.file_path;
      }

      // Click file header
      file.onclick = ()=> {
        // Clear previous active states
        document.querySelectorAll('.result-file-header.active, .result-match.active').forEach(el => el.classList.remove('active'));
        fileHeader.classList.add('active');

        if(isBinary){
          // Binary file: download or preview
          handleBinaryFileClick(fileGroup.resultSets[0]);
        } else {
          // Text file: normal behavior
          focusResult(fileGroup.resultSets[0]);
        }

        file.scrollIntoView({block:'nearest'});
        // Highlight this file in all filter panels
        highlightFileInAllPanels(fileGroup.file_path, null);
      };

      // Add deleted badge
      if(fileGroup.deleted){
        const deletedBadge = document.createElement('span');
        deletedBadge.className = 'deleted-badge';
        deletedBadge.textContent = 'DELETED';
        fileHeader.appendChild(file);
        fileHeader.appendChild(deletedBadge);
      }

      // Add score badge with additional info if multiple result sets
      const scoreBadge = document.createElement('span');
      scoreBadge.className = 'score-badge';
      if(fileGroup.resultSets.length > 1){
        scoreBadge.textContent = `${Math.round(fileGroup.highestScore)}% (${fileGroup.resultSets.length} sets)`;
        scoreBadge.title = `${fileGroup.totalMatches} total matches across ${fileGroup.resultSets.length} result sets`;
      } else {
        scoreBadge.textContent = `${Math.round(fileGroup.highestScore)}%`;
      }
      scoreBadge.setAttribute('data-score', Math.round(fileGroup.highestScore));
      fileHeader.appendChild(file);
      fileHeader.appendChild(scoreBadge);

      // Add version count badge if file has multiple versions
      const versionCount = fileGroup.resultSets[0].version_count || 1;
      console.log(`[Version Debug] ${fileGroup.file_path}: version_count =`, versionCount, 'from result:', fileGroup.resultSets[0]);

      if(versionCount > 1){
        const versionBadge = document.createElement('span');
        versionBadge.className = 'version-badge';
        versionBadge.textContent = `v${versionCount}`;
        versionBadge.title = `${versionCount} versions in history`;
        fileHeader.appendChild(versionBadge);
        console.log(`   ✅ Showing badge: v${versionCount}`);
      } else {
        console.log(`   ⚠️  Only 1 version, no badge shown`);
      }

      // Render ALL matches from ALL result sets
      const matchesContainer = document.createElement('div');
      matchesContainer.className = 'result-matches';

      // Check if there are any actual matches (with line numbers/content)
      let hasActualMatches = false;
      fileGroup.resultSets.forEach(resultSet => {
        const matches = resultSet.matches || [];
        if(matches.length > 0 && matches.some(m => m.line || m.highlight)){
          hasActualMatches = true;
        }
      });

      fileGroup.resultSets.forEach((resultSet, setIdx) => {
        const matches = resultSet.matches || [];

        matches.forEach((m, matchIdx)=>{
          const item = document.createElement('div');
          item.className = 'result-match';
          item.setAttribute('data-line', m.line || 0);

          // Build line number with match count if > 1
          let ln = '';
          if(m.line){
            ln = `<span class="line-num">:${m.line}</span>`;
            if(m.match_count && m.match_count > 1){
              ln += ` <span class="match-count">(${m.match_count}×)</span>`;
            }
          }
          const snippet = m.highlight || '';

          // ALWAYS show individual match score (subtle, at end of line)
          const matchScore = resultSet.score_pct || Math.round(resultSet.score || 0);

          // Use innerHTML to render <mark> tags for highlighting
          item.innerHTML = `${ln}  ${snippet.slice(0,120)} <span class="match-score-subtle">${matchScore}%</span>`;


          item.onclick = ()=> {
            // Clear previous active states
            document.querySelectorAll('.result-file-header.active, .result-match.active').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            focusLine(fileGroup.file_path, m.line, qEl.value);
            item.scrollIntoView({block:'nearest'});
          };
          matchesContainer.appendChild(item);
        });
      });

      grp.appendChild(fileHeader);

      // Only append matches container if there are actual matches
      // (Skip for filename-only matches with no content)
      if(hasActualMatches){
        grp.appendChild(matchesContainer);
      }

      resultsEl.appendChild(grp);

      // Auto-focus first result on initial render
      if(idx === 0) {
        fileHeader.classList.add('active');
        focusResult(fileGroup.resultSets[0]);
        grp.scrollIntoView({block:'nearest'});
      }
    });
  }

  function renderRecentUpdates(){
    resultsEl.innerHTML = '';

    if(recentUpdates.length === 0){
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'results-count';
      emptyDiv.textContent = 'No recent updates';
      emptyDiv.style.opacity = '0.6';
      resultsEl.appendChild(emptyDiv);
      return;
    }

    // Header
    const headerDiv = document.createElement('div');
    headerDiv.className = 'results-count';
    headerDiv.textContent = `${recentUpdates.length} recent updates`;
    resultsEl.appendChild(headerDiv);

    // Render each update
    recentUpdates.forEach((update, idx)=>{
      const grp = document.createElement('div');
      grp.className = 'result-group recent-update-item';

      const fileHeader = document.createElement('div');
      fileHeader.className = 'result-file-header';

      const file = document.createElement('div');
      file.className = 'result-file';
      file.textContent = update.path;
      file.onclick = ()=> {
        const tile = tiles.get(update.path);
        if(tile){
          openTile(update.path).then(async ()=>{
            centerOnTile(update.path);
            if(!tileContent.has(update.path)){
              await loadTileContent(update.path);
            }
            flashTile(update.path, 'focus');
          });
        }
        file.scrollIntoView({block:'nearest'});
      };

      // Action and timestamp badge
      const badge = document.createElement('span');
      badge.className = 'update-badge';
      badge.textContent = update.action;
      badge.setAttribute('data-action', update.action);

      fileHeader.appendChild(file);
      fileHeader.appendChild(badge);

      // Timestamp
      const timestampDiv = document.createElement('div');
      timestampDiv.className = 'update-timestamp';
      const timeAgo = getTimeAgo(update.timestamp);
      timestampDiv.textContent = timeAgo;

      grp.appendChild(fileHeader);
      grp.appendChild(timestampDiv);
      resultsEl.appendChild(grp);
    });
  }

  // ============================================================================
  // MULTI-PANEL FILTER SYSTEM (New Implementation)
  // ============================================================================

  // Highlight and scroll to a file in all panels (main + all filters)
  function highlightFileInAllPanels(filePath, currentPanelId = null){
    console.log(`🎯 [highlightFileInAllPanels] Highlighting: ${filePath} (skip panel: ${currentPanelId})`);

    // 1. Highlight in main results
    const mainResults = resultsEl.querySelectorAll('.result-group');
    mainResults.forEach(grp => {
      const grpPath = grp.getAttribute('data-file-path');
      const fileHeader = grp.querySelector('.result-file-header');
      if(grpPath === filePath && fileHeader){
        // Clear other highlights in main results
        resultsEl.querySelectorAll('.result-file-header.cross-highlight').forEach(el => {
          el.classList.remove('cross-highlight');
        });
        // Add highlight
        fileHeader.classList.add('cross-highlight');
        // Scroll into view
        fileHeader.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        console.log('  ✓ Highlighted in main results');
      }
    });

    // 2. Highlight in all filter panels (except the one clicked)
    filterPanels.forEach(panel => {
      if(panel.id === currentPanelId) return; // Skip the panel that was clicked

      const resultsContent = panel.element.querySelector('.filter-results-content');
      if(!resultsContent) return;

      const resultGroups = resultsContent.querySelectorAll('.result-group');
      resultGroups.forEach(grp => {
        const grpPath = grp.getAttribute('data-file-path');
        const fileHeader = grp.querySelector('.result-file-header');
        if(grpPath === filePath && fileHeader){
          // Clear other highlights in this panel
          resultsContent.querySelectorAll('.result-file-header.cross-highlight').forEach(el => {
            el.classList.remove('cross-highlight');
          });
          // Add highlight
          fileHeader.classList.add('cross-highlight');
          // Scroll into view within the panel
          fileHeader.scrollIntoView({block: 'nearest', behavior: 'smooth'});
          console.log(`  ✓ Highlighted in filter panel ${panel.id}`);
        }
      });
    });
  }

  // Create and add a new filter panel
  function addFilterPanel(){
    if(filterPanels.length >= MAX_FILTER_PANELS){
      showToast(`Maximum ${MAX_FILTER_PANELS} filter panels reached`);
      return;
    }

    // Ensure we have primary results to filter
    if(!lastSearchResults || lastSearchResults.length === 0){
      showToast('Perform a primary search first');
      return;
    }

    const panelId = nextFilterId++;
    const panelNumber = filterPanels.length + 1;

    // Create panel DOM element
    const panel = document.createElement('div');
    panel.className = 'filter-panel animating-in';
    panel.setAttribute('data-panel-id', panelId);

    // Compact header with input + toggles + close all in one row
    const header = document.createElement('div');
    header.className = 'filter-panel-header';
    header.innerHTML = `
      <input type="text" class="filter-panel-input" placeholder="Refine further..." />
      <button class="filter-option-btn" data-option="fuzzy" title="Fuzzy search">~</button>
      <button class="filter-option-btn" data-option="partial" title="Partial match">*</button>
      <button class="filter-panel-close" title="Remove filter">×</button>
    `;

    // Results container with header, spinner, and content
    const resultsDiv = document.createElement('div');
    resultsDiv.className = 'filter-panel-results';
    resultsDiv.innerHTML = `
      <div class="filter-results-header"></div>
      <div class="search-spinner filter-spinner" style="display:none;">
        <div class="spinner-ring"></div>
        <div class="spinner-text">Searching...</div>
      </div>
      <div class="filter-results-content">
        <div style="color: #888; font-size: 11px; padding: 8px;">
          Enter a query to refine results further
        </div>
      </div>
    `;

    // Assemble panel
    panel.appendChild(header);
    panel.appendChild(resultsDiv);

    // Add panel state
    const panelState = {
      id: panelId,
      element: panel,
      query: '',
      results: [], // Cumulative intersection results (for display)
      rawResults: [], // Raw search results (for computing next panel's intersection)
      fuzzyMode: false,
      partialMode: false
    };
    filterPanels.push(panelState);

    // Add to DOM
    const container = document.getElementById('filterPanelsContainer');
    container.appendChild(panel);

    // Hide previous panel's nub (if any) since this panel is now the last one
    // Note: filterPanels.length is now >= 1 since we just pushed
    // Animate in
    requestAnimationFrame(() => {
      panel.classList.remove('animating-in');
    });

    // Event handlers
    const closeBtn = panel.querySelector('.filter-panel-close');
    const input = panel.querySelector('.filter-panel-input');
    const fuzzyBtn = panel.querySelector('[data-option="fuzzy"]');
    const partialBtn = panel.querySelector('[data-option="partial"]');

    closeBtn.onclick = () => removeFilterPanel(panelId);
    input.addEventListener('input', debounce(() => updateFilterPanel(panelId), 300));
    input.addEventListener('keydown', (e) => {
      if(e.key === 'Enter') updateFilterPanel(panelId);
    });
    fuzzyBtn.onclick = () => toggleFilterOption(panelId, 'fuzzy');
    partialBtn.onclick = () => toggleFilterOption(panelId, 'partial');
    nub.onclick = () => addFilterPanel();

    // Update workspace positioning
    updateWorkspacePosition();

    showToast(`Filter ${panelNumber} added`);
  }

  // Remove a filter panel
  function removeFilterPanel(panelId){
    const index = filterPanels.findIndex(p => p.id === panelId);
    if(index === -1) return;

    const panel = filterPanels[index];
    panel.element.remove();
    filterPanels.splice(index, 1);

    // Re-compute filtering with remaining panels
    updateAllFilterHighlighting();
    updateWorkspacePosition();

    showToast('Filter panel removed');
  }

  // Update a specific filter panel's search
  async function updateFilterPanel(panelId, skipHighlighting = false){
    const panel = filterPanels.find(p => p.id === panelId);
    if(!panel) return;

    const input = panel.element.querySelector('.filter-panel-input');
    const query = input.value.trim();
    panel.query = query;

    // Get spinner element
    const spinner = panel.element.querySelector('.filter-spinner');
    const resultsContent = panel.element.querySelector('.filter-results-content');

    if(!query){
      panel.results = [];
      if(spinner) spinner.style.display = 'none';
      renderFilterPanelResults(panel);
      if(!skipHighlighting) updateAllFilterHighlighting();
      return;
    }

    // Show spinner
    if(spinner) spinner.style.display = 'flex';
    if(resultsContent) resultsContent.style.display = 'none';

    // NEW APPROACH: Compute allowed file paths BEFORE searching
    // Each filter searches ONLY within files from the previous stage
    const panelIndex = filterPanels.findIndex(p => p.id === panelId);

    // Get file paths from previous stage
    let allowedFilePaths;
    if(panelIndex === 0){
      // First filter: search within primary results (with language filter if active)
      let baseResults = lastSearchResults;
      if(currentLanguageFilter){
        baseResults = lastSearchResults.filter(r => r.language === currentLanguageFilter);
        console.log(`  🎨 Language filter active: ${currentLanguageFilter} (${baseResults.length}/${lastSearchResults.length} files)`);
      }
      allowedFilePaths = baseResults.map(r => r.file_path);
    } else {
      // Subsequent filters: search within previous filter's results
      const prevPanel = filterPanels[panelIndex - 1];
      allowedFilePaths = prevPanel.results.map(r => r.file_path);
    }

    console.log(`🔍 [Filter ${panelIndex + 1}] Searching within ${allowedFilePaths.length} files from previous stage`);

    // SHORT CIRCUIT: If previous stage has zero files, we must also have zero
    if(allowedFilePaths.length === 0){
      console.log(`  ⚠️  Previous stage has 0 files, short-circuiting to 0 results`);
      panel.results = [];
      panel.rawResults = [];
      if(spinner) spinner.style.display = 'none';
      if(resultsContent) resultsContent.style.display = 'block';
      renderFilterPanelResults(panel);
      if(!skipHighlighting) updateAllFilterHighlighting();
      return;
    }

    // Search via API with file_paths filter
    const body = {
      query: query,
      filters: {
        file_paths: allowedFilePaths,  // NEW: Restrict to files from previous stage
        ...(currentAsOfMs ? { as_of_ms: currentAsOfMs } : {})
      },
      options: {
        limit: 300,
        context_lines: 2,
        highlight: true,
        fuzziness: panel.fuzzyMode ? 'AUTO' : undefined,
        partial: panel.partialMode,
        show_deleted: deletedMode
      }
    };

    try {
      const res = await fetchJSON('/search/simple', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
      });

      // Results are already filtered by ES - no client-side intersection needed!
      const results = res.results || [];

      console.log(`✅ [Filter ${panelIndex + 1}] Found ${results.length} files matching "${query}"`);

      // Store results
      panel.results = results;

      // Hide spinner and show results
      if(spinner) spinner.style.display = 'none';
      if(resultsContent) resultsContent.style.display = 'block';

      renderFilterPanelResults(panel);

      // Update all subsequent panels (they need to re-search with new file paths)
      // Since we changed this panel's results, all subsequent panels' allowed paths have changed
      for(let i = panelIndex + 1; i < filterPanels.length; i++){
        const nextPanel = filterPanels[i];
        if(nextPanel.query){
          // Re-run the search for this panel with updated file paths from previous panel
          await updateFilterPanel(nextPanel.id, true); // Pass skipHighlighting=true
        }
      }

      // Only update highlighting if not skipped (to avoid multiple calls)
      if(!skipHighlighting) updateAllFilterHighlighting();
    } catch(e){
      console.error('Filter search error:', e);
      // Hide spinner on error
      if(spinner) spinner.style.display = 'none';
      if(resultsContent) resultsContent.style.display = 'block';
      showToast('Search failed');
    }
  }

  // Toggle filter option (fuzzy/partial)
  async function toggleFilterOption(panelId, option){
    const panel = filterPanels.find(p => p.id === panelId);
    if(!panel) return;

    if(option === 'fuzzy'){
      panel.fuzzyMode = !panel.fuzzyMode;
      const btn = panel.element.querySelector('[data-option="fuzzy"]');
      btn.classList.toggle('active', panel.fuzzyMode);
    } else if(option === 'partial'){
      panel.partialMode = !panel.partialMode;
      const btn = panel.element.querySelector('[data-option="partial"]');
      btn.classList.toggle('active', panel.partialMode);
    }

    // Re-run search if query exists
    if(panel.query){
      await updateFilterPanel(panelId);
    }
  }

  // Render results in a filter panel (same format as primary results)
  function renderFilterPanelResults(panel){
    // Get header and content wrappers
    let resultsHeader = panel.element.querySelector('.filter-results-header');
    let resultsContent = panel.element.querySelector('.filter-results-content');

    if(!resultsContent){
      // Fallback: create wrapper if it doesn't exist
      const resultsDiv = panel.element.querySelector('.filter-panel-results');
      resultsContent = document.createElement('div');
      resultsContent.className = 'filter-results-content';
      resultsDiv.appendChild(resultsContent);
    }

    resultsContent.innerHTML = '';
    resultsHeader.innerHTML = ''; // Clear header
    const results = panel.results;

    if(results.length === 0 && !panel.query){
      resultsContent.innerHTML = `
        <div style="color: #888; font-size: 11px; padding: 8px;">
          Enter a query to refine results further
        </div>
      `;
      return;
    }

    if(results.length === 0){
      resultsContent.innerHTML = `
        <div style="color: #888; font-size: 11px; padding: 8px;">
          No matches in cumulative intersection
        </div>
      `;
      return;
    }

    // Count display in header (always visible)
    const countDiv = document.createElement('div');
    countDiv.className = 'results-count';
    const fileCount = results.length;
    const matchCount = results.reduce((sum, r) => sum + (r.matches ? r.matches.length : 0), 0);
    countDiv.textContent = `${matchCount} matches in ${fileCount} files`;
    resultsHeader.appendChild(countDiv);

    // Add chevron button to add another filter panel
    const addFilterBtn = document.createElement('button');
    addFilterBtn.className = 'add-filter-btn';
    addFilterBtn.innerHTML = '›';
    addFilterBtn.title = 'Add another filter panel';
    addFilterBtn.onclick = () => addFilterPanel();
    resultsHeader.appendChild(addFilterBtn);

    // Results list: per-file group with per-match lines (same as primary)
    results.forEach((r, idx) => {
      const grp = document.createElement('div');
      grp.className = 'result-group';

      // File header with score badge
      const fileHeader = document.createElement('div');
      fileHeader.className = 'result-file-header';

      const file = document.createElement('div');
      file.className = 'result-file';
      if(r.deleted) file.classList.add('deleted');
      file.textContent = r.file_path;
      file.onclick = () => {
        document.querySelectorAll('.result-file-header.active, .result-match.active').forEach(el => el.classList.remove('active'));
        fileHeader.classList.add('active');
        focusResult(r);
        file.scrollIntoView({block:'nearest'});
        // Highlight this file in all other panels (main results + earlier filters)
        highlightFileInAllPanels(r.file_path, panel.id);
      };

      // Add deleted badge
      if(r.deleted){
        const deletedBadge = document.createElement('span');
        deletedBadge.className = 'deleted-badge';
        deletedBadge.textContent = 'DELETED';
        fileHeader.appendChild(file);
        fileHeader.appendChild(deletedBadge);
      }

      // Add score badge
      if(r.score_pct !== undefined){
        const scoreBadge = document.createElement('span');
        scoreBadge.className = 'score-badge';
        scoreBadge.textContent = `${r.score_pct}%`;
        scoreBadge.setAttribute('data-score', r.score_pct);
        fileHeader.appendChild(file);
        fileHeader.appendChild(scoreBadge);
      } else {
        fileHeader.appendChild(file);
      }

      // Add version count badge if file has multiple versions
      const versionCount = r.version_count || 1;
      if(versionCount > 1){
        const versionBadge = document.createElement('span');
        versionBadge.className = 'version-badge';
        versionBadge.textContent = `v${versionCount}`;
        versionBadge.title = `${versionCount} versions in history`;
        fileHeader.appendChild(versionBadge);
      }

      // Matches (line numbers + snippets)
      const ol = document.createElement('div');
      ol.className = 'result-matches';
      (r.matches||[]).forEach((m) => {
        const item = document.createElement('div');
        item.className = 'result-match';
        const ln = m.line ? `<span class="line-num">:${m.line}</span>` : '';
        const snippet = m.highlight || '';
        // Use innerHTML to render <mark> tags for highlighting
        item.innerHTML = `${ln}  ${snippet.slice(0,120)}`;
        item.onclick = () => {
          document.querySelectorAll('.result-file-header.active, .result-match.active').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          focusLine(r.file_path, m.line, panel.query);
          item.scrollIntoView({block:'nearest'});
          // Highlight this file in all other panels
          highlightFileInAllPanels(r.file_path, panel.id);
        };
        ol.appendChild(item);
      });

      // Add data attribute for cross-panel highlighting
      grp.setAttribute('data-file-path', r.file_path);

      grp.appendChild(fileHeader);
      grp.appendChild(ol);
      resultsContent.appendChild(grp);

      // DON'T auto-focus in filter panels - causes performance issues
      // Only focus when user explicitly clicks
      // if(idx === 0) { focusResult(r); grp.scrollIntoView({block:'nearest'}); }
    });
  }

  // Compute cumulative intersection: ALL filters must match
  function computeCumulativeIntersection(){
    if(filterPanels.length === 0) return new Set();

    // Start with primary results
    let intersectionPaths = new Set(lastSearchResults.map(r => r.file_path));

    // Intersect with each filter panel
    for(const panel of filterPanels){
      if(panel.query && panel.results.length > 0){
        const panelPaths = new Set(panel.results.map(r => r.file_path));
        // Keep only paths in both sets
        intersectionPaths = new Set([...intersectionPaths].filter(p => panelPaths.has(p)));
      }
    }

    return intersectionPaths;
  }

  // Update all tile highlighting based on active filters
  function updateAllFilterHighlighting(){
    const perfStart = performance.now();
    console.log('✨ [updateAllFilterHighlighting] START', {
      tiles: tiles.size,
      filterPanels: filterPanels.length
    });

    // If no active filters, just clear highlighting and return
    const activeFilters = filterPanels.filter(p => p.query && p.results.length > 0);
    const matchCount = activeFilters.length + 1; // +1 for primary
    const glowLevel = Math.min(matchCount, 5);

    if(activeFilters.length === 0){
      // Clear all highlighting in single pass
      for(const [, tile] of tiles){
        // Only remove if actually has highlighting (avoid unnecessary DOM ops)
        if(tile.className.includes('filter-match')){
          for(let i = 1; i <= 5; i++){
            tile.classList.remove(`filter-match-${i}`);
          }
          const oldBadge = tile.querySelector('.filter-match-badge');
          if(oldBadge) oldBadge.remove();
        }
      }
      return;
    }

    // Compute intersection
    const matchingPaths = computeCumulativeIntersection();

    // SINGLE PASS: Update highlighting efficiently
    for(const [path, tile] of tiles){
      const shouldHighlight = matchingPaths.has(path);
      const hasHighlighting = tile.className.includes('filter-match');

      if(shouldHighlight && !hasHighlighting){
        // Add highlighting (tile wasn't highlighted before)
        tile.classList.add(`filter-match-${glowLevel}`);
        const badge = document.createElement('div');
        badge.className = 'filter-match-badge';
        badge.textContent = `×${matchCount}`;
        tile.appendChild(badge);
      } else if(shouldHighlight && hasHighlighting){
        // Update existing highlighting (level might have changed)
        // Remove old level, add new level
        for(let i = 1; i <= 5; i++){
          if(i !== glowLevel) tile.classList.remove(`filter-match-${i}`);
        }
        tile.classList.add(`filter-match-${glowLevel}`);
        // Update badge text
        const badge = tile.querySelector('.filter-match-badge');
        if(badge) badge.textContent = `×${matchCount}`;
      } else if(!shouldHighlight && hasHighlighting){
        // Remove highlighting (tile was highlighted but isn't anymore)
        for(let i = 1; i <= 5; i++){
          tile.classList.remove(`filter-match-${i}`);
        }
        const oldBadge = tile.querySelector('.filter-match-badge');
        if(oldBadge) oldBadge.remove();
      }
      // else: !shouldHighlight && !hasHighlighting - no action needed
    }

    const perfEnd = performance.now();
    console.log('✅ [updateAllFilterHighlighting] END', {
      duration: `${(perfEnd - perfStart).toFixed(2)}ms`,
      activeFilters: activeFilters.length
    });
  }

  // Update workspace left position based on number of panels
  function updateWorkspacePosition(){
    // Workspace now stays at left: 0 (renders under sidebar and panels)
    // No need to update its position

    // const workspace = document.getElementById('workspace');
    // const sidebar = document.getElementById('sidebar');
    // const panelCount = filterPanels.length;
    // const baseLeft = sidebar ? parseInt(sidebar.style.width || '345') : 345; // Current sidebar width
    // const panelWidth = 300;
    // const totalLeft = baseLeft + (panelCount * panelWidth) + 10;
    // workspace.style.left = `${totalLeft}px`;
  }

  // ============================================================================
  // END OF MULTI-PANEL FILTER SYSTEM
  // ============================================================================

  function getTimeAgo(timestamp){
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if(days > 0) return `${days}d ago`;
    if(hours > 0) return `${hours}h ago`;
    if(minutes > 0) return `${minutes}m ago`;
    return 'just now';
  }

  function defineMonacoTheme(){
    console.log(' [defineMonacoTheme] Defining Monaco themes');
    // Define custom theme matching canvas background and Prism.js colors (Tomorrow Night)
    if(typeof monaco === 'undefined') return;

    monaco.editor.defineTheme('rewindex-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        // Tomorrow Night syntax colors to match Prism.js
        { token: 'comment', foreground: '969896', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'b294bb' },
        { token: 'string', foreground: 'b5bd68' },
        { token: 'number', foreground: 'de935f' },
        { token: 'regexp', foreground: 'de935f' },
        { token: 'type', foreground: 'f0c674' },
        { token: 'class', foreground: 'f0c674' },
        { token: 'function', foreground: '81a2be' },
        { token: 'variable', foreground: 'cc6666' },
        { token: 'constant', foreground: 'de935f' },
        { token: 'operator', foreground: '8abeb7' },
      ],
      colors: {
        'editor.background': '#090c0f98',  // Match canvas background
        'editor.foreground': '#c5c8c697',  // Tomorrow Night foreground
        'editor.lineHighlightBackground': '#1d1f21',
        'editor.selectionBackground': '#373b41',
        'editorCursor.foreground': '#c5c8c6',
        'editorWhitespace.foreground': '#404040',
        'minimap.background': '#090c0f00',  // Transparent to match editor
        'minimapSlider.background': '#ffffff20',
        'minimapSlider.hoverBackground': '#ffffff30',
        'minimapSlider.activeBackground': '#ffffff40',
      }
    });

    // Define Omarchy theme if available
    if(currentOmarchyTheme){
      console.log(' [defineMonacoTheme] Defining Omarchy theme', currentOmarchyTheme);
      const syntaxColors = currentOmarchyTheme.syntax;
      const uiColors = currentOmarchyTheme.ui;

      const bg = toMonacoColor(uiColors['--bg'] || '#0a142877');
      const bgt = toMonacoColor(uiColors['--bg'] + '90' || '#0a1428');
      const fg = toMonacoColor(uiColors['--text'] || '#f0f8ff');
      const accent = toMonacoColor(uiColors['--accent'] || '#39bae6');
      const border = toMonacoColor(uiColors['--border'] || '#44475a');

      monaco.editor.defineTheme('omarchy', {
        base: 'vs-dark',
        inherit: false,
        rules: [
          // Comments
          { token: 'comment', foreground: toMonacoColor(syntaxColors.comment) },
          { token: 'comment.line', foreground: toMonacoColor(syntaxColors.comment) },
          { token: 'comment.block', foreground: toMonacoColor(syntaxColors.comment) },

          // Keywords
          { token: 'keyword', foreground: toMonacoColor(syntaxColors.keyword), fontStyle: 'bold' },
          { token: 'keyword.control', foreground: toMonacoColor(syntaxColors.keyword), fontStyle: 'bold' },

          // Strings
          { token: 'string', foreground: toMonacoColor(syntaxColors.string) },
          { token: 'string.quoted', foreground: toMonacoColor(syntaxColors.string) },

          // Numbers
          { token: 'number', foreground: toMonacoColor(syntaxColors.number) },
          { token: 'number.hex', foreground: toMonacoColor(syntaxColors.number) },
          { token: 'number.float', foreground: toMonacoColor(syntaxColors.number) },
          { token: 'constant.numeric', foreground: toMonacoColor(syntaxColors.number) },

          // Functions
          { token: 'entity.name.function', foreground: toMonacoColor(syntaxColors.function) },
          { token: 'support.function', foreground: toMonacoColor(syntaxColors.function) },

          // Classes/Types
          { token: 'entity.name.class', foreground: toMonacoColor(syntaxColors.class) },
          { token: 'entity.name.type', foreground: toMonacoColor(syntaxColors.class) },
          { token: 'support.class', foreground: toMonacoColor(syntaxColors.class) },
          { token: 'support.type', foreground: toMonacoColor(syntaxColors.class) },

          // Variables
          { token: 'variable', foreground: toMonacoColor(syntaxColors.variable) },
          { token: 'variable.parameter', foreground: toMonacoColor(syntaxColors.variable) },

          // Constants
          { token: 'constant', foreground: toMonacoColor(syntaxColors.constant) },
          { token: 'constant.language', foreground: toMonacoColor(syntaxColors.constant) },

          // Operators
          { token: 'keyword.operator', foreground: toMonacoColor(syntaxColors.operator) },

          // Punctuation
          { token: 'punctuation', foreground: toMonacoColor(syntaxColors.punctuation) },
          { token: 'delimiter', foreground: toMonacoColor(syntaxColors.punctuation) },
        ],
        colors: {
          'editor.background': '#' + bg + '55',
          'editor.foreground': '#' + fg,
          'editor.lineHighlightBackground': '#' + bg + '40',
          'editor.selectionBackground': '#' + accent + '40',
          'editor.inactiveSelectionBackground': '#' + accent + '20',
          'editorCursor.foreground': '#' + accent,
          'editorLineNumber.foreground': '#' + toMonacoColor(syntaxColors.comment),
          'editorLineNumber.activeForeground': '#' + accent,
          'editorIndentGuide.background': '#' + border + '40',
          'editorIndentGuide.activeBackground': '#' + border,
          'minimap.background': '#' + bg + '00',  // Transparent to match editor
          'minimapSlider.background': '#' + accent + '30',
          'minimapSlider.hoverBackground': '#' + accent + '40',
          'minimapSlider.activeBackground': '#' + accent + '50',
        }
      });

      console.log(' [defineMonacoTheme] Omarchy theme defined successfully');
    } else {
      console.log(' [defineMonacoTheme] No Omarchy theme data available yet');
    }
  }

  async function loadFileHistory(path){
    try{
      console.log(`📜 [loadFileHistory] Fetching history for: ${path}`);
      const history = await fetchJSON('/file/history?path=' + encodeURIComponent(path));
      const versions = history.versions || [];
      console.log(`📜 [loadFileHistory] Received ${versions.length} versions`);
      if(versions.length === 0){
        console.warn(`📜 [loadFileHistory] No versions found for path: ${path}`);
        console.warn(`   Make sure this is the exact path stored in ES (not relative)`);
      }
      return versions;
    }catch(e){
      console.error('Failed to load file history:', e);
      return [];
    }
  }

  function renderVersionHistorySidebar(versions, currentPath, currentHash, options = {}){
    const {
      sidebarEl = versionHistorySidebar,
      contentEl = versionHistoryContent,
      isDiffMode = false
    } = options;

    if(!sidebarEl || !contentEl) return;

    if(!versions || versions.length === 0){
      console.warn(`📜 [versionSidebar] No versions to render for ${currentPath}`);
      sidebarEl.style.display = 'none';
      return;
    }

    console.log(`📜 [versionSidebar] Input: ${versions.length} versions for ${currentPath}`);
    console.log(`📜 [versionSidebar] Current hash: ${currentHash}`);

    // Show sidebar
    sidebarEl.style.display = 'flex';
    contentEl.innerHTML = '';

    // Sort versions newest to oldest
    const sorted = [...versions].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    console.log(`📜 [versionSidebar] After sorting: ${sorted.length} versions (rendering all)`);

    sorted.forEach((version, idx) => {
      // Debug first few versions
      if(idx < 3){
        console.log(`  Version ${idx+1}:`, {
          hash: version.content_hash?.substring(0, 8),
          created_at: new Date(version.created_at).toLocaleString(),
          is_current: version.content_hash === currentHash,
          has_content: !!version.content,
          content_length: version.content?.length
        });
      }

      const miniTile = document.createElement('div');
      miniTile.className = 'version-mini-tile';
      miniTile.setAttribute('data-hash', version.content_hash);

      // Mark current version
      if(version.content_hash === currentHash){
        miniTile.classList.add('current');
      }

      // Header with timestamp and hash
      const header = document.createElement('div');
      header.className = 'version-mini-header';

      const timeSpan = document.createElement('span');
      timeSpan.className = 'version-mini-time';
      const date = new Date(version.created_at);
      const now = new Date();
      const diffMs = now - date;
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHours / 24);

      if(diffDays > 0){
        timeSpan.textContent = `${diffDays}d ago`;
      } else if(diffHours > 0){
        timeSpan.textContent = `${diffHours}h ago`;
      } else {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        timeSpan.textContent = diffMins > 0 ? `${diffMins}m ago` : 'now';
      }

      const hashSpan = document.createElement('span');
      hashSpan.className = 'version-mini-hash';
      hashSpan.textContent = version.content_hash.substring(0, 6);

      header.appendChild(timeSpan);
      header.appendChild(hashSpan);

      // Code preview (first 15 lines, syntax highlighted)
      const codeDiv = document.createElement('div');
      codeDiv.className = 'version-mini-code';

      const content = version.content || '';
      const lines = content.split('\n').slice(0, 15); // First 15 lines
      const preview = lines.join('\n');

      // Use Prism for syntax highlighting
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = `language-${languageToPrism(version.language)}`;
      code.textContent = preview;
      pre.appendChild(code);
      codeDiv.appendChild(pre);

      // Highlight with Prism
      if(typeof Prism !== 'undefined'){
        Prism.highlightElement(code);
      }

      // Click to open diff with this version
      miniTile.onclick = () => {
        console.log(`📜 [versionSidebar] Clicked version ${version.content_hash.substring(0, 8)} (${timeSpan.textContent})`);
        if(isDiffMode){
          // Already in diff mode - just update the diff to this version
          openDiffEditor(currentPath, version.content_hash);
        } else {
          // In edit mode - switch to diff mode
          closeOverlayEditor();
          openDiffEditor(currentPath, version.content_hash);
        }
      };

      miniTile.appendChild(header);
      miniTile.appendChild(codeDiv);
      contentEl.appendChild(miniTile);
    });

    console.log(`✅ [versionSidebar] Rendered ${sorted.length} version previews`);
  }

  function renderFileTimeline(versions, currentPath, options = {}){
    const {
      timelineEl = fileTimelineEl,
      markersEl = fileTimelineMarkersEl,
      selectedHash = null,  // Which version is currently selected
      isDiffMode = false,   // Whether we're in diff mode
    } = options;

    if(!markersEl) return;

    // Clear existing markers
    markersEl.innerHTML = '';

    if(!versions || versions.length === 0){
      if(timelineEl) timelineEl.style.display = 'none';
      return;
    }

    // Always show timeline (in both live and diff modes)
    if(timelineEl) timelineEl.style.display = 'flex';

    console.log('🔍 [fileTimeline] Version data sample:', versions[0]);
    console.log(`   Selected hash: ${selectedHash}, isDiffMode: ${isDiffMode}`);

    // Sort versions by created_at timestamp (oldest to newest)
    const sorted = versions.slice().sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    const oldest = sorted[0].created_at || 0;
    const newest = sorted[sorted.length - 1].created_at || 0;
    const range = newest - oldest || 1;

    // Render markers
    sorted.forEach((version, index) => {
      const marker = document.createElement('div');
      marker.className = 'file-timeline-marker';

      // Mark current version (latest) OR selected version in diff mode
      const isLatest = index === sorted.length - 1;
      const isSelected = selectedHash && version.content_hash === selectedHash;

      if(isSelected){
        marker.classList.add('current');
        marker.classList.add('selected');
      } else if(isLatest && !isDiffMode){
        marker.classList.add('current');
      }

      // Position on timeline
      const position = ((version.created_at - oldest) / range) * 100;
      marker.style.left = `${position}%`;

      // Tooltip
      const tooltip = document.createElement('div');
      tooltip.className = 'file-timeline-tooltip';
      const date = new Date(version.created_at);
      tooltip.textContent = date.toLocaleString() + (isSelected ? ' (selected)' : '');
      marker.appendChild(tooltip);

      // Click handler
      marker.onclick = async (e) => {
        e.stopPropagation();
        console.log(`📅 [fileTimeline] Clicked version:`, version);

        if(!isDiffMode){
          // Close overlay editor and switch to diff mode
          closeOverlayEditor();
        }

        // Open/update diff mode with this version
        await openDiffEditor(currentPath, version.content_hash);
      };

      markersEl.appendChild(marker);
    });

    console.log(`🕐 [fileTimeline] Rendered ${sorted.length} versions for ${currentPath}`);
  }

  async function openOverlayEditor(path){
    console.log(`📝 [openOverlayEditor] Opening file: ${path}`);
    overlayEditorPath = path;
    overlayFilePathEl.textContent = path;

    // Fetch file content
    try{
      const data = await fetchJSON('/file?path=' + encodeURIComponent(path));
      console.log(`📝 [openOverlayEditor] Got file data, content_hash: ${data.content_hash?.substring(0, 8)}`);

      // Clear container
      overlayEditorContainer.innerHTML = '';

      // Create Monaco editor in overlay
      if(typeof require === 'undefined'){
        showToast('Monaco editor not available');
        return;
      }

      require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
      require(['vs/editor/editor.main'], function(){
        if(overlayEditor){
          try{ overlayEditor.dispose(); }catch(e){}
        }

        // Define custom theme
        defineMonacoTheme();

        // Calculate line count and dynamic font size
        const content = data.content || '';
        const lineCount = content.split('\n').length;
        const fontSize = calculateDynamicFontSize(lineCount);

        const editorOptions = {
          value: content,
          language: normalizeLanguageForMonaco(data.language),
          readOnly: false,  // Editable!
          minimap: { enabled: true },
          theme: systemThemeEnabled && systemThemeAvailable ? 'omarchy' : 'rewindex-dark',
          fontSize: fontSize,
          automaticLayout: true,
        };

        // Apply system font if available
        if(systemThemeEnabled && systemThemeAvailable){
          const monoFont = document.documentElement.style.getPropertyValue('--font-mono');
          if(monoFont){
            editorOptions.fontFamily = monoFont;
          }
        }

        overlayEditor = monaco.editor.create(overlayEditorContainer, editorOptions);
      });

      // Show overlay
      overlayEditorEl.style.display = 'flex';

      // Load and render file history (timeline + sidebar)
      if(!currentAsOfMs){
        const versions = await loadFileHistory(path);
        renderFileTimeline(versions, path);

        // Render version history sidebar with mini previews
        const liveData = await fetchJSON('/file?path=' + encodeURIComponent(path));
        const currentHash = liveData.content_hash;
        renderVersionHistorySidebar(versions, path, currentHash, {
          sidebarEl: versionHistorySidebar,
          contentEl: versionHistoryContent,
          isDiffMode: false
        });
      } else {
        // Hide timeline when time-traveling globally
        fileTimelineEl.style.display = 'none';
        versionHistorySidebar.style.display = 'none';
      }
    }catch(e){
      showToast('Failed to load file for editing');
      console.error('Overlay editor error:', e);
    }
  }

  function closeOverlayEditor(){
    if(overlayEditor){
      try{ overlayEditor.dispose(); }catch(e){}
      overlayEditor = null;
    }
    overlayEditorPath = null;
    overlayEditorEl.style.display = 'none';
    // Hide file timeline
    if(fileTimelineEl){
      fileTimelineEl.style.display = 'none';
    }
  }

  async function saveOverlayEditor(){
    if(!overlayEditor || !overlayEditorPath){
      showToast('No file to save');
      return;
    }

    const model = overlayEditor.getModel();
    if(!model){
      showToast('No content to save');
      return;
    }

    const content = model.getValue();

    try{
      // Save file via backend API
      const res = await fetchJSON('/file/save', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          path: overlayEditorPath,
          content: content
        })
      });

      showToast(`Saved: ${overlayEditorPath}`);
      closeOverlayEditor();

      // Invalidate cache to ensure fresh content on next load
      preloadCache.delete(overlayEditorPath);
      tileContent.delete(overlayEditorPath);

      // Refresh tile content (will fetch fresh from server now)
      await refreshTileContent(overlayEditorPath);
    }catch(e){
      showToast(`Failed to save: ${e.message || e}`);
      console.error('Save failed:', e);
    }
  }

  async function openDiffEditor(path, contentHash = null){
    diffEditorPath = path;
    diffFilePathEl.textContent = path;
    diffSelectedHash = contentHash;  // Store selected hash

    try{
      // Fetch current (live) version
      const liveData = await fetchJSON('/file?path=' + encodeURIComponent(path));
      const liveContent = liveData.content || '';

      // Get historical version
      let historicalContent = '';
      if(contentHash){
        // Fetch specific version by hash (from file timeline)
        console.log(`📅 [openDiffEditor] Fetching version by hash: ${contentHash}`);
        const versionData = await fetchJSON('/version?hash=' + encodeURIComponent(contentHash));
        historicalContent = versionData.content || '';
      } else {
        // Get historical version from tile content (global time-travel mode)
        historicalContent = tileContent.get(path) || '';

        // If no contentHash provided but we're in global time-travel mode,
        // try to get the hash from tile content metadata
        if(currentAsOfMs){
          // TODO: Could fetch version info to get the hash
          console.log('📅 [openDiffEditor] Global time-travel mode, no specific hash');
        }
      }

      // Store historical content for restore
      diffHistoricalContent = historicalContent;

      // Clear container
      diffEditorContainer.innerHTML = '';

      // Create Monaco diff editor
      if(typeof require === 'undefined'){
        showToast('Monaco editor not available');
        return;
      }

      require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
      require(['vs/editor/editor.main'], function(){
        if(diffEditor){
          try{ diffEditor.dispose(); }catch(e){}
        }

        // Define custom theme
        defineMonacoTheme();

        const diffEditorOptions = {
          readOnly: true,
          minimap: { enabled: true },
          theme: systemThemeEnabled && systemThemeAvailable ? 'omarchy' : 'rewindex-dark',
          fontSize: 12,
          automaticLayout: true,
          renderSideBySide: true,
        };

        // Apply system font if available
        if(systemThemeEnabled && systemThemeAvailable){
          const monoFont = document.documentElement.style.getPropertyValue('--font-mono');
          if(monoFont){
            diffEditorOptions.fontFamily = monoFont;
          }
        }

        diffEditor = monaco.editor.createDiffEditor(diffEditorContainer, diffEditorOptions);

        // Set models: original (historical) vs modified (current/live)
        const originalModel = monaco.editor.createModel(historicalContent, normalizeLanguageForMonaco(liveData.language));
        const modifiedModel = monaco.editor.createModel(liveContent, normalizeLanguageForMonaco(liveData.language));

        diffEditor.setModel({
          original: originalModel,
          modified: modifiedModel
        });
      });

      // Show overlay
      diffOverlayEl.style.display = 'flex';

      // Load and render file history (timeline + sidebar) in diff mode
      const versions = await loadFileHistory(path);
      renderFileTimeline(versions, path, {
        timelineEl: diffTimelineEl,
        markersEl: diffTimelineMarkersEl,
        selectedHash: contentHash,
        isDiffMode: true
      });

      // Render version history sidebar with current version highlighted
      renderVersionHistorySidebar(versions, path, contentHash || liveData.content_hash, {
        sidebarEl: diffVersionHistorySidebar,
        contentEl: diffVersionHistoryContent,
        isDiffMode: true
      });
    }catch(e){
      showToast('Failed to load diff');
      console.error('Diff editor error:', e);
    }
  }

  function closeDiffEditor(){
    if(diffEditor){
      try{
        // Dispose models
        const model = diffEditor.getModel();
        if(model){
          if(model.original) model.original.dispose();
          if(model.modified) model.modified.dispose();
        }
        diffEditor.dispose();
      }catch(e){}
      diffEditor = null;
    }
    diffEditorPath = null;
    diffHistoricalContent = null;
    diffSelectedHash = null;
    diffOverlayEl.style.display = 'none';
    // Hide diff timeline and sidebar
    if(diffTimelineEl){
      diffTimelineEl.style.display = 'none';
    }
    if(diffVersionHistorySidebar){
      diffVersionHistorySidebar.style.display = 'none';
    }
  }

  function showRestoreConfirmation(){
    confirmMessageEl.textContent = `This will overwrite the current file "${diffEditorPath}" with the historical version.`;
    confirmModalEl.style.display = 'flex';
  }

  async function restoreHistoricalVersion(){
    if(!diffEditorPath || !diffHistoricalContent){
      showToast('No historical version to restore');
      return;
    }

    try{
      // Save historical content to current file
      const res = await fetchJSON('/file/save', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          path: diffEditorPath,
          content: diffHistoricalContent
        })
      });

      showToast(`Restored: ${diffEditorPath}`);

      // Close modal and diff overlay
      confirmModalEl.style.display = 'none';
      closeDiffEditor();

      // Invalidate cache to ensure fresh content on next load
      preloadCache.delete(diffEditorPath);
      tileContent.delete(diffEditorPath);

      // Refresh tile content (will fetch fresh from server now)
      await refreshTileContent(diffEditorPath);

      // Flash the tile to show it was updated
      flashTile(diffEditorPath, 'update');
    }catch(e){
      showToast(`Failed to restore: ${e.message || e}`);
      console.error('Restore failed:', e);
    }
  }

  const tiles = new Map(); // path -> tile DOM
  const tileContent = new Map(); // path -> content string
  const pendingFocus = new Map(); // path -> {line, token}
  const folders = new Map(); // folderPath -> folder DOM
  const filePos = new Map(); // path -> {x,y}
  const fileFolder = new Map(); // path -> folderPath
  const fileLanguages = new Map(); // path -> language
  const fileMeta = new Map(); // path -> {size_bytes, line_count}
  const toasts = document.getElementById('toasts');
  let nextX = 0;
  let nextY = 0;
  function autoPos(){
    const x = nextX; const y = nextY; nextX += 640; if(nextX > 1600){ nextX = 0; nextY += 460; } return [x,y];
  }

  // Calculate tile dimensions based on file type and image aspect ratio
  function calculateTileSize(path){
    const meta = fileMeta.get(path) || {};

    // For binary files (images) use ORIGINAL dimensions for aspect ratio
    if(meta.is_binary && meta.original_width && meta.original_height){
      const aspect = meta.original_width / meta.original_height;
      console.log(`🖼️  [calculateTileSize] Image ${path.split('/').pop()}: ${meta.original_width}x${meta.original_height}, aspect=${aspect.toFixed(2)}`);

      if(aspect > 1.5){
        // Wide landscape image
        console.log(`   → Wide landscape: 800×400`);
        return { w: 800, h: 400 };
      } else if(aspect > 1.2){
        // Landscape image
        console.log(`   → Landscape: 600×400`);
        return { w: 600, h: 400 };
      } else if(aspect < 0.7){
        // Tall portrait image
        console.log(`   → Tall portrait: 300×600`);
        return { w: 300, h: 600 };
      } else if(aspect < 0.85){
        // Portrait image
        console.log(`   → Portrait: 400×500`);
        return { w: 400, h: 500 };
      } else {
        // Square-ish image
        console.log(`   → Square: 400×400`);
        return { w: 400, h: 400 };
      }
    } else if(meta.is_binary){
      console.log(`⚠️  [calculateTileSize] Binary file ${path.split('/').pop()} has NO original dimensions`);
    }

    // Default size for text files
    return { w: 600, h: 400 };
  }

  async function openTile(path){
    // Check if tile already exists
    const existingTile = tiles.get(path);
    if(existingTile){
      // Update dimensions if changed (MiniMasonry will reposition on next layout() call)
      const pos = filePos.get(path);
      if(pos){
        // Update position if available (treemap mode has x,y)
        if(pos.x !== undefined) existingTile.style.left = `${pos.x}px`;
        if(pos.y !== undefined) existingTile.style.top = `${pos.y}px`;
        // Update dimensions
        if(pos.w) existingTile.style.width = `${pos.w}px`;
        if(pos.h) existingTile.style.height = `${pos.h}px`;
      }
      return existingTile;
    }

    // Create new tile
    const tile = document.createElement('div');
    tile.className = 'tile';
    const pos = filePos.get(path);

    // Set position if available (treemap mode, or after minimasonry calculates)
    if(pos && pos.x !== undefined && pos.y !== undefined){
      tile.style.left = `${pos.x}px`;
      tile.style.top = `${pos.y}px`;
    } else {
      // MiniMasonry will calculate position, set default for now
      tile.style.left = '0px';
      tile.style.top = '0px';
    }

    // Apply dimensions if available (from layoutSimpleGrid or layoutTreemap)
    if(pos && pos.w){
      tile.style.width = `${pos.w}px`;
      tile.setAttribute('data-default-width', pos.w);
      console.log(`📏 [openTile] Applied width ${pos.w}px to ${path.split('/').pop()}`);
    }
    if(pos && pos.h){
      tile.style.height = `${pos.h}px`;
      tile.setAttribute('data-default-height', pos.h);
      console.log(`📏 [openTile] Applied height ${pos.h}px to ${path.split('/').pop()}`);
    }
    const title = document.createElement('div');
    title.className = 'title';
    title.innerHTML = `<span>${path}</span><span class="right"><button class="btn tiny editbtn" title="Edit" style="display:none;">✎</button><button class="btn tiny dlbtn" title="Download" style="display:none;">⬇</button><span class="lang"></span><span class="updated"></span></span>`;

    // Dynamic header font size based on tile height (for treemap mode)
    if(pos.h){
      const headerFontSize = Math.max(8, Math.min(14, pos.h / 20)); // 8-14px based on height
      title.style.fontSize = `${headerFontSize}px`;
      title.style.padding = `${Math.max(2, headerFontSize * 0.3)}px ${Math.max(4, headerFontSize * 0.5)}px`;
    }

    const body = document.createElement('div');
    body.className = 'body';
    tile.appendChild(title); tile.appendChild(body);
    canvas.appendChild(tile);
    tiles.set(path, tile);
    return tile;
  }

  // ========== Color Utilities for Theme-Aware Gradient ==========

  function hexToRgb(hex){
    // Remove # if present and handle rgba strings
    if(hex.startsWith('rgba(')){
      const match = hex.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if(match){
        return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
      }
    }
    hex = hex.replace('#', '');
    if(hex.length === 3){
      hex = hex.split('').map(c => c + c).join('');
    }
    return {
      r: parseInt(hex.substring(0, 2), 16),
      g: parseInt(hex.substring(2, 4), 16),
      b: parseInt(hex.substring(4, 6), 16)
    };
  }

  function rgbToHex(r, g, b){
    return '#' + [r, g, b].map(x => {
      const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  }

  function rgbToHsl(r, g, b){
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if(max === min){
      h = s = 0; // achromatic
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch(max){
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }

    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  function hslToRgb(h, s, l){
    h /= 360;
    s /= 100;
    l /= 100;
    let r, g, b;

    if(s === 0){
      r = g = b = l; // achromatic
    } else {
      const hue2rgb = (p, q, t) => {
        if(t < 0) t += 1;
        if(t > 1) t -= 1;
        if(t < 1/6) return p + (q - p) * 6 * t;
        if(t < 1/2) return q;
        if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  function hslToHex(h, s, l){
    const rgb = hslToRgb(h, s, l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function interpolateColor(color1, color2, ratio){
    const rgb1 = hexToRgb(color1);
    const rgb2 = hexToRgb(color2);
    const r = rgb1.r + (rgb2.r - rgb1.r) * ratio;
    const g = rgb1.g + (rgb2.g - rgb1.g) * ratio;
    const b = rgb1.b + (rgb2.b - rgb1.b) * ratio;
    return rgbToHex(r, g, b);
  }

  function generateTetradPalette(accentColor){
    // Generate tetrad color scheme (4 colors evenly spaced on color wheel)
    const rgb = hexToRgb(accentColor);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

    // Keep saturation high and lightness moderate for vibrant colors
    const saturation = Math.max(60, hsl.s); // Boost saturation if needed
    const lightness = 55; // Consistent lightness for even vibrancy

    // Tetrad: base, +90°, +180°, +270°
    const tetrad = [
      hslToHex(hsl.h, saturation, lightness),                    // Base (accent)
      hslToHex((hsl.h + 90) % 360, saturation, lightness),       // +90° (complementary split 1)
      hslToHex((hsl.h + 180) % 360, saturation, lightness),      // +180° (direct complement)
      hslToHex((hsl.h + 270) % 360, saturation, lightness),      // +270° (complementary split 2)
    ];

    return tetrad;
  }

  function generateThemeGradient(index, total){
    // Strategy 1: Tetrad palette from accent color (vibrant heatmap)
    if(currentThemeColors && currentThemeColors['--accent']){
      const accentColor = currentThemeColors['--accent'];
      const tetrad = generateTetradPalette(accentColor);

      if(index === 0){
        console.log('🎨 [gradient] Using tetrad heatmap palette from accent:', accentColor);
        console.log('   Tetrad colors:', tetrad);
        // Visual debug: show color swatches in console (modern browsers)
        tetrad.forEach((color, i) => {
          console.log(`   %c ${i}: ${color} `, `background: ${color}; color: white; padding: 2px 8px; font-weight: bold;`);
        });
      }

      // Map index across the 4 tetrad colors
      const position = (index / Math.max(1, total - 1)) * (tetrad.length - 1);
      const lower = Math.floor(position);
      const upper = Math.min(tetrad.length - 1, Math.ceil(position));
      const ratio = position - lower;

      if(lower === upper){
        return tetrad[lower];
      }
      return interpolateColor(tetrad[lower], tetrad[upper], ratio);
      // return interpolateColor(tetrad[upper], tetrad[lower], ratio);
    }

    // Strategy 2: Use terminal ANSI colors if available
    if(currentTerminalColors && currentTerminalColors.normal){
      const normal = currentTerminalColors.normal;
      const bright = currentTerminalColors.bright || {};

      // Order colors by hue for spectrum effect: blue->cyan->green->yellow->orange->red->magenta
      const spectrum = [
        normal.blue,
        bright.blue || normal.cyan,
        normal.cyan,
        bright.cyan || normal.green,
        normal.green,
        bright.green || normal.yellow,
        normal.yellow,
        bright.yellow || normal.red,
        normal.red,
        bright.red || normal.magenta,
        normal.magenta,
        bright.magenta || normal.blue,
      ].filter(c => c); // Remove undefined colors

      if(spectrum.length > 0){
        if(index === 0){
          console.log('🎨 [gradient] Using terminal ANSI color spectrum:', spectrum);
        }
        // Map index to spectrum position
        const position = (index / Math.max(1, total - 1)) * (spectrum.length - 1);
        const lower = Math.floor(position);
        const upper = Math.min(spectrum.length - 1, Math.ceil(position));
        const ratio = position - lower;

        if(lower === upper){
          return spectrum[lower];
        }
        return interpolateColor(spectrum[lower], spectrum[upper], ratio);
      }
    }

    // Strategy 3: Fallback to vibrant rainbow (enhanced pastel)
    if(index === 0){
      console.log('🎨 [gradient] Using fallback vibrant rainbow');
    }
    const hue = (index * 360 / total) % 360;
    const saturation = 70; // Boosted saturation for more vibrant colors
    const lightness = 55;  // Moderate lightness for better vibrancy
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  function generatePastelColor(index, total){
    // Legacy function - now redirects to theme-aware gradient
    return generateThemeGradient(index, total);
  }

  function getLanguageColor(language){
    if(!language || language === 'unknown' || language === 'plaintext'){
      return 'rgba(92, 106, 114, 0.4)'; // Muted gray for unknown
    }

    // Handle binary languages (binary-image, binary-pdf, etc.)
    if(language.startsWith('binary-')){
      const baseLang = language.replace('binary-', '');
      // Use base language if we have it, otherwise generate for full name
      if(languageColors[baseLang]){
        return languageColors[baseLang];
      }
    }

    // If we've already assigned a color, return it
    if(languageColors[language]){
      return languageColors[language];
    }

    // Add new language and assign color
    languageList.push(language);
    const color = generatePastelColor(languageList.length - 1, Math.max(20, languageList.length));
    languageColors[language] = color;
    return color;
  }

  // Expose to global scope for physics blocks
  window.getLanguageColor = getLanguageColor;
  window.languageColors = languageColors;

  function applyLanguageColor(tile, language){
    if(!tile) return;
    const color = getLanguageColor(language);
    tile.style.borderColor = color;
    tile.style.borderWidth = '2px';
    tile.style.boxShadow = `0 6px 18px rgba(0, 0, 0, 0.45), 0 0 0 2px ${color}`;

    // Also color the filename in the title
    const titleSpan = tile.querySelector('.title > span:first-child');
    if(titleSpan){
      titleSpan.style.color = color;
      titleSpan.style.fontWeight = '600';
    }
  }

  function getMostCommonLanguage(folderPath){
    // Find all files in this folder
    const filesInFolder = [];
    for(const [path, folder] of fileFolder){
      if(folder === folderPath){
        const lang = fileLanguages.get(path);
        if(lang && lang !== 'unknown' && lang !== 'plaintext'){
          filesInFolder.push(lang);
        }
      }
    }

    if(filesInFolder.length === 0) return null;

    // Count occurrences
    const counts = {};
    for(const lang of filesInFolder){
      counts[lang] = (counts[lang] || 0) + 1;
    }

    // Find most common
    let maxCount = 0;
    let mostCommon = null;
    for(const [lang, count] of Object.entries(counts)){
      if(count > maxCount){
        maxCount = count;
        mostCommon = lang;
      }
    }

    return mostCommon;
  }

  function applyFolderColor(folderEl, folderPath){
    if(!folderEl) return;
    const language = getMostCommonLanguage(folderPath);
    if(!language) return;

    const color = getLanguageColor(language);
    const label = folderEl.querySelector('.label');

    if(label){
      // Make label bigger and colored
      label.style.color = color;
      label.style.fontSize = '16px';
      label.style.fontWeight = '700';
    }

    // Tint the folder background
    // Convert HSL color to semi-transparent version
    const hslMatch = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if(hslMatch){
      const [, h, s, l] = hslMatch;
      const tintColor = `hsla(${h}, ${s}%, ${l}%, 0.05)`;
      folderEl.style.backgroundColor = tintColor;
    }
  }

  function normalizeLanguageForMonaco(lang){
    // Map backend language names to Monaco language identifiers
    const monacoMap = {
      'unknown': 'plaintext',
      'shell': 'shell',
      'toml': 'ini',  // Monaco doesn't have native TOML support
      'ignore': 'plaintext',
      'properties': 'ini',
      'makefile': 'makefile',
      'restructuredtext': 'plaintext',  // Monaco doesn't have rst
      'objective-c': 'objective-c',
      'objective-cpp': 'objective-c',
    };
    return monacoMap[lang] || lang || 'plaintext';
  }

  function calculateDynamicFontSize(lineCount){
    // Returns font size based on file line count
    // Small files: 20px, Large files: 5px (wide range!)
    if(!dynTextMode) return 12; // Default font size when disabled
    if(!lineCount || lineCount <= 0) return 12;

    // Logarithmic scaling: bigger files get smaller font
    // 1-50 lines: 20px (very readable)
    // 50-200 lines: 16px
    // 200-500 lines: 12px
    // 500-1000 lines: 9px
    // 1000-3000 lines: 7px
    // 3000+ lines: 5px (tiny for huge files)
    const MIN_FONT = 5;
    const MAX_FONT = 20;

    if(lineCount <= 50) return MAX_FONT;
    if(lineCount >= 3000) return MIN_FONT;

    // Logarithmic interpolation
    const logMin = Math.log(50);
    const logMax = Math.log(3000);
    const logValue = Math.log(lineCount);
    const ratio = (logValue - logMin) / (logMax - logMin);

    return Math.round(MAX_FONT - (ratio * (MAX_FONT - MIN_FONT)));
  }

  function languageToPrism(lang){
    // Map backend language names to Prism language identifiers
    const prismMap = {
      'javascript': 'javascript',
      'typescript': 'typescript',
      'python': 'python',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'csharp': 'csharp',
      'go': 'go',
      'rust': 'rust',
      'ruby': 'ruby',
      'php': 'php',
      'swift': 'swift',
      'kotlin': 'kotlin',
      'scala': 'scala',
      'html': 'markup',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'json': 'json',
      'yaml': 'yaml',
      'toml': 'toml',
      'xml': 'markup',
      'markdown': 'markdown',
      'sql': 'sql',
      'shell': 'bash',
      'bash': 'bash',
      'dockerfile': 'docker',
      'makefile': 'makefile',
      'unknown': 'plaintext'
    };
    return prismMap[lang] || lang || 'plaintext';
  }

  async function loadTileContent(path, initData, focusLine = null, searchQuery = null, scrollDirection = null){
    const perfStart = performance.now();
    const hadContent = tileContent.has(path);
    const inCache = preloadCache.has(path);
    // console.log('📄 [loadTileContent] START', {
    //   path: path.substring(path.lastIndexOf('/') + 1), // Just filename for brevity
    //   hadContent,
    //   inCache,
    //   focusLine,
    //   hasQuery: !!searchQuery
    // });

    let tile = tiles.get(path);
    if(!tile){ await openTile(path); tile = tiles.get(path); }

    // Check preload cache first (instant if available)
    let data;
    if(initData){
      data = initData;
    } else if(preloadCache.has(path)){
      data = preloadCache.get(path);
      //console.log('⚡ [loadTileContent] Using cached data (instant!)');
    } else {
      data = await fetchJSON('/file?path=' + encodeURIComponent(path));
    }

    const body = tile.querySelector('.body');

    // CRITICAL: Check if body already has children before clearing
    const oldChildCount = body.children.length;
    if(oldChildCount > 0){
      // Only warn if we're unexpectedly reloading (not for focus line changes)
      if(!focusLine){
        console.warn('⚠️  [loadTileContent] Body already has content, clearing', {
          oldChildren: oldChildCount,
          path: path.split('/').pop()
        });
      }
    }

    // Update language in title and apply color
    try{ tile.querySelector('.title .lang').textContent = data.language || ''; }catch(e){}
    try{ tile.querySelector('.title .updated').textContent = new Date().toLocaleTimeString(); }catch(e){}

    // Store language and full content
    fileLanguages.set(path, data.language);
    tileContent.set(path, data.content || '');
    applyLanguageColor(tile, data.language);

    // Handle binary files differently
    if(data.is_binary){
      console.log(`📦 [loadTileContent] Binary file: ${path}`, {
        has_preview: !!data.preview_base64,
        binary_type: data.binary_type,
        size_kb: (data.size_bytes / 1024).toFixed(1)
      });

      body.innerHTML = ''; // Clear

      // Show preview if available
      if(data.preview_base64){
        const previewWidth = data.preview_width || 200;
        const previewHeight = data.preview_height || 200;
        const aspectRatio = previewWidth / previewHeight;

        console.log(`🖼️  [loadTileContent] Rendering preview`, {
          file: path.split('/').pop(),
          width: previewWidth,
          height: previewHeight,
          aspect: aspectRatio.toFixed(2)
        });

        const img = document.createElement('img');
        img.src = data.preview_base64;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';  // Fill tile, may crop
        img.style.display = 'block';
        img.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
        body.appendChild(img);

        console.log(`🖼️  [binary] Image rendered, aspect: ${aspectRatio.toFixed(2)}, tile already sized by layout`);
        return; // Done! Layout system already sized the tile
      }

      // No preview - show binary info
      console.log(`📦 [loadTileContent] No preview, showing info for ${path.split('/').pop()}`);
      const info = document.createElement('div');
      info.className = 'binary-tile-info';
      info.innerHTML = `
        <div class="binary-type-badge">${(data.binary_type || 'BINARY').toUpperCase()}</div>
        <div class="binary-size">${(data.size_bytes / 1024).toFixed(1)} KB</div>
        <div class="binary-hint">Click to download</div>
      `;
      body.appendChild(info);
      return; // Done, skip text rendering
    }

    // Use Prism for syntax highlighting (lightweight, supports 1000s of instances)
    const content = data.content || '';
    const prismLang = languageToPrism(data.language);

    // PERFORMANCE FIX: Limit line length to prevent loading giant minified files
    // Files with no line breaks (minified JS, compiled code) can be megabytes on one line
    const MAX_LINE_LENGTH = 10000; // 10k chars per line max (generous but safe)
    const rawLines = content.split('\n');
    let truncatedCount = 0;
    const lines = rawLines.map(line => {
      if(line.length > MAX_LINE_LENGTH){
        truncatedCount++;
        return line.substring(0, MAX_LINE_LENGTH) + ' ...[line truncated, ' + (line.length - MAX_LINE_LENGTH) + ' more chars]';
      }
      return line;
    });
    // if(truncatedCount > 0){
    //   console.warn(`⚠️  [loadTileContent] Truncated ${truncatedCount} long lines in ${path.substring(path.lastIndexOf('/') + 1)}`);
    // }
    const totalLines = lines.length;

    // CHUNKED RENDERING: Calculate chunk size based on tile height and dynamic font size
    // This ensures the chunk fits nicely in the viewport
    const fontSize = calculateDynamicFontSize(totalLines);
    const lineHeight = fontSize * 1.4;
    const tileHeight = tile.offsetHeight || 400;
    const bodyHeight = tileHeight - 34; // Subtract title height

    // Calculate how many lines fit in the viewport (with some buffer)
    const visibleLines = Math.floor(bodyHeight / lineHeight);
    const MAX_LINES_TO_RENDER = Math.max(100, Math.min(500, visibleLines * 3)); // 3x viewport, clamped 100-500

    let startLine = 1;
    let endLine = totalLines;
    let extendedChunkForScroll = false;
    let scrollAnimationData = null; // {direction, targetLine, prependedLines, appendedLines}

    // Check if there's a pending focus for this path
    const pending = pendingFocus.get(path);
    if(pending && pending.line){
      focusLine = pending.line;
      // Preserve direction from pending focus if available
      if(pending.direction && !scrollDirection){
        scrollDirection = pending.direction;
        console.log(`📌 [loadTileContent] Using pending scroll direction: ${scrollDirection}`);
      }
      pendingFocus.delete(path); // Clear after using
    }

    if(totalLines > MAX_LINES_TO_RENDER){
      if(focusLine && focusLine > 0){
        // Get current chunk info to determine scroll direction
        const tile = tiles.get(path);
        const body = tile && tile.querySelector('.body');
        const pre = body && body.querySelector('pre.prism-code');
        const currentChunkStart = pre ? (parseInt(pre.getAttribute('data-chunk-start')) || 1) : 1;
        const currentChunkEnd = pre ? (parseInt(pre.getAttribute('data-chunk-end')) || totalLines) : totalLines;

        // Calculate current visible line (approximate from scroll position)
        let currentVisibleLine = currentChunkStart;
        if(pre && pre.scrollTop > 0){
          const computedStyle = window.getComputedStyle(pre);
          const currentFontSize = parseFloat(computedStyle.fontSize) || fontSize;
          const currentLineHeight = parseFloat(computedStyle.lineHeight) || currentFontSize * 1.4;
          const scrolledLines = Math.floor(pre.scrollTop / currentLineHeight);
          currentVisibleLine = currentChunkStart + scrolledLines;
        }

        // Determine scroll direction
        const direction = scrollDirection || (focusLine < currentVisibleLine ? 'up' : 'down');

        console.log(`🎯 [loadTileContent] Smart chunking:`, {
          focusLine,
          currentVisible: currentVisibleLine,
          currentChunk: `${currentChunkStart}-${currentChunkEnd}`,
          direction,
          explicitDirection: scrollDirection
        });

        // Center the target line in main chunk
        const halfChunk = Math.floor(MAX_LINES_TO_RENDER / 2);
        startLine = Math.max(1, focusLine - halfChunk);
        endLine = Math.min(totalLines, startLine + MAX_LINES_TO_RENDER - 1);

        // EXTENDED CHUNK TRICK: Add buffer lines for smooth scroll animation
        const SCROLL_BUFFER = 150; // Extra lines for animation
        let prependedLines = 0;
        let appendedLines = 0;

        if(direction === 'up' && endLine < totalLines){
          // Scrolling UP: append extra lines AFTER to scroll up from
          const oldEnd = endLine;
          endLine = Math.min(totalLines, endLine + SCROLL_BUFFER);
          appendedLines = endLine - oldEnd;
          extendedChunkForScroll = true;
          console.log(`  ⬆️  Extended chunk for UP scroll: appended ${appendedLines} lines (${oldEnd+1}-${endLine})`);
        } else if(direction === 'down' && startLine > 1){
          // Scrolling DOWN: prepend extra lines BEFORE to scroll down through
          const oldStart = startLine;
          startLine = Math.max(1, startLine - SCROLL_BUFFER);
          prependedLines = oldStart - startLine;
          extendedChunkForScroll = true;
          console.log(`  ⬇️  Extended chunk for DOWN scroll: prepended ${prependedLines} lines (${startLine}-${oldStart-1})`);
        }

        if(extendedChunkForScroll){
          scrollAnimationData = {
            direction,
            targetLine: focusLine,
            prependedLines,
            appendedLines
          };
        }

        // Adjust if we're near the edges
        if(endLine - startLine + 1 < MAX_LINES_TO_RENDER){
          if(startLine > 1){
            startLine = Math.max(1, endLine - MAX_LINES_TO_RENDER + 1);
          } else if(endLine < totalLines){
            endLine = Math.min(totalLines, startLine + MAX_LINES_TO_RENDER - 1);
          }
        }

        console.log(`  → Final chunk: ${startLine}-${endLine} (${endLine - startLine + 1} lines)${extendedChunkForScroll ? ' [EXTENDED]' : ''}`);
      } else {
        // Just show first chunk
        startLine = 1;
        endLine = MAX_LINES_TO_RENDER;
      }
    }

    // Extract the chunk to render
    const chunkLines = lines.slice(startLine - 1, endLine);
    const chunkContent = chunkLines.join('\n');
    const chunkLineCount = chunkLines.length;

    // fontSize already calculated above for chunk sizing

    const pre = document.createElement('pre');
    pre.className = 'prism-code line-numbers'; // Add line-numbers class
    pre.style.fontSize = `${fontSize}px`;
    pre.style.marginTop = `0px`;
    pre.style.lineHeight = '1.4'; // Ensure readability
    pre.style.userSelect = 'text'; // Allow text selection
    pre.style.cursor = 'text'; // Show text cursor
    pre.setAttribute('data-start', String(startLine)); // Line numbers start at actual line number!
    pre.setAttribute('data-total-lines', String(totalLines)); // Store total for reference
    pre.setAttribute('data-chunk-start', String(startLine));
    pre.setAttribute('data-chunk-end', String(endLine));

    // Store extended chunk metadata for scroll animation
    if(scrollAnimationData){
      pre.setAttribute('data-scroll-direction', scrollAnimationData.direction);
      pre.setAttribute('data-scroll-target', String(scrollAnimationData.targetLine));
      pre.setAttribute('data-prepended-lines', String(scrollAnimationData.prependedLines));
      pre.setAttribute('data-appended-lines', String(scrollAnimationData.appendedLines));
    }

    const code = document.createElement('code');
    code.className = `language-${prismLang}`;
    code.style.fontSize = `${fontSize}px`; // Apply to code element too
    code.textContent = chunkContent; // Only render the chunk!
    pre.appendChild(code);

    body.innerHTML = '';
    body.appendChild(pre);

    // Add chunk indicator if not showing full file
    if(totalLines > MAX_LINES_TO_RENDER){
      const indicator = document.createElement('div');
      indicator.className = 'chunk-indicator';
      indicator.textContent = `Showing lines ${startLine}-${endLine} of ${totalLines}`;
      //indicator.style.cssText = '';
      body.style.position = 'relative';
      body.appendChild(indicator);
    }

    // Syntax highlighting with Prism (with performance monitoring)
    const prismStart = performance.now();
    let prismRan = false;
    if(typeof Prism !== 'undefined'){
      try{
        Prism.highlightElement(code);
        prismRan = true;
        const prismEnd = performance.now();
        const prismDuration = prismEnd - prismStart;
        if(prismDuration > 50){
          console.warn(`⚠️  [Prism] Slow highlighting: ${prismDuration.toFixed(2)}ms for ${path.substring(path.lastIndexOf('/') + 1)}`);
        }
      }catch(e){
        console.warn('[Prism] Highlighting failed:', e.message);
      }
    }

    // Highlight search terms if provided
    if(searchQuery && searchQuery.trim()){
      highlightSearchTerms(code, searchQuery.trim());
    }

    // Scroll to focused line if provided
    if(focusLine && focusLine > 0){
      // Wait for Prism to finish rendering and layout to stabilize
      setTimeout(() => {
        scrollToLine(path, focusLine, scrollDirection, scrollAnimationData);
      }, 150);
    }

    setupTileButtons(path);

    const perfEnd = performance.now();
    const totalDuration = perfEnd - perfStart;
    // console.log('✅ [loadTileContent] END', {
    //   path: path.substring(path.lastIndexOf('/') + 1),
    //   duration: `${totalDuration.toFixed(2)}ms`,
    //   source: inCache ? 'cache' : 'network',
    //   bodyChildren: body.children.length,
    //   linesRendered: chunkLineCount,
    //   totalLines: totalLines,
    //   truncated: truncatedCount > 0,
    //   prism: prismRan
    // });
  }

  function highlightSearchTerms(element, query){
    const perfStart = performance.now();
    console.log('🔍 [highlightSearchTerms] START', { query });

    // Check if already highlighted with this query to avoid re-processing
    const alreadyHighlighted = element.getAttribute('data-highlighted-query');
    if(alreadyHighlighted === query){
      console.log(`  ⏭️  Already highlighted with query "${query}", skipping`);
      return;
    }

    // CRITICAL: Remove existing search highlights to prevent layering
    const existingMarks = element.querySelectorAll('mark.search-highlight');
    if(existingMarks.length > 0){
      console.log(`  🧹 Clearing ${existingMarks.length} existing highlights`);
      existingMarks.forEach(mark => {
        // Replace mark with its text content
        const textNode = document.createTextNode(mark.textContent);
        mark.parentNode.replaceChild(textNode, mark);
      });
      // Normalize to merge adjacent text nodes
      element.normalize();
    }

    // Escape regex special characters
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedQuery, 'gi');

    // Find all text nodes and highlight matches
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const nodesToReplace = [];
    let node;
    let nodesWalked = 0;

    while(node = walker.nextNode()){
      nodesWalked++;
      const text = node.textContent;
      if(regex.test(text)){
        nodesToReplace.push(node);
      }
      regex.lastIndex = 0; // Reset regex
    }

    // Replace text nodes with highlighted versions
    nodesToReplace.forEach(textNode => {
      const text = textNode.textContent;
      const fragment = document.createDocumentFragment();

      let lastIndex = 0;
      let match;
      regex.lastIndex = 0;

      while((match = regex.exec(text)) !== null){
        // Add text before match
        if(match.index > lastIndex){
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }

        // Add highlighted match
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.textContent = match[0];
        fragment.appendChild(mark);

        lastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if(lastIndex < text.length){
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      textNode.parentNode.replaceChild(fragment, textNode);
    });

    // Mark as highlighted with this query
    element.setAttribute('data-highlighted-query', query);

    const perfEnd = performance.now();
    console.log('✅ [highlightSearchTerms] END', {
      duration: `${(perfEnd - perfStart).toFixed(2)}ms`,
      nodesWalked,
      nodesReplaced: nodesToReplace.length
    });
  }

  function setupTileButtons(path){
    const tile = tiles.get(path);
    if(!tile) return;

    const title = tile.querySelector('.title .right');
    if(!title) return;

    // Setup download button (historical mode only)
    const dlBtn = tile.querySelector('.dlbtn');
    if(dlBtn){
      dlBtn.style.display = (currentAsOfMs != null) ? 'inline-block' : 'none';
    }

    // Setup edit button (live mode only)
    const editBtn = tile.querySelector('.editbtn');
    if(editBtn){
      editBtn.style.display = (currentAsOfMs == null) ? 'inline-block' : 'none';
      editBtn.onclick = (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        openOverlayEditor(path);
      };
    }

    // Setup diff button (historical mode only) - create if doesn't exist
    let diffBtn = tile.querySelector('.diffbtn');
    if(!diffBtn){
      diffBtn = document.createElement('button');
      diffBtn.className = 'btn tiny diffbtn';
      diffBtn.title = 'Diff from Live';
      diffBtn.textContent = '⇄';
      // Insert before lang/updated spans
      const lang = title.querySelector('.lang');
      if(lang){
        title.insertBefore(diffBtn, lang);
      } else {
        title.appendChild(diffBtn);
      }
    }
    diffBtn.style.display = (currentAsOfMs != null) ? 'inline-block' : 'none';
    diffBtn.onclick = (ev)=>{
      ev.preventDefault();
      ev.stopPropagation();
      openDiffEditor(path);
    };

    if(!dlBtn) return;

    // Remove any existing click handler to avoid duplicates
    dlBtn.onclick = null;

    dlBtn.onclick = (ev)=>{
      ev.preventDefault();
      ev.stopPropagation();

      // Get content from tile content map
      const content = tileContent.get(path) || '';

      // If no content, show error
      if(!content){
        showToast('Error: Could not retrieve file content');
        console.error('Download failed: no content found for', path);
        return;
      }

      // Generate clean filename with timestamp
      const filename = path.split('/').pop() || 'file.txt';
      const baseWithoutExt = filename.lastIndexOf('.') > 0
        ? filename.substring(0, filename.lastIndexOf('.'))
        : filename;
      const ext = filename.lastIndexOf('.') > 0
        ? filename.substring(filename.lastIndexOf('.'))
        : '';

      let downloadName = filename;
      if(currentAsOfMs){
        // Format: filename_YYYYMMDD-HHMMSS.ext
        const d = new Date(currentAsOfMs);
        const timestamp = d.getFullYear() +
          String(d.getMonth() + 1).padStart(2, '0') +
          String(d.getDate()).padStart(2, '0') +
          '-' +
          String(d.getHours()).padStart(2, '0') +
          String(d.getMinutes()).padStart(2, '0') +
          String(d.getSeconds()).padStart(2, '0');
        downloadName = `${baseWithoutExt}_${timestamp}${ext}`;
      }

      // Create and trigger download
      const blob = new Blob([content], {type:'text/plain;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();

      // Cleanup
      setTimeout(()=>{
        URL.revokeObjectURL(url);
        a.remove();
      }, 100);

      showToast(`Downloaded: ${downloadName}`);
    };
  }

  async function refreshTileContent(path){
    try{
      await loadTileContent(path);
    }catch(e){ /* ignore */ }
  }

  function showToast(msg){
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = msg;
    toasts.appendChild(div);
    setTimeout(()=>{ div.remove(); }, 3000);
  }

  function buildTree(paths){
    const sep = '/';
    const root = { name: '.', path: '', folders: new Map(), files: [] };
    for(const p of paths){
      const parts = p.split('/');
      let node = root;
      for(let i=0;i<parts.length-1;i++){
        const part = parts[i];
        const key = (node.path ? node.path + sep : '') + part;
        if(!node.folders.has(part)) node.folders.set(part, { name: part, path: key, folders: new Map(), files: [] });
        node = node.folders.get(part);
      }
      node.files.push(p);
    }
    return root;
  }

  function layoutAndRender(root){
    // Clear old containers/positions
    for(const [, el] of folders){ el.remove(); }
    folders.clear(); filePos.clear(); fileFolder.clear();

    // Fixed, comfortable layout parameters
    const tileW = 600;
    const tileH = 400;
    const gap = 40;
    const pad = 60; // Generous padding inside folders
    const header = 50; // Space for folder label

    // Shelf packing with balanced aspect ratio: packs items wide AND tall
    function packSkyline(children, gap, pad, header){
      if(children.length === 0){
        return { positions: new Map(), width: 2*pad, height: pad + header + pad };
      }

      // Check if all children are uniform size (same width and height)
      const allUniform = children.every(ch => ch.w === children[0].w && ch.h === children[0].h);

      if(allUniform){
        // For uniform tiles, use optimal grid layout (creates square-ish grids)
        const n = children.length;
        const itemW = children[0].w;
        const itemH = children[0].h;

        // Calculate optimal columns to create a square-ish grid
        // For n items, we want cols ≈ sqrt(n) to minimize aspect ratio deviation
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);

        console.log(`📐 [grid layout] ${n} uniform tiles → ${cols}×${rows} grid`);

        const positions = new Map();

        children.forEach((child, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = pad + col * (itemW + gap);
          const y = pad + header + row * (itemH + gap);
          positions.set(child, { x, y });
        });

        const width = pad + cols * (itemW + gap) - gap + pad;
        const height = pad + header + rows * (itemH + gap) - gap + pad;

        return { positions, width, height };
      }

      // For non-uniform children, use skyline packing algorithm
      // Calculate total area to determine optimal width for balanced aspect ratio
      let totalArea = 0;
      for(const child of children){
        totalArea += (child.w + gap) * (child.h + gap);
      }

      // Target aspect ratio: square (1:1 - as wide as tall)
      const targetWidth = Math.sqrt(totalArea * 1.0);
      const maxShelfWidth = Math.max(targetWidth, 5000);

      // Sort by height descending for better packing
      const sorted = [...children].sort((a, b) => {
        if(b.h !== a.h) return b.h - a.h;
        return b.w - a.w;
      });

      const positions = new Map();

      let currentX = pad;
      let currentY = pad + header;
      let currentShelfHeight = 0;

      for(const child of sorted){
        // Check if item fits in current shelf (accounting for gap)
        if(currentX > pad && currentX + child.w > pad + maxShelfWidth){
          // Start new shelf below
          currentY += currentShelfHeight + gap;
          currentX = pad;
          currentShelfHeight = 0;
        }

        // Place item at current position
        positions.set(child, { x: currentX, y: currentY });

        // Move to next position
        currentX += child.w + gap;

        // Track tallest item in this shelf
        currentShelfHeight = Math.max(currentShelfHeight, child.h);
      }

      // Calculate actual bounds
      let maxRight = pad;
      let maxBottom = pad + header;

      for(const [child, pos] of positions){
        maxRight = Math.max(maxRight, pos.x + child.w);
        maxBottom = Math.max(maxBottom, pos.y + child.h);
      }

      return {
        positions,
        width: maxRight + pad,
        height: maxBottom + pad
      };
    }

    function layoutNode(node, ox, oy, render=true){
      // Collect all children (folders and files)
      const children = [];

      // First, recursively layout all subfolders to get their sizes (bottom-up)
      for(const [name, sub] of node.folders){
        const size = layoutNode(sub, 0, 0, false); // measure only, recursive
        children.push({ type:'folder', node: sub, name, w: size.w, h: size.h });
      }

      // Add files
      for(const fp of node.files){
        children.push({ type:'file', path: fp, w: tileW, h: tileH });
      }

      if(node !== root && children.length === 0){
        children.push({ type:'spacer', w: tileW, h: tileH });
      }

      // Special case: if we ONLY have files (no folders), force uniform grid layout
      // This ensures files always use the optimal square grid
      const hasOnlyFiles = children.every(ch => ch.type === 'file' || ch.type === 'spacer');
      if(hasOnlyFiles && children.length > 0){
        // Override dimensions to ensure uniform check passes
        children.forEach(ch => { ch.w = tileW; ch.h = tileH; });
      }

      // Use Skyline bin packing for optimal space usage
      const packed = packSkyline(children, gap, pad, header);

      const W = packed.width;
      const H = packed.height;

      // Render folder container (skip root)
      if(render && node !== root){
        const div = document.createElement('div');
        div.className = 'folder';
        div.style.left = `${ox}px`;
        div.style.top = `${oy}px`;
        div.style.width = `${W}px`;
        div.style.height = `${H}px`;
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = node.path || node.name;
        div.appendChild(label);
        canvas.appendChild(div);
        folders.set(node.path, div);
      }

      // Position children using packed positions
      for(const ch of children){
        const pos = packed.positions.get(ch);
        if(pos){
          ch.x = pos.x;
          ch.y = pos.y;
          if(ch.type === 'folder'){
            layoutNode(ch.node, ox + ch.x, oy + ch.y, render);
          }else if(ch.type === 'file'){
            if(render){
              filePos.set(ch.path, { x: ox + ch.x, y: oy + ch.y });
              fileFolder.set(ch.path, node.path || '');
            }
          }
        }
      }

      return { w: W, h: H };
    }

    // Layout root's children with dynamic square-based wrapping
    const topChildren = [];
    for(const [name, sub] of root.folders){ topChildren.push({type:'folder', node: sub}); }
    for(const f of root.files){ topChildren.push({type:'file', path: f}); }

    // Measure all root children first
    for(const ch of topChildren){
      if(ch.type === 'folder'){
        const size = layoutNode(ch.node, 0, 0, false);
        ch.w = size.w;
        ch.h = size.h;
      }else{
        ch.w = tileW;
        ch.h = tileH;
      }
    }

    // Calculate total area and target square layout
    let totalRootArea = 0;
    for(const ch of topChildren){
      totalRootArea += (ch.w + gap) * (ch.h + gap);
    }

    // Aim for square: calculate target width
    const targetRootWidth = Math.sqrt(totalRootArea * 1.0);

    // Use shelf packing at root level too
    let cx = 0, cy = 0, rowH = 0;

    for(const ch of topChildren){
      // Check if we need to wrap
      if(cx > 0 && cx + ch.w > targetRootWidth){
        cx = 0;
        cy += rowH + gap;
        rowH = 0;
      }

      if(ch.type === 'folder'){
        layoutNode(ch.node, cx, cy, true); // render
      }else{
        // Root-level file
        filePos.set(ch.path, { x: cx, y: cy });
        fileFolder.set(ch.path, '');
      }

      cx += ch.w + gap;
      rowH = Math.max(rowH, ch.h);
    }
  }

  function layoutSimpleGrid(paths){
    // SIMPLE GRID LAYOUT - Shelf packing algorithm (NFDH - Next-Fit Decreasing Height)
    // Like stacking books on shelves - no overlaps guaranteed!
    for(const [, el] of folders){ el.remove(); }
    folders.clear(); filePos.clear(); fileFolder.clear();

    if(paths.length === 0) return;

    // Calculate tile sizes based on aspect ratios
    const tileSizes = paths.map(p => {
      const size = calculateTileSize(p);
      return { path: p, ...size };
    });

    // Sort by height descending (tallest first for better packing)
    tileSizes.sort((a, b) => b.h - a.h);

    console.log(`📐 [layoutSimpleGrid] ${paths.length} tiles with shelf-packing (NFDH)`);
    console.log(`   Sample sizes:`, tileSizes.slice(0, 3).map(t => `${t.path.split('/').pop()}: ${t.w}x${t.h}`));

    const gap = 40;
    const containerWidth = 4800; // Virtual canvas width for pan/zoom

    let shelfX = gap;      // Current X position in this shelf
    let shelfY = gap;      // Y position of current shelf
    let shelfHeight = 0;   // Height of tallest tile in current shelf
    let shelfCount = 0;

    for(const tileInfo of tileSizes){
      // Check if tile fits in current shelf
      if(shelfX > gap && shelfX + tileInfo.w + gap > containerWidth){
        // Tile doesn't fit - start new shelf below
        shelfX = gap;
        shelfY += shelfHeight + gap;
        shelfHeight = 0;
        shelfCount++;
      }

      // Place tile at current position
      filePos.set(tileInfo.path, {
        x: shelfX,
        y: shelfY,
        w: tileInfo.w,
        h: tileInfo.h
      });
      fileFolder.set(tileInfo.path, '');

      // Update shelf state
      shelfX += tileInfo.w + gap;
      shelfHeight = Math.max(shelfHeight, tileInfo.h);
    }

    const finalHeight = shelfY + shelfHeight + gap;

    console.log(`✅ [layoutSimpleGrid] Shelf-packing complete`);
    console.log(`   Shelves: ${shelfCount + 1}`);
    console.log(`   Canvas: ${containerWidth}x${finalHeight.toFixed(0)}px`);
    console.log(`   Efficiency: ${((tileSizes.reduce((s,t) => s + t.w*t.h, 0) / (containerWidth * finalHeight)) * 100).toFixed(1)}% filled`);
  }

  function layoutTreemap(paths){
    // Spiral/curved packing treemap - fills organically in swooping patterns
    // Clear old containers/positions
    for(const [, el] of folders){ el.remove(); }
    folders.clear(); filePos.clear(); fileFolder.clear();

    // Gather files with sizes from metadata (NOT from rendered chunks)
    // fileMeta contains the TOTAL line_count from the index/database
    const items = [];
    for(const p of paths){
      const meta = fileMeta.get(p) || {line_count: 1, size_bytes: 1};
      const size = sizeByBytes ? Math.max(1, meta.size_bytes || 1) : Math.max(1, meta.line_count || 1);
      items.push({
        path: p,
        size: size  // Using TOTAL line count, not chunk size
      });
    }

    if(items.length === 0) return;

    // Sort by size descending (largest first for better packing)
    items.sort((a, b) => b.size - a.size);

    // Calculate total area and determine base tile size
    const totalSize = items.reduce((sum, item) => sum + item.size, 0);
    const minTileW = 250, minTileH = 180; // Increased minimums for better text visibility
    const maxTileW = 2200, maxTileH = 1571;
    const gap = 20;

    // DEBUG: Log size distribution
    if(items.length > 0){
      const sizes = items.map(i => i.size);
      console.log('📊 [Treemap] Size stats:', {
        min: Math.min(...sizes),
        max: Math.max(...sizes),
        avg: totalSize / items.length,
        total: totalSize,
        count: items.length,
        sizeBy: sizeByBytes ? 'bytes' : 'lines',
        samples: items.slice(0, 5).map(i => ({
          path: i.path.split('/').pop(),
          size: i.size,
          meta: fileMeta.get(i.path)
        }))
      });
    }

    // Assign sizes based on relative size (better scaling without sqrt compression)
    const sizedItems = items.map(item => {
      const meta = fileMeta.get(item.path) || {};

      // For images, use aspect ratio to determine base dimensions
      if(meta.is_binary && meta.preview_width && meta.preview_height){
        const aspect = meta.preview_width / meta.preview_height;
        const ratio = item.size / totalSize;
        const scale = Math.max(0.5, Math.min(4.0, Math.pow(ratio * items.length * 2, 0.6)));

        // Apply aspect ratio to base size
        let w, h;
        if(aspect > 1.5){
          // Wide landscape
          w = Math.max(minTileW, Math.min(maxTileW, minTileW * scale * 1.3));
          h = Math.max(minTileH, Math.min(maxTileH, minTileH * scale * 0.8));
        } else if(aspect > 1.0){
          // Landscape
          w = Math.max(minTileW, Math.min(maxTileW, minTileW * scale * 1.1));
          h = Math.max(minTileH, Math.min(maxTileH, minTileH * scale * 0.9));
        } else if(aspect < 0.7){
          // Tall portrait
          w = Math.max(minTileW, Math.min(maxTileW, minTileW * scale * 0.7));
          h = Math.max(minTileH, Math.min(maxTileH, minTileH * scale * 1.3));
        } else if(aspect < 1.0){
          // Portrait
          w = Math.max(minTileW, Math.min(maxTileW, minTileW * scale * 0.8));
          h = Math.max(minTileH, Math.min(maxTileH, minTileH * scale * 1.1));
        } else {
          // Square
          w = Math.max(minTileW, Math.min(maxTileW, minTileW * scale));
          h = Math.max(minTileH, Math.min(maxTileH, minTileH * scale));
        }
        return { ...item, w, h, x: 0, y: 0 };
      }

      // For text files, use standard calculation
      const ratio = item.size / totalSize;
      const scale = Math.max(0.5, Math.min(4.0, Math.pow(ratio * items.length * 2, 0.6)));
      const w = Math.max(minTileW, Math.min(maxTileW, minTileW * scale));
      const h = Math.max(minTileH, Math.min(maxTileH, minTileH * scale));
      return { ...item, w, h, x: 0, y: 0 };
    });

    // Calculate target square layout
    let totalArea = 0;
    for(const item of sizedItems){
      totalArea += (item.w + gap) * (item.h + gap);
    }
    const targetWidth = Math.sqrt(totalArea * 1.0); // Square aspect ratio

    // Spiral/curved packing algorithm
    // Track occupied regions as rectangles
    const placed = [];

    function intersects(x, y, w, h){
      for(const p of placed){
        if(!(x + w <= p.x || x >= p.x + p.w || y + h <= p.y || y >= p.y + p.h)){
          return true;
        }
      }
      return false;
    }

    // Find best position using spiral search pattern
    function findBestPosition(w, h){
      const candidates = [];

      // Try corners of existing items (organic filling)
      for(const p of placed){
        // Below
        candidates.push({ x: p.x, y: p.y + p.h + gap, dist: p.x + (p.y + p.h) });
        // Right
        candidates.push({ x: p.x + p.w + gap, y: p.y, dist: (p.x + p.w) + p.y });
        // Diagonal (below-right)
        candidates.push({ x: p.x + p.w + gap, y: p.y + p.h + gap, dist: (p.x + p.w) + (p.y + p.h) });
        // Below-left of right edge (fills gaps)
        candidates.push({ x: p.x, y: p.y + p.h + gap, dist: p.x + (p.y + p.h) });
      }

      // Sort by distance from origin (prefer top-left)
      candidates.sort((a, b) => a.dist - b.dist);

      // Find first non-intersecting position within target width
      for(const c of candidates){
        if(c.x + w <= targetWidth && !intersects(c.x, c.y, w, h)){
          return { x: c.x, y: c.y };
        }
      }

      // Fallback: find next available position in grid
      let testY = 0;
      while(testY < 20000){ // Reasonable limit
        let testX = 0;
        while(testX < targetWidth){
          if(!intersects(testX, testY, w, h)){
            return { x: testX, y: testY };
          }
          testX += gap;
        }
        testY += gap;
      }

      return { x: 0, y: 0 }; // Ultimate fallback
    }

    // Place items using spiral pattern
    for(const item of sizedItems){
      let pos;
      if(placed.length === 0){
        // First item at origin
        pos = { x: 0, y: 0 };
      } else {
        pos = findBestPosition(item.w, item.h);
      }

      item.x = pos.x;
      item.y = pos.y;
      placed.push({ x: pos.x, y: pos.y, w: item.w, h: item.h });

      // Place tile with size information
      filePos.set(item.path, { x: item.x, y: item.y, w: item.w, h: item.h });
      fileFolder.set(item.path, ''); // No folders in treemap mode
    }
  }

  function layoutTreemapWithFolders(root){
    // Treemap with folder structure - variable file sizes based on metric
    for(const [, el] of folders){ el.remove(); }
    folders.clear(); filePos.clear(); fileFolder.clear();

    const gap = 40, pad = 30, header = 0;
    const maxRow = 2400; // wrap width

    // Track depth for alignment padding
    const depthMap = new Map();
    function calculateDepth(node, depth = 0){
      if(node.path) depthMap.set(node.path, depth);
      for(const [name, sub] of node.folders){
        calculateDepth(sub, depth + 1);
      }
      for(const f of node.files){
        depthMap.set(f, depth);
      }
    }
    calculateDepth(root, 0);

    function layoutNode(node, ox, oy, render=true, nodeDepth=0){
      // Compute child boxes with variable sizes for files
      const children = [];

      // Add folders first
      for(const [name, sub] of node.folders){
        const subDepth = depthMap.get(sub.path) || nodeDepth + 1;
        const size = layoutNode(sub, 0, 0, false, subDepth); // measure only
        children.push({ type:'folder', node: sub, w: size.w, h: size.h, depth: subDepth });
      }

      // Add files with treemap sizing (uses TOTAL line count from metadata, NOT chunk size)
      for(const fp of node.files){
        const meta = fileMeta.get(fp) || {line_count: 1, size_bytes: 1};
        const size = sizeByBytes ? Math.max(1, meta.size_bytes || 1) : Math.max(1, meta.line_count || 1);
        const totalSize = node.files.reduce((sum, p) => {
          const m = fileMeta.get(p) || {line_count: 1, size_bytes: 1};
          return sum + (sizeByBytes ? (m.size_bytes || 1) : (m.line_count || 1));
        }, 0);

        // Better scaling without sqrt compression
        const ratio = size / totalSize;
        const scale = Math.max(0.5, Math.min(4.0, Math.pow(ratio * node.files.length * 2, 0.6)));
        const w = Math.max(250, Math.min(1400, 400 * scale)); // Increased minimum
        const h = Math.max(180, Math.min(1000, 300 * scale)); // Increased minimum

        const fileDepth = depthMap.get(fp) || nodeDepth;
        children.push({ type:'file', path: fp, w, h, depth: fileDepth });
      }

      if(node !== root && children.length === 0){
        children.push({ type:'spacer', w: 400, h: 300 });
      }

      // Position children within this container
      const labelPadX = 0;
      let x = pad + labelPadX, y = pad + header, rowH = 0, innerW = 0;

      // First pass: initial positioning
      for(const ch of children){
        if(x > pad + labelPadX && x + ch.w > pad + labelPadX + maxRow){
          x = pad + labelPadX; y += rowH + gap; rowH = 0;
        }
        ch.x = x; ch.y = y;
        x += ch.w + gap;
        rowH = Math.max(rowH, ch.h);
        innerW = Math.max(innerW, ch.x + ch.w);
      }

      // Second pass: align items by depth within each row
      // Group children by row (Y position)
      const rows = new Map();
      for(const ch of children){
        if(!rows.has(ch.y)) rows.set(ch.y, []);
        rows.get(ch.y).push(ch);
      }

      // For each row, find max depth and add padding to shallower items
      // Depth padding = folder padding (30) + border (2) + label visual space (~8)
      const DEPTH_PADDING = pad + 10; // ~40px per depth level
      for(const [rowY, rowItems] of rows){
        const maxDepthInRow = Math.max(...rowItems.map(item => item.depth || 0));
        for(const item of rowItems){
          const depthDiff = maxDepthInRow - (item.depth || 0);
          if(depthDiff > 0){
            // Add top padding to align with deeper neighbors
            item.alignPadY = depthDiff * DEPTH_PADDING;
            item.y += item.alignPadY;
          }
        }
      }

      // Calculate innerH as max of all children's bottom (accounting for alignment)
      let innerH = pad + header;
      for(const ch of children){
        innerH = Math.max(innerH, ch.y + ch.h);
      }
      const W = Math.max(innerW + pad, 400 + 2*pad + labelPadX);
      const H = Math.max(innerH + pad, header + 2*pad + 300);

      // Render container (skip root)
      if(render && node !== root){
        const div = document.createElement('div');
        div.className = 'folder';
        div.style.left = `${ox}px`;
        div.style.top = `${oy}px`;
        div.style.width = `${W}px`;
        div.style.height = `${H}px`;
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = node.path || node.name;
        div.appendChild(label);
        canvas.appendChild(div);
        folders.set(node.path, div);
      }

      // Assign child positions
      for(const ch of children){
        if(ch.type === 'folder'){
          layoutNode(ch.node, ox + ch.x, oy + ch.y, render);
        }else if(ch.type === 'file'){
          if(render){
            filePos.set(ch.path, { x: ox + ch.x, y: oy + ch.y, w: ch.w, h: ch.h });
            const parent = node.path || '';
            fileFolder.set(ch.path, parent);
          }
        }
      }
      return { w: W, h: H };
    }

    // Layout root's children in rows across the canvas
    let cx = 0, cy = 0, rowH = 0;
    const topChildren = [];
    for(const [name, sub] of root.folders){
      const subDepth = depthMap.get(sub.path) || 1;
      topChildren.push({type:'folder', node: sub, depth: subDepth});
    }
    for(const f of root.files){
      const meta = fileMeta.get(f) || {line_count: 1, size_bytes: 1};
      const size = sizeByBytes ? Math.max(1, meta.size_bytes || 1) : Math.max(1, meta.line_count || 1);
      const ratio = Math.sqrt(size / 1000); // Normalize to reasonable scale
      const scale = Math.max(0.5, Math.min(2.0, ratio * 5));
      const w = Math.max(300, Math.min(800, 400 * scale));
      const h = Math.max(200, Math.min(600, 300 * scale));
      const fileDepth = depthMap.get(f) || 0;
      topChildren.push({type:'file', path: f, w, h, depth: fileDepth});
    }

    // Position items and track rows
    const rootPositions = [];
    for(const ch of topChildren){
      if(ch.type === 'folder'){
        const size = layoutNode(ch.node, 0, 0, false, ch.depth); // measure
        if(cx > 0 && cx + size.w > 3200){ cx = 0; cy += rowH + gap; rowH = 0; }
        ch.x = cx; ch.y = cy;
        ch.w = size.w; ch.h = size.h;
        rootPositions.push(ch);
        rowH = Math.max(rowH, size.h); cx += size.w + gap;
      }else{
        // Root-level file
        if(cx > 0 && cx + ch.w + 2*pad > 3200){ cx = 0; cy += rowH + gap; rowH = 0; }
        ch.x = cx + pad; ch.y = cy + pad + header;
        rootPositions.push(ch);
        cx += (ch.w + 2*pad) + gap; rowH = Math.max(rowH, ch.h + 2*pad + header);
      }
    }

    // Align root items by depth (same as nested items)
    // Group by approximate Y with smaller bucket size for better accuracy
    const rootRows = new Map();
    for(const ch of rootPositions){
      const rowKey = Math.floor(ch.y / 40) * 40; // Group by 40px buckets (gap size)
      if(!rootRows.has(rowKey)) rootRows.set(rowKey, []);
      rootRows.get(rowKey).push(ch);
    }

    const DEPTH_PADDING = pad + 10; // ~40px per depth level (matches nested items)
    for(const [rowKey, rowItems] of rootRows){
      const maxDepthInRow = Math.max(...rowItems.map(item => item.depth || 0));
      for(const item of rowItems){
        const depthDiff = maxDepthInRow - (item.depth || 0);
        if(depthDiff > 0){
          item.alignPadY = depthDiff * DEPTH_PADDING;
          item.y += item.alignPadY;
        }
      }
    }

    // Final render with aligned positions
    for(const ch of rootPositions){
      if(ch.type === 'folder'){
        layoutNode(ch.node, ch.x, ch.y, true, ch.depth); // render with aligned position
      }else{
        filePos.set(ch.path, { x: ch.x, y: ch.y, w: ch.w, h: ch.h });
        fileFolder.set(ch.path, '');
      }
    }
  }

  // Search on Enter key
  qEl.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){
      e.preventDefault();
      doSearch();
    }
  });

  // Search on input (debounced)
  let searchTimer = null;
  qEl.addEventListener('input', ()=>{
    if(searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(()=> doSearch(), 300);
  });

  // Clear search button
  if(clearSearchBtn){
    // Show/hide based on input value
    const updateClearBtnVisibility = () => {
      if(qEl.value.trim()){
        clearSearchBtn.style.opacity = '0.6';
        clearSearchBtn.style.pointerEvents = 'all';
      } else {
        clearSearchBtn.style.opacity = '0';
        clearSearchBtn.style.pointerEvents = 'none';
      }
    };

    // Update on input
    qEl.addEventListener('input', updateClearBtnVisibility);

    // Click handler
    clearSearchBtn.onclick = ()=>{
      console.log('🧹 [clearSearch] Clearing search');
      qEl.value = '';
      updateClearBtnVisibility();
      doSearch(); // Triggers overview rendering in results-only mode
    };

    // Initial state
    updateClearBtnVisibility();
  }

  // Browse folders button
  if(browseFoldersBtn && pathFilterInput){
    browseFoldersBtn.onclick = async () => {
      console.log('📁 [browseFolders] Opening folder browser');
      const selectedPath = await showFolderBrowser();
      if(selectedPath){
        pathFilterInput.value = selectedPath;
        console.log(`📁 [browseFolders] Selected: ${selectedPath}`);
        if(qEl.value.trim()){
          doSearch(); // Apply new path filter to search
        } else if(resultsOnlyMode){
          // Empty search: update overview with selected folder
          renderCodebaseOverview();
        }
      }
    };
  }

  // Path filter input - re-search or update overview when changed
  if(pathFilterInput){
    pathFilterInput.addEventListener('input', ()=>{
      console.log('🔍 [pathFilter] Input changed:', pathFilterInput.value);
      if(searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(()=> {
        const hasQuery = qEl.value.trim();
        console.log(`🔍 [pathFilter] Timer fired - hasQuery: ${!!hasQuery}, resultsOnlyMode: ${resultsOnlyMode}`);

        if(hasQuery){
          console.log('   → Calling doSearch()');
          doSearch(); // Re-run search with new path filter
        } else if(resultsOnlyMode){
          // Empty search: update overview with new filter
          console.log('   → Calling renderCodebaseOverview()');
          renderCodebaseOverview();
        } else {
          console.log('   → NOT in results-only mode, skipping overview update');
        }
      }, 300);
    });

    pathFilterInput.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){
        e.preventDefault();
        if(qEl.value.trim()){
          doSearch();
        }
      }
    });
  }

  // Path exclude input - re-search or update overview when changed
  if(pathExcludeInput){
    pathExcludeInput.addEventListener('input', ()=>{
      console.log('🚫 [pathExclude] Input changed:', pathExcludeInput.value);
      if(searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(()=> {
        const hasQuery = qEl.value.trim();
        console.log(`🚫 [pathExclude] Timer fired - hasQuery: ${!!hasQuery}, resultsOnlyMode: ${resultsOnlyMode}`);

        if(hasQuery){
          console.log('   → Calling doSearch()');
          doSearch(); // Re-run search with new exclude filter
        } else if(resultsOnlyMode){
          // Empty search: update overview with new filter
          console.log('   → Calling renderCodebaseOverview()');
          renderCodebaseOverview();
        } else {
          console.log('   → NOT in results-only mode, skipping overview update');
        }
      }, 300);
    });

    pathExcludeInput.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){
        e.preventDefault();
        if(qEl.value.trim()){
          doSearch();
        }
      }
    });
  }

  // ==================== Input History Focus/Blur Handlers ====================
  // Show history panel on focus, hide on blur
  qEl.addEventListener('focus', () => {
    showHistoryPanel(qEl, HISTORY_KEYS.search, (value) => {
      qEl.value = value;
      doSearch();
    });
  });

  qEl.addEventListener('blur', () => {
    // Delay to allow clicks on panel
    setTimeout(() => {
      if (!currentHistoryPanel || !currentHistoryPanel.matches(':hover')) {
        hideHistoryPanel();
      }
    }, 150);
  });

  if (pathFilterInput) {
    pathFilterInput.addEventListener('focus', () => {
      showHistoryPanel(pathFilterInput, HISTORY_KEYS.path, (value) => {
        pathFilterInput.value = value;
        console.log(`📋 [history] Path filter set to: ${value}`);
        if (qEl.value.trim()) {
          doSearch();
        } else if(resultsOnlyMode){
          // Empty search: update overview with selected path
          console.log('   → Updating overview');
          renderCodebaseOverview();
        }
      });
    });

    pathFilterInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (!currentHistoryPanel || !currentHistoryPanel.matches(':hover')) {
          hideHistoryPanel();
        }
      }, 150);
    });
  }

  if (pathExcludeInput) {
    pathExcludeInput.addEventListener('focus', () => {
      showHistoryPanel(pathExcludeInput, HISTORY_KEYS.exclude, (value) => {
        pathExcludeInput.value = value;
        console.log(`📋 [history] Exclude filter set to: ${value}`);
        if (qEl.value.trim()) {
          doSearch();
        } else if(resultsOnlyMode){
          // Empty search: update overview with exclude filter
          console.log('   → Updating overview');
          renderCodebaseOverview();
        }
      });
    });

    pathExcludeInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (!currentHistoryPanel || !currentHistoryPanel.matches(':hover')) {
          hideHistoryPanel();
        }
      }, 150);
    });
  }

  // Close history panel when clicking outside
  document.addEventListener('click', (e) => {
    if (currentHistoryPanel &&
        !currentHistoryPanel.contains(e.target) &&
        e.target !== qEl &&
        e.target !== pathFilterInput &&
        e.target !== pathExcludeInput) {
      hideHistoryPanel();
    }
  });
  // ==================== End Input History Handlers ====================

  // Content search toggle
  if(contentToggleBtn){
    contentToggleBtn.onclick = ()=>{
      // Prevent disabling if name is also disabled (need at least one)
      if(contentSearchEnabled && !nameSearchEnabled){
        showToast('At least one search field must be enabled');
        return;
      }
      contentSearchEnabled = !contentSearchEnabled;
      contentToggleBtn.classList.toggle('active', contentSearchEnabled);
      console.log(`🔍 Content search: ${contentSearchEnabled ? 'ON' : 'OFF'}`);
      if(qEl.value.trim()){
        doSearch(); // Re-run search with new field selection
      }
    };
  }

  // Name search toggle
  if(nameToggleBtn){
    nameToggleBtn.onclick = ()=>{
      // Prevent disabling if content is also disabled (need at least one)
      if(nameSearchEnabled && !contentSearchEnabled){
        showToast('At least one search field must be enabled');
        return;
      }
      nameSearchEnabled = !nameSearchEnabled;
      nameToggleBtn.classList.toggle('active', nameSearchEnabled);
      console.log(`🔍 Name search: ${nameSearchEnabled ? 'ON' : 'OFF'}`);
      if(qEl.value.trim()){
        doSearch(); // Re-run search with new field selection
      }
    };
  }

  // Binary files toggle
  if(binaryToggleBtn){
    binaryToggleBtn.onclick = ()=>{
      showBinaries = !showBinaries;
      binaryToggleBtn.classList.toggle('active', showBinaries);
      console.log(`📦 Binary files: ${showBinaries ? 'SHOWN' : 'HIDDEN'}`);
      if(qEl.value.trim()){
        doSearch(); // Re-run search to apply filter
      } else if(resultsOnlyMode){
        // Empty search: update overview with new binary filter
        console.log('   → Calling renderCodebaseOverview() for binary toggle');
        renderCodebaseOverview();
      }
    };
  }

  // Deleted files toggle
  if(deletedToggleBtn){
    deletedToggleBtn.onclick = ()=>{
      deletedMode = !deletedMode;
      deletedToggleBtn.classList.toggle('active', deletedMode);
      if(qEl.value.trim()){
        doSearch(); // Re-run search with new deleted setting
      }
    };
  }

  // Partial match toggle
  if(partialToggleBtn){
    partialToggleBtn.onclick = ()=>{
      partialMode = !partialMode;
      partialToggleBtn.classList.toggle('active', partialMode);
      if(qEl.value.trim()){
        doSearch(); // Re-run search with new partial setting
      }
    };
  }

  // Fuzzy search toggle
  if(fuzzyToggleBtn){
    fuzzyToggleBtn.onclick = ()=>{
      fuzzyMode = !fuzzyMode;
      fuzzyToggleBtn.classList.toggle('active', fuzzyMode);
      if(qEl.value.trim()){
        doSearch(); // Re-run search with new fuzzy setting
      }
    };
  }

  // Results Only toggle
  if(resultsOnlyBtn){
    // Set initial state based on URL params
    resultsOnlyBtn.classList.toggle('active', resultsOnlyMode);

    resultsOnlyBtn.onclick = async ()=>{
      resultsOnlyMode = !resultsOnlyMode;
      resultsOnlyBtn.classList.toggle('active', resultsOnlyMode);

      if(resultsOnlyMode){
        //showToast('Results Only mode: showing only search results');
        // If there's a search query, trigger re-render with results
        if(qEl.value.trim()){
          await doSearch();
        } else {
          // No search query - show message
          resultsEl.innerHTML = '<div class="results-count" style="color: #888;">Enter a search query to see results</div>';
          // Clear canvas
          for(const [p, tile] of tiles){ tile.remove(); }
          tiles.clear(); tileContent.clear(); filePos.clear(); fileFolder.clear(); fileLanguages.clear();
          for(const [, el] of folders){ el.remove(); } folders.clear();
        }
      } else {
        showToast('Show All mode: displaying entire codebase');
        // Switch to showing all files
        await refreshAllTiles(currentAsOfMs);
        // If there was a search, re-apply dimming
        if(qEl.value.trim()){
          await doSearch();
        }
      }
    };
  }

  // Sidebar Resizer
  let sidebarWidth = 445; // Initial width
  const minSidebarWidth = 280;
  const maxSidebarWidth = 800;
  const sidebarEl = document.getElementById('sidebar');
  const sidebarResizer = document.getElementById('sidebarResizer');
  const workspaceEl = document.getElementById('workspace');
  const filterPanelsContainer = document.getElementById('filterPanelsContainer');

  if(sidebarResizer){
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    sidebarResizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = sidebarWidth;
      sidebarResizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if(!isResizing) return;

      const delta = e.clientX - startX;
      let newWidth = startWidth + delta;

      // Enforce limits
      newWidth = Math.max(minSidebarWidth, Math.min(maxSidebarWidth, newWidth));

      // Update sidebar width
      sidebarWidth = newWidth;
      sidebarEl.style.width = `${newWidth}px`;

      // Workspace stays at left: 0 (renders under sidebar)
      // workspaceEl.style.left = `${newWidth + 10}px`;

      // Update filter panels container left position
      filterPanelsContainer.style.left = `${newWidth - 10}px`;
      filterPanelsContainer.style.background = bgt;

      // Update search bar and workspace position
      adjustSearchBarLeft();
    });

    document.addEventListener('mouseup', () => {
      if(isResizing){
        isResizing = false;
        sidebarResizer.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }


  // Follow CLI toggle
  followCliBtn.onclick = ()=>{
    followCliMode = !followCliMode;
    followCliBtn.classList.toggle('active', followCliMode);

    // Hide/show search container when Follow CLI is toggled
    if(searchContainer) searchContainer.classList.toggle('hidden', followCliMode);
    qEl.disabled = followCliMode;

    if(!followCliMode){
      resultsEl.innerHTML='';
      for(const [,tile] of tiles){ tile.classList.remove('dim'); }
      for(const [,el] of folders){ el.classList.remove('dim'); }
      // Clear tracking sets
      if(window._dimmedTiles) window._dimmedTiles.clear();
      if(window._dimmedFolders) window._dimmedFolders.clear();
    }
  };

  // Follow Updates toggle
  followUpdatesBtn.onclick = ()=>{
    followUpdatesMode = !followUpdatesMode;
    followUpdatesBtn.classList.toggle('active', followUpdatesMode);
    if(followUpdatesMode){
      showToast('Following file updates');
    } else {
      showToast('Stopped following updates');
    }
  };

  // Dynamic Text toggle
  if(dynTextBtn){
    // Set initial state (defaults to ON)
    dynTextBtn.classList.toggle('active', dynTextMode);

    dynTextBtn.onclick = ()=>{
      dynTextMode = !dynTextMode;
      dynTextBtn.classList.toggle('active', dynTextMode);

      // Reload all tiles with new font sizes
      for(const [path, tile] of tiles){
        // Reload if we have content OR if tile is visible
        if(tileContent.has(path) || tile.querySelector('.body')){
          loadTileContent(path).catch(e => {/* ignore */});
        }
      }

      // Update overlay editor if open
      if(overlayEditor && overlayEditor.getModel){
        try{
          const model = overlayEditor.getModel();
          if(model){
            const lineCount = model.getLineCount();
            const fontSize = calculateDynamicFontSize(lineCount);
            overlayEditor.updateOptions({ fontSize: fontSize });
          }
        }catch(e){
          // Ignore errors
        }
      }

      showToast(dynTextMode ? 'Dynamic text sizing enabled' : 'Dynamic text sizing disabled');
    };
  }

  // Overlay editor controls
  if(saveOverlayBtn){
    saveOverlayBtn.onclick = ()=> saveOverlayEditor();
  }
  if(cancelOverlayBtn){
    cancelOverlayBtn.onclick = ()=> closeOverlayEditor();
  }

  // Diff overlay controls
  if(closeDiffBtn){
    closeDiffBtn.onclick = ()=> closeDiffEditor();
  }
  if(restoreDiffBtn){
    restoreDiffBtn.onclick = ()=> showRestoreConfirmation();
  }

  // Confirmation modal controls
  if(confirmRestoreBtn){
    confirmRestoreBtn.onclick = ()=> restoreHistoricalVersion();
  }
  if(cancelRestoreBtn){
    cancelRestoreBtn.onclick = ()=> {
      confirmModalEl.style.display = 'none';
    };
  }

  // Double-click on tiles: open editor (live) or diff (historical)
  canvas.addEventListener('dblclick', (e)=>{
    const tileEl = e.target.closest('.tile');
    if(!tileEl) return;
    // Find path for this tile
    for(const [path, tile] of tiles){
      if(tile === tileEl){
        if(currentAsOfMs != null){
          // Historical mode: open diff editor
          openDiffEditor(path);
        } else {
          // Live mode: open overlay editor
          openOverlayEditor(path);
        }
        break;
      }
    }
  });

  // Treemap Mode toggle
  if(treemapModeBtn){
    treemapModeBtn.onclick = async ()=>{
      treemapMode = !treemapMode;
      treemapModeBtn.classList.toggle('active', treemapMode);

      // Show/hide sub-toggles
      if(treemapFoldersBtn) treemapFoldersBtn.style.display = treemapMode ? 'inline-block' : 'none';

      if(treemapMode){
        showToast('Treemap mode enabled');
      } else {
        showToast('Treemap mode disabled');
        // Reset sub-toggles when disabled
        treemapFoldersMode = false;
        if(treemapFoldersBtn) treemapFoldersBtn.classList.remove('active');
      }

      // Re-layout with current file set
      await refreshAllTiles(currentAsOfMs);

      // Auto-load content for all visible tiles in treemap mode
      if(treemapMode){
        console.log('📊 [Treemap] Auto-loading content for all tiles...');
        const tilePaths = Array.from(tiles.keys());

        // Load in batches to avoid overwhelming the browser
        const batchSize = 20;
        for(let i = 0; i < tilePaths.length; i += batchSize){
          const batch = tilePaths.slice(i, i + batchSize);
          await Promise.all(batch.map(async path => {
            if(!tileContent.has(path)){
              try{
                await loadTileContent(path);
              }catch(e){
                console.error('Failed to load tile content:', path, e);
              }
            }
          }));
          // Small delay between batches
          if(i + batchSize < tilePaths.length){
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        console.log('✅ [Treemap] All tiles loaded');
      }
    };
  }

  // Treemap Folders sub-toggle
  if(treemapFoldersBtn){
    treemapFoldersBtn.onclick = async ()=>{
      treemapFoldersMode = !treemapFoldersMode;
      treemapFoldersBtn.classList.toggle('active', treemapFoldersMode);
      showToast(treemapFoldersMode ? 'Showing folders' : 'Flat treemap');
      // Re-layout with current file set
      await refreshAllTiles(currentAsOfMs);

      // Auto-load content for all visible tiles when folders mode is enabled
      if(treemapFoldersMode && treemapMode){
        console.log('📊 [Treemap Folders] Auto-loading content for all tiles...');
        const tilePaths = Array.from(tiles.keys());

        // Load in batches to avoid overwhelming the browser
        const batchSize = 20;
        for(let i = 0; i < tilePaths.length; i += batchSize){
          const batch = tilePaths.slice(i, i + batchSize);
          await Promise.all(batch.map(async path => {
            if(!tileContent.has(path)){
              try{
                await loadTileContent(path);
              }catch(e){
                console.error('Failed to load tile content:', path, e);
              }
            }
          }));
          // Small delay between batches
          if(i + batchSize < tilePaths.length){
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        console.log('✅ [Treemap Folders] All tiles loaded');
      }
    };
  }

  // Size by Bytes toggle removed - now always uses bytes (const sizeByBytes = true)

  // startWatch.onclick = async ()=>{
  //   try{
  //     await fetchJSON('/index/start', {method:'POST'});
  //     await refreshStatus();
  //     showToast('Watcher started');
  //   }catch(e){
  //     showToast('Failed to start watcher');
  //   }
  // };
  // stopWatch.onclick = async ()=>{
  //   try{
  //     await fetchJSON('/index/stop', {method:'POST'});
  //     await refreshStatus();
  //     showToast('Watcher stopped');
  //   }catch(e){
  //     showToast('Failed to stop watcher');
  //   }
  // };
  if(goLiveBtn){
    goLiveBtn.onclick = async ()=>{
      try{
        console.debug('[rewindex-ui] Go Live clicked');
        currentAsOfMs = null;
        asofLabel.textContent = 'Live';
        await refreshAllTiles(null);
        updateSparkTick();
        if(!followCliMode && qEl.value) await doSearch();
        if(typeof showToast === 'function') showToast('Live');
      }catch(err){
        console.error('Go Live failed', err);
        try{ showToast('Live failed'); }catch(e){}
      }
    };
  }
  refreshStatus();
  spawnAll();

  // Live updates via SSE
  try{
    const esrc = new EventSource('/events/indexing');
    esrc.addEventListener('watcher', ()=> { refreshStatus(); refreshTimeline(); });
    esrc.addEventListener('index', ()=> { refreshStatus(); refreshTimeline(); });
    esrc.addEventListener('query', async (ev)=>{
      try{
        const data = JSON.parse(ev.data || '{}');
        const payload = data.payload || data;

        // Update project root if provided by CLI (regardless of follow mode)
        let projectJustChanged = false;
        if(payload.project_root && payload.project_root !== currentProjectRoot){
          console.log('[beads DEBUG] CLI project_root changed from', currentProjectRoot, 'to', payload.project_root);
          currentProjectRoot = payload.project_root;
          projectJustChanged = true;
          // DISABLED: Beads integration
          // if(beadsAvailable){
          //   console.log('[beads DEBUG] Refreshing beads tickets for new project');
          //   refreshBeadsTickets();
          // }
          // Refresh file list and layout for the new project (in follow mode only)
          if(followCliMode){
            console.log('[follow mode] Refreshing tiles for new project');
            refreshStatus(); // Update status to new project
            await refreshAllTiles(null); // Reload file list and layout
          }
        }

        if(!followCliMode) return;

        if(payload.query !== undefined) qEl.value = payload.query;
        // Align timeline to incoming query time (default live)
        const filt = payload.filters || {};
        let newAsOf = null;
        if(filt.as_of){
          try{ newAsOf = Date.parse(filt.as_of); }catch(e){ newAsOf = null; }
        }

        if(newAsOf==null){
          // live - only refresh if project didn't already change
          currentAsOfMs = null;
          asofLabel.textContent = 'Live';
          updateSparkTick();
          if(!projectJustChanged && currentAsOfMs !== null){
            // Was on a temporal view, now going live
            await refreshAllTiles(null);
            currentAsOfMs = null;
          }
        }else{
          if(timelineMin!=null && timelineMax!=null){
            currentAsOfMs = newAsOf;
            try{ asofLabel.textContent = new Date(currentAsOfMs).toLocaleString(); }catch(e){ asofLabel.textContent = `${currentAsOfMs}`; }
            updateSparkTick();
            // Only refresh if project didn't already change (avoid double refresh)
            if(!projectJustChanged){
              await refreshAllTiles(currentAsOfMs);
            }
          }
        }
        const results = payload.results || [];
        renderResults(results);
      }catch(e){ /* ignore */ }
    });
    esrc.addEventListener('theme-update', (ev)=>{
      try{
        const data = JSON.parse(ev.data || '{}');
        const theme = data.theme || {};
        console.log(' [theme] Received theme update via SSE:', theme);
        console.log(' [theme] background_url from SSE:', theme.background_url);
        console.log(' [theme] background (raw path) from SSE:', theme.background);

        if(systemThemeEnabled && theme.colors){
          // ONLY use background_url (API endpoint), NEVER raw filesystem path
          const bgUrl = theme.background_url || null;
          if(theme.background && !theme.background_url){
            console.error(' [theme] ERROR: Received raw filesystem path instead of API URL!');
            console.error('   Raw path:', theme.background);
            console.error('   This will cause 404 errors. Server needs to send background_url.');
          }
          applySystemTheme(theme.colors, theme.syntax || {}, theme.font || {}, bgUrl, theme.terminal_colors);
        }
      }catch(e){
        console.error(' [theme] Error processing theme update:', e);
      }
    });
    esrc.addEventListener('file', (ev)=>{
      try{
        const data = JSON.parse(ev.data || '{}');
        const path = data.file_path || data.path;
        let action = data.action || 'updated';

        // Enhance action display for renames
        if(data.renamed_from){
          action = 'renamed from ' + data.renamed_from.split('/').pop(); // Show old filename
        } else if(data.renamed_to){
          action = 'renamed to ' + data.renamed_to.split('/').pop(); // Show new filename
        }

        // Spawn falling block if in overview mode AND page is visible
        // Skip block spawning when page is hidden to prevent lag from queued updates
        const isPageVisible = !document.hidden;
        if(!qEl.value.trim() && resultsOnlyMode){
          if(isPageVisible && typeof window.spawnFallingFileBlock === 'function'){
            window.spawnFallingFileBlock({
              file_path: path,
              language: data.language || 'text',
              action: action
            });
          } else if(!isPageVisible){
            // Track skipped updates while hidden
            hiddenUpdateCount++;
          }
        }

        if(path){
          // Track recent update
          recentUpdates.unshift({
            path: path,
            action: action,
            timestamp: Date.now()
          });
          // Keep only last MAX_RECENT_UPDATES
          if(recentUpdates.length > MAX_RECENT_UPDATES){
            recentUpdates.pop();
          }

          // Don't render recent updates panel - falling blocks show updates!
          // Instead, refresh overview and timeline (with debounce)
          if(!qEl.value.trim() && resultsOnlyMode && !followCliMode){
            if(overviewRefreshTimer) clearTimeout(overviewRefreshTimer);
            overviewRefreshTimer = setTimeout(() => {
              console.log('🔄 [file update] Refreshing overview + timeline');
              renderCodebaseOverview();
              refreshTimeline();
            }, 2000); // 2 second debounce
          }

          //showToast(`${action === 'added' ? 'Indexed' : 'Updated'}: ${path}`);
          refreshTileContent(path);
          flashTile(path, 'update');

          // Update timeline and trigger ripple (for non-overview modes)
          if(qEl.value.trim()){
            refreshTimeline().then(() => {
              setTimeout(() => triggerTimelineRipple(), 50);
            }).catch(() => {});
          }

          // Update language bar when files change
          updateLanguageBar();

          // Pan and zoom to file if Follow Updates is active
          if(followUpdatesMode){
            const tile = tiles.get(path);
            if(tile){
              centerOnTile(path, { zoomToFit: true });
              // Also load the content if not already loaded
              if(!tileContent.has(path)){
                loadTileContent(path);
              }
            }
          }
        }
      }catch(e){ /* ignore */ }
    });
  }catch(e){ /* SSE not supported? */ }

  // Page Visibility API: Clear falling blocks when tab becomes visible
  // This prevents lag from hundreds of queued blocks when returning to the tab
  let hiddenUpdateCount = 0;
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden){
      // Page became visible
      if(hiddenUpdateCount > 0){
        console.log(`👁️ [visibility] Page visible again. Skipped ${hiddenUpdateCount} falling blocks while hidden.`);
        hiddenUpdateCount = 0;

        // Clear any lingering blocks to ensure clean state
        if(typeof window.clearAllFallingBlocks === 'function'){
          window.clearAllFallingBlocks();
        }

        // Refresh overview to show current state
        if(!qEl.value.trim() && resultsOnlyMode){
          renderCodebaseOverview();
        }
      }
    } else {
      // Page became hidden
      console.log('👁️ [visibility] Page hidden. Falling blocks will be skipped.');
    }
  });

  async function refreshTimeline(){
    if(!sparklineEl) return;
    try{
      // Determine if we should show search-scoped timeline or global timeline
      // IMPORTANT: Use timelineFilePaths (base query) not lastSearchResults (time-filtered)
      const hasQuery = qEl && qEl.value && qEl.value.trim();
      const hasTimelineFiles = timelineFilePaths.length > 0;
      const isTimeTraveling = currentAsOfMs != null;

      // Show search-scoped timeline whenever we have timeline file paths
      // Timeline ALWAYS shows all time for these files (never filtered by currentAsOfMs)
      const hasActiveSearch = hasQuery && hasTimelineFiles;

      console.log(`🕐 [refreshTimeline] DEBUG:`, {
        hasQuery: !!hasQuery,
        queryValue: qEl?.value,
        hasTimelineFiles,
        timelineFileCount: timelineFilePaths.length,
        currentResultCount: lastSearchResults.length,
        isTimeTraveling,
        currentAsOfMs,
        hasActiveSearch
      });

      let url = '/timeline/stats';
      if(hasActiveSearch){
        // Search-scoped timeline: show only versions of files from BASE query (no time filter)
        // This ensures timeline shows full history even when time-traveling
        const pathsParam = encodeURIComponent(JSON.stringify(timelineFilePaths));
        url = `/timeline/stats?paths=${pathsParam}`;
        if(isTimeTraveling){
          console.log(`🕐 [refreshTimeline] Search-scoped (time-traveling): ${timelineFilePaths.length} files from base query, showing full history`);
        } else {
          console.log(`🕐 [refreshTimeline] Search-scoped: ${timelineFilePaths.length} files`);
        }
      } else {
        console.log(`🕐 [refreshTimeline] Global timeline (no active search)`);
      }

      console.log(`🕐 [refreshTimeline] Fetching: ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`);
      const s = await fetchJSON(url);
      console.log(`🕐 [refreshTimeline] Response:`, s);

      if(s && s.min && s.max){
        timelineMin = s.min; timelineMax = s.max;
        drawSparkline(s.series||[]);

        // Log timeline stats
        if(s.filtered){
          console.log(`🕐 [refreshTimeline] ✅ Filtered to ${s.file_count} files, ${s.bucket_count} buckets (${s.interval} interval)`);
        } else {
          console.log(`🕐 [refreshTimeline] ✅ Global: ${s.bucket_count} buckets (${s.interval} interval)`);
        }

        // Update tick position if we're in time-travel mode
        if(currentAsOfMs != null) updateSparkTick();
      } else {
        console.log(`🕐 [refreshTimeline] Empty response, drawing empty sparkline`);
        drawSparkline([]);
      }
    }catch(e){
      // Log errors for debugging
      console.error('[refreshTimeline] Error:', e);
    }
  }

  // Timeline init
  (async function initTimeline(){
    if(!sparklineEl) return;
    try{
      const s = await fetchJSON('/timeline/stats');
      if(s && s.min && s.max){
        timelineMin = s.min; timelineMax = s.max;
        drawSparkline(s.series||[]);
      } else {
        // Keep panel visible with empty sparkline
        drawSparkline([]);
      }
      asofLabel.textContent = 'Live';

      // Sparkline hover + click
      sparklineEl.addEventListener('mousemove', (ev)=>{
        const rect = sparklineEl.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const W = rect.width || 1;
        if(sparkKeys.length>0){
          const n = sparkKeys.length;
          const idx = Math.max(0, Math.min(n-1, Math.round((x/W) * (n-1))));
          const ts = sparkKeys[idx];
          if(ts!=null) asofLabel.textContent = new Date(ts).toLocaleString();
          const tickX = Math.round((idx/(n-1||1)) * W);
          if(sparkHover){ sparkHover.style.display='block'; sparkHover.style.left = `${tickX}px`; }
        } else {
          if(sparkHover){ sparkHover.style.display='block'; sparkHover.style.left = `${Math.round(x)}px`; }
        }
      });
      sparklineEl.addEventListener('mouseleave', ()=>{
        if(currentAsOfMs==null) asofLabel.textContent='Live'; else asofLabel.textContent=new Date(currentAsOfMs).toLocaleString();
        if(sparkHover) sparkHover.style.display='none';
      });
      sparklineEl.addEventListener('click', async (ev)=>{
        const rect = sparklineEl.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const W = rect.width || 1;
        let ts = null;
        if(sparkKeys.length>0){
          const n = sparkKeys.length;
          const idx = Math.max(0, Math.min(n-1, Math.round((x/W) * (n-1))));
          ts = sparkKeys[idx];
        } else if(timelineMin!=null && timelineMax!=null){
          const pct = Math.min(1, Math.max(0, x / W));
          ts = timelineMin + (timelineMax - timelineMin) * pct;
        }
        if(ts!=null){
          currentAsOfMs = Math.floor(ts);
          asofLabel.textContent = new Date(currentAsOfMs).toLocaleString();
          await refreshAllTiles(currentAsOfMs);
          updateSparkTick();
          if(!followCliMode && qEl.value) await doSearch();
        }
      });
    }catch(e){
      // Keep timeline visible even if stats endpoint fails
      drawSparkline([]);
      asofLabel.textContent = 'Live';
    }
  })();

  function triggerTimelineRipple(){
    // Create a ripple wave that travels from right to left across the timeline
    if(!sparklineEl) return;

    const svg = sparklineEl.querySelector('svg');
    if(!svg) return;

    // Limit number of concurrent ripples to prevent performance issues
    const existingRipples = svg.querySelectorAll('.timeline-ripple');
    if(existingRipples.length > 5){
      // Remove oldest ripple if too many
      existingRipples[0].remove();
    }

    const svgNS = 'http://www.w3.org/2000/svg';
    const viewBox = svg.getAttribute('viewBox');
    if(!viewBox) return;

    const [,,W, H] = viewBox.split(' ').map(Number);
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#39bae6';

    // Create gradient definition for the ripple (reuse defs if exists)
    let defs = svg.querySelector('defs');
    if(!defs){
      defs = document.createElementNS(svgNS, 'defs');
      svg.insertBefore(defs, svg.firstChild);
    }
    const gradientId = `ripple-gradient-${Date.now()}`;
    const gradient = document.createElementNS(svgNS, 'linearGradient');
    gradient.setAttribute('id', gradientId);
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('x2', '100%');

    // Gradient: transparent -> bright -> transparent
    const stop1 = document.createElementNS(svgNS, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', accentColor);
    stop1.setAttribute('stop-opacity', '0');

    const stop2 = document.createElementNS(svgNS, 'stop');
    stop2.setAttribute('offset', '50%');
    stop2.setAttribute('stop-color', accentColor);
    stop2.setAttribute('stop-opacity', '0.8');

    const stop3 = document.createElementNS(svgNS, 'stop');
    stop3.setAttribute('offset', '100%');
    stop3.setAttribute('stop-color', accentColor);
    stop3.setAttribute('stop-opacity', '0');

    gradient.appendChild(stop1);
    gradient.appendChild(stop2);
    gradient.appendChild(stop3);
    defs.appendChild(gradient);

    // Create ripple rectangle
    const rippleWidth = W * 0.2; // 20% of timeline width
    const ripple = document.createElementNS(svgNS, 'rect');
    ripple.setAttribute('class', 'timeline-ripple');
    ripple.setAttribute('x', W); // Start at right edge
    ripple.setAttribute('y', 0);
    ripple.setAttribute('width', rippleWidth);
    ripple.setAttribute('height', H);
    ripple.setAttribute('fill', `url(#${gradientId})`);
    ripple.setAttribute('opacity', '0');

    // Insert ripple (before ticks so ticks render on top)
    svg.appendChild(ripple);

    // Use SVG native animation for smooth movement
    const duration = 1.8; // 1.8 seconds

    // Animate X position (movement)
    const animateX = document.createElementNS(svgNS, 'animate');
    animateX.setAttribute('attributeName', 'x');
    animateX.setAttribute('from', W);
    animateX.setAttribute('to', -rippleWidth);
    animateX.setAttribute('dur', `${duration}s`);
    animateX.setAttribute('fill', 'freeze');
    ripple.appendChild(animateX);

    // Animate opacity (fade in/out)
    const animateOpacity = document.createElementNS(svgNS, 'animate');
    animateOpacity.setAttribute('attributeName', 'opacity');
    animateOpacity.setAttribute('values', '0;0.8;0.6;0');
    animateOpacity.setAttribute('keyTimes', '0;0.05;0.9;1');
    animateOpacity.setAttribute('dur', `${duration}s`);
    animateOpacity.setAttribute('fill', 'freeze');
    ripple.appendChild(animateOpacity);

    // Start animation
    animateX.beginElement();
    animateOpacity.beginElement();

    // Remove ripple and gradient after animation (don't remove defs, just the gradient)
    setTimeout(() => {
      ripple.remove();
      gradient.remove();
      // Clean up empty defs element if no gradients remain
      if (defs && defs.children.length === 0) {
        defs.remove();
      }
    }, duration * 1000);
  }

  function drawSparkline(series){
    // Preserve existing ripple animations before clearing
    const existingSvg = sparklineEl.querySelector('svg');
    const existingRipples = existingSvg ? Array.from(existingSvg.querySelectorAll('.timeline-ripple')) : [];
    const existingDefs = existingSvg ? existingSvg.querySelector('defs') : null;

    sparklineEl.innerHTML = '';
    if(!series || series.length===0){
      const svgNS = 'http://www.w3.org/2000/svg';
      const H = sparklineEl.clientHeight || 32;
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', `0 0 1 ${H}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      sparklineEl.appendChild(svg);
      sparkKeys = [];

      // Restore ripples even for empty series
      if (existingDefs) svg.appendChild(existingDefs);
      existingRipples.forEach(r => svg.appendChild(r));

      if (sparkTick) sparklineEl.appendChild(sparkTick);
      if (sparkHover) sparklineEl.appendChild(sparkHover);
      updateSparkTick();
      return;
    }
    const H = sparklineEl.clientHeight || 32;

    // Log scale normalization: makes all activity visible regardless of magnitude
    const counts = series.map(b => b.count || 0);

    // Find max for reference
    const maxCount = Math.max(1, ...counts);

    // Filter out zero-count buckets to remove long inactive spans
    const filtered = series.filter(b => (b.count||0) > 0);
    const data = filtered.length ? filtered : series;
    const svgNS = 'http://www.w3.org/2000/svg';
    const n = Math.max(2, data.length);

    // Use normalized viewBox so it scales to container width smoothly
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${n-1} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    sparklineEl.appendChild(svg);
    sparkKeys = data.map(b => b.key);

    // Draw smoothed area chart
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const paddingTop = H * 0.1;
    const paddingBottom = H * 0.2;
    const availableHeight = H - paddingTop - paddingBottom;

    // Calculate y positions using LOG SCALE + minimum floor
    const points = data.map((b, i) => {
      const x = i;
      const rawCount = b.count || 0;

      if(rawCount === 0){
        // No activity - baseline
        const y = paddingTop + availableHeight;
        return { x, y };
      }

      // Log scale: log(1 + count) compresses large values, expands small ones
      const logValue = Math.log(1 + rawCount);
      const maxLogValue = Math.log(1 + maxCount);

      // Normalize to 0-1 range with log scale
      const normalized = logValue / maxLogValue;

      // Apply minimum floor: any activity gets at least 15% height
      const MIN_HEIGHT_RATIO = 0.15;
      const heightRatio = Math.max(MIN_HEIGHT_RATIO, normalized);

      const yHeight = heightRatio * availableHeight;
      const y = paddingTop + (availableHeight - yHeight);
      return { x, y };
    });

    if (points.length === 0) return;

    // Create smooth curve using cubic Bezier curves
    let pathData = `M ${points[0].x} ${points[0].y}`; // Move to first point

    // Generate smooth curve through points using Catmull-Rom inspired control points
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      // Calculate control points for smooth curve (tension = 0.3 for gentler curves)
      const tension = 0.3;
      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;

      pathData += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }

    // Save the line path for stroke (before closing)
    const linePathData = pathData;

    // Close the area: line down to bottom right, across to bottom left, close
    const bottomY = H - paddingBottom;
    pathData += ` L ${points[points.length - 1].x} ${bottomY}`; // Down to bottom right
    pathData += ` L ${points[0].x} ${bottomY}`; // Across to bottom left
    pathData += ` Z`; // Close path

    // Split paths if we're time-traveling (dim the "future" portion)
    let areaPathBefore = pathData;
    let linePathBefore = linePathData;
    let areaPathAfter = null;
    let linePathAfter = null;
    let splitIndex = -1;

    if(currentAsOfMs !== null && sparkKeys.length > 0){
      // Find the split point (closest timestamp to currentAsOfMs)
      let minDiff = Math.abs(sparkKeys[0] - currentAsOfMs);
      splitIndex = 0;
      for(let i = 1; i < sparkKeys.length; i++){
        const diff = Math.abs(sparkKeys[i] - currentAsOfMs);
        if(diff < minDiff){
          minDiff = diff;
          splitIndex = i;
        }
      }

      // Split the paths at this index
      if(splitIndex < points.length - 1){
        // Build "before" path (from start to splitIndex)
        let beforeLinePath = `M ${points[0].x} ${points[0].y}`;
        for(let i = 0; i < splitIndex; i++){
          const p0 = points[Math.max(0, i - 1)];
          const p1 = points[i];
          const p2 = points[i + 1];
          const p3 = points[Math.min(points.length - 1, i + 2)];
          const tension = 0.3;
          const cp1x = p1.x + (p2.x - p0.x) * tension;
          const cp1y = p1.y + (p2.y - p0.y) * tension;
          const cp2x = p2.x - (p3.x - p1.x) * tension;
          const cp2y = p2.y - (p3.y - p1.y) * tension;
          beforeLinePath += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
        }
        linePathBefore = beforeLinePath;
        let beforeAreaPath = beforeLinePath;
        beforeAreaPath += ` L ${points[splitIndex].x} ${bottomY}`;
        beforeAreaPath += ` L ${points[0].x} ${bottomY}`;
        beforeAreaPath += ` Z`;
        areaPathBefore = beforeAreaPath;

        // Build "after" path (from splitIndex to end)
        let afterLinePath = `M ${points[splitIndex].x} ${points[splitIndex].y}`;
        for(let i = splitIndex; i < points.length - 1; i++){
          const p0 = points[Math.max(0, i - 1)];
          const p1 = points[i];
          const p2 = points[i + 1];
          const p3 = points[Math.min(points.length - 1, i + 2)];
          const tension = 0.3;
          const cp1x = p1.x + (p2.x - p0.x) * tension;
          const cp1y = p1.y + (p2.y - p0.y) * tension;
          const cp2x = p2.x - (p3.x - p1.x) * tension;
          const cp2y = p2.y - (p3.y - p1.y) * tension;
          afterLinePath += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
        }
        linePathAfter = afterLinePath;
        let afterAreaPath = afterLinePath;
        afterAreaPath += ` L ${points[points.length - 1].x} ${bottomY}`;
        afterAreaPath += ` L ${points[splitIndex].x} ${bottomY}`;
        afterAreaPath += ` Z`;
        areaPathAfter = afterAreaPath;
      }
    }

    // Create area fill "before" (semi-transparent, normal)
    const areaPath = document.createElementNS(svgNS, 'path');
    areaPath.setAttribute('d', areaPathBefore);
    areaPath.setAttribute('fill', accentColor || '#39bae6');
    areaPath.setAttribute('fill-opacity', '0.2');
    areaPath.setAttribute('stroke', 'none');
    svg.appendChild(areaPath);

    // Create stroke line "before" (full color, no fill)
    const linePath = document.createElementNS(svgNS, 'path');
    linePath.setAttribute('d', linePathBefore);
    linePath.setAttribute('fill', 'none');
    linePath.setAttribute('stroke', accentColor || '#39bae6');
    linePath.setAttribute('stroke-width', '1.5');
    linePath.setAttribute('stroke-opacity', '1');
    linePath.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(linePath);

    // Create dimmed "after" portion (future from selected timestamp)
    if(areaPathAfter && linePathAfter){
      const areaPathDimmed = document.createElementNS(svgNS, 'path');
      areaPathDimmed.setAttribute('d', areaPathAfter);
      areaPathDimmed.setAttribute('fill', accentColor || '#39bae6');
      areaPathDimmed.setAttribute('fill-opacity', '0.05'); // Much dimmer
      areaPathDimmed.setAttribute('stroke', 'none');
      areaPathDimmed.setAttribute('class', 'timeline-future-dimmed');
      svg.appendChild(areaPathDimmed);

      const linePathDimmed = document.createElementNS(svgNS, 'path');
      linePathDimmed.setAttribute('d', linePathAfter);
      linePathDimmed.setAttribute('fill', 'none');
      linePathDimmed.setAttribute('stroke', accentColor || '#39bae6');
      linePathDimmed.setAttribute('stroke-width', '1.5');
      linePathDimmed.setAttribute('stroke-opacity', '0.15'); // Much dimmer
      linePathDimmed.setAttribute('stroke-dasharray', '4,4'); // Dashed to show it's "future"
      linePathDimmed.setAttribute('vector-effect', 'non-scaling-stroke');
      linePathDimmed.setAttribute('class', 'timeline-future-dimmed');
      svg.appendChild(linePathDimmed);
    }

    // Restore existing ripple animations (allows multiple ripples to stack)
    if (existingDefs) svg.appendChild(existingDefs);
    existingRipples.forEach(r => svg.appendChild(r));

    // Re-attach ticks on top
    if (sparkTick) sparklineEl.appendChild(sparkTick);
    if (sparkHover) sparklineEl.appendChild(sparkHover);
    updateSparkTick();
  }

  function updateSparkTick(){
    if(!sparklineEl || !sparkTick){ return; }
    const W = sparklineEl.clientWidth || 600;
    let x = W; // Default to far right (live)

    // Position based on index in sparkKeys (filtered data), not timestamp percentage
    // This makes the tick align with where data points actually are in the graph
    if(currentAsOfMs!=null && sparkKeys.length > 0){
      // Find the closest timestamp in sparkKeys to currentAsOfMs
      let closestIdx = 0;
      let minDiff = Math.abs(sparkKeys[0] - currentAsOfMs);

      for(let i = 1; i < sparkKeys.length; i++){
        const diff = Math.abs(sparkKeys[i] - currentAsOfMs);
        if(diff < minDiff){
          minDiff = diff;
          closestIdx = i;
        }
      }

      // Position tick at the index in the filtered data
      const n = sparkKeys.length;
      x = Math.round((closestIdx / (n - 1 || 1)) * W);
    }

    sparkTick.style.left = `${x}px`;
    try{ sparkTick.classList.remove('snap'); void sparkTick.offsetWidth; sparkTick.classList.add('snap'); }catch(e){}
  }

  // applyScrub removed - timeline click now handles time selection directly

  async function refreshAllTiles(ts){
    const perfStart = performance.now();
    console.log('🔄 [refreshAllTiles] START', {
      timestamp: ts,
      existingTiles: tiles.size,
      existingFolders: folders.size
    });

    // Determine target file set with metadata
    let list = [];
    let filesWithMeta = [];

    // RESULTS-ONLY MODE: Only render files from search results (limit 200)
    if(resultsOnlyMode && lastSearchResults.length > 0){
      // Apply language filter if active
      let filteredResults = lastSearchResults;
      if(currentLanguageFilter){
        filteredResults = lastSearchResults.filter(r => r.language === currentLanguageFilter);
        console.log(`🔍 [refreshAllTiles] Language filter active: ${currentLanguageFilter} (${filteredResults.length}/${lastSearchResults.length} files)`);
      }

      // Include binary files on canvas (now that we can render them!)
      // Binary toggle controls visibility in results, not canvas
      const maxFiles = 300;
      const limitedResults = filteredResults.slice(0, maxFiles);
      list = limitedResults.map(r => r.file_path);

      // Fetch metadata for these specific files
      // NOTE: Most metadata is nested, but preview fields are top-level
      filesWithMeta = limitedResults.map(r => ({
        file_path: r.file_path,
        size_bytes: (r.metadata && r.metadata.size_bytes) || 0,
        line_count: (r.metadata && r.metadata.line_count) || 1,
        language: r.language || 'text',
        is_binary: r.is_binary || false,
        preview_width: r.preview_width || null,  // Thumbnail width
        preview_height: r.preview_height || null,  // Thumbnail height
        original_width: r.original_width || null,  // Original image width
        original_height: r.original_height || null  // Original image height
      }));
    }
    // SHOW ALL MODE: Fetch all files from index
    else if(!resultsOnlyMode){
      if(ts==null){
        const res = await fetchJSON('/files');
        filesWithMeta = res.files || [];
        list = filesWithMeta.map(f => f.file_path);
      } else {
        const res = await fetchJSON(`/files/at?ts=${ts}`);
        filesWithMeta = res.files || [];
        list = filesWithMeta.map(f => f.file_path);
      }
    }
    // RESULTS-ONLY MODE with no search: Do nothing (canvas stays empty)
    else {
      return;
    }

    // Store file metadata for treemap mode AND binary sizing
    fileMeta.clear();
    fileLanguages.clear(); // Clear before repopulating
    for(const f of filesWithMeta){
      if(f.file_path){
        const meta = {
          size_bytes: f.size_bytes || 0,
          line_count: f.line_count || 1,
          is_binary: f.is_binary || false,
          preview_width: f.preview_width || null,  // Thumbnail width
          preview_height: f.preview_height || null,  // Thumbnail height
          original_width: f.original_width || null,  // Original image width
          original_height: f.original_height || null  // Original image height
        };
        fileMeta.set(f.file_path, meta);

        // Debug log for binary files
        if(meta.is_binary){
          console.log(`💾 [fileMeta] ${f.file_path}:`, {
            preview: `${meta.preview_width}x${meta.preview_height}`,
            original: `${meta.original_width}x${meta.original_height}`
          });
        }

        // Populate language data early for language bar
        if(f.language){
          fileLanguages.set(f.file_path, f.language);
        }
      }
    }

    console.log('📊 [refreshAllTiles] fileMeta populated:', {
      count: fileMeta.size,
      samples: Array.from(fileMeta.entries()).slice(0, 3).map(([path, meta]) => ({
        path: path.split('/').pop(),
        ...meta
      }))
    });

    console.log(' [refreshAllTiles] Populated fileLanguages', {
      count: fileLanguages.size,
      languages: [...new Set(fileLanguages.values())]
    });

    // Rebuild canvas & tiles for new file set
    // PERFORMANCE: Batch DOM operations to avoid layout thrashing
    // Temporarily hide canvas to prevent reflows during bulk removal
    canvas.style.display = 'none';

    // CRITICAL: Check if tiles are accumulating in DOM before removal
    const domChildrenBefore = canvas.children.length;
    console.log('🗑️  [refreshAllTiles] Removing tiles', {
      mapSize: tiles.size,
      domChildren: domChildrenBefore
    });

    // Remove existing tiles
    for(const [p, tile] of tiles){ tile.remove(); }
    tiles.clear(); tileContent.clear(); filePos.clear(); fileFolder.clear();
    // NOTE: fileLanguages is NOT cleared here - it was just populated above from metadata!

    for(const [, el] of folders){ el.remove(); } folders.clear();

    // CRITICAL: Verify tiles were actually removed from DOM
    const domChildrenAfter = canvas.children.length;
    console.log('✅ [refreshAllTiles] Tiles removed', {
      domChildrenBefore,
      domChildrenAfter,
      leaked: domChildrenAfter > 0 ? domChildrenAfter : 0
    });

    // Sort files by path for spatial coherence (files in same folder are nearby)
    // Results panel already shows score-sorted order, so canvas can show path-sorted
    list.sort((a, b) => a.localeCompare(b));
    console.log('📂 [refreshAllTiles] Sorted by path for spatial grouping', {
      first: list[0],
      last: list[list.length - 1]
    });

    // Use treemap (flat or with folders), simple grid (results-only), or traditional layout based on mode
    if(treemapMode && treemapFoldersMode){
      console.log('🗺️  [refreshAllTiles] Using TREEMAP WITH FOLDERS mode (OLD manual positioning)');
      const tree = buildTree(list);
      layoutTreemapWithFolders(tree);
    } else if(treemapMode){
      console.log('🗺️  [refreshAllTiles] Using TREEMAP mode (OLD manual spiral packing)');
      layoutTreemap(list);
    } else if(resultsOnlyMode){
      console.log('📊 [refreshAllTiles] Using SIMPLE GRID mode (shelf-packing algorithm)');
      // RESULTS-ONLY MODE: Use simple grid layout (no folder hierarchy for performance)
      layoutSimpleGrid(list);
    } else {
      console.log('📁 [refreshAllTiles] Using SHOW ALL mode (OLD folder hierarchy)');
      // SHOW ALL MODE: Use traditional folder hierarchy layout
      const tree = buildTree(list);
      layoutAndRender(tree);
    }
    // PERFORMANCE FIX: Create placeholder tiles immediately (no content loading)
    // Content will be lazy-loaded on-demand when user clicks a tile
    for(const p of list){
      try{
        // Create empty tile immediately (synchronous, no network calls)
        openTile(p);
      }catch(e){ /* ignore */ }
    }

    // Show canvas again after all tiles created (batch DOM update complete)
    canvas.style.display = 'block';

    // Verify no overlaps in simple grid mode (bin-packing should be perfect)
    if(resultsOnlyMode && !treemapMode){
      setTimeout(() => {
        let overlaps = 0;
        const positions = [];

        for(const [path, tile] of tiles){
          const x = parseFloat(tile.style.left) || 0;
          const y = parseFloat(tile.style.top) || 0;
          const w = parseFloat(tile.style.width) || 600;
          const h = parseFloat(tile.style.height) || 400;

          // Check for overlaps
          for(const other of positions){
            if(!(x + w <= other.x || x >= other.x + other.w || y + h <= other.y || y >= other.y + other.h)){
              overlaps++;
              console.error(`   ❌ Overlap detected: ${path.split('/').pop()} overlaps with another tile`);
            }
          }
          positions.push({ x, y, w, h, path });
        }

        const maxX = Math.max(...positions.map(p => p.x + p.w));
        const maxY = Math.max(...positions.map(p => p.y + p.h));

        console.log('🔍 [Verification] Checking layout quality:');
        console.log(`   Canvas bounds: ${maxX.toFixed(0)}x${maxY.toFixed(0)}px`);
        console.log(`   Overlaps: ${overlaps} ${overlaps === 0 ? '✅ Perfect!' : '❌ ERROR!'}`);

        if(overlaps > 0){
          console.error('   ⚠️  OVERLAP DETECTED - This should never happen with shelf-packing!');
        }

        console.log(`   Sample positions:`, positions.slice(0, 5).map(p => ({
          file: p.path.split('/').pop(),
          x: p.x.toFixed(0),
          y: p.y.toFixed(0),
          w: p.w.toFixed(0),
          h: p.h.toFixed(0)
        })));
      }, 50);
    }

    // Apply folder colors and update language bar
    // PERFORMANCE: Skip folder colors in results-only mode (no folders in simple grid layout)
    if(!resultsOnlyMode || treemapMode){
      applyAllFolderColors();
    }
    updateLanguageBar();

    // Content loading is now lazy - happens in openTile() when user interacts

    const perfEnd = performance.now();
    console.log('✅ [refreshAllTiles] END', {
      duration: `${(perfEnd - perfStart).toFixed(2)}ms`,
      tilesCreated: tiles.size,
      foldersCreated: folders.size,
      filesInList: list.length
    });
  }

  function flashTile(path, kind='focus'){
    const tile = tiles.get(path);
    if(!tile) return;
    // Reset previous animation classes to retrigger
    tile.classList.remove('flash-focus');
    tile.classList.remove('flash-update');
    void tile.offsetWidth; // reflow to restart animation
    tile.classList.add(kind === 'update' ? 'flash-update' : 'flash-focus');
    setTimeout(()=> {
      tile.classList.remove('flash-focus');
      tile.classList.remove('flash-update');
    }, 1800);
  }

  // Helper: Calculate visible viewport dimensions accounting for UI elements
  function getVisibleViewport(){
    const ws = workspace.getBoundingClientRect();
    const FILTER_PANEL_WIDTH = 300; // Must match CSS .filter-panel width

    // Calculate total width covered by UI elements on the left
    const filterPanelsWidth = filterPanels.length * FILTER_PANEL_WIDTH;
    const leftCoverage = sidebarWidth + filterPanelsWidth;

    // Calculate visible area (the part not covered by sidebar/panels)
    const visibleWidth = ws.width - leftCoverage;
    const visibleHeight = ws.height;

    // Calculate the center point of the visible area in workspace coordinates
    const visibleCenterX = leftCoverage + (visibleWidth / 2);
    const visibleCenterY = visibleHeight / 2;

    return {
      width: visibleWidth,
      height: visibleHeight,
      centerX: visibleCenterX,
      centerY: visibleCenterY,
      leftCoverage: leftCoverage
    };
  }

  function centerOnTile(path, opts={}){
    console.log('🎬 [centerOnTile] START', { path, isAnimating, animHandle, animId: currentAnimationId });

    // CRITICAL FIX: Stop ALL pending animations and increment ID to invalidate callbacks
    currentAnimationId++; // Invalidate all old animation callbacks
    if(isAnimating){
      console.warn('⚠️  Canceling existing animation');
      isAnimating = false; // Stop all animation loops
    }
    if(animHandle){
      cancelAnimationFrame(animHandle);
      animHandle = null;
    }

    const tile = tiles.get(path);
    if(!tile) return;

    // Get visible viewport accounting for sidebar and filter panels
    const viewport = getVisibleViewport();

    // world coords (pre-transform)
    const worldX = parseFloat(tile.style.left) || 0;
    const worldY = parseFloat(tile.style.top) || 0;
    const w = tile.offsetWidth || 600;
    const h = tile.offsetHeight || 400;
    const cx = worldX + w/2;
    const cy = worldY + h/2;

    // Determine target scale: zoom to fit VISIBLE viewport
    let targetScale = scale;
    if(opts.zoomToFit !== false){
      // Use visible viewport dimensions with some padding (0.7 = 70% of visible area)
      const fitW = (viewport.width * 0.7) / w;
      const fitH = (viewport.height * 0.7) / h;
      targetScale = Math.min(2.5, Math.max(0.05, Math.min(fitW, fitH)));
    }

    // Compute target offsets to center tile in VISIBLE viewport
    const targetOffsetX = viewport.centerX - (targetScale * cx);
    const targetOffsetY = viewport.centerY - (targetScale * cy);

    // Check if tile is already properly centered and zoomed - if so, skip animation
    const POSITION_TOLERANCE = 5; // pixels
    const SCALE_TOLERANCE = 0.02; // 2% difference
    const isAlreadyCentered =
      Math.abs(offsetX - targetOffsetX) < POSITION_TOLERANCE &&
      Math.abs(offsetY - targetOffsetY) < POSITION_TOLERANCE &&
      Math.abs(scale - targetScale) < SCALE_TOLERANCE;

    if(isAlreadyCentered){
      console.log('✓ [centerOnTile] Already centered, skipping animation');
      return;
    }

    // FUN CINEMATIC ANIMATION: If already zoomed in, zoom out first, then pan, then zoom in
    const ZOOM_THRESHOLD = 0.8; // Consider "zoomed in" if scale > 0.8
    if(scale > ZOOM_THRESHOLD && targetScale > ZOOM_THRESHOLD){
      // Do cinematic 3-stage animation
      animatePanZoomCinematic(cx, cy, targetOffsetX, targetOffsetY, targetScale);
    } else {
      // Normal single-stage animation
      animatePanZoom(targetOffsetX, targetOffsetY, targetScale, 500);
    }
  }

  function animatePanZoomCinematic(cx, cy, finalOffsetX, finalOffsetY, finalScale){
    // CRITICAL: Capture animation ID to prevent old callbacks from executing
    const myAnimationId = currentAnimationId;
    // console.log('🎬 [animatePanZoomCinematic] Starting 3-stage animation', { animId: myAnimationId });

    // Stage 1: Zoom out to wide view
    const pullbackScale = Math.max(0.3, scale * 0.4); // Zoom out to 40% of current (min 0.3)

    // Get visible viewport for accurate centering
    const viewport = getVisibleViewport();

    // Calculate current center in world coords (using visible viewport center)
    const currentCenterX = (-offsetX + viewport.centerX) / scale;
    const currentCenterY = (-offsetY + viewport.centerY) / scale;

    // Stage 1: Zoom out while keeping current center in visible viewport
    const pullbackOffsetX = viewport.centerX - (pullbackScale * currentCenterX);
    const pullbackOffsetY = viewport.centerY - (pullbackScale * currentCenterY);

    // Stage 2: Calculate offset to center target (cx, cy) AT THE PULLBACK SCALE
    const targetOffsetXAtPullback = viewport.centerX - (pullbackScale * cx);
    const targetOffsetYAtPullback = viewport.centerY - (pullbackScale * cy);

    // Stage 1: Zoom out (200ms) - keep current center
    animatePanZoom(pullbackOffsetX, pullbackOffsetY, pullbackScale, 200, () => {
      // CRITICAL: Check if this animation was cancelled
      if(currentAnimationId !== myAnimationId){
        console.warn('⚠️  Stage 1 callback cancelled (new animation started)');
        return;
      }
      // Stage 2: Pan to target (300ms) - stay at pullback scale, pan to new center
      animatePanZoom(targetOffsetXAtPullback, targetOffsetYAtPullback, pullbackScale, 300, () => {
        // CRITICAL: Check if this animation was cancelled
        if(currentAnimationId !== myAnimationId){
          console.warn('⚠️  Stage 2 callback cancelled (new animation started)');
          return;
        }
        // Stage 3: Zoom in (250ms) - target already centered, just change scale
        // finalOffsetX/Y were calculated for finalScale, so they'll keep (cx,cy) centered
        animatePanZoom(finalOffsetX, finalOffsetY, finalScale, 250);
      });
    });
  }

  function animatePanZoom(toX, toY, toScale, duration=500, onComplete=null){
    activeAnimationCount++;
    //console.log('▶️  [animatePanZoom] START', { activeCount: activeAnimationCount, duration });

    const fromX = offsetX, fromY = offsetY, fromS = scale;
    const start = performance.now();
    isAnimating = true;
    function ease(t){ return t<0.5 ? 2*t*t : -1+(4-2*t)*t; } // easeInOutQuad
    function step(now){
      if(!isAnimating){
        activeAnimationCount--;
        //console.log('⏹️  [animatePanZoom] STOPPED (isAnimating=false)', { activeCount: activeAnimationCount });
        return;
      }
      const t = Math.min(1, (now - start) / duration);
      const e = ease(t);
      offsetX = fromX + (toX - fromX) * e;
      offsetY = fromY + (toY - fromY) * e;
      scale = fromS + (toScale - fromS) * e;
      applyTransform();
      if(t < 1){
        animHandle = requestAnimationFrame(step);
      } else {
        isAnimating = false;
        activeAnimationCount--;
        //console.log('✅ [animatePanZoom] COMPLETE', { activeCount: activeAnimationCount });
        if(onComplete) onComplete();
      }
    }
    if(animHandle) cancelAnimationFrame(animHandle);
    animHandle = requestAnimationFrame(step);
  }

  function scrollToLine(path, line, explicitDirection = null, animData = null){
    const tile = tiles.get(path);
    if(!tile || !line) return;

    const body = tile.querySelector('.body');
    const pre = body && body.querySelector('pre.prism-code');
    if(!pre) return;

    const code = pre.querySelector('code');
    if(!code) return;

    // Get chunk info and extended chunk metadata
    const chunkStart = parseInt(pre.getAttribute('data-chunk-start')) || 1;
    const chunkEnd = parseInt(pre.getAttribute('data-chunk-end')) || 999999;
    const totalLines = parseInt(pre.getAttribute('data-total-lines')) || 0;
    const storedDirection = pre.getAttribute('data-scroll-direction');
    const prependedLines = parseInt(pre.getAttribute('data-prepended-lines')) || 0;
    const appendedLines = parseInt(pre.getAttribute('data-appended-lines')) || 0;

    // Calculate current visible line from scroll position
    const computedStyle = window.getComputedStyle(pre);
    const fontSize = parseFloat(computedStyle.fontSize);
    const lineHeight = parseFloat(computedStyle.lineHeight) || fontSize * 1.4;
    const currentScrolledLines = Math.floor(pre.scrollTop / lineHeight);
    const currentVisibleLine = chunkStart + currentScrolledLines;

    // Use explicit direction if provided, otherwise try stored direction, otherwise calculate
    const direction = explicitDirection || storedDirection || (line < currentVisibleLine ? 'up' : 'down');

    // Clear stored metadata after reading
    if(storedDirection){
      pre.removeAttribute('data-scroll-direction');
      pre.removeAttribute('data-scroll-target');
      pre.removeAttribute('data-prepended-lines');
      pre.removeAttribute('data-appended-lines');
    }

    console.log(`📜 [scrollToLine] State:`, {
      targetLine: line,
      currentVisibleLine,
      currentScrollTop: pre.scrollTop.toFixed(0),
      direction,
      explicitDirection,
      storedDirection,
      chunkRange: `${chunkStart}-${chunkEnd}`,
      prependedLines,
      appendedLines,
      hasExtended: prependedLines > 0 || appendedLines > 0,
      scrollHeight: pre.scrollHeight,
      clientHeight: pre.clientHeight
    });

    // Check if target line is in the current chunk
    if(line < chunkStart || line > chunkEnd){
      // Line is not in current chunk - need to reload with focus on that line
      console.log(`  → Need chunk reload: line ${line} not in current chunk ${chunkStart}-${chunkEnd}, direction: ${direction}`);

      // Prevent reload loops: check if we already have a pending focus for this exact line
      const existingPending = pendingFocus.get(path);
      if(existingPending && existingPending.line === line){
        console.warn(`  ⚠️  Already reloading to line ${line}, skipping duplicate reload`);
        return;
      }

      pendingFocus.set(path, { line, direction }); // Store direction for after reload
      loadTileContent(path, null, line, null, direction).catch(e => {/* ignore */});
      return;
    }

    // Wait for Prism to finish rendering
    requestAnimationFrame(() => {
      // Line is in chunk - calculate position relative to chunk
      const relativeLineIndex = line - chunkStart; // 0-based index within chunk
      const linePositionInChunk = relativeLineIndex * lineHeight;
      const viewportHeight = pre.clientHeight;
      const currentScroll = pre.scrollTop;

      console.log(`  🔍 Scroll calculation:`, {
        targetLine: line,
        lineInChunk: relativeLineIndex,
        linePosition: linePositionInChunk.toFixed(0),
        currentScroll: currentScroll.toFixed(0),
        direction,
        prependedLines,
        appendedLines
      });

      // Calculate target scroll position
      let targetScroll;
      if(direction === 'up'){
        // Position target line in center of viewport
        targetScroll = Math.max(0, linePositionInChunk - (viewportHeight / 2));
      } else {
        // Position target line in top third
        targetScroll = Math.max(0, linePositionInChunk - (viewportHeight / 3));
      }

      // Handle extended chunks with prepended/appended content
      const hasAppended = appendedLines > 0;
      const hasPrepended = prependedLines > 0;

      console.log(`  📦 Extended chunk check:`, {
        hasAppended,
        hasPrepended,
        direction,
        willUseUpTrick: hasAppended && direction === 'up',
        willUseDownTrick: hasPrepended && direction === 'down'
      });

      if(hasAppended && direction === 'up'){
        // UP scroll with appended buffer: Start at bottom of chunk, animate UP to target
        const maxScroll = Math.max(0, pre.scrollHeight - viewportHeight);
        const startScroll = Math.min(maxScroll, linePositionInChunk + (viewportHeight * 0.8));

        console.log(`  ⬆️  [UP EXTENDED] Using appended buffer`, {
          appendedLines,
          linePositionInChunk: linePositionInChunk.toFixed(0),
          startScroll: startScroll.toFixed(0),
          targetScroll: targetScroll.toFixed(0),
          delta: (startScroll - targetScroll).toFixed(0),
          maxScroll: maxScroll.toFixed(0)
        });

        // Set start position instantly
        pre.scrollTop = startScroll;
        console.log(`  ⬆️  Set scrollTop to ${pre.scrollTop.toFixed(0)}px`);

        // Animate UP to target after brief delay
        setTimeout(() => {
          const beforeScroll = pre.scrollTop;
          console.log(`  ⬆️  NOW ANIMATING UP: ${beforeScroll.toFixed(0)}px → ${targetScroll.toFixed(0)}px`);
          pre.scrollTo({ top: targetScroll, behavior: 'smooth' });

          // Verify scroll started
          setTimeout(() => {
            console.log(`  ⬆️  After 200ms: scrollTop = ${pre.scrollTop.toFixed(0)}px`);
          }, 200);

          // Add highlight after animation
          setTimeout(() => addLineHighlight(pre, relativeLineIndex), 700);
        }, 120);

        return; // Animation scheduled
      } else if(prependedLines > 0 && direction === 'down'){
        // DOWN scroll with prepended buffer: Start at top, scroll DOWN to target
        console.log(`  ⬇️  [DOWN with ${prependedLines} prepended lines]`, {
          targetScroll: targetScroll.toFixed(0),
          prependedLines
        });

        // Start at top
        pre.scrollTop = 0;

        // Animate DOWN to target after brief delay
        setTimeout(() => {
          console.log(`  ⬇️  Animating DOWN from 0px to ${targetScroll.toFixed(0)}px`);
          pre.scrollTo({ top: targetScroll, behavior: 'smooth' });

          // Add highlight after animation
          setTimeout(() => addLineHighlight(pre, relativeLineIndex), 600);
        }, 100);

        return; // Animation scheduled
      }

      // Normal scrolling (no extended chunk or within existing chunk)
      const scrollDelta = Math.abs(targetScroll - currentScroll);
      const shouldAnimate = scrollDelta > 20;

      console.log(`  → Normal scroll ${direction}:`, {
        from: currentScroll.toFixed(0),
        to: targetScroll.toFixed(0),
        delta: scrollDelta.toFixed(0),
        willAnimate: shouldAnimate,
        scrollHeight: pre.scrollHeight,
        viewportHeight
      });

      // Always use smooth behavior for any visible movement
      pre.scrollTo({
        top: targetScroll,
        behavior: shouldAnimate ? 'smooth' : 'instant'
      });

      // Add line highlight after scroll completes
      setTimeout(() => addLineHighlight(pre, relativeLineIndex), shouldAnimate ? 600 : 100);
    });

    // Extracted highlight logic
    function addLineHighlight(pre, relativeLineIndex){
      // Remove previous highlights
      const existingHighlights = pre.querySelectorAll('.highlight-line, .highlight-line-fade');
      existingHighlights.forEach(el => {
        el.classList.remove('highlight-line');
        el.classList.remove('highlight-line-fade');
      });

      // Add highlight to target line using Prism's line-numbers structure
      const lineNumbersRows = pre.querySelectorAll('.line-numbers-rows > span');
      if(lineNumbersRows && lineNumbersRows[relativeLineIndex]){
        lineNumbersRows[relativeLineIndex].classList.add('highlight-line');

        // Also add a temporary highlight effect
        setTimeout(() => {
          if(lineNumbersRows[relativeLineIndex]){
            lineNumbersRows[relativeLineIndex].classList.remove('highlight-line');
            lineNumbersRows[relativeLineIndex].classList.add('highlight-line-fade');
            setTimeout(() => {
              if(lineNumbersRows[relativeLineIndex]){
                lineNumbersRows[relativeLineIndex].classList.remove('highlight-line-fade');
              }
            }, 2000);
          }
        }, 1000);
      }
    }
  }

  function focusResult(r){
    console.log('👆 [focusResult] CLICK', {
      path: r.file_path,
      hasContent: tileContent.has(r.file_path),
      totalTiles: tiles.size,
      totalContent: tileContent.size
    });

    const path = r.file_path;
    const line = (r.matches && r.matches[0] && r.matches[0].line) || null;
    const query = qEl.value.trim(); // Get current search query
    openTile(path).then(async ()=>{
      centerOnTile(path);

      // Check if line is in current chunk before reloading
      const tile = tiles.get(path);
      const pre = tile && tile.querySelector('.body pre.prism-code');
      const chunkStart = pre ? parseInt(pre.getAttribute('data-chunk-start')) || 0 : 0;
      const chunkEnd = pre ? parseInt(pre.getAttribute('data-chunk-end')) || 0 : 0;
      const lineInChunk = line && chunkStart > 0 && line >= chunkStart && line <= chunkEnd;

      if(!tileContent.has(path)){
        await loadTileContent(path, null, line, query);
      } else if(line && lineInChunk){
        // Line already in chunk - just scroll without reloading!
        console.log(`  ✓ Line ${line} already in chunk ${chunkStart}-${chunkEnd}, scrolling only`);
        scrollToLine(path, line);
        // DON'T re-highlight - manipulating DOM after Prism breaks line number alignment
      } else if(line){
        // Line not in chunk - reload with extended chunk for smooth scroll
        console.log(`  ↻ Line ${line} not in chunk ${chunkStart}-${chunkEnd}, reloading`);
        await loadTileContent(path, null, line, query);
      } else {
        // No line to focus, just ensure content is loaded
        if(!pre) await loadTileContent(path, null, null, query);
      }
      flashTile(path, 'focus');
    });
  }

  function focusLine(path, line, token){
    const query = token || qEl.value.trim(); // Use token or current search query
    openTile(path).then(async ()=>{
      centerOnTile(path);

      // Check if line is in current chunk before reloading
      const tile = tiles.get(path);
      const pre = tile && tile.querySelector('.body pre.prism-code');
      const chunkStart = pre ? parseInt(pre.getAttribute('data-chunk-start')) || 0 : 0;
      const chunkEnd = pre ? parseInt(pre.getAttribute('data-chunk-end')) || 0 : 0;
      const lineInChunk = line && chunkStart > 0 && line >= chunkStart && line <= chunkEnd;

      if(!tileContent.has(path)){
        await loadTileContent(path, null, line, query);
      } else if(lineInChunk){
        // Line already in chunk - just scroll without reloading!
        console.log(`  ✓ Line ${line} already in chunk ${chunkStart}-${chunkEnd}, scrolling`);
        scrollToLine(path, line);
        // Update highlighting if needed
        if(query && pre){
          const code = pre.querySelector('code');
          if(code) highlightSearchTerms(code, query);
        }
      } else {
        // Line not in chunk - reload with extended chunk for smooth scroll
        console.log(`  ↻ Line ${line} not in chunk ${chunkStart}-${chunkEnd}, reloading`);
        await loadTileContent(path, null, line, query);
      }
      flashTile(path, 'focus');
    });
  }

  function applyAllFolderColors(){
    // Apply colors to all folders based on their most common file type
    for(const [folderPath, folderEl] of folders){
      applyFolderColor(folderEl, folderPath);
    }
  }

  function updateLanguageBar(overrideStats = null, skipLegend = false){
    if(!languageBarEl) return;
    if(!skipLegend && !languageLegendEl) return;

    let counts = {};
    let total = 0;

    if(overrideStats){
      // Use provided stats (overview mode)
      overrideStats.forEach(s => {
        counts[s.language] = s.file_count;
      });
      total = overrideStats.reduce((sum, s) => sum + s.file_count, 0);
      console.log('📊 [updateLanguageBar] Overview mode:', {
        languages: Object.keys(counts).length,
        totalFiles: total
      });
    } else {
      // Count languages from current file set (search mode)
      for(const [path, lang] of fileLanguages){
        if(lang && lang !== 'unknown' && lang !== 'plaintext'){
          counts[lang] = (counts[lang] || 0) + 1;
          total++;
        }
      }
      console.log('📊 [updateLanguageBar] Search mode:', {
        totalFiles: fileLanguages.size,
        countedFiles: total,
        languages: Object.keys(counts)
      });
    }

    // If no languages, clear and return
    if(total === 0){
      languageBarEl.innerHTML = '';
      if(!skipLegend && languageLegendEl) languageLegendEl.innerHTML = '';
      return;
    }

    // Sort by count descending
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    // Render stacked bar
    languageBarEl.innerHTML = '';
    sorted.forEach(([lang, count]) => {
      const percent = (count / total) * 100;
      const segment = document.createElement('div');
      segment.className = 'language-bar-segment';
      segment.style.width = `${percent}%`;
      segment.style.backgroundColor = getLanguageColor(lang);
      segment.title = `${lang}: ${count} files (${percent.toFixed(1)}%)`;
      languageBarEl.appendChild(segment);
    });

    // Skip legend in overview mode
    if(skipLegend){
      return;
    }

    // Render legend (clickable to filter by language)
    if(languageLegendEl){
      languageLegendEl.innerHTML = '';
      sorted.forEach(([lang, count]) => {
        const item = document.createElement('div');
        item.className = 'language-legend-item';

        const dot = document.createElement('div');
        dot.className = 'language-legend-dot';
        dot.style.backgroundColor = getLanguageColor(lang);

        const label = document.createElement('span');
        label.className = 'language-legend-label';
        label.textContent = lang;

        const countSpan = document.createElement('span');
        countSpan.className = 'language-legend-count';
        countSpan.textContent = `(${count})`;

        // Make clickable to filter by this language
        item.style.cursor = 'pointer';
        item.title = `Click to filter by ${lang} files`;
        item.onclick = () => {
          filterByLanguage(lang);
        };

        // Highlight if currently filtered by this language
        if(currentLanguageFilter === lang){
          item.classList.add('active');
        }

        item.appendChild(dot);
        item.appendChild(label);
        item.appendChild(countSpan);
        languageLegendEl.appendChild(item);
      });
    }
  }

  // Filter files by language (called when clicking language legend)
  async function renderCodebaseOverview(){
    console.log('📊 [renderCodebaseOverview] CALLED');
    if(!resultsEl){
      console.error('📊 [renderCodebaseOverview] resultsEl not found!');
      return;
    }

    console.log('📊 [renderCodebaseOverview] Fetching codebase stats...');

    // Build URL with current path filters
    let url = '/stats/overview';
    const params = new URLSearchParams();

    const pathPrefix = pathFilterInput?.value?.trim();
    if(pathPrefix){
      params.append('path_prefix', pathPrefix);
      console.log(`📊 [renderCodebaseOverview] Applying path prefix filter: ${pathPrefix}`);
    }

    const pathExclude = pathExcludeInput?.value?.trim();
    if(pathExclude){
      params.append('exclude_paths', pathExclude);
      console.log(`📊 [renderCodebaseOverview] Applying exclude filter: ${pathExclude}`);
    }

    if(params.toString()){
      url += '?' + params.toString();
    }

    try{
      const data = await fetchJSON(url);
      const stats = data.stats || [];

      if(stats.length === 0){
        resultsEl.innerHTML = '<div class="results-count" style="color: #888;">No files indexed yet</div>';
        return;
      }

      console.log(`📊 [renderCodebaseOverview] Rendering ${stats.length} language stats`);

      // Add wordmark to results header
      if(resultsHeaderEl){
        const wordmark = document.createElement('div');
        wordmark.className = 'rewindex-wordmark';
        wordmark.textContent = 'REWINDex';
        resultsHeaderEl.innerHTML = '';
        resultsHeaderEl.appendChild(wordmark);
      }

      // Calculate totals across all languages
      const totals = stats.reduce((acc, s) => ({
        files: acc.files + s.file_count,
        versions: acc.versions + s.version_count,
        bytes: acc.bytes + s.total_bytes,
        lines: acc.lines + s.total_lines
      }), {files: 0, versions: 0, bytes: 0, lines: 0});

      // Create overview container
      const overview = document.createElement('div');
      overview.className = 'codebase-overview';

      // Header with dynamic subtitle
      const header = document.createElement('div');
      header.className = 'overview-header';

      let subtitle = 'Click any file extension to pre-filter';
      if(pathPrefix || pathExclude){
        const filters = [];
        if(pathPrefix) filters.push(`prefix: ${pathPrefix}`);
        if(pathExclude) filters.push(`excluding: ${pathExclude}`);
        subtitle = `Filtered by ${filters.join(', ')}`;
      }

      header.innerHTML = `
        <div class="overview-subtitle">${subtitle}</div>
      `;
      overview.appendChild(header);

      // Store previous totals for comparison
      const prevTotals = window.overviewPrevTotals || {};
      window.overviewPrevTotals = {
        files: totals.files,
        versions: totals.versions,
        bytes: totals.bytes,
        lines: totals.lines
      };

      // Total summary section
      const summary = document.createElement('div');
      summary.className = 'overview-summary';
      const totalMB = (totals.bytes / (1024 * 1024)).toFixed(1);
      const avgChurn = totals.files > 0 ? (totals.versions / totals.files).toFixed(1) : 0;
      summary.innerHTML = `
        <div class="summary-stat">
          <div class="summary-value">${totals.files.toLocaleString()}</div>
          <div class="summary-label">Files</div>
        </div>
        <div class="summary-stat">
          <div class="summary-value">${totals.versions.toLocaleString()}</div>
          <div class="summary-label">Versions</div>
        </div>
        <div class="summary-stat">
          <div class="summary-value">${avgChurn}×</div>
          <div class="summary-label">Avg Churn</div>
        </div>
        <div class="summary-stat">
          <div class="summary-value">${totalMB} MB</div>
          <div class="summary-label">Total Size</div>
        </div>
        <div class="summary-stat">
          <div class="summary-value">${totals.lines.toLocaleString()}</div>
          <div class="summary-label">Total Lines</div>
        </div>
        <div class="summary-stat">
          <div class="summary-value">${stats.length}</div>
          <div class="summary-label">Languages</div>
        </div>
      `;
      overview.appendChild(summary);
      // Trigger bump animation on all summary values
      setTimeout(() => {
        const values = summary.querySelectorAll('.summary-value');
        values.forEach((val, idx) => {
          setTimeout(() => {
            val.classList.add('bump');
            setTimeout(() => val.classList.remove('bump'), 400);
          }, idx * 50);
        });
      }, 100);

      // Stats grid
      const grid = document.createElement('div');
      grid.className = 'stats-grid';

      stats.forEach(stat => {
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.setAttribute('data-language', stat.language);

        // Get language color (reuse existing color scheme)
        const langColor = getLanguageColor(stat.language);

        // Calculate churn rate (versions per file)
        const churnRate = stat.file_count > 0 ? (stat.version_count / stat.file_count).toFixed(1) : 0;

        // Format bytes
        const totalMB = (stat.total_bytes / (1024 * 1024)).toFixed(1);
        const avgKB = (stat.avg_size / 1024).toFixed(1);

        card.innerHTML = `
          <div class="stat-card-header" style="border-left: 3px solid ${langColor}">
            <div class="stat-lang-name">${stat.language}</div>
            <div class="stat-lang-color" style="background: ${langColor}"></div>
          </div>
          <div class="stat-card-body">
            <div class="stat-row">
              <div class="stat-label">Files</div>
              <div class="stat-value">${stat.file_count.toLocaleString()}</div>
            </div>
            <div class="stat-row">
              <div class="stat-label">Versions</div>
              <div class="stat-value">${stat.version_count.toLocaleString()}</div>
            </div>
            <div class="stat-row">
              <div class="stat-label">Churn</div>
              <div class="stat-value">${churnRate}×</div>
            </div>
            <div class="stat-row">
              <div class="stat-label">Size</div>
              <div class="stat-value">${totalMB} MB</div>
            </div>
          </div>
        `;

        // Click to filter by this language (using existing system)
        card.onclick = async () => {
          console.log(`📊 [overview] Clicked language: ${stat.language}`);

          // Set language filter BEFORE search
          currentLanguageFilter = stat.language;
          updateLanguageBar();

          // Set query to wildcard and trigger search
          qEl.value = '*';

          // doSearch() will apply the language filter automatically
          await doSearch();
        };

        grid.appendChild(card);
      });

      overview.appendChild(grid);
      resultsEl.innerHTML = '';
      resultsEl.appendChild(overview);

      // Update language bar with overview stats (no legend)
      updateLanguageBar(stats, true);

      console.log('✅ [renderCodebaseOverview] Rendered stats grid + language bar');
    }catch(e){
      console.error('[renderCodebaseOverview] Error:', e);
      resultsEl.innerHTML = '<div class="results-count" style="color: #888;">Error loading stats</div>';
    }
  }

  async function filterByLanguage(lang){
    console.log('🔍 [filterByLanguage]', { lang, current: currentLanguageFilter });

    // Toggle: if clicking same language, clear filter
    const wasFiltered = currentLanguageFilter === lang;
    if(wasFiltered){
      currentLanguageFilter = null;
      console.log('✅ Cleared language filter');
    } else {
      currentLanguageFilter = lang;
      console.log(`✅ Filtering by language: ${lang}`);
    }

    // Update language bar to show active state
    updateLanguageBar();

    // If we're clearing the filter OR setting a new one, re-run the search
    // This ensures the backend query includes/excludes the language filter
    if(qEl.value && qEl.value.trim()){
      console.log('🔄 Re-running search with updated language filter');
      await doSearch();
      return;
    }

    // Old behavior: only for when search results already exist
    // In results-only mode, re-render with filter applied
    if(resultsOnlyMode && lastSearchResults.length > 0){
      // refreshAllTiles will apply the language filter
      await refreshAllTiles(currentAsOfMs);

      // Re-render results panel with filtered results
      const filtered = currentLanguageFilter
        ? lastSearchResults.filter(r => r.language === currentLanguageFilter)
        : lastSearchResults;

      console.log(`📊 Filtered ${filtered.length} / ${lastSearchResults.length} results by language`);
      renderResults(filtered, filtered.length, true);

      // Start background preload for filtered files
      if(filtered.length > 0){
        const filePaths = filtered.map(r => r.file_path);
        startBackgroundPreload(filePaths).catch(e => {
          console.error('[preload] Error:', e);
        });
      }

      // IMPORTANT: Recalculate all filter panels after language filter is applied
      // Each filter panel searches within the previous stage, so they cascade
      console.log(`🔄 Recalculating ${filterPanels.length} filter panel(s)...`);
      for(const panel of filterPanels){
        if(panel.query){
          // Re-run the search for this panel (will cascade from new filtered base)
          await updateFilterPanel(panel.id, true); // skipHighlighting=true
        }
      }
      // Update highlighting once after all panels recalculated
      if(filterPanels.length > 0){
        console.log('🎨 Updating filter highlighting after language filter change');
        updateAllFilterHighlighting();
      }
    }
    // In show-all mode, apply dimming
    else if(!resultsOnlyMode){
      // Apply dimming to non-matching language files
      for(const [path, tile] of tiles){
        const fileLang = fileLanguages.get(path);
        if(currentLanguageFilter && fileLang !== currentLanguageFilter){
          tile.classList.add('dim');
        } else {
          tile.classList.remove('dim');
        }
      }

      // Also dim/undim folders
      for(const [folderPath, folderEl] of folders){
        // Check if folder has any files matching the language
        let hasMatch = false;
        for(const [path, lang] of fileLanguages){
          if(fileFolder.get(path) === folderPath){
            if(!currentLanguageFilter || lang === currentLanguageFilter){
              hasMatch = true;
              break;
            }
          }
        }
        if(hasMatch){
          folderEl.classList.remove('dim');
        } else {
          folderEl.classList.add('dim');
        }
      }
    }
  }

  async function spawnAll(){
    try{
      // RESULTS-ONLY MODE: Show codebase overview on initial load
      if(resultsOnlyMode){
        console.log('📋 [spawnAll] Results-only mode: Showing codebase overview');
        renderCodebaseOverview();
        return;
      }

      const res = await fetchJSON('/files');
      const list = res.files || [];

      // Store file metadata for treemap mode and image sizing
      fileMeta.clear();
      for(const f of list){
        if(f.file_path){
          fileMeta.set(f.file_path, {
            size_bytes: f.size_bytes || 0,
            line_count: f.line_count || 1,
            is_binary: f.is_binary || false,
            preview_width: f.preview_width || null,  // Thumbnail width
            preview_height: f.preview_height || null,  // Thumbnail height
            original_width: f.original_width || null,  // Original image width
            original_height: f.original_height || null  // Original image height
          });
        }
      }

      // Build hierarchy and layout (treemap flat, treemap with folders, or traditional)
      if(treemapMode && treemapFoldersMode){
        const tree = buildTree(list.map(f=>f.file_path));
        layoutTreemapWithFolders(tree);
      } else if(treemapMode){
        layoutTreemap(list.map(f => f.file_path));
      } else {
        const tree = buildTree(list.map(f=>f.file_path));
        layoutAndRender(tree);
      }
      // PERFORMANCE FIX: Create placeholder tiles immediately (no content loading)
      // Content will be lazy-loaded on-demand when user clicks a tile (same as Results Only mode)
      for(const f of list){
        try{
          // Create empty tile immediately (synchronous, no network calls)
          openTile(f.file_path);
        }catch(e){ /* ignore */ }
      }

      // Apply folder colors and update language bar
      applyAllFolderColors();
      updateLanguageBar();
    }catch(e){ /* ignore */ }
  }

  // DISABLED: Beads integration (all functions commented out)
  /*
  async function checkBeadsAvailable(){
    try{
      const res = await fetchJSON('/beads/check');
      beadsAvailable = res.available || false;
      if(!beadsAvailable){
        beadsTicketsEl.innerHTML = '<div class="beads-empty">Beads not installed<br/><small>Install with: go install github.com/steveyegge/beads/cmd/bd@latest</small></div>';
        // Hide the panel after showing message briefly
        setTimeout(()=>{
          if(!beadsAvailable && beadsPanelEl){
            beadsPanelEl.classList.add('collapsed');
          }
        }, 3000);
      } else {
        await refreshBeadsTickets();
      }
    }catch(e){
      beadsTicketsEl.innerHTML = '<div class="beads-empty">Error checking Beads</div>';
    }
  }

  async function refreshBeadsTickets(){
    if(!beadsAvailable) return;
    try{
      // Pass project_root as query parameter if available
      const url = currentProjectRoot ? `/beads/list?project_root=${encodeURIComponent(currentProjectRoot)}` : '/beads/list';
      console.log('[beads DEBUG] refreshBeadsTickets url=', url);
      console.log('[beads DEBUG] currentProjectRoot=', currentProjectRoot);
      const res = await fetchJSON(url);
      console.log('[beads DEBUG] response=', res);
      beadsTickets = res.tickets || [];
      console.log('[beads DEBUG] ticket_count=', beadsTickets.length);
      renderBeadsTickets();
      updateBeadsTabCount();
    }catch(e){
      console.error('[beads DEBUG] error=', e);
      beadsTicketsEl.innerHTML = '<div class="beads-empty">Error loading tickets</div>';
    }
  }

  function updateBeadsTabCount(){
    const openCount = beadsTickets.filter(t => t.status === 'open').length;
    if(beadsPanelTabBtn){
      beadsPanelTabBtn.textContent = String(openCount);
    }
  }

  function renderBeadsTickets(){
    const filtered = beadsTickets.filter(ticket => {
      if(beadsCurrentFilter === 'all') return true;
      if(beadsCurrentFilter === 'ready'){
        // TODO: Check if ticket is ready (no blockers)
        return ticket.status === 'open';
      }
      return ticket.status === beadsCurrentFilter;
    });

    if(filtered.length === 0){
      beadsTicketsEl.innerHTML = `<div class="beads-empty">No ${beadsCurrentFilter} tickets</div>`;
      return;
    }

    beadsTicketsEl.innerHTML = '';
    filtered.forEach(ticket => {
      const div = document.createElement('div');
      div.className = 'beads-ticket';
      div.dataset.id = ticket.id;

      const header = document.createElement('div');
      header.className = 'beads-ticket-header';

      const id = document.createElement('div');
      id.className = 'beads-ticket-id';
      id.textContent = ticket.id;

      const badges = document.createElement('div');
      badges.className = 'beads-ticket-badges';

      const statusBadge = document.createElement('span');
      statusBadge.className = `beads-ticket-badge status-${ticket.status}`;
      statusBadge.textContent = ticket.status.replace('_', ' ');

      const priorityBadge = document.createElement('span');
      priorityBadge.className = `beads-ticket-badge priority-${ticket.priority}`;
      priorityBadge.textContent = `P${ticket.priority}`;

      badges.appendChild(statusBadge);
      badges.appendChild(priorityBadge);

      header.appendChild(id);
      header.appendChild(badges);

      const title = document.createElement('div');
      title.className = 'beads-ticket-title';
      title.textContent = ticket.title;

      const meta = document.createElement('div');
      meta.className = 'beads-ticket-meta';

      const type = document.createElement('span');
      type.className = 'beads-ticket-type';
      type.textContent = ticket.issue_type;

      const created = document.createElement('span');
      created.textContent = `Created ${formatBeadsDate(ticket.created_at)}`;

      meta.appendChild(type);
      meta.appendChild(created);

      div.appendChild(header);
      div.appendChild(title);
      div.appendChild(meta);

      // Click to cycle status: open -> in_progress -> closed
      div.onclick = async ()=>{
        const nextStatus = ticket.status === 'open' ? 'in_progress' : ticket.status === 'in_progress' ? 'closed' : 'open';
        try{
          if(nextStatus === 'closed'){
            await fetchJSON('/beads/close', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ id: ticket.id, project_root: currentProjectRoot })
            });
          } else {
            await fetchJSON('/beads/update', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ id: ticket.id, status: nextStatus, project_root: currentProjectRoot })
            });
          }
          showToast(`${ticket.id}: ${nextStatus.replace('_', ' ')}`);
          await refreshBeadsTickets();
        }catch(e){
          showToast(`Failed to update ${ticket.id}`);
        }
      };

      beadsTicketsEl.appendChild(div);
    });
  }

  function formatBeadsDate(dateStr){
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if(days === 0) return 'today';
    if(days === 1) return 'yesterday';
    if(days < 7) return `${days}d ago`;
    if(days < 30) return `${Math.floor(days/7)}w ago`;
    return `${Math.floor(days/30)}mo ago`;
  }

  // Beads panel toggle
  if(beadsPanelToggleBtn){
    beadsPanelToggleBtn.onclick = ()=>{
      beadsPanelEl.classList.toggle('collapsed');
    };
  }
  if(beadsPanelTabBtn){
    beadsPanelTabBtn.onclick = ()=>{
      beadsPanelEl.classList.remove('collapsed');
    };
  }

  // Beads filter buttons
  beadsFilterBtns.forEach(btn => {
    btn.onclick = ()=>{
      beadsFilterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      beadsCurrentFilter = btn.dataset.filter;
      renderBeadsTickets();
    };
  });

  // Note: checkBeadsAvailable() is now called from refreshStatus() after project root is set

  // Poll for Beads updates every 10 seconds when panel is open
  function startBeadsPolling(){
    if(beadsPollInterval) clearInterval(beadsPollInterval);
    beadsPollInterval = setInterval(()=>{
      if(!beadsPanelEl.classList.contains('collapsed') && beadsAvailable){
        refreshBeadsTickets();
      }
    }, 10000);
  }
  startBeadsPolling();
  */
  // END OF DISABLED BEADS INTEGRATION

  // ============================================================================
  // OMARCHY THEME INTEGRATION
  // ============================================================================

  let systemThemeEnabled = localStorage.getItem('systemThemeEnabled') !== 'false'; // Default true
  let systemThemeAvailable = false;

  async function loadSystemTheme(){
    console.log(' [theme] Checking for system theme...');
    try {
      const res = await fetchJSON('/api/system-theme');
      if(res.available){
        systemThemeAvailable = true;
        console.log(' [theme] Omarchy theme system detected!', res.colors);

        // Show toggle button when system theme is available
        if(systemThemeToggleBtn){
          systemThemeToggleBtn.style.display = '';
          // Set initial state
          if(systemThemeEnabled){
            systemThemeToggleBtn.classList.add('active');
          }
        }

        if(systemThemeEnabled){
          applySystemTheme(res.colors, res.syntax, res.font, res.background_url, res.terminal_colors);
        }
      } else {
        systemThemeAvailable = false;
        console.log(' [theme] System theme not available (not running on Omarchy)');
      }
    } catch(e){
      console.warn(' [theme] Failed to load system theme:', e);
      systemThemeAvailable = false;
    }
  }

  function hexToRgba(hex, alpha){
    // Remove # if present
    hex = hex.replace('#', '');

    // Handle short hex (#FFF -> #FFFFFF)
    if(hex.length === 3){
      hex = hex.split('').map(c => c + c).join('');
    }

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function applySystemTheme(colors, syntaxColors, font, backgroundUrl, terminalColors){
    console.log(' [theme] Applying system theme:', { colors, syntaxColors, font, backgroundUrl, terminalColors });

    // Store theme colors for gradient generation
    currentThemeColors = colors;
    currentTerminalColors = terminalColors;

    // Apply CSS variables
    const root = document.documentElement;
    for(const [varName, value] of Object.entries(colors)){
      root.style.setProperty(varName, value);
    }

    // Calculate dynamic accent-based colors from theme accent
    const accentColor = colors['--accent'] || '#39bae6';
    root.style.setProperty('--accent-subtle', hexToRgba(accentColor, 0.08));
    root.style.setProperty('--accent-hover', hexToRgba(accentColor, 0.15));
    root.style.setProperty('--accent-active', hexToRgba(accentColor, 0.2));
    root.style.setProperty('--accent-bright', hexToRgba(accentColor, 0.3));
    root.style.setProperty('--accent-border', hexToRgba(accentColor, 0.4));
    root.style.setProperty('--accent-strong', hexToRgba(accentColor, 0.5));
    root.style.setProperty('--accent-opaque', hexToRgba(accentColor, 0.8));

    // Apply font
    if(font && font.family){
      applySystemFont(font);
    }

    // Apply syntax highlighting colors
    if(syntaxColors && Object.keys(syntaxColors).length > 0){
      applySyntaxTheme(syntaxColors, colors);
    }

    // Apply wallpaper background to workspace with retry and smooth transition
    if(backgroundUrl){
      console.log('🖼️  [theme] Loading new wallpaper:', backgroundUrl);
      loadBackgroundWithRetry(backgroundUrl).then(() => {
        console.log('✅ [theme] Wallpaper loaded successfully');
      }).catch(e => {
        console.warn('⚠️  [theme] Failed to load wallpaper after retries:', e);
      });
    }

    // Regenerate language colors with new theme gradient
    console.log('🎨 [theme] Regenerating language colors with theme gradient...');
    languageColors = {}; // Clear existing colors
    languageList.forEach((lang, idx) => {
      languageColors[lang] = generateThemeGradient(idx, languageList.length);
    });
    updateLanguageBar(); // Refresh language bar with new colors

    showToast(' System theme applied');
  }

  async function loadBackgroundWithRetry(url, maxRetries = 5){
    console.log(`🖼️  [loadBackground] Attempting to load: ${url}`);

    // Try to load the image with retries
    for(let attempt = 0; attempt < maxRetries; attempt++){
      try {
        // Wait before attempting (exponential backoff)
        if(attempt > 0){
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 1s, 2s, 4s, 5s, 5s
          console.log(`🖼️  [loadBackground] Retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Preload image to check if it's available
        const img = new Image();

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Image load timeout'));
          }, 3000);

          img.onload = () => {
            clearTimeout(timeout);
            console.log(`✅ [loadBackground] Image loaded successfully on attempt ${attempt + 1}`);
            resolve();
          };

          img.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('Image failed to load (404 or network error)'));
          };

          img.src = url;
        });

        // Image loaded successfully - apply it with smooth transition
        const oldBackground = workspace.style.backgroundImage;

        // Fade out old background
        workspace.style.transition = 'opacity 0.3s ease';
        workspace.style.opacity = '0.3';

        setTimeout(() => {
          // Apply new background
          workspace.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url('${url}')`;
          workspace.style.backgroundSize = 'cover';
          workspace.style.backgroundPosition = 'center';
          workspace.style.backgroundRepeat = 'no-repeat';
          workspace.style.backgroundAttachment = 'fixed';

          // Fade in new background
          workspace.style.opacity = '1';

          // Remove transition after animation
          setTimeout(() => {
            workspace.style.transition = '';
          }, 300);
        }, 300);

        return; // Success!

      } catch(e){
        console.warn(`⚠️  [loadBackground] Attempt ${attempt + 1} failed:`, e.message);
        if(attempt === maxRetries - 1){
          throw new Error(`Failed to load background after ${maxRetries} attempts`);
        }
      }
    }
  }

  function handleBinaryFileClick(fileData){
    const path = fileData.file_path;
    const binaryType = fileData.binary_type;
    const preview = fileData.metadata?.preview_base64 || fileData.preview_base64;

    console.log(`📦 [handleBinaryFile] Clicked binary file:`, {
      path,
      type: binaryType,
      hasPreview: !!preview
    });

    // If image with preview, show modal
    if(binaryType === 'image' && preview){
      showImagePreviewModal(fileData);
    } else {
      // Download file
      const downloadUrl = `/file/download?path=${encodeURIComponent(path)}`;
      console.log(`📦 [handleBinaryFile] Opening download: ${downloadUrl}`);
      window.open(downloadUrl, '_blank');
      showToast(`Downloading ${path.split('/').pop()}`);
    }
  }

  function showImagePreviewModal(fileData){
    const path = fileData.file_path;
    const preview = fileData.metadata?.preview_base64 || fileData.preview_base64;
    const fileName = path.split('/').pop();

    // Create modal overlay
    const modal = document.createElement('div');
    modal.className = 'binary-preview-modal';
    modal.innerHTML = `
      <div class="binary-preview-content">
        <div class="binary-preview-header">
          <span>${fileName}</span>
          <button class="binary-preview-close">×</button>
        </div>
        <div class="binary-preview-body">
          <img src="${preview}" alt="${fileName}" />
          <div class="binary-preview-info">
            ${fileData.binary_type?.toUpperCase() || 'IMAGE'} ·
            ${(fileData.metadata?.size_bytes || 0 / 1024).toFixed(1)} KB
          </div>
        </div>
        <div class="binary-preview-footer">
          <button class="btn" onclick="window.open('/file/download?path=${encodeURIComponent(path)}', '_blank')">
            Download Full Size
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    const closeBtn = modal.querySelector('.binary-preview-close');
    closeBtn.onclick = () => modal.remove();
    modal.onclick = (e) => {
      if(e.target === modal) modal.remove();
    };
  }

  async function showFolderBrowser(){
    console.log('📁 [showFolderBrowser] Fetching folder list from index...');

    try {
      // Get unique folders from dedicated endpoint (faster than fetching all files)
      const res = await fetchJSON('/folders');
      const folders = res.folders || [];

      console.log(`📁 [showFolderBrowser] Fetched ${folders.length} unique folders from /folders endpoint`);
      if(folders.length > 0){
        console.log(`📁 [showFolderBrowser] Sample folders:`, folders.slice(0, 10));
      }

      // Build tree structure
      const tree = buildFolderTree(folders);

      // Show modal
      return await showFolderTreeModal(tree);

    } catch(e){
      console.error('[showFolderBrowser] Error:', e);
      showToast('Failed to load folders');
      return null;
    }
  }

  function buildFolderTree(folders){
    const root = {};

    folders.forEach(path => {
      const parts = path.split('/');
      let node = root;

      parts.forEach((part, idx) => {
        if(!node[part]){
          node[part] = {
            _path: parts.slice(0, idx + 1).join('/'),
            _children: {}
          };
        }
        node = node[part]._children;
      });
    });

    console.log(`📁 [buildFolderTree] Built tree with ${Object.keys(root).length} top-level folders`);
    console.log(`📁 [buildFolderTree] Top-level keys:`, Object.keys(root).slice(0, 10));

    return root;
  }

  async function showFolderTreeModal(tree){
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'folder-browser-modal';

      const content = document.createElement('div');
      content.className = 'folder-browser-content';

      const header = document.createElement('div');
      header.className = 'folder-browser-header';
      header.innerHTML = `
        <span>Select Folder</span>
        <button class="folder-browser-close">×</button>
      `;

      const body = document.createElement('div');
      body.className = 'folder-browser-body';

      // Render tree
      renderFolderTreeNodes(tree, body, (selectedPath) => {
        modal.remove();
        resolve(selectedPath);
      });

      const closeBtn = header.querySelector('.folder-browser-close');
      closeBtn.onclick = () => {
        modal.remove();
        resolve(null);
      };

      modal.onclick = (e) => {
        if(e.target === modal){
          modal.remove();
          resolve(null);
        }
      };

      content.appendChild(header);
      content.appendChild(body);
      modal.appendChild(content);
      document.body.appendChild(modal);
    });
  }

  function renderFolderTreeNodes(tree, container, onSelect, depth = 0){
    const entries = Object.entries(tree);

    if(depth === 0){
      console.log(`📁 [renderFolderTreeNodes] Rendering ${entries.length} root folders`);
    }

    for(const [name, node] of entries){
      const hasChildren = node._children && Object.keys(node._children).length > 0;

      // Main item row
      const item = document.createElement('div');
      item.className = 'folder-tree-item';
      item.style.paddingLeft = `${depth * 16 + 8}px`;

      // Expand/collapse chevron
      const chevron = document.createElement('span');
      chevron.className = 'folder-tree-chevron';
      chevron.textContent = hasChildren ? '▶' : ' ';
      chevron.style.opacity = hasChildren ? '1' : '0';

      // Folder icon (SVG)
      const icon = document.createElement('span');
      icon.className = 'folder-tree-icon';
      icon.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M1 3.5C1 2.67 1.67 2 2.5 2H6L7 4H13.5C14.33 4 15 4.67 15 5.5V12.5C15 13.33 14.33 14 13.5 14H2.5C1.67 14 1 13.33 1 12.5V3.5Z" fill="currentColor" opacity="0.4"/>
          <path d="M1 5.5C1 4.67 1.67 4 2.5 4H13.5C14.33 4 15 4.67 15 5.5V12.5C15 13.33 14.33 14 13.5 14H2.5C1.67 14 1 13.33 1 12.5V5.5Z" stroke="currentColor" stroke-width="1.5" fill="none"/>
        </svg>
      `;

      // Folder name
      const label = document.createElement('span');
      label.className = 'folder-tree-label';
      label.textContent = name;

      item.appendChild(chevron);
      item.appendChild(icon);
      item.appendChild(label);
      container.appendChild(item);

      // Children container (initially hidden)
      let childrenContainer = null;
      let isExpanded = false;

      if(hasChildren){
        childrenContainer = document.createElement('div');
        childrenContainer.className = 'folder-tree-children';
        childrenContainer.style.display = 'none';
        container.appendChild(childrenContainer);

        // Render children (but hidden)
        renderFolderTreeNodes(node._children, childrenContainer, onSelect, depth + 1);
      }

      // Click chevron to expand/collapse
      chevron.onclick = (e) => {
        e.stopPropagation();
        if(!hasChildren) return;

        isExpanded = !isExpanded;
        chevron.textContent = isExpanded ? '▼' : '▶';
        childrenContainer.style.display = isExpanded ? 'block' : 'none';
      };

      // Click folder name to select
      label.onclick = (e) => {
        e.stopPropagation();
        console.log(`📁 Selected folder: ${node._path}`);
        onSelect(node._path);
      };
    }
  }

  function applySystemFont(font){
    console.log(' [theme] Applying system font:', font);

    // Build mono font-family with fallbacks
    let monoFamily = 'monospace';
    if(font.mono_family){
      const baseName = font.mono_family.replace(/\s*Nerd\s*Font\s*/i, '').trim();
      monoFamily = `'${font.mono_family}', '${baseName}', 'Berkeley Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace`;
    }

    // Build sans font-family with fallbacks
    let sansFamily = 'sans-serif';
    if(font.sans_family){
      const baseName = font.sans_family.replace(/\s*Nerd\s*Font\s*/i, '').trim();
      sansFamily = `'${font.sans_family}', '${baseName}', 'Berkeley Mono', 'Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif`;
    }

    // Apply to CSS variables
    const root = document.documentElement;
    root.style.setProperty('--font-mono', monoFamily);
    root.style.setProperty('--font-sans', sansFamily);

    // Inject global font CSS
    let styleId = 'omarchy-font-theme';
    let styleEl = document.getElementById(styleId);

    if(!styleEl){
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    const monoSize = font.mono_size ? `${font.mono_size}px` : '';

    styleEl.textContent = `
      /* Omarchy System Fonts */

      /* Monospace areas: code, Monaco editor, results */
      .tile pre,
      .tile code,
      pre[class*="language-"],
      code[class*="language-"],
      .result-match,
      .result-file,
      .status,
      #asofLabel {
        font-family: var(--font-mono) !important;
        ${monoSize ? `font-size: ${monoSize} !important;` : ''}
      }

      /* Sans-serif areas: UI, buttons, headers */
      body,
      .btn,
      .btn-toggle,
      .btn-toggle-small,
      .results-count,
      .filter-panel-header,
      .language-bar,
      .add-filter-btn,
      input[type="text"] {
        font-family: var(--font-sans) !important;
      }

      /* Monaco editor font override */
      .monaco-editor .view-lines {
        font-family: var(--font-mono) !important;
        ${monoSize ? `font-size: ${monoSize} !important;` : ''}
      }
    `;

    // Update Monaco editor options if already loaded
    if(typeof monaco !== 'undefined'){
      const editorOptions = {
        fontFamily: monoFamily,
      };
      if(font.mono_size){
        editorOptions.fontSize = parseInt(font.mono_size);
      }

      // Update overlay editor if exists
      if(overlayEditor){
        overlayEditor.updateOptions(editorOptions);
      }
      // Update diff editor if exists
      if(diffEditor){
        diffEditor.updateOptions(editorOptions);
      }
    }
  }

  function applySyntaxTheme(syntaxColors, uiColors){
    console.log(' [theme] Applying syntax highlighting:', syntaxColors);

    // Inject custom Prism.js theme overrides
    let styleId = 'omarchy-syntax-theme';
    let styleEl = document.getElementById(styleId);

    if(!styleEl){
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    // Generate CSS for Prism.js token classes
    const css = `
      /* Omarchy Syntax Theme (Prism.js) */
      .token.comment,
      .token.prolog,
      .token.doctype,
      .token.cdata {
        color: ${syntaxColors.comment} !important;
      }

      .token.punctuation {
        color: ${syntaxColors.punctuation} !important;
      }

      .token.property,
      .token.tag,
      .token.boolean,
      .token.constant,
      .token.symbol,
      .token.deleted {
        color: ${syntaxColors.constant} !important;
      }

      .token.selector,
      .token.attr-name,
      .token.string,
      .token.char,
      .token.builtin,
      .token.inserted {
        color: ${syntaxColors.string} !important;
      }

      .token.operator,
      .token.entity,
      .token.url,
      .language-css .token.string,
      .style .token.string {
        color: ${syntaxColors.operator} !important;
      }

      .token.atrule,
      .token.attr-value,
      .token.keyword {
        color: ${syntaxColors.keyword} !important;
      }

      .token.function,
      .token.class-name {
        color: ${syntaxColors.function} !important;
      }

      .token.number {
        color: ${syntaxColors.number} !important;
      }

      .token.variable {
        color: ${syntaxColors.variable} !important;
      }

      .token.regex,
      .token.important {
        color: ${syntaxColors.number} !important;
        font-weight: bold;
      }
    `;

    styleEl.textContent = css;

    // Always call applyMonacoTheme to store theme data, even if Monaco isn't loaded yet
    // This ensures the theme is available when Monaco loads later
    applyMonacoTheme(syntaxColors, uiColors || {});
  }

  // Helper to convert rgba/hex to RRGGBB for Monaco
  function toMonacoColor(color){
    if(!color) return 'FFFFFF';

    // If hex, strip #
    if(color.startsWith('#')){
      return color.substring(1).toUpperCase();
    }

    // If rgba, extract rgb and convert to hex
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if(rgbaMatch){
      const r = parseInt(rgbaMatch[1]).toString(16).padStart(2, '0');
      const g = parseInt(rgbaMatch[2]).toString(16).padStart(2, '0');
      const b = parseInt(rgbaMatch[3]).toString(16).padStart(2, '0');
      return (r + g + b).toUpperCase();
    }

    return 'FFFFFF';
  }

  // Store current theme data globally for Monaco theme definition
  let currentOmarchyTheme = null;

  function applyMonacoTheme(syntaxColors, uiColors){
    console.log(' [theme] Creating Monaco theme');

    // Store theme data globally
    currentOmarchyTheme = { syntax: syntaxColors, ui: uiColors };

    // Check if Monaco is loaded
    if(typeof monaco === 'undefined'){
      console.log(' [theme] Monaco not loaded yet, theme will be applied when Monaco loads');
      return;
    }

    try {
      const bg = toMonacoColor(uiColors['--bg'] || '#0a1428');
      const bgt = toMonacoColor(uiColors['--bg'] + '90' || '#0a1428');
      const fg = toMonacoColor(uiColors['--text'] || '#f0f8ff');
      const accent = toMonacoColor(uiColors['--accent'] || '#39bae6');
      const border = toMonacoColor(uiColors['--border'] || '#44475a');

      // Define custom Monaco theme with comprehensive token mappings
      monaco.editor.defineTheme('omarchy', {
        base: 'vs-dark',
        inherit: false, // Don't inherit to have full control
        rules: [
          // Comments
          { token: 'comment', foreground: toMonacoColor(syntaxColors.comment) },
          { token: 'comment.line', foreground: toMonacoColor(syntaxColors.comment) },
          { token: 'comment.block', foreground: toMonacoColor(syntaxColors.comment) },

          // Keywords
          { token: 'keyword', foreground: toMonacoColor(syntaxColors.keyword), fontStyle: 'bold' },
          { token: 'keyword.control', foreground: toMonacoColor(syntaxColors.keyword), fontStyle: 'bold' },

          // Strings
          { token: 'string', foreground: toMonacoColor(syntaxColors.string) },
          { token: 'string.quoted', foreground: toMonacoColor(syntaxColors.string) },

          // Numbers
          { token: 'number', foreground: toMonacoColor(syntaxColors.number) },
          { token: 'number.hex', foreground: toMonacoColor(syntaxColors.number) },
          { token: 'number.float', foreground: toMonacoColor(syntaxColors.number) },
          { token: 'constant.numeric', foreground: toMonacoColor(syntaxColors.number) },

          // Functions
          { token: 'entity.name.function', foreground: toMonacoColor(syntaxColors.function) },
          { token: 'support.function', foreground: toMonacoColor(syntaxColors.function) },

          // Classes/Types
          { token: 'entity.name.class', foreground: toMonacoColor(syntaxColors.class) },
          { token: 'entity.name.type', foreground: toMonacoColor(syntaxColors.class) },
          { token: 'support.class', foreground: toMonacoColor(syntaxColors.class) },
          { token: 'support.type', foreground: toMonacoColor(syntaxColors.class) },

          // Variables
          { token: 'variable', foreground: toMonacoColor(syntaxColors.variable) },
          { token: 'variable.parameter', foreground: toMonacoColor(syntaxColors.variable) },

          // Constants
          { token: 'constant', foreground: toMonacoColor(syntaxColors.constant) },
          { token: 'constant.language', foreground: toMonacoColor(syntaxColors.constant) },

          // Operators
          { token: 'keyword.operator', foreground: toMonacoColor(syntaxColors.operator) },

          // Punctuation
          { token: 'punctuation', foreground: toMonacoColor(syntaxColors.punctuation) },
          { token: 'delimiter', foreground: toMonacoColor(syntaxColors.punctuation) },
        ],
        colors: {
          'editor.background': '#' + bg,
          'editor.foreground': '#' + fg,
          'editor.lineHighlightBackground': '#' + bg + '40',
          'editor.selectionBackground': '#' + accent + '40',
          'editor.inactiveSelectionBackground': '#' + accent + '20',
          'editorCursor.foreground': '#' + accent,
          'editorLineNumber.foreground': '#' + toMonacoColor(syntaxColors.comment),
          'editorLineNumber.activeForeground': '#' + accent,
          'editorIndentGuide.background': '#' + border + '40',
          'editorIndentGuide.activeBackground': '#' + border,
          'minimap.background': '#' + bg + '00',  // Transparent to match editor
          'minimapSlider.background': '#' + accent + '30',
          'minimapSlider.hoverBackground': '#' + accent + '40',
          'minimapSlider.activeBackground': '#' + accent + '50',
        }
      });

      // Apply theme to existing editors
      if(overlayEditor){
        monaco.editor.setTheme('omarchy');
      }
      if(diffEditor){
        monaco.editor.setTheme('omarchy');
      }

      console.log(' [theme] Monaco theme applied');
    } catch(e){
      console.warn(' [theme] Failed to apply Monaco theme:', e);
    }
  }

  function clearSystemTheme(){
    console.log(' [theme] Clearing system theme, reverting to default');

    // Clear all CSS variable overrides
    const root = document.documentElement;
    root.style.removeProperty('--bg');
    root.style.removeProperty('--text');
    root.style.removeProperty('--muted');
    root.style.removeProperty('--border');
    root.style.removeProperty('--accent');
    root.style.removeProperty('--hover');

    // Clear syntax highlighting overrides
    const syntaxStyleEl = document.getElementById('omarchy-syntax-theme');
    if(syntaxStyleEl){
      syntaxStyleEl.remove();
    }

    // Clear font overrides
    const fontStyleEl = document.getElementById('omarchy-font-theme');
    if(fontStyleEl){
      fontStyleEl.remove();
    }

    // Clear workspace wallpaper
    workspace.style.backgroundImage = '';

    // Revert Monaco to default theme
    if(typeof monaco !== 'undefined'){
      try {
        monaco.editor.setTheme('vs-dark');
      } catch(e){ /* ignore */ }
    }

    showToast('System theme disabled');
  }

  function toggleSystemTheme(){
    systemThemeEnabled = !systemThemeEnabled;
    localStorage.setItem('systemThemeEnabled', String(systemThemeEnabled));

    // Update button state
    if(systemThemeToggleBtn){
      if(systemThemeEnabled){
        systemThemeToggleBtn.classList.add('active');
      } else {
        systemThemeToggleBtn.classList.remove('active');
      }
    }

    if(systemThemeEnabled){
      loadSystemTheme(); // Re-load and apply
    } else {
      clearSystemTheme();
    }
  }

  // Wire up toggle button
  if(systemThemeToggleBtn){
    systemThemeToggleBtn.onclick = toggleSystemTheme;
  }

  // Load theme on startup
  loadSystemTheme();

  
  // ============================================================================
  // END OMARCHY THEME INTEGRATION
  // ============================================================================

  // Start performance monitoring
  console.log('🚀 [APP] Initializing performance monitoring');
  setTimeout(startMemoryMonitoring, 1000);

})();

// ============================================================================
// FALLING FILES PHYSICS SIMULATION
// ============================================================================

// Physics variables declared at top with other globals
if(typeof window.physicsEngine === 'undefined'){
  window.physicsEngine = null;
  window.physicsWorld = null;
  window.physicsRender = null;
  window.fallingBlocks = new Map();
  window.fallingFilesEnabled = true;
}


function initPhysicsSimulation(){
  if(typeof Matter === 'undefined'){
    console.warn('⚠️  Matter.js not loaded, falling files disabled');
    return;
  }

  console.log('🎮 [physics] Initializing Matter.js...');

  const pCanvas = document.getElementById('physicsCanvas');
  if(!pCanvas) return;


  // Create engine  
  window.physicsEngine = Matter.Engine.create({
    gravity: { x: 0, y: 0.8 }
  });
  window.physicsWorld = window.physicsEngine.world;

  // Setup canvas
  const width = pCanvas.width = window.innerWidth;
  const height = pCanvas.height = window.innerHeight;

  window.physicsRender = Matter.Render.create({
    canvas: pCanvas,
    engine: window.physicsEngine,
    options: {
      width, height,
      wireframes: false,
      background: 'transparent'
    }
  });

  // Boundaries
  const ground = Matter.Bodies.rectangle(width/2, height + 25, width, 50, {
    isStatic: true,
    render: { fillStyle: 'transparent' }
  });

  const leftWall = Matter.Bodies.rectangle(-25, height/2, 50, height, {
    isStatic: true,
    render: { fillStyle: 'transparent' }
  });

  const rightWall = Matter.Bodies.rectangle(width + 25, height/2, 50, height, {
    isStatic: true,
    render: { fillStyle: 'transparent' }
  });

  Matter.World.add(window.physicsWorld, [ground, leftWall, rightWall]);

  // Start engines (use Runner instead of deprecated Engine.run)
  window.physicsRunner = Matter.Runner.create();
  Matter.Runner.run(window.physicsRunner, window.physicsEngine);
  Matter.Render.run(window.physicsRender);

  // Track active collisions for crush particle emission
  window.activeCollisions = new Map(); // blockId -> [{otherBlockId, contactPoint}]

  // Listen for block-to-block collisions (track for crush particles)
  Matter.Events.on(window.physicsEngine, 'collisionStart', (event) => {
    event.pairs.forEach(pair => {
      const bodyA = pair.bodyA;
      const bodyB = pair.bodyB;

      // Track collision if either block is at risk (for crush particles)
      const dataA = window.fallingBlocks.get(bodyA.id);
      const dataB = window.fallingBlocks.get(bodyB.id);

      if(dataA && dataB){
        const contactPoint = pair.collision.supports[0];

        // Store collision for both blocks
        if(!window.activeCollisions.has(bodyA.id)){
          window.activeCollisions.set(bodyA.id, []);
        }
        if(!window.activeCollisions.has(bodyB.id)){
          window.activeCollisions.set(bodyB.id, []);
        }

        window.activeCollisions.get(bodyA.id).push({
          otherId: bodyB.id,
          point: contactPoint
        });
        window.activeCollisions.get(bodyB.id).push({
          otherId: bodyA.id,
          point: contactPoint
        });
      }

      // Only particles for block-to-block collisions (not walls/ground)
      const isBlockA = window.fallingBlocks.has(bodyA.id);
      const isBlockB = window.fallingBlocks.has(bodyB.id);

      //console.log('💥 [physics] Pair:', {isBlockA, isBlockB, bodyAId: bodyA.id, bodyBId: bodyB.id});

      if(isBlockA && isBlockB){
        const colorA = bodyA.render.fillStyle;
        const colorB = bodyB.render.fillStyle;
        const point = pair.collision.supports[0];
        
        // Calculate impact velocity
        const vA = bodyA.velocity;
        const vB = bodyB.velocity;
        const relativeVelocity = Math.sqrt(
          Math.pow(vA.x - vB.x, 2) + Math.pow(vA.y - vB.y, 2)
        );

        //console.log('💥 [physics] Block collision! Velocity:', relativeVelocity.toFixed(2));

        if(point && window.spawnCollisionParticles){
          window.spawnCollisionParticles(point, colorA, colorB, relativeVelocity);
        }
      }
    });
  });

  // Custom text rendering and particle effects
  Matter.Events.on(window.physicsRender, 'afterRender', () => {
    const ctx = window.physicsRender.context;

    // Update and render particles FIRST (behind text)
    if(typeof window.updateParticles === 'function'){
      window.updateParticles();
    }

    ctx.save();

    window.fallingBlocks.forEach((data) => {
      const body = data.body;
      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);

      // No visual distortion - just show countdown and particles
      // Blocks stay solid and stable, only particles show degradation

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Draw countdown timer if marked for crumbling
      if(false) { //(data.markedForCrumble){ // debug: disable block distortion
        const timeLeft = Math.max(0, data.crumbleAt - Date.now());
        const seconds = (timeLeft / 1000).toFixed(1);

        // Draw countdown at top
        ctx.fillStyle = 'rgba(255, 80, 80, 0.9)';
        ctx.font = 'bold 16px monospace';
        ctx.fillText(`⏱ ${seconds}s`, 0, -18);
      } else {
        // Draw action badge at top (normal blocks)
        const action = (data.action || 'updated').toUpperCase();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '13px monospace';
        ctx.fontWeight = '400';
        ctx.fillText(action, 0, -12);
      }

      // Draw file path at bottom
      const text = data.displayPath || data.fileName || data.path;
      ctx.fillStyle = '#fff';
      ctx.font = '15px monospace';
      ctx.fontWeight = '500';
      ctx.lineWidth = 4;
      ctx.fillText(text, 0, 4);
      ctx.restore();
    });

    // Emit particles from at-risk blocks (pressure effects) 
    const now = Date.now(); 
    window.lastCrushParticleEmit = window.lastCrushParticleEmit || 0;
    window.lastCrackParticleEmit = window.lastCrackParticleEmit || 0;

    // Emit crush particles at contact points every 200ms (only from marked blocks)
    if(now - window.lastCrushParticleEmit > 200){
      window.fallingBlocks.forEach((data) => {
        if(data.markedForCrumble){
          const collisions = window.activeCollisions.get(data.body.id) || [];

          // Emit dust from contact points (being crushed!)
          if(collisions.length > 0){
            const blockColor = data.body.render.fillStyle; // Use exact block color
            collisions.forEach(collision => {
              // Randomly emit (40% chance per contact for intermittent effect)
              if(Math.random() < 0.4){
                emitCrushParticle(collision.point.x, collision.point.y, blockColor);
              }
            });
          }
        }
      });

      // Clear old collision data (fresh collisions tracked each frame)
      window.activeCollisions.clear();
      window.lastCrushParticleEmit = now;
    }

    // Emit cracking particles from block edges every 150ms (pieces breaking off)
    if(now - window.lastCrackParticleEmit > 150){
      window.fallingBlocks.forEach((data) => {
        if(data.markedForCrumble){
          const timeLeft = data.crumbleAt - now;
          const countdownProgress = 1 - (timeLeft / 6000); // 0->1 as countdown progresses

          // Emission rate increases as block approaches crumbling
          const emissionChance = 0.2 + countdownProgress * 0.5; // 20% -> 70% over countdown

          // Randomly emit from edges (more frequent as countdown progresses)
          if(Math.random() < emissionChance){
            const body = data.body;
            const bounds = body.bounds;

            // Pick a random edge point (favor bottom/sides where pressure is)
            const edge = Math.floor(Math.random() * 4);
            let px, py;

            switch(edge){
              case 0: // Top edge (less common)
                px = bounds.min.x + Math.random() * (bounds.max.x - bounds.min.x);
                py = bounds.min.y;
                break;
              case 1: // Right edge
                px = bounds.max.x;
                py = bounds.min.y + Math.random() * (bounds.max.y - bounds.min.y);
                break;
              case 2: // Bottom edge (most common - being crushed from below)
                px = bounds.min.x + Math.random() * (bounds.max.x - bounds.min.x);
                py = bounds.max.y;
                break;
              case 3: // Left edge
                px = bounds.min.x;
                py = bounds.min.y + Math.random() * (bounds.max.y - bounds.min.y);
                break;
            }

            const blockColor = data.body.render.fillStyle; // Use exact block color
            emitCrackParticle(px, py, blockColor);
          }
        }
      });
      window.lastCrackParticleEmit = now;
    }

    // Update and cleanup crumbling chunks (keep solid until removal)
    window.crumblingChunks = (window.crumblingChunks || []).filter(chunkData => {
      const age = now - chunkData.createdAt;

      // Remove completely after duration
      if(age > chunkData.duration){
        // CRITICAL: Remove from physics world immediately
        try {
          Matter.World.remove(window.physicsWorld, chunkData.body);
        } catch(e){
          // Already removed, ignore
        }
        return false; // Remove from tracking array
      }

      // Keep full opacity until very end (no ghosting)
      const fadeProgress = age / chunkData.duration;
      if(fadeProgress > 0.95){
        // Quick fade only in last 5%
        chunkData.body.render.opacity = (1 - fadeProgress) / 0.05;
      } else {
        chunkData.body.render.opacity = 0.9; // Stay solid
      }

      return true;
    });

    // Update and cleanup crush particles (keep solid until removal)
    window.crushParticles = (window.crushParticles || []).filter(particleData => {
      const age = now - particleData.createdAt;
      if(age > particleData.duration){
        return false; // Already auto-removed by setTimeout
      }

      // Keep solid until very end
      const fadeProgress = age / particleData.duration;
      if(fadeProgress > 0.92){
        // Quick fade only in last 8%
        particleData.body.render.opacity = (1 - fadeProgress) / 0.08;
      } else {
        particleData.body.render.opacity = 0.7; // Stay visible
      }

      return true;
    });

    // Update and cleanup crack particles (keep solid until removal)
    window.crackParticles = (window.crackParticles || []).filter(particleData => {
      const age = now - particleData.createdAt;
      if(age > particleData.duration){
        return false; // Already auto-removed by setTimeout
      }

      // Keep solid until very end
      const fadeProgress = age / particleData.duration;
      if(fadeProgress > 0.92){
        // Quick fade only in last 8%
        particleData.body.render.opacity = (1 - fadeProgress) / 0.08;
      } else {
        particleData.body.render.opacity = 0.8; // Stay visible
      }

      return true;
    });

    ctx.restore();
  });

  console.log('✅ [physics] Initialized');
}

window.spawnFallingFileBlock = function(fileData){
  if(!window.physicsEngine || !window.fallingFilesEnabled) return;

  const { file_path, language, action } = fileData;
  // Use full path, not just filename
  const displayPath = file_path;



  // Spawn position: avoid first 500px (sidebar area)
  const minX = 550;  // After sidebar (435px) + margin
  const maxX = window.innerWidth - 100;
  const x = Math.random() * (maxX - minX) + minX;
  const y = -50;

  // Width based on full path length (make it fit!)
  const charWidth = 9;  // Approximate monospace char width
  const padding = 6;
  //const width = Math.min(600, Math.max(150, displayPath.length * charWidth + padding));
  const width = displayPath.length * charWidth + padding;
  const height = 50;  // Taller to fit action + path


  // IMPORTANT: Physics code runs in global scope (window.spawnFallingFileBlock)
  // Need to access getLanguageColor from main app context 
  let color = '#39bae6';

  // Access function from window/global scope
  const colorFn = window.getLanguageColor || getLanguageColor;
  if(typeof colorFn === 'function'){
    colorFull = colorFn(language)
    color = colorFull + '70';
  } else {
    console.warn('🎨 [physics] getLanguageColor not accessible from physics context');
  }

  console.log(`🎨 [physics] Language: "${language}", Color: ${color}, languageColors size:`, Object.keys(window.languageColors || {}).length);

  const block = Matter.Bodies.rectangle(x, y, width, height, {
    restitution: 0.6,
    friction: 0.5,
    density: 0.002,
    angle: (Math.random() - 0.5) * 0.3,
    angularVelocity: (Math.random() - 0.5) * 0.15,
    render: {
      fillStyle: color,
      strokeStyle: colorFull || '#000000', 
      lineWidth: 2, 
      opacity: 0.85
    }
  });

  Matter.World.add(window.physicsWorld, block);

  const date = new Date(Date.now());
  const readable = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  // Example: "2025-10-26 15:45:30"  

  window.fallingBlocks.set(block.id, {
    path: file_path,
    displayPath: displayPath,
    language,
    action: action + ' ' + readable,  
    createdAt: Date.now(),
    body: block
  });

  console.log(`🎮 [physics] Spawned: ${displayPath} (${language})`);

  // Smart cleanup: explode old blocks when stack gets too high
  checkAndExplodeIfNeeded();
};

// Monitor stack height and trigger explosions if approaching top
function checkAndExplodeIfNeeded(){
  if(!window.physicsWorld || window.fallingBlocks.size === 0) return;

  const blocks = Array.from(window.fallingBlocks.values());
  const viewportHeight = window.innerHeight;

  // Only check blocks that have SETTLED (low velocity = landed on pile)
  const settledBlocks = blocks.filter(b => {
    const vel = b.body.velocity;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
    const angularSpeed = Math.abs(b.body.angularVelocity);

    // Consider settled if barely moving AND below top 100px (not freshly spawned)
    return speed < 0.5 && angularSpeed < 0.05 && b.body.position.y > 100;
  });

  if(settledBlocks.length === 0) return; // No settled blocks yet

  // Find highest SETTLED block (lowest Y value of landed blocks)
  const minY = Math.min(...settledBlocks.map(b => b.body.position.y));
  const stackTop = minY;

  // Calculate how much of viewport is filled (0 = empty, 1 = stack at top)
  const fillRatio = (viewportHeight - stackTop) / viewportHeight;

  // Warning threshold: mark blocks for imminent explosion
  const WARNING_THRESHOLD = 0.6;
  const DANGER_THRESHOLD = 0.7;

  // Sort by age
  const sortedByAge = blocks.sort((a, b) => a.createdAt - b.createdAt);

  // Clear atRisk flags ONLY for blocks not marked for crumbling
  blocks.forEach(b => {
    if(!b.markedForCrumble){
      b.atRisk = false;
    }
  });

  // Sentence oldest blocks to crumble if stack is getting high (ONE WAY TRIP!)
  if(fillRatio > WARNING_THRESHOLD){
    const numToSentence = Math.ceil(blocks.length * 0.25);

    for(let i = 0; i < numToSentence; i++){
      const block = sortedByAge[i];

      // Mark for crumbling if not already marked
      if(!block.markedForCrumble){
        const crumbleDelay = 5000 + Math.random() * 1000; // 5-6 seconds countdown
        block.markedForCrumble = true;
        block.crumbleAt = Date.now() + crumbleDelay;
        block.atRisk = true;  // Show visual warning

        console.log(`⏰ [physics] Sentenced ${block.displayPath} to crumble in ${(crumbleDelay/1000).toFixed(1)}s (no escape!)`);

        // Schedule exact crumbling at countdown zero (guaranteed execution)
        block.crumbleTimeout = setTimeout(() => {
          if(window.fallingBlocks && window.fallingBlocks.has(block.body.id)){
            console.log(`💀 [physics] Countdown ZERO! Crumbling ${block.displayPath}`);
            crumbleBlock(block);
          }
        }, crumbleDelay);
      }
    }
  }

  // Debug logging (throttled to avoid spam)
  const now = Date.now();
  if(!window.lastStackCheckLog || now - window.lastStackCheckLog > 3000){
    if(settledBlocks.length > 5){ // Only log if there's actually a stack
      const markedCount = blocks.filter(b => b.markedForCrumble).length;
      console.log(`📊 [physics] Stack: ${settledBlocks.length} settled, top at ${stackTop.toFixed(0)}px, fill: ${(fillRatio * 100).toFixed(0)}%, marked: ${markedCount}`);
      window.lastStackCheckLog = now;
    }
  }

  // Crumbling happens via setTimeout (scheduled when block is sentenced)
  // No manual checking needed - guaranteed execution at countdown zero
}

// Crumble a block into falling chunks (digital decay effect)
window.crumblingChunks = window.crumblingChunks || []; // Track crumbling fragments

function crumbleBlock(blockData){
  const body = blockData.body;
  const pos = body.position;
  const width = body.bounds.max.x - body.bounds.min.x;
  const height = body.bounds.max.y - body.bounds.min.y;

  console.log(`🧱 [physics] Crumbling ${blockData.displayPath}...`);

  // Get block color
  const color = body.render.fillStyle;

  // Break into 6-9 chunks (irregular pieces)
  const numChunks = 6 + Math.floor(Math.random() * 4);
  const chunkSize = Math.min(width, height) / 3; // Smaller fragments

  for(let i = 0; i < numChunks; i++){
    // Random position within original block bounds
    const offsetX = (Math.random() - 0.5) * width * 0.6;
    const offsetY = (Math.random() - 0.5) * height * 0.6;

    // Random chunk dimensions
    const chunkW = chunkSize * (0.5 + Math.random() * 0.5);
    const chunkH = chunkSize * (0.5 + Math.random() * 0.5);

    // Create chunk body
    const chunk = Matter.Bodies.rectangle(
      pos.x + offsetX,
      pos.y + offsetY,
      chunkW,
      chunkH,
      {
        restitution: 0.3,
        friction: 0.7,
        density: 0.001,
        angle: Math.random() * Math.PI * 2,
        angularVelocity: (Math.random() - 0.5) * 0.2,
        render: {
          fillStyle: color,
          strokeStyle: color.replace(/[0-9a-f]{2}$/, 'FF'), // Solid stroke
          lineWidth: 1,
          opacity: 0.9
        }
      }
    );

    // Small random velocity (gentle crumble, not explosion)
    Matter.Body.setVelocity(chunk, {
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.2) * 1.5  // Slight downward bias
    });

    Matter.World.add(window.physicsWorld, chunk);

    // Track chunk for removal (stays solid, then quick disappear)
    window.crumblingChunks.push({
      body: chunk,
      createdAt: Date.now(),
      duration: 2000,  // 2 seconds then remove
      language: blockData.language
    });
  }

  // Clear scheduled crumble timeout if it exists
  if(blockData.crumbleTimeout){
    clearTimeout(blockData.crumbleTimeout);
  }

  // Remove original block immediately (it's been replaced by chunks)
  Matter.World.remove(window.physicsWorld, body);
  window.fallingBlocks.delete(body.id);

  // Clear collision tracking for this block
  if(window.activeCollisions){
    window.activeCollisions.delete(body.id);
  }

  console.log(`   ✨ Created ${numChunks} crumbling chunks (solid for 2s, then vanish)`);

  // Optional: Very subtle gravity disturbance to nearby blocks (no visual effect)
  for(const [id, otherData] of window.fallingBlocks){
    if(otherData === blockData) continue;

    const otherBody = otherData.body;
    const dx = otherBody.position.x - pos.x;
    const dy = otherBody.position.y - pos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if(distance < 150 && distance > 0){
      // Very gentle nudge (barely noticeable)
      const forceMagnitude = 0.005 * (1 - distance / 150);
      const forceX = (dx / distance) * forceMagnitude;
      const forceY = (dy / distance) * forceMagnitude;

      Matter.Body.applyForce(otherBody, otherBody.position, {
        x: forceX,
        y: forceY
      });
    }
  }
}

// Emit small crush particle (dust being squeezed out from compression)
window.crushParticles = window.crushParticles || [];

function emitCrushParticle(x, y, blockColor){
  if(!window.physicsWorld) return;

  const size = 2 + Math.random() * 4; // Tiny dust particles

  // Use exact block color (already has alpha channel)
  const color = blockColor;

  const particle = Matter.Bodies.circle(x, y, size, {
    restitution: 0.2,
    friction: 0.8,
    density: 0.0003,
    render: {
      fillStyle: color,  // Use block's exact color
      strokeStyle: 'transparent',
      lineWidth: 0
    }
  });

  // Gentle sideways motion (being squeezed out)
  const sideways = (Math.random() - 0.5) * 0.015;
  const upward = -0.008 - Math.random() * 0.005; // Float upward slightly

  Matter.Body.setVelocity(particle, {
    x: sideways,
    y: upward
  });

  Matter.World.add(window.physicsWorld, particle);

  // Track for removal (stays solid)
  window.crushParticles.push({
    body: particle,
    createdAt: Date.now(),
    duration: 1200  // 1.2 seconds then remove
  });

  // Auto-cleanup
  setTimeout(() => {
    if(window.physicsWorld){
      try {
        Matter.World.remove(window.physicsWorld, particle);
      } catch(e){
        // Already removed
      }
    }
  }, 1200);
}

// Emit crack particle (fragment breaking off from block edge under pressure)
window.crackParticles = window.crackParticles || [];

function emitCrackParticle(x, y, blockColor){
  if(!window.physicsWorld) return;

  const size = 3 + Math.random() * 6; // Slightly larger than crush dust (visible fragments)

  // Use exact block color
  const color = blockColor;

  // Use rectangles for crack fragments (not circles - looks more like chipped pieces)
  const w = size * (0.8 + Math.random() * 0.4);
  const h = size * (0.8 + Math.random() * 0.4);

  const particle = Matter.Bodies.rectangle(x, y, w, h, {
    restitution: 0.4,
    friction: 0.6,
    density: 0.0004,
    angle: Math.random() * Math.PI * 2,
    angularVelocity: (Math.random() - 0.5) * 0.1,
    render: {
      fillStyle: color,  // Use block's exact color
      strokeStyle: color,  // Match fill
      lineWidth: 1
    }
  });

  // Fall downward with slight horizontal variance (pieces breaking off)
  const sideways = (Math.random() - 0.5) * 0.01;
  const downward = 0.005 + Math.random() * 0.005; // Fall down (not up!)

  Matter.Body.setVelocity(particle, {
    x: sideways,
    y: downward
  });

  Matter.World.add(window.physicsWorld, particle);

  // Track for removal (stays solid)
  window.crackParticles.push({
    body: particle,
    createdAt: Date.now(),
    duration: 1500  // 1.5 seconds then remove
  });

  // Auto-cleanup
  setTimeout(() => {
    if(window.physicsWorld){
      try {
        Matter.World.remove(window.physicsWorld, particle);
      } catch(e){
        // Already removed
      }
    }
  }, 1500);
}

// Restore Matter.js and initialize physics
setTimeout(() => {
  // Restore from backup if Monaco's RequireJS interfered
  if(typeof Matter === 'undefined' && typeof window.MatterBackup !== 'undefined'){
    window.Matter = window.MatterBackup;
    console.log('🔄 Restored Matter from backup');
  }

  if(typeof Matter !== 'undefined'){
    console.log('✅ Matter.js ready! Version:', Matter.version);
    if(document.getElementById('physicsCanvas')){
      initPhysicsSimulation();
    }
  } else {
    console.error('❌ Matter.js not available');
    console.error('   window.MatterBackup:', typeof window.MatterBackup);
  }
}, 1500);


// Expose clear function globally
window.clearAllFallingBlocks = function(){
  if(!window.physicsWorld) return;

  // Clear falling blocks
  window.fallingBlocks.forEach((data) => {
    Matter.World.remove(window.physicsWorld, data.body);
  });
  window.fallingBlocks.clear();

  // Clear crumbling chunks
  (window.crumblingChunks || []).forEach(chunk => {
    Matter.World.remove(window.physicsWorld, chunk.body);
  });
  window.crumblingChunks = [];

  // Clear crush particles
  (window.crushParticles || []).forEach(particle => {
    Matter.World.remove(window.physicsWorld, particle.body);
  });
  window.crushParticles = [];

  // Clear crack particles
  (window.crackParticles || []).forEach(particle => {
    try {
      Matter.World.remove(window.physicsWorld, particle.body);
    } catch(e){
      // Already removed
    }
  });
  window.crackParticles = [];

  console.log('🧹 [physics] Cleared all blocks, chunks, and particles');
};

// Expose crumble trigger for testing/manual cleanup
window.crumbleOldestBlocks = function(count = 5){
  if(!window.physicsWorld || window.fallingBlocks.size === 0){
    console.warn('No blocks to crumble!');
    return;
  }

  const blocks = Array.from(window.fallingBlocks.values());
  const oldest = blocks
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, count);

  console.log(`🧱 [manual] Crumbling ${oldest.length} blocks...`);
  oldest.forEach((blockData, index) => {
    setTimeout(() => {
      if(window.fallingBlocks.has(blockData.body.id)){
        crumbleBlock(blockData);
      }
    }, index * 120); // Staggered cascade
  });
};

// Legacy alias
window.explodeOldestBlocks = window.crumbleOldestBlocks;

// Collision particles system
window.collisionParticles = [];

// Listen for collisions
if(window.physicsEngine){
  Matter.Events.on(window.physicsEngine, 'collisionStart', (event) => {
    event.pairs.forEach(pair => {
      const bodyA = pair.bodyA;
      const bodyB = pair.bodyB;

      // Only create particles for block-to-block collisions (not walls/ground)
      const isBlockA = window.fallingBlocks.has(bodyA.id);
      const isBlockB = window.fallingBlocks.has(bodyB.id);

      if(isBlockA && isBlockB){
        // Get colors of both blocks
        const colorA = bodyA.render.fillStyle;
        const colorB = bodyB.render.fillStyle;

        // Spawn particles at collision point
        spawnCollisionParticles(pair.collision.supports[0], colorA, colorB);
      }
    });
  });
}

window.spawnCollisionParticles = function(point, colorA, colorB){
  //console.log('✨ [particles] Spawning at', point, 'colors:', colorA, colorB);
  if(!point) return;

  // Mix the two colors
  const mixedColor = window.mixColors(colorA, colorB);

  // Spawn 6-10 small particles
  const particleCount = Math.floor(Math.random() * 5) + 6;
  //console.log('✨ [particles] Creating', particleCount, 'particles, color:', mixedColor);

  for(let i = 0; i < particleCount; i++){
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 3 + 2;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 2; // Slight upward bias

    const particle = { 
      x: point.x,
      y: point.y,
      vx: vx,
      vy: vy,
      size: Math.random() + 2,  // Bigger for debugging  
      color: mixedColor,
      alpha: 1.0,
      life: 1.0,
      createdAt: Date.now()
    };

    window.collisionParticles.push(particle);
  }
}

window.mixColors = function(colorA, colorB){
  // Parse HSL colors and blend
  // For simplicity, just alternate or pick one
  return Math.random() > 0.5 ? colorA : colorB;
}

// Update and render particles (call in render loop)
window.updateParticles = function(){
  const ctx = window.physicsRender?.context;
  if(!ctx) return;

  // Debug: log particle count occasionally
  // if(window.collisionParticles.length > 0 && Math.random() < 0.05){
  //   console.log('✨ [particles] Active particles:', window.collisionParticles.length);
  // }

  // Update physics
  for(let i = window.collisionParticles.length - 1; i >= 0; i--){
    const p = window.collisionParticles[i];

    // Apply gravity  
    p.vy += 0.3;  // Slower gravity 
    p.x += p.vx;
    p.y += p.vy;

    // Fade out
    p.life -= 0.01;  // Fade slower
    p.alpha = p.life;

    // Remove if dead
    if(p.life <= 0){
      window.collisionParticles.splice(i, 1);
    }
  }

  // Render
  // if(window.collisionParticles.length > 0){
  //   console.log('✨ [particles] Rendering', window.collisionParticles.length, 'particles');
  // }
  ctx.save();
  window.collisionParticles.forEach(p => {
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

// Add to render loop
if(window.physicsRender){
  Matter.Events.on(window.physicsRender, 'afterRender', () => {
    updateParticles();
  });
}

