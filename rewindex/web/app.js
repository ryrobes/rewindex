(function(){
  const canvas = document.getElementById('canvas');
  const workspace = document.getElementById('workspace');
  const resultsEl = document.getElementById('results');
  const statusEl = document.getElementById('status');
  const qEl = document.getElementById('q');
  const followCliBtn = document.getElementById('followCli');
  const followUpdatesBtn = document.getElementById('followUpdates');
  const startWatch = document.getElementById('startWatch');
  const stopWatch = document.getElementById('stopWatch');
  const languageBarEl = document.getElementById('languageBar');
  const languageLegendEl = document.getElementById('languageLegend');
  const searchSectionEl = document.getElementById('searchSection');
  const timeline = document.getElementById('timeline');
  const spark = document.getElementById('sparkline');
  const scrubber = document.getElementById('scrubber');
  const asofLabel = document.getElementById('asofLabel');
  const sparkTick = document.getElementById('sparkTick');
  const sparkHover = document.getElementById('sparkHover');
  const goLiveBtn = document.getElementById('goLive');

  let timelineMin = null, timelineMax = null;
  let currentAsOfMs = null;
  let scrubTimer = null;
  let sparkKeys = [];
  let followCliMode = false;
  let followUpdatesMode = false;
  let languageColors = {}; // Map of language -> color
  let languageList = []; // Ordered list of discovered languages

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
  workspace.addEventListener('pointerup', ()=>{ dragging = false; });

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
      resultsEl.innerHTML = '';
      // Clear dimming on all tiles
      for(const [,tile] of tiles){ tile.classList.remove('dim'); }
      for(const [,el] of folders){ el.classList.remove('dim'); }
      return;
    }
    resultsEl.innerHTML = '';
    const body = {
      query: qEl.value,
      filters: currentAsOfMs ? { as_of_ms: currentAsOfMs } : {},
      options: { limit: 50, context_lines: 2, highlight: true }
    };
    const res = await fetchJSON('/search/simple', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
    renderResults(res.results||[]);
  }

  function renderResults(results){
    resultsEl.innerHTML = '';
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
      const file = document.createElement('div');
      file.className = 'result-file';
      file.textContent = r.file_path;
      file.onclick = ()=> { focusResult(r); file.scrollIntoView({block:'nearest'}); };
      const ol = document.createElement('div');
      ol.className = 'result-matches';
      (r.matches||[]).forEach((m)=>{
        const item = document.createElement('div');
        item.className = 'result-match';
        const ln = m.line ? `:${m.line}` : '';
        const snippet = (m.highlight||'').replace(/<[^>]*>/g,'');
        item.textContent = `${ln}  ${snippet.slice(0,120)}`;
        item.onclick = ()=> { focusLine(r.file_path, m.line, qEl.value); item.scrollIntoView({block:'nearest'}); };
        ol.appendChild(item);
      });
      grp.appendChild(file);
      grp.appendChild(ol);
      resultsEl.appendChild(grp);
      if(idx === 0) { focusResult(r); grp.scrollIntoView({block:'nearest'}); }
    });
  }

  const tiles = new Map(); // path -> tile DOM
  const editors = new Map(); // path -> monaco editor
  const pendingFocus = new Map(); // path -> {line, token}
  const folders = new Map(); // folderPath -> folder DOM
  const filePos = new Map(); // path -> {x,y}
  const fileFolder = new Map(); // path -> folderPath
  const fileLanguages = new Map(); // path -> language
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
    const pos = filePos.get(path) || {x:0, y:0};
    tile.style.left = `${pos.x}px`;
    tile.style.top = `${pos.y}px`;
    const title = document.createElement('div');
    title.className = 'title';
    title.innerHTML = `<span>${path}</span><span class="right"><button class="btn tiny dlbtn" title="Download" style="display:none;">⬇</button><span class="lang"></span><span class="updated"></span></span>`;
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
      setupDownloadButton(path);
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
          setupDownloadButton(path);
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
          const editor = monaco.editor.create(body, {
            value: data.content || '',
            language: normalizeLanguageForMonaco(data.language),
            readOnly: true,
            minimap: { enabled: false },
            theme: 'ayu-dark',
            fontSize: 12,
            automaticLayout: true,
          });
          editors.set(path, editor);
          const pf = pendingFocus.get(path);
          if(pf){ revealAndDecorate(path, pf.line, pf.token); pendingFocus.delete(path); }
          setupDownloadButton(path);
          finish(editor);
        }, function(){
          // Errback: fallback
          if(settled) return;
          clearTimeout(to);
          const pre = document.createElement('pre');
          pre.className = 'pre';
          pre.textContent = data.content || '';
          body.appendChild(pre);
          setupDownloadButton(path);
          finish(null);
        });
      });
    }catch(e){
      const pre = document.createElement('pre');
      pre.className = 'pre';
      pre.textContent = data.content || '';
      body.appendChild(pre);
      setupDownloadButton(path);
      return null;
    }
  }

  function setupDownloadButton(path){
    const tile = tiles.get(path);
    if(!tile) return;
    const btn = tile.querySelector('.dlbtn');
    if(!btn) return;

    // Show button only when viewing historical version
    btn.style.display = (currentAsOfMs != null) ? 'inline-block' : 'none';

    // Remove any existing click handler to avoid duplicates
    btn.onclick = null;

    btn.onclick = (ev)=>{
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
      setupDownloadButton(path);
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

  // Follow CLI toggle
  followCliBtn.onclick = ()=>{
    followCliMode = !followCliMode;
    followCliBtn.classList.toggle('active', followCliMode);

    // Hide/show search section when Follow CLI is toggled
    if(searchSectionEl){
      searchSectionEl.classList.toggle('hidden', followCliMode);
    }

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
    // Determine target file set
    let list = [];
    if(ts==null){ const res = await fetchJSON('/files'); list = (res.files||[]).map(f=>f.file_path); }
    else { const res = await fetchJSON(`/files/at?ts=${ts}`); list = (res.files||[]).map(f=>f.file_path); }

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

    const tree = buildTree(list);
    layoutAndRender(tree);
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
            setupDownloadButton(p);
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
      // Build hierarchy and layout
      const tree = buildTree(list.map(f=>f.file_path));
      layoutAndRender(tree);
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
