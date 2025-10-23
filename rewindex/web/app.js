(function(){
  const canvas = document.getElementById('canvas');
  const workspace = document.getElementById('workspace');
  const resultsEl = document.getElementById('results');
  const statusEl = document.getElementById('status');
  const qEl = document.getElementById('q');
  const searchContainer = qEl.parentElement;
  const clearSearchBtn = document.getElementById('clearSearch');
  const deletedToggleBtn = document.getElementById('deletedToggle');
  const partialToggleBtn = document.getElementById('partialToggle');
  const fuzzyToggleBtn = document.getElementById('fuzzyToggle');
  const resultsOnlyBtn = document.getElementById('resultsOnly');
  const treemapModeBtn = document.getElementById('treemapMode');
  const treemapFoldersBtn = document.getElementById('treemapFolders');
  const sizeByBytesBtn = document.getElementById('sizeByBytes');
  const followCliBtn = document.getElementById('followCli');
  const followUpdatesBtn = document.getElementById('followUpdates');
  const dynTextBtn = document.getElementById('dynText');
  const startWatch = document.getElementById('startWatch');
  const stopWatch = document.getElementById('stopWatch');
  const languageBarEl = document.getElementById('languageBar');
  const languageLegendEl = document.getElementById('languageLegend');
  const timeline = document.getElementById('timeline');
  const spark = document.getElementById('sparkline');
  const scrubber = document.getElementById('scrubber');
  const asofLabel = document.getElementById('asofLabel');
  const sparkTick = document.getElementById('sparkTick');
  const sparkHover = document.getElementById('sparkHover');
  const goLiveBtn = document.getElementById('goLive');
  const overlayEditorEl = document.getElementById('overlayEditor');
  const overlayFilePathEl = document.getElementById('overlayFilePath');
  const overlayEditorContainer = document.getElementById('overlayEditorContainer');
  const saveOverlayBtn = document.getElementById('saveOverlay');
  const cancelOverlayBtn = document.getElementById('cancelOverlay');
  const diffOverlayEl = document.getElementById('diffOverlay');
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
  let sizeByBytes = false;
  let fuzzyMode = false;
  let partialMode = false;
  let deletedMode = false;
  let dynTextMode = true; // Default ON for dynamic text sizing
  let resultsOnlyMode = !showAllParam; // Default TRUE (results only), unless URL param says otherwise
  let lastSearchResults = []; // Store last search results for results-only mode
  let languageColors = {}; // Map of language -> color
  let languageList = []; // Ordered list of discovered languages
  let recentUpdates = []; // Track recent file updates [{path, action, timestamp}]
  const MAX_RECENT_UPDATES = 20;
  let overlayEditor = null; // Monaco editor instance for overlay
  let overlayEditorPath = null; // Current file path being edited
  let diffEditor = null; // Monaco diff editor instance
  let diffEditorPath = null; // Current file path in diff mode
  let diffHistoricalContent = null; // Historical content for restore
  let currentProjectRoot = null; // Current project root directory
  let beadsAvailable = false; // Whether bd command is available
  let beadsInitialized = false; // Whether beads has been checked
  let beadsTickets = []; // All Beads tickets
  let beadsCurrentFilter = 'all'; // Current filter
  let beadsPollInterval = null; // Polling interval for Beads updates

  let scale = 1.0;
  let offsetX = 40;
  let offsetY = 40;
  let isAnimating = false;
  let animHandle = null;
  let dragging = false;
  let dragStart = [0,0];

  function applyTransform(){
    canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }
  applyTransform();

  workspace.addEventListener('wheel', (e)=>{
    // Ignore zooming when interacting with timeline
    if(e.target.closest('#timeline')) return;
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
    // ignore drags on timeline and its children
    if(e.target.closest('#timeline') || e.target.closest('#asofFloat')) return;
    // Don't drag when clicking buttons or other interactive elements
    if(e.target.closest('button')) return;
    // Don't drag when interacting with the search input
    if(e.target === qEl) return;
    dragging = true;
    dragStart = [e.clientX - offsetX, e.clientY - offsetY];
    workspace.setPointerCapture(e.pointerId);
    // Hide search container while dragging to prevent text selection
    if(searchContainer) searchContainer.classList.add('dragging');
  });
  workspace.addEventListener('pointermove', (e)=>{
    if(!dragging) return;
    offsetX = e.clientX - dragStart[0];
    offsetY = e.clientY - dragStart[1];
    applyTransform();
  });
  workspace.addEventListener('pointerup', ()=>{
    dragging = false;
    // Show search container again
    if(searchContainer) searchContainer.classList.remove('dragging');
  });

  async function fetchJSON(url, opts){
    const r = await fetch(url, opts);
    if(!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }

  function adjustTimelineLeft(){
    const sidebar = document.getElementById('sidebar');
    const left = sidebar ? sidebar.offsetWidth : 320;
    if(timeline) timeline.style.left = left + 'px';
    const asof = document.getElementById('asofFloat');
    if(asof) asof.style.left = left + 'px';
  }
  window.addEventListener('resize', adjustTimelineLeft);
  adjustTimelineLeft();

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
      if(currentProjectRoot && !beadsInitialized){
        console.log('[beads DEBUG] First load - checking beads availability');
        beadsInitialized = true;
        checkBeadsAvailable();
      }

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

      // Conditionally show/hide watcher buttons based on state
      const watcherRunning = s.watcher === 'running';
      if(startWatch) startWatch.classList.toggle('hidden', watcherRunning);
      if(stopWatch) stopWatch.classList.toggle('hidden', !watcherRunning);
    }catch(e){
      statusEl.textContent = 'status unavailable';
      // Show both buttons if status fails
      if(startWatch) startWatch.classList.remove('hidden');
      if(stopWatch) stopWatch.classList.remove('hidden');
    }
  }

  async function doSearch(){
    if(followCliMode) return; // disabled in follow CLI mode
    if(!qEl.value.trim()) {
      // Clear search results
      lastSearchResults = [];

      // In results-only mode, clear canvas when search is empty
      if(resultsOnlyMode){
        resultsEl.innerHTML = '<div class="results-count" style="color: #888;">Enter a search query to see results</div>';
        // Clear canvas
        for(const [p, tile] of tiles){ tile.remove(); }
        tiles.clear(); tileContent.clear(); filePos.clear(); fileFolder.clear(); fileLanguages.clear();
        for(const [, el] of folders){ el.remove(); } folders.clear();
        return;
      }

      // In show-all mode, clear dimming on all tiles
      for(const [,tile] of tiles){ tile.classList.remove('dim'); }
      for(const [,el] of folders){ el.classList.remove('dim'); }
      // Clear tracking sets
      if(window._dimmedTiles) window._dimmedTiles.clear();
      if(window._dimmedFolders) window._dimmedFolders.clear();
      // Show recent updates when search is empty
      renderRecentUpdates();
      return;
    }
    resultsEl.innerHTML = '';

    const body = {
      query: qEl.value,
      filters: currentAsOfMs ? { as_of_ms: currentAsOfMs } : {},
      options: {
        limit: 500,
        context_lines: 2,
        highlight: true,
        fuzziness: fuzzyMode ? 'AUTO' : undefined,
        partial: partialMode,
        show_deleted: deletedMode
      }
    };
    const res = await fetchJSON('/search/simple', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
    const results = res.results || [];

    // Store search results for results-only mode
    lastSearchResults = results;

    // RESULTS-ONLY MODE: Rebuild canvas with only search results
    if(resultsOnlyMode){
      await refreshAllTiles(currentAsOfMs);
      // Render results sidebar (no dimming needed since we only show matches)
      renderResults(results, res.total||0, true); // Pass true to skip dimming
    }
    // SHOW ALL MODE: Render results and apply dimming to non-matches
    else {
      renderResults(results, res.total||0, false);
    }
  }

  function renderResults(results, total, skipDimming = false){
    resultsEl.innerHTML = '';

    // Add result count at the top
    if(results.length > 0){
      const countDiv = document.createElement('div');
      countDiv.className = 'results-count';
      const fileCount = results.length;
      const matchCount = results.reduce((sum, r) => sum + (r.matches ? r.matches.length : 0), 0);
      const modeInfo = resultsOnlyMode ? ' (Results Only mode)' : '';
      countDiv.textContent = `${matchCount} matches in ${fileCount} files${modeInfo}`;
      resultsEl.appendChild(countDiv);
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
    // Results list: per-file group with per-match lines
    results.forEach((r, idx)=>{
      const grp = document.createElement('div');
      grp.className = 'result-group';

      // File header with score badge
      const fileHeader = document.createElement('div');
      fileHeader.className = 'result-file-header';

      const file = document.createElement('div');
      file.className = 'result-file';
      if(r.deleted) file.classList.add('deleted');
      file.textContent = r.file_path;
      file.onclick = ()=> { focusResult(r); file.scrollIntoView({block:'nearest'}); };

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

      const ol = document.createElement('div');
      ol.className = 'result-matches';
      (r.matches||[]).forEach((m)=>{
        const item = document.createElement('div');
        item.className = 'result-match';
        const ln = m.line ? `:${m.line}` : '';
        const snippet = m.highlight || '';
        // Use innerHTML to render <mark> tags for highlighting
        item.innerHTML = `${ln}  ${snippet.slice(0,120)}`;
        item.onclick = ()=> { focusLine(r.file_path, m.line, qEl.value); item.scrollIntoView({block:'nearest'}); };
        ol.appendChild(item);
      });
      grp.appendChild(fileHeader);
      grp.appendChild(ol);
      resultsEl.appendChild(grp);
      if(idx === 0) { focusResult(r); grp.scrollIntoView({block:'nearest'}); }
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
        'editor.background': '#090c0f',  // Match canvas background
        'editor.foreground': '#c5c8c6',  // Tomorrow Night foreground
        'editor.lineHighlightBackground': '#1d1f21',
        'editor.selectionBackground': '#373b41',
        'editorCursor.foreground': '#c5c8c6',
        'editorWhitespace.foreground': '#404040',
      }
    });
  }

  async function openOverlayEditor(path){
    overlayEditorPath = path;
    overlayFilePathEl.textContent = path;

    // Fetch file content
    try{
      const data = await fetchJSON('/file?path=' + encodeURIComponent(path));

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

        overlayEditor = monaco.editor.create(overlayEditorContainer, {
          value: content,
          language: normalizeLanguageForMonaco(data.language),
          readOnly: false,  // Editable!
          minimap: { enabled: true },
          theme: 'rewindex-dark',  // Use custom theme
          fontSize: fontSize,
          automaticLayout: true,
        });
      });

      // Show overlay
      overlayEditorEl.style.display = 'flex';
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

      // Refresh tile content
      await refreshTileContent(overlayEditorPath);
    }catch(e){
      showToast(`Failed to save: ${e.message || e}`);
      console.error('Save failed:', e);
    }
  }

  async function openDiffEditor(path){
    diffEditorPath = path;
    diffFilePathEl.textContent = path;

    try{
      // Fetch current (live) version
      const liveData = await fetchJSON('/file?path=' + encodeURIComponent(path));
      const liveContent = liveData.content || '';

      // Get historical version from tile content
      let historicalContent = tileContent.get(path) || '';

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

        diffEditor = monaco.editor.createDiffEditor(diffEditorContainer, {
          readOnly: true,
          minimap: { enabled: true },
          theme: 'rewindex-dark',  // Use custom theme
          fontSize: 12,
          automaticLayout: true,
          renderSideBySide: true,
        });

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
    diffOverlayEl.style.display = 'none';
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

      // Refresh tile content
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

  async function openTile(path){
    // Check if tile already exists
    const existingTile = tiles.get(path);
    if(existingTile){
      // IMPORTANT: Update position even for existing tiles
      // This fixes the bug where tiles stack at 0,0 after layout changes
      const pos = filePos.get(path);
      if(pos){
        existingTile.style.left = `${pos.x}px`;
        existingTile.style.top = `${pos.y}px`;
        if(pos.w) existingTile.style.width = `${pos.w}px`;
        if(pos.h) existingTile.style.height = `${pos.h}px`;
      }
      return existingTile;
    }

    // Create new tile
    const tile = document.createElement('div');
    tile.className = 'tile';
    const pos = filePos.get(path);
    if(!pos){
      // Position not available yet - this shouldn't happen in normal flow
      // but can occur if openTile is called before layout is complete
      console.warn(`[openTile] No position found for ${path}, using default`);
      tile.style.left = '0px';
      tile.style.top = '0px';
    } else {
      tile.style.left = `${pos.x}px`;
      tile.style.top = `${pos.y}px`;
      // Apply dimensions if specified (treemap mode)
      if(pos.w) tile.style.width = `${pos.w}px`;
      if(pos.h) tile.style.height = `${pos.h}px`;
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

  function generatePastelColor(index, total){
    // Generate evenly distributed pastel colors using HSL
    // Hue: spread across color wheel
    // Saturation: 65-75% for soft pastels
    // Lightness: 65-75% for pastels
    const hue = (index * 360 / total) % 360;
    const saturation = 65 + (index % 3) * 5; // Vary between 65-75%
    const lightness = 65 + (index % 2) * 5;  // Vary between 65-75%
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  function getLanguageColor(language){
    if(!language || language === 'unknown' || language === 'plaintext'){
      return 'rgba(92, 106, 114, 0.4)'; // Muted gray for unknown
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

  async function loadTileContent(path, initData, focusLine = null, searchQuery = null){
    let tile = tiles.get(path);
    if(!tile){ await openTile(path); tile = tiles.get(path); }
    const data = initData || await fetchJSON('/file?path=' + encodeURIComponent(path));
    const body = tile.querySelector('.body');

    // Update language in title and apply color
    try{ tile.querySelector('.title .lang').textContent = data.language || ''; }catch(e){}
    try{ tile.querySelector('.title .updated').textContent = new Date().toLocaleTimeString(); }catch(e){}

    // Store language and full content
    fileLanguages.set(path, data.language);
    tileContent.set(path, data.content || '');
    applyLanguageColor(tile, data.language);

    // Use Prism for syntax highlighting (lightweight, supports 1000s of instances)
    const content = data.content || '';
    const prismLang = languageToPrism(data.language);
    const lines = content.split('\n');
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

    // Check if there's a pending focus for this path
    const pending = pendingFocus.get(path);
    if(pending && pending.line){
      focusLine = pending.line;
      pendingFocus.delete(path); // Clear after using
    }

    if(totalLines > MAX_LINES_TO_RENDER){
      if(focusLine && focusLine > 0){
        // Center around the focus line
        const halfChunk = Math.floor(MAX_LINES_TO_RENDER / 2);
        startLine = Math.max(1, focusLine - halfChunk);
        endLine = Math.min(totalLines, startLine + MAX_LINES_TO_RENDER - 1);

        // Adjust if we're near the end
        if(endLine - startLine + 1 < MAX_LINES_TO_RENDER && startLine > 1){
          startLine = Math.max(1, endLine - MAX_LINES_TO_RENDER + 1);
        }
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
    pre.style.lineHeight = '1.4'; // Ensure readability
    pre.style.userSelect = 'text'; // Allow text selection
    pre.style.cursor = 'text'; // Show text cursor
    pre.setAttribute('data-start', String(startLine)); // Line numbers start at actual line number!
    pre.setAttribute('data-total-lines', String(totalLines)); // Store total for reference
    pre.setAttribute('data-chunk-start', String(startLine));
    pre.setAttribute('data-chunk-end', String(endLine));

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
      indicator.style.cssText = 'position:absolute; top:0; right:0; padding:2px 6px; font-size:9px; background:rgba(0,0,0,0.5); color:#888; z-index:10; pointer-events:none;';
      body.style.position = 'relative';
      body.appendChild(indicator);
    }

    // Highlight with Prism and enable line numbers
    if(typeof Prism !== 'undefined'){
      try{
        Prism.highlightElement(code);
      }catch(e){
        // Prism not available or language not loaded
      }
    }

    // Highlight search terms if provided
    if(searchQuery && searchQuery.trim()){
      highlightSearchTerms(code, searchQuery.trim());
    }

    // Scroll to focused line if provided
    if(focusLine && focusLine > 0){
      // Use a short delay to ensure Prism has finished rendering
      setTimeout(() => {
        scrollToLine(path, focusLine);
      }, 100);
    }

    setupTileButtons(path);
  }

  function highlightSearchTerms(element, query){
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

    while(node = walker.nextNode()){
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
    // SIMPLE GRID LAYOUT for Results-Only mode - no folders, no complex packing
    // Just arrange tiles in a regular grid for maximum performance

    // Clear old containers/positions
    for(const [, el] of folders){ el.remove(); }
    folders.clear(); filePos.clear(); fileFolder.clear();

    const tileW = 600;
    const tileH = 400;
    const gap = 40;
    const startX = 40;
    const startY = 40;
    const tilesPerRow = 15; // 15 tiles per row for wide pannable canvas

    let x = startX;
    let y = startY;
    let col = 0;

    for(const p of paths){
      // Store position
      filePos.set(p, { x: x, y: y });
      fileFolder.set(p, ''); // No folder hierarchy

      // Move to next position
      col++;
      if(col >= tilesPerRow){
        // Start new row
        col = 0;
        x = startX;
        y += tileH + gap;
      } else {
        // Next column
        x += tileW + gap;
      }
    }
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
      console.log('Treemap size stats:', {
        min: Math.min(...sizes),
        max: Math.max(...sizes),
        avg: totalSize / items.length,
        total: totalSize,
        count: items.length,
        samples: items.slice(0, 5).map(i => ({path: i.path, size: i.size}))
      });
    }

    // Assign sizes based on relative size (better scaling without sqrt compression)
    const sizedItems = items.map(item => {
      // Use linear ratio with gentle power (sqrt was too compressive)
      const ratio = item.size / totalSize;
      const scale = Math.max(0.5, Math.min(4.0, Math.pow(ratio * items.length * 2, 0.6))); // Power 0.6 for gentle curve
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
    clearSearchBtn.onclick = ()=>{
      qEl.value = '';
      doSearch(); // Will show recent updates since query is empty
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
        showToast('Results Only mode: showing only search results');
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
      if(sizeByBytesBtn) sizeByBytesBtn.style.display = treemapMode ? 'inline-block' : 'none';

      if(treemapMode){
        showToast('Treemap mode enabled');
      } else {
        showToast('Treemap mode disabled');
        // Reset sub-toggles when disabled
        treemapFoldersMode = false;
        sizeByBytes = false;
        if(treemapFoldersBtn) treemapFoldersBtn.classList.remove('active');
        if(sizeByBytesBtn) sizeByBytesBtn.classList.remove('active');
      }
      // Re-layout with current file set
      await refreshAllTiles(currentAsOfMs);
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
    };
  }

  // Size by Bytes sub-toggle
  if(sizeByBytesBtn){
    sizeByBytesBtn.onclick = async ()=>{
      sizeByBytes = !sizeByBytes;
      sizeByBytesBtn.classList.toggle('active', sizeByBytes);
      showToast(sizeByBytes ? 'Sizing by bytes' : 'Sizing by lines');
      // Re-layout with current file set
      await refreshAllTiles(currentAsOfMs);
    };
  }

  startWatch.onclick = async ()=>{
    try{
      await fetchJSON('/index/start', {method:'POST'});
      await refreshStatus();
      showToast('Watcher started');
    }catch(e){
      showToast('Failed to start watcher');
    }
  };
  stopWatch.onclick = async ()=>{
    try{
      await fetchJSON('/index/stop', {method:'POST'});
      await refreshStatus();
      showToast('Watcher stopped');
    }catch(e){
      showToast('Failed to stop watcher');
    }
  };
  if(goLiveBtn){
    goLiveBtn.onclick = async ()=>{
      try{
        console.debug('[rewindex-ui] Go Live clicked');
        if(scrubber) scrubber.value = '1000';
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
          // Refresh beads tickets for the new project
          if(beadsAvailable){
            console.log('[beads DEBUG] Refreshing beads tickets for new project');
            refreshBeadsTickets();
          }
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
          if(typeof scrubber !== 'undefined'){ scrubber.value = '1000'; currentAsOfMs = null; asofLabel.textContent = 'Live'; }
          if(!projectJustChanged && currentAsOfMs !== null){
            // Was on a temporal view, now going live
            await refreshAllTiles(null);
            currentAsOfMs = null;
          }
        }else{
          if(timelineMin!=null && timelineMax!=null && typeof scrubber !== 'undefined'){
            currentAsOfMs = newAsOf;
            const pct = (newAsOf - timelineMin) / (timelineMax - timelineMin);
            const v = Math.round(Math.min(1, Math.max(0, pct)) * 1000);
            scrubber.value = String(v);
            try{ asofLabel.textContent = new Date(currentAsOfMs).toLocaleString(); }catch(e){ asofLabel.textContent = `${currentAsOfMs}`; }
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
    esrc.addEventListener('file', (ev)=>{
      try{
        const data = JSON.parse(ev.data || '{}');
        const path = data.file_path || data.path;
        const action = data.action || 'updated';
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

          // Re-render recent updates if search is empty
          if(!qEl.value.trim() && !followCliMode){
            renderRecentUpdates();
          }

          showToast(`${action === 'added' ? 'Indexed' : 'Updated'}: ${path}`);
          refreshTileContent(path);
          flashTile(path, 'update');
          refreshTimeline(); // Update timeline when files are indexed

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

  async function refreshTimeline(){
    if(!timeline || !spark || !scrubber) return;
    try{
      const s = await fetchJSON('/timeline/stats');
      if(s && s.min && s.max){
        timelineMin = s.min; timelineMax = s.max;
        drawSparkline(s.series||[]);
        // Update tick position if we're in scrubbed mode
        if(currentAsOfMs != null) updateSparkTick();
      } else {
        drawSparkline([]);
      }
    }catch(e){
      // Ignore errors silently
    }
  }

  // Timeline init
  (async function initTimeline(){
    if(!timeline || !spark || !scrubber) return;
    try{
      const s = await fetchJSON('/timeline/stats');
      if(s && s.min && s.max){
        timelineMin = s.min; timelineMax = s.max;
        drawSparkline(s.series||[]);
      } else {
        // Keep panel visible with empty sparkline
        drawSparkline([]);
      }
      scrubber.value = 1000; // live
      asofLabel.textContent = 'Live';
      scrubber.addEventListener('input', ()=>{
        if(scrubTimer) clearTimeout(scrubTimer);
        scrubTimer = setTimeout(()=> applyScrub(), 150);
      });
      // Sparkline hover + click
      spark.addEventListener('mousemove', (ev)=>{
        const rect = spark.getBoundingClientRect();
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
      spark.addEventListener('mouseleave', ()=>{
        if(currentAsOfMs==null) asofLabel.textContent='Live'; else asofLabel.textContent=new Date(currentAsOfMs).toLocaleString();
        if(sparkHover) sparkHover.style.display='none';
      });
      spark.addEventListener('click', (ev)=>{
        const rect = spark.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const W = rect.width || 1;
        if(sparkKeys.length>0){
          const n = sparkKeys.length;
          const idx = Math.max(0, Math.min(n-1, Math.round((x/W) * (n-1))));
          const ts = sparkKeys[idx];
          if(ts!=null && timelineMin!=null && timelineMax!=null && timelineMax>timelineMin){
            const v = Math.round(((ts - timelineMin) / (timelineMax - timelineMin)) * 1000);
            scrubber.value = String(Math.max(0, Math.min(1000, v)));
          }
        } else {
          const pct = Math.min(1, Math.max(0, x / W));
          const v = Math.round(pct * 1000);
          scrubber.value = String(v);
        }
        applyScrub().then(()=> { updateSparkTick(); });
      });
    }catch(e){
      // Keep timeline visible even if stats endpoint fails
      drawSparkline([]);
      scrubber.value = 1000;
      asofLabel.textContent = 'Live';
    }
  })();

  function drawSparkline(series){
    spark.innerHTML = '';
    if(!series || series.length===0){
      const svgNS = 'http://www.w3.org/2000/svg';
      const H = spark.clientHeight || 28;
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', `0 0 1 ${H}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      spark.appendChild(svg);
      sparkKeys = [];
      if (sparkTick) spark.appendChild(sparkTick);
      if (sparkHover) spark.appendChild(sparkHover);
      updateSparkTick();
      return;
    }
    const H = spark.clientHeight || 28;

    // Better normalization: use 95th percentile to handle outliers
    const counts = series.map(b => b.count || 0);
    const sorted = [...counts].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95Value = sorted[p95Index] || 1;

    // Use 95th percentile as max, but ensure we have at least some value
    const maxCount = Math.max(1, p95Value);

    // Filter out zero-count buckets to remove long inactive spans
    const filtered = series.filter(b => (b.count||0) > 0);
    const data = filtered.length ? filtered : series;
    const svgNS = 'http://www.w3.org/2000/svg';
    const n = Math.max(2, data.length);
    // Use normalized viewBox so it scales to container width smoothly
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${n-1} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    spark.appendChild(svg);
    const points = data.map((b, i) => {
      const x = i; // normalized unit step
      // Clip values to maxCount to prevent going off-screen
      const clippedCount = Math.min(b.count || 0, maxCount);
      const h = Math.max(1, Math.round((clippedCount / maxCount) * H * 0.9)); // Use 90% of height for padding
      const y = H - h;
      return { x, y };
    });
    sparkKeys = data.map(b => b.key);
    // Build smoothed line path using cubic Bezier curves
    let d = '';
    if (points.length > 0) {
      d = `M ${points[0].x} ${points[0].y}`;

      // Calculate smooth curve control points for each segment
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];

        // Catmull-Rom to Bezier conversion with smoothing factor
        const tension = 0.3; // Lower = smoother, higher = closer to points
        const cp1x = p1.x + (p2.x - p0.x) * tension;
        const cp1y = p1.y + (p2.y - p0.y) * tension;
        const cp2x = p2.x - (p3.x - p1.x) * tension;
        const cp2y = p2.y - (p3.y - p1.y) * tension;

        d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
      }
    }
    const line = document.createElementNS(svgNS, 'path');
    line.setAttribute('d', d);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'rgba(57,186,230,0.9)');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);
    // Re-attach ticks on top
    if (sparkTick) spark.appendChild(sparkTick);
    if (sparkHover) spark.appendChild(sparkHover);
    updateSparkTick();
  }

  function updateSparkTick(){
    if(!spark || !sparkTick){ return; }
    const W = spark.clientWidth || 600;
    let pct = 1; // Live at far right
    if(currentAsOfMs!=null && timelineMin!=null && timelineMax!=null && timelineMax>timelineMin){
      pct = Math.min(1, Math.max(0, (currentAsOfMs - timelineMin) / (timelineMax - timelineMin)));
    }
    const x = Math.round(W * pct);
    sparkTick.style.left = `${x}px`;
    try{ sparkTick.classList.remove('snap'); void sparkTick.offsetWidth; sparkTick.classList.add('snap'); }catch(e){}
  }

  async function applyScrub(){
    if(timelineMin==null || timelineMax==null) return;
    const v = parseInt(scrubber.value,10) || 1000;
    if(v>=1000){ currentAsOfMs = null; asofLabel.textContent='Live'; await refreshAllTiles(null); updateSparkTick(); if(!followCliMode && qEl.value) await doSearch(); return; }
    const ts = timelineMin + ((timelineMax - timelineMin) * (v/1000));
    currentAsOfMs = Math.floor(ts);
    try{ asofLabel.textContent = new Date(currentAsOfMs).toLocaleString(); }catch(e){ asofLabel.textContent = `${currentAsOfMs}`; }
    await refreshAllTiles(currentAsOfMs);
    updateSparkTick();
    if(!followCliMode && qEl.value) await doSearch();
  }

  async function refreshAllTiles(ts){
    // Determine target file set with metadata
    let list = [];
    let filesWithMeta = [];

    // RESULTS-ONLY MODE: Only render files from search results (limit 200)
    if(resultsOnlyMode && lastSearchResults.length > 0){
      // Use search results instead of fetching all files
      const maxFiles = 200;
      const limitedResults = lastSearchResults.slice(0, maxFiles);
      list = limitedResults.map(r => r.file_path);

      // Fetch metadata for these specific files
      // NOTE: This is a lightweight approach - we'll fetch content during tile loading
      filesWithMeta = limitedResults.map(r => ({
        file_path: r.file_path,
        size_bytes: r.size_bytes || 0,
        line_count: r.line_count || 1,
        language: r.language || 'text'
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

    // Store file metadata for treemap mode
    fileMeta.clear();
    for(const f of filesWithMeta){
      if(f.file_path){
        fileMeta.set(f.file_path, {
          size_bytes: f.size_bytes || 0,
          line_count: f.line_count || 1
        });
      }
    }

    // Rebuild canvas & tiles for new file set
    // Remove existing tiles
    for(const [p, tile] of tiles){ tile.remove(); }

    tiles.clear(); tileContent.clear(); filePos.clear(); fileFolder.clear(); fileLanguages.clear();
    for(const [, el] of folders){ el.remove(); } folders.clear();

    // Use treemap (flat or with folders), simple grid (results-only), or traditional layout based on mode
    if(treemapMode && treemapFoldersMode){
      const tree = buildTree(list);
      layoutTreemapWithFolders(tree);
    } else if(treemapMode){
      layoutTreemap(list);
    } else if(resultsOnlyMode){
      // RESULTS-ONLY MODE: Use simple grid layout (no folder hierarchy for performance)
      layoutSimpleGrid(list);
    } else {
      // SHOW ALL MODE: Use traditional folder hierarchy layout
      const tree = buildTree(list);
      layoutAndRender(tree);
    }
    // Spawn and load tiles with Prism (lightweight, can handle 1000s)
    const concurrency = 10;
    let i = 0;
    async function next(){
      if(i >= list.length) return;
      const p = list[i++];
      try{
        await openTile(p);
        if(ts == null){
          const data = await fetchJSON(`/file?path=${encodeURIComponent(p)}`);
          await loadTileContent(p, data);
        } else {
          const data = await fetchJSON(`/file/at?path=${encodeURIComponent(p)}&ts=${ts}`);
          await loadTileContent(p, data);
        }
      }catch(e){ /* ignore */ }
      await next();
    }
    const workers = [];
    for(let k = 0; k < concurrency; k++) workers.push(next());
    await Promise.all(workers);

    // Apply folder colors and update language bar
    applyAllFolderColors();
    updateLanguageBar();
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

  function centerOnTile(path, opts={}){
    const tile = tiles.get(path);
    if(!tile) return;
    const ws = workspace.getBoundingClientRect();
    // world coords (pre-transform)
    const worldX = parseFloat(tile.style.left) || 0;
    const worldY = parseFloat(tile.style.top) || 0;
    const w = tile.offsetWidth || 600;
    const h = tile.offsetHeight || 400;
    const cx = worldX + w/2;
    const cy = worldY + h/2;

    // Determine target scale: zoom to fit if requested
    let targetScale = scale;
    if(opts.zoomToFit !== false){
      const fitW = (ws.width * 0.65) / w;
      const fitH = (ws.height * 0.65) / h;
      targetScale = Math.min(2.5, Math.max(0.05, Math.min(fitW, fitH)));
    }

    // Bias to the right by ~100px to account for sidebar coverage
    const sidebarBias = 100;

    // Compute target offsets to center tile (with right bias)
    const targetOffsetX = (ws.width/2 + sidebarBias) - (targetScale * cx);
    const targetOffsetY = (ws.height/2) - (targetScale * cy);

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
    // Stage 1: Zoom out to wide view
    const pullbackScale = Math.max(0.3, scale * 0.4); // Zoom out to 40% of current (min 0.3)

    const ws = workspace.getBoundingClientRect();
    const sidebarBias = 100;

    // Calculate current center in world coords
    const currentCenterX = (-offsetX + ws.width / 2) / scale;
    const currentCenterY = (-offsetY + ws.height / 2) / scale;

    // Stage 1: Zoom out while keeping current center
    const pullbackOffsetX = (ws.width / 2) - (pullbackScale * currentCenterX);
    const pullbackOffsetY = (ws.height / 2) - (pullbackScale * currentCenterY);

    // Stage 2: Calculate offset to center target (cx, cy) AT THE PULLBACK SCALE
    const targetOffsetXAtPullback = (ws.width / 2 + sidebarBias) - (pullbackScale * cx);
    const targetOffsetYAtPullback = (ws.height / 2) - (pullbackScale * cy);

    // Stage 1: Zoom out (200ms) - keep current center
    animatePanZoom(pullbackOffsetX, pullbackOffsetY, pullbackScale, 200, () => {
      // Stage 2: Pan to target (300ms) - stay at pullback scale, pan to new center
      animatePanZoom(targetOffsetXAtPullback, targetOffsetYAtPullback, pullbackScale, 300, () => {
        // Stage 3: Zoom in (250ms) - target already centered, just change scale
        // finalOffsetX/Y were calculated for finalScale, so they'll keep (cx,cy) centered
        animatePanZoom(finalOffsetX, finalOffsetY, finalScale, 250);
      });
    });
  }

  function animatePanZoom(toX, toY, toScale, duration=500, onComplete=null){
    const fromX = offsetX, fromY = offsetY, fromS = scale;
    const start = performance.now();
    isAnimating = true;
    function ease(t){ return t<0.5 ? 2*t*t : -1+(4-2*t)*t; } // easeInOutQuad
    function step(now){
      if(!isAnimating){ return; }
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
        if(onComplete) onComplete();
      }
    }
    if(animHandle) cancelAnimationFrame(animHandle);
    animHandle = requestAnimationFrame(step);
  }

  function scrollToLine(path, line){
    const tile = tiles.get(path);
    if(!tile || !line) return;

    const body = tile.querySelector('.body');
    const pre = body && body.querySelector('pre.prism-code');
    if(!pre) return;

    const code = pre.querySelector('code');
    if(!code) return;

    // Get chunk info
    const chunkStart = parseInt(pre.getAttribute('data-chunk-start')) || 1;
    const chunkEnd = parseInt(pre.getAttribute('data-chunk-end')) || 999999;
    const totalLines = parseInt(pre.getAttribute('data-total-lines')) || 0;

    // Check if target line is in the current chunk
    if(line < chunkStart || line > chunkEnd){
      // Line is not in current chunk - need to reload with focus on that line
      pendingFocus.set(path, { line });
      loadTileContent(path, null, line).catch(e => {/* ignore */});
      return;
    }

    // Wait a tick for Prism to finish rendering, then scroll
    requestAnimationFrame(() => {
      // Line is in chunk - calculate position relative to chunk
      const relativeLineIndex = line - chunkStart; // 0-based index within chunk

      // Get actual computed line height (after Prism rendering)
      const computedStyle = window.getComputedStyle(pre);
      const fontSize = parseFloat(computedStyle.fontSize);
      const lineHeight = parseFloat(computedStyle.lineHeight) || fontSize * 1.4;

      // Calculate scroll position (relative to chunk)
      const scrollTop = relativeLineIndex * lineHeight;

      // Smooth scroll to position (target line at top third of viewport)
      const targetScroll = Math.max(0, scrollTop - (pre.clientHeight / 3));
      pre.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
      });

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
    });
  }

  function focusResult(r){
    const path = r.file_path;
    const line = (r.matches && r.matches[0] && r.matches[0].line) || null;
    const query = qEl.value.trim(); // Get current search query
    openTile(path).then(async ()=>{
      centerOnTile(path);
      if(!tileContent.has(path)){
        await loadTileContent(path, null, line, query); // Pass line and query
      } else if(line){
        // Content exists, but may need to reload chunk centered on line with highlighting
        await loadTileContent(path, null, line, query); // Reload with query for highlighting
      }
      flashTile(path, 'focus');
    });
  }

  function focusLine(path, line, token){
    const query = token || qEl.value.trim(); // Use token or current search query
    openTile(path).then(async ()=>{
      centerOnTile(path);
      if(!tileContent.has(path)){
        await loadTileContent(path, null, line, query); // Pass line and query
      } else if(line){
        // Content exists, but may need to reload chunk centered on line with highlighting
        await loadTileContent(path, null, line, query); // Reload with query for highlighting
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

  function updateLanguageBar(){
    if(!languageBarEl || !languageLegendEl) return;

    // Count languages from current file set
    const counts = {};
    let total = 0;
    for(const [path, lang] of fileLanguages){
      if(lang && lang !== 'unknown' && lang !== 'plaintext'){
        counts[lang] = (counts[lang] || 0) + 1;
        total++;
      }
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

    // Render legend
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

      item.appendChild(dot);
      item.appendChild(label);
      item.appendChild(countSpan);
      languageLegendEl.appendChild(item);
    });
  }

  async function spawnAll(){
    try{
      // RESULTS-ONLY MODE: Skip loading all files on initial load
      // User must perform a search first
      if(resultsOnlyMode){
        resultsEl.innerHTML = '<div class="results-count" style="color: #888; padding: 10px;">🔍 <strong>Results Only mode</strong><br/>Enter a search query to see matching files.<br/><br/>Tip: Click "Results Only" button to switch to "Show All" mode.</div>';
        return;
      }

      const res = await fetchJSON('/files');
      const list = res.files || [];

      // Store file metadata for treemap mode
      fileMeta.clear();
      for(const f of list){
        if(f.file_path){
          fileMeta.set(f.file_path, {
            size_bytes: f.size_bytes || 0,
            line_count: f.line_count || 1
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
      // Spawn and load tiles with Prism (lightweight, can handle 1000s)
      const concurrency = 10;
      let i = 0;
      async function next(){
        if(i >= list.length) return;
        const f = list[i++];
        try{
          await openTile(f.file_path);
          await loadTileContent(f.file_path);
        }catch(e){ /* ignore */ }
        await next();
      }
      const workers = [];
      for(let k = 0; k < concurrency; k++) workers.push(next());
      await Promise.all(workers);

      // Apply folder colors and update language bar
      applyAllFolderColors();
      updateLanguageBar();
    }catch(e){ /* ignore */ }
  }

  // Beads integration
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

})();
