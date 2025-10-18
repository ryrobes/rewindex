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

  let timelineMin = null, timelineMax = null;
  let currentAsOfMs = null;
  let scrubTimer = null;
  let sparkKeys = [];
  let followCliMode = false;
  let followUpdatesMode = false;
  let treemapMode = false;
  let treemapFoldersMode = false;
  let sizeByBytes = false;
  let fuzzyMode = false;
  let partialMode = false;
  let deletedMode = false;
  let dynTextMode = false;
  let languageColors = {}; // Map of language -> color
  let languageList = []; // Ordered list of discovered languages
  let recentUpdates = []; // Track recent file updates [{path, action, timestamp}]
  const MAX_RECENT_UPDATES = 20;
  let overlayEditor = null; // Monaco editor instance for overlay
  let overlayEditorPath = null; // Current file path being edited

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

    const delta = -Math.sign(e.deltaY) * 0.12;
    const newScale = Math.min(2.5, Math.max(0.2, scale + delta));
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
      // Clear dimming on all tiles
      for(const [,tile] of tiles){ tile.classList.remove('dim'); }
      for(const [,el] of folders){ el.classList.remove('dim'); }
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
    renderResults(res.results||[], res.total||0);
  }

  function renderResults(results, total){
    resultsEl.innerHTML = '';

    // Add result count at the top
    if(results.length > 0){
      const countDiv = document.createElement('div');
      countDiv.className = 'results-count';
      const fileCount = results.length;
      const matchCount = results.reduce((sum, r) => sum + (r.matches ? r.matches.length : 0), 0);
      countDiv.textContent = `${matchCount} matches in ${fileCount} files`;
      resultsEl.appendChild(countDiv);
    }

    const matches = new Set(results.map(r => r.file_path));
    // Dim non-matching tiles and containers with no matches
    for(const [p, tile] of tiles){ tile.classList.toggle('dim', !matches.has(p)); }
    // dim folders with no matching tiles
    const folderMatch = new Map();
    for(const p of matches){ const f = fileFolder.get(p) || ''; folderMatch.set(f, true); }
    for(const [fp, el] of folders){ el.classList.toggle('dim', !folderMatch.get(fp)); }
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
          openTile(update.path).then(()=>{
            centerOnTile(update.path);
            loadEditor(update.path);
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

        // Calculate line count and dynamic font size
        const content = data.content || '';
        const lineCount = content.split('\n').length;
        const fontSize = calculateDynamicFontSize(lineCount);

        overlayEditor = monaco.editor.create(overlayEditorContainer, {
          value: content,
          language: normalizeLanguageForMonaco(data.language),
          readOnly: false,  // Editable!
          minimap: { enabled: true },
          theme: 'ayu-dark',
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

  const tiles = new Map(); // path -> tile DOM
  const editors = new Map(); // path -> monaco editor
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
    if(tiles.has(path)) return tiles.get(path);
    const tile = document.createElement('div');
    tile.className = 'tile';
    const pos = filePos.get(path) || {x:0, y:0, w:600, h:400};
    tile.style.left = `${pos.x}px`;
    tile.style.top = `${pos.y}px`;
    // Apply dimensions if specified (treemap mode)
    if(pos.w) tile.style.width = `${pos.w}px`;
    if(pos.h) tile.style.height = `${pos.h}px`;
    const title = document.createElement('div');
    title.className = 'title';
    title.innerHTML = `<span>${path}</span><span class="right"><button class="btn tiny editbtn" title="Edit" style="display:none;">✎</button><button class="btn tiny dlbtn" title="Download" style="display:none;">⬇</button><span class="lang"></span><span class="updated"></span></span>`;
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
    // Small files: 14px, Large files: 8px
    if(!dynTextMode) return 12; // Default font size when disabled
    if(!lineCount || lineCount <= 0) return 12;

    // Logarithmic scaling: bigger files get smaller font
    // 1-100 lines: 14px
    // 100-500 lines: 12px
    // 500-1000 lines: 10px
    // 1000-2000 lines: 9px
    // 2000+ lines: 8px
    const MIN_FONT = 8;
    const MAX_FONT = 14;

    if(lineCount <= 100) return MAX_FONT;
    if(lineCount >= 2000) return MIN_FONT;

    // Logarithmic interpolation
    const logMin = Math.log(100);
    const logMax = Math.log(2000);
    const logValue = Math.log(lineCount);
    const ratio = (logValue - logMin) / (logMax - logMin);

    return Math.round(MAX_FONT - (ratio * (MAX_FONT - MIN_FONT)));
  }

  async function loadEditor(path, initData){
    if(editors.has(path)) return editors.get(path);
    let tile = tiles.get(path);
    if(!tile){ await openTile(path); tile = tiles.get(path); }
    const data = initData || await fetchJSON('/file?path=' + encodeURIComponent(path));
    const body = tile.querySelector('.body');
    // Remove existing content
    body.innerHTML = '';
    // Update language in title and apply color
    try{ tile.querySelector('.title .lang').textContent = data.language || ''; }catch(e){}
    try{ tile.querySelector('.title .updated').textContent = new Date().toLocaleTimeString(); }catch(e){}

    // Store language for folder color calculation
    fileLanguages.set(path, data.language);

    // Apply language-based color to tile
    applyLanguageColor(tile, data.language);

    // Monaco (if available); else fallback to <pre>
    if(typeof require === 'undefined'){
      const pre = document.createElement('pre');
      pre.className = 'pre';
      pre.textContent = data.content || '';
      body.appendChild(pre);
      setupTileButtons(path);
      return null;
    }
    try{
      require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
      return await new Promise((resolve)=>{
        let settled = false;
        const finish = (editor)=>{ if(settled) return; settled = true; resolve(editor); };
        const to = setTimeout(()=>{
          if(settled) return;
          // Fallback to <pre>
          const pre = document.createElement('pre');
          pre.className = 'pre';
          pre.textContent = data.content || '';
          body.appendChild(pre);
          setupTileButtons(path);
          finish(null);
        }, 3000);
        require(['vs/editor/editor.main'], function(){
          if(settled) return;
          clearTimeout(to);
          try{
            if(!window.__rewindexMonacoThemeSet){
              monaco.editor.defineTheme('ayu-dark', {
                base: 'vs-dark', inherit: true,
                rules: [
                  { token: '', foreground: 'B3B1AD' },
                  { token: 'comment', foreground: '5C6773', fontStyle: 'italic' },
                  { token: 'keyword', foreground: 'FF8F40' },
                  { token: 'string', foreground: 'B8CC52' },
                  { token: 'number', foreground: 'E6B450' },
                  { token: 'type', foreground: '39BAE6' },
                  { token: 'function', foreground: 'FFB454' }
                ],
                colors: {
                  'editor.background': '#0f1419',
                  'editor.foreground': '#b3b1ad',
                  'editorCursor.foreground': '#f29718',
                  'editorLineNumber.foreground': '#5c6773',
                  'editorLineNumber.activeForeground': '#b3b1ad',
                  'editor.selectionBackground': '#27374780',
                  'editor.inactiveSelectionBackground': '#1d2b3680',
                  'editor.lineHighlightBackground': '#11151b',
                  'editorGutter.background': '#0f1419',
                  'editorWidget.background': '#0b0e14'
                }
              });
              window.__rewindexMonacoThemeSet = true;
            }
          }catch(e){}
          // Calculate line count and dynamic font size
          const content = data.content || '';
          const lineCount = content.split('\n').length;
          const fontSize = calculateDynamicFontSize(lineCount);

          const editor = monaco.editor.create(body, {
            value: content,
            language: normalizeLanguageForMonaco(data.language),
            readOnly: true,
            minimap: { enabled: false },
            theme: 'ayu-dark',
            fontSize: fontSize,
            automaticLayout: true,
          });
          editors.set(path, editor);
          const pf = pendingFocus.get(path);
          if(pf){ revealAndDecorate(path, pf.line, pf.token); pendingFocus.delete(path); }
          setupTileButtons(path);
          finish(editor);
        }, function(){
          // Errback: fallback
          if(settled) return;
          clearTimeout(to);
          const pre = document.createElement('pre');
          pre.className = 'pre';
          pre.textContent = data.content || '';
          body.appendChild(pre);
          setupTileButtons(path);
          finish(null);
        });
      });
    }catch(e){
      const pre = document.createElement('pre');
      pre.className = 'pre';
      pre.textContent = data.content || '';
      body.appendChild(pre);
      setupTileButtons(path);
      return null;
    }
  }

  function setupTileButtons(path){
    const tile = tiles.get(path);
    if(!tile) return;

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

    if(!dlBtn) return;

    // Remove any existing click handler to avoid duplicates
    dlBtn.onclick = null;

    dlBtn.onclick = (ev)=>{
      ev.preventDefault();
      ev.stopPropagation();

      let content = '';

      // Try to get content from Monaco editor
      const ed = editors.get(path);
      if(ed && ed.getModel){
        const model = ed.getModel();
        if(model){
          content = model.getValue();
        }
      }

      // Fallback to pre tag if Monaco didn't work
      if(!content){
        const body = tile.querySelector('.body');
        const pre = body && body.querySelector('pre.pre');
        if(pre){
          content = pre.textContent || '';
        }
      }

      // If still no content, show error
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
      const data = await fetchJSON('/file?path=' + encodeURIComponent(path));
      const ed = editors.get(path);
      const tile = tiles.get(path);
      if(ed && ed.getModel){
        const model = ed.getModel();
        if(model) model.setValue(data.content || '');
      } else if(tile){
        const body = tile.querySelector('.body');
        const pre = body && body.querySelector('pre.pre');
        if(pre) pre.textContent = data.content || '';
      }
      const title = tiles.get(path) && tiles.get(path).querySelector('.title');
      if(title){
        const up = title.querySelector('.updated');
        if(up) up.textContent = new Date().toLocaleTimeString();
      }
      // Store language and apply color
      fileLanguages.set(path, data.language);
      applyLanguageColor(tile, data.language);
      setupTileButtons(path);
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
    const gap = 40, pad = 30, header = 0;
    const tileW = 600, tileH = 400;
    const maxRow = 2400; // wrap width

    function layoutNode(node, ox, oy, render=true){
      // Compute child boxes sizes
      const children = [];
      for(const [name, sub] of node.folders){
        const size = layoutNode(sub, 0, 0, false); // measure only
        children.push({ type:'folder', node: sub, w: size.w, h: size.h });
      }
      for(const fp of node.files){
        children.push({ type:'file', path: fp, w: tileW, h: tileH });
      }
      if(node !== root && children.length === 0){
        // empty folder, minimal size
        children.push({ type:'spacer', w: tileW, h: tileH });
      }
      // Position children within this container
      const labelPadX = 0; // rely on top header spacing only
      let x = pad + labelPadX, y = pad + header, rowH = 0, innerW = 0;
      for(const ch of children){
        if(x > pad + labelPadX && x + ch.w > pad + labelPadX + maxRow){
          x = pad + labelPadX; y += rowH + gap; rowH = 0;
        }
        ch.x = x; ch.y = y; x += ch.w + gap; rowH = Math.max(rowH, ch.h); innerW = Math.max(innerW, ch.x + ch.w);
      }
      const innerH = (children.length ? (children[children.length-1].y + rowH) : (pad + header));
      const W = Math.max(innerW + pad, tileW + 2*pad + labelPadX);
      const H = Math.max(innerH + pad, header + 2*pad + tileH);
      // Render container (skip root)
      if(render && node !== root){
        const div = document.createElement('div');
        div.className = 'folder';
        div.style.left = `${ox}px`; div.style.top = `${oy}px`; div.style.width = `${W}px`; div.style.height = `${H}px`;
        const label = document.createElement('div');
        label.className = 'label'; label.textContent = node.path || node.name;
        div.appendChild(label);
        canvas.appendChild(div);
        folders.set(node.path, div);
      }
      // Assign child positions (absolute within canvas)
      for(const ch of children){
        if(ch.type === 'folder'){
          layoutNode(ch.node, ox + ch.x, oy + ch.y, render);
        }else if(ch.type === 'file'){
          if(render){
            filePos.set(ch.path, { x: ox + ch.x, y: oy + ch.y });
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
    for(const [name, sub] of root.folders){ topChildren.push({type:'folder', node: sub}); }
    for(const f of root.files){ topChildren.push({type:'file', path: f}); }
    for(const ch of topChildren){
      if(ch.type === 'folder'){
        const size = layoutNode(ch.node, 0, 0, false); // measure
        if(cx > 0 && cx + size.w > 3200){ cx = 0; cy += rowH + gap; rowH = 0; }
        layoutNode(ch.node, cx, cy, true); // render
        rowH = Math.max(rowH, size.h); cx += size.w + gap;
      }else{
        // Root-level file (no folder)
        if(cx > 0 && cx + tileW + 2*pad > 3200){ cx = 0; cy += rowH + gap; rowH = 0; }
        // For root files, assign position with a pseudo container-less placement
        filePos.set(ch.path, { x: cx + pad, y: cy + pad + header });
        fileFolder.set(ch.path, '');
        cx += (tileW + 2*pad) + gap; rowH = Math.max(rowH, tileH + 2*pad + header);
      }
    }
  }

  function layoutTreemap(paths){
    // Shelf-packing treemap based on line_count or size_bytes
    // Clear old containers/positions
    for(const [, el] of folders){ el.remove(); }
    folders.clear(); filePos.clear(); fileFolder.clear();

    // Gather files with sizes
    const items = [];
    for(const p of paths){
      const meta = fileMeta.get(p) || {line_count: 1, size_bytes: 1};
      const size = sizeByBytes ? Math.max(1, meta.size_bytes || 1) : Math.max(1, meta.line_count || 1);
      items.push({
        path: p,
        size: size
      });
    }

    if(items.length === 0) return;

    // Sort by size descending (largest first for better packing)
    items.sort((a, b) => b.size - a.size);

    // Calculate total area and determine base tile size
    const totalSize = items.reduce((sum, item) => sum + item.size, 0);
    const minTileW = 300, minTileH = 200;
    const maxTileW = 800, maxTileH = 600;
    const gap = 20;
    const maxRowWidth = 3200; // Canvas wrap width

    // Assign sizes based on relative size (using sqrt for more balanced sizing)
    const sizedItems = items.map(item => {
      const ratio = Math.sqrt(item.size / totalSize);
      const scale = Math.max(0.5, Math.min(2.0, ratio * 10)); // Scale factor between 0.5-2.0
      const w = Math.max(minTileW, Math.min(maxTileW, minTileW * scale));
      const h = Math.max(minTileH, Math.min(maxTileH, minTileH * scale));
      return { ...item, w, h };
    });

    // Shelf packing algorithm
    let x = 0, y = 0, rowH = 0;
    for(const item of sizedItems){
      // Check if we need to wrap to next row
      if(x > 0 && x + item.w > maxRowWidth){
        x = 0;
        y += rowH + gap;
        rowH = 0;
      }

      // Place tile with size information
      filePos.set(item.path, { x, y, w: item.w, h: item.h });
      fileFolder.set(item.path, ''); // No folders in treemap mode

      x += item.w + gap;
      rowH = Math.max(rowH, item.h);
    }
  }

  function layoutTreemapWithFolders(root){
    // Treemap with folder structure - variable file sizes based on metric
    for(const [, el] of folders){ el.remove(); }
    folders.clear(); filePos.clear(); fileFolder.clear();

    const gap = 40, pad = 30, header = 0;
    const maxRow = 2400; // wrap width

    function layoutNode(node, ox, oy, render=true){
      // Compute child boxes with variable sizes for files
      const children = [];

      // Add folders first
      for(const [name, sub] of node.folders){
        const size = layoutNode(sub, 0, 0, false); // measure only
        children.push({ type:'folder', node: sub, w: size.w, h: size.h });
      }

      // Add files with treemap sizing
      for(const fp of node.files){
        const meta = fileMeta.get(fp) || {line_count: 1, size_bytes: 1};
        const size = sizeByBytes ? Math.max(1, meta.size_bytes || 1) : Math.max(1, meta.line_count || 1);
        const totalSize = node.files.reduce((sum, p) => {
          const m = fileMeta.get(p) || {line_count: 1, size_bytes: 1};
          return sum + (sizeByBytes ? (m.size_bytes || 1) : (m.line_count || 1));
        }, 0);

        const ratio = Math.sqrt(size / totalSize);
        const scale = Math.max(0.5, Math.min(2.0, ratio * 8));
        const w = Math.max(300, Math.min(800, 400 * scale));
        const h = Math.max(200, Math.min(600, 300 * scale));

        children.push({ type:'file', path: fp, w, h });
      }

      if(node !== root && children.length === 0){
        children.push({ type:'spacer', w: 400, h: 300 });
      }

      // Position children within this container
      const labelPadX = 0;
      let x = pad + labelPadX, y = pad + header, rowH = 0, innerW = 0;

      for(const ch of children){
        if(x > pad + labelPadX && x + ch.w > pad + labelPadX + maxRow){
          x = pad + labelPadX; y += rowH + gap; rowH = 0;
        }
        ch.x = x; ch.y = y;
        x += ch.w + gap;
        rowH = Math.max(rowH, ch.h);
        innerW = Math.max(innerW, ch.x + ch.w);
      }

      const innerH = (children.length ? (children[children.length-1].y + rowH) : (pad + header));
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
    for(const [name, sub] of root.folders){ topChildren.push({type:'folder', node: sub}); }
    for(const f of root.files){
      const meta = fileMeta.get(f) || {line_count: 1, size_bytes: 1};
      const size = sizeByBytes ? Math.max(1, meta.size_bytes || 1) : Math.max(1, meta.line_count || 1);
      const ratio = Math.sqrt(size / 1000); // Normalize to reasonable scale
      const scale = Math.max(0.5, Math.min(2.0, ratio * 5));
      const w = Math.max(300, Math.min(800, 400 * scale));
      const h = Math.max(200, Math.min(600, 300 * scale));
      topChildren.push({type:'file', path: f, w, h});
    }

    for(const ch of topChildren){
      if(ch.type === 'folder'){
        const size = layoutNode(ch.node, 0, 0, false); // measure
        if(cx > 0 && cx + size.w > 3200){ cx = 0; cy += rowH + gap; rowH = 0; }
        layoutNode(ch.node, cx, cy, true); // render
        rowH = Math.max(rowH, size.h); cx += size.w + gap;
      }else{
        // Root-level file
        if(cx > 0 && cx + ch.w + 2*pad > 3200){ cx = 0; cy += rowH + gap; rowH = 0; }
        filePos.set(ch.path, { x: cx + pad, y: cy + pad + header, w: ch.w, h: ch.h });
        fileFolder.set(ch.path, '');
        cx += (ch.w + 2*pad) + gap; rowH = Math.max(rowH, ch.h + 2*pad + header);
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
    dynTextBtn.onclick = ()=>{
      dynTextMode = !dynTextMode;
      dynTextBtn.classList.toggle('active', dynTextMode);

      // Update all existing editors with new font sizes
      for(const [path, editor] of editors){
        if(!editor || !editor.getModel) continue;
        try{
          const model = editor.getModel();
          if(!model) continue;
          const lineCount = model.getLineCount();
          const fontSize = calculateDynamicFontSize(lineCount);
          editor.updateOptions({ fontSize: fontSize });
        }catch(e){
          // Ignore errors
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

  // Double-click on tiles to open editor (live mode only)
  canvas.addEventListener('dblclick', (e)=>{
    if(currentAsOfMs != null) return; // Only in live mode
    const tileEl = e.target.closest('.tile');
    if(!tileEl) return;
    // Find path for this tile
    for(const [path, tile] of tiles){
      if(tile === tileEl){
        openOverlayEditor(path);
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
    esrc.addEventListener('query', (ev)=>{
      if(!followCliMode) return;
      try{
        const data = JSON.parse(ev.data || '{}');
        const payload = data.payload || data;
        if(payload.query !== undefined) qEl.value = payload.query;
        // Align timeline to incoming query time (default live)
        const filt = payload.filters || {};
        let newAsOf = null;
        if(filt.as_of){
          try{ newAsOf = Date.parse(filt.as_of); }catch(e){ newAsOf = null; }
        }
        if(newAsOf==null){
          // live
          if(typeof scrubber !== 'undefined'){ scrubber.value = '1000'; currentAsOfMs = null; asofLabel.textContent = 'Live'; }
        }else{
          if(timelineMin!=null && timelineMax!=null && typeof scrubber !== 'undefined'){
            currentAsOfMs = newAsOf;
            const pct = (newAsOf - timelineMin) / (timelineMax - timelineMin);
            const v = Math.round(Math.min(1, Math.max(0, pct)) * 1000);
            scrubber.value = String(v);
            try{ asofLabel.textContent = new Date(currentAsOfMs).toLocaleString(); }catch(e){ asofLabel.textContent = `${currentAsOfMs}`; }
            refreshAllTiles(currentAsOfMs);
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
              // Also load the editor if not already loaded
              if(!editors.has(path)){
                loadEditor(path);
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
    if(ts==null){
      const res = await fetchJSON('/files');
      filesWithMeta = res.files || [];
      list = filesWithMeta.map(f => f.file_path);
    } else {
      const res = await fetchJSON(`/files/at?ts=${ts}`);
      filesWithMeta = res.files || [];
      list = filesWithMeta.map(f => f.file_path);
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

    // Properly dispose Monaco editors to prevent memory leaks
    for(const [, editor] of editors){
      if(editor && typeof editor.dispose === 'function'){
        try{
          editor.dispose();
        }catch(e){
          console.warn('Failed to dispose editor:', e);
        }
      }
    }

    tiles.clear(); editors.clear(); filePos.clear(); fileFolder.clear(); fileLanguages.clear();
    for(const [, el] of folders){ el.remove(); } folders.clear();

    // Use treemap (flat or with folders) or traditional layout based on mode
    if(treemapMode && treemapFoldersMode){
      const tree = buildTree(list);
      layoutTreemapWithFolders(tree);
    } else if(treemapMode){
      layoutTreemap(list);
    } else {
      const tree = buildTree(list);
      layoutAndRender(tree);
    }
    // Spawn tiles
    for(const p of list){ await openTile(p); }
    // Load content concurrently (ensure Monaco for live and time-travel)
    const concurrency = 2; let i = 0;
    async function next(){
      if(i>=list.length) return;
      const p = list[i++];
      try{
        if(ts==null){
          const data = await fetchJSON(`/file?path=${encodeURIComponent(p)}`);
          const ed = editors.get(p);
          if(!ed){ await loadEditor(p, data); }
          else {
            const model = ed.getModel && ed.getModel();
            if(model) model.setValue(data.content||'');
            const tile = tiles.get(p);
            if(tile){
              const l=tile.querySelector('.title .lang');
              if(l) l.textContent = data.language||'';
              fileLanguages.set(p, data.language);
              applyLanguageColor(tile, data.language);
            }
          }
          const up = tiles.get(p) && tiles.get(p).querySelector('.title .updated'); if(up) up.textContent = new Date().toLocaleTimeString();
        }
        else{
          const data = await fetchJSON(`/file/at?path=${encodeURIComponent(p)}&ts=${ts}`);
          const ed = editors.get(p);
          if(!ed){ await loadEditor(p, data); }
          else {
            const model = ed.getModel && ed.getModel();
            if(model) model.setValue(data.content||'');
            setupTileButtons(p);
          }
          const tile = tiles.get(p);
          if(tile){
            const l=tile.querySelector('.title .lang');
            if(l) l.textContent = data.language||'';
            fileLanguages.set(p, data.language);
            applyLanguageColor(tile, data.language);
          }
          const up = tiles.get(p) && tiles.get(p).querySelector('.title .updated'); if(up) up.textContent = ts ? new Date(ts).toLocaleTimeString() : new Date().toLocaleTimeString();
        }
      }catch(e){ /* ignore */ }
      await next();
    }
    const workers = []; for(let k=0;k<concurrency;k++) workers.push(next());
    await Promise.all(workers);

    // Apply folder colors and update language bar now that all file languages are loaded
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
      targetScale = Math.min(2.5, Math.max(0.2, Math.min(fitW, fitH)));
    }

    // Bias to the right by ~100px to account for sidebar coverage
    const sidebarBias = 100;

    // Compute target offsets to center tile (with right bias)
    const targetOffsetX = (ws.width/2 + sidebarBias) - (targetScale * cx);
    const targetOffsetY = (ws.height/2) - (targetScale * cy);

    animatePanZoom(targetOffsetX, targetOffsetY, targetScale, 500);
  }

  function animatePanZoom(toX, toY, toScale, duration=500){
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
      if(t < 1){ animHandle = requestAnimationFrame(step); } else { isAnimating = false; }
    }
    if(animHandle) cancelAnimationFrame(animHandle);
    animHandle = requestAnimationFrame(step);
  }

  function revealAndDecorate(path, line, token){
    const ed = editors.get(path);
    if(!ed){ pendingFocus.set(path, {line, token}); return; }
    if(line){
      ed.revealLineInCenter(line);
      const decos = [];
      // Line highlight
      decos.push({ range: new monaco.Range(line,1,line,1), options: { isWholeLine: true, className: 'match-line' } });
      // Token highlight (best-effort)
      if(token){
        const model = ed.getModel();
        const lineText = model.getLineContent(line);
        const idx = lineText.toLowerCase().indexOf(String(token).toLowerCase());
        if(idx >= 0){
          const startCol = idx+1; const endCol = idx + String(token).length + 1;
          decos.push({ range: new monaco.Range(line,startCol,line,endCol), options: { inlineClassName: 'match-token' } });
        }
      }
      ed.deltaDecorations([], decos);
    }
  }

  function focusResult(r){
    const path = r.file_path; const line = (r.matches && r.matches[0] && r.matches[0].line) || null;
    const token = (r.matches && r.matches[0] && r.matches[0].highlight) ? null : (qEl.value || null);
    openTile(path).then(()=>{
      centerOnTile(path);
      loadEditor(path).then(()=>{ revealAndDecorate(path, line, token); });
      flashTile(path, 'focus');
    });
  }

  function focusLine(path, line, token){
    openTile(path).then(()=>{
      centerOnTile(path);
      loadEditor(path).then(()=>{ revealAndDecorate(path, line, token); });
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
      // Spawn tiles
      for(const f of list){ await openTile(f.file_path); }
      // Now load editors for all tiles with limited concurrency so content appears by default
      const concurrency = 2;
      let i = 0;
      async function next(){
        if(i >= list.length) return;
        const f = list[i++];
        await loadEditor(f.file_path);
        await next();
      }
      const workers = [];
      for(let k=0;k<concurrency;k++){ workers.push(next()); }
      await Promise.all(workers);

      // Apply folder colors and update language bar now that all file languages are loaded
      applyAllFolderColors();
      updateLanguageBar();
    }catch(e){ /* ignore */ }
  }

})();
