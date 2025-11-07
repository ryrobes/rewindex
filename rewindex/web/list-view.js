/* =====================================================
   LIST VIEW MODE - JavaScript Logic
   ===================================================== */

(function(){
  'use strict';

  // State
  let listViewMode = false;
  let selectedFilePath = null;
  let currentSearchResults = [];

  // DOM Elements
  const listViewButton = document.getElementById('listViewMode');
  const canvasEl = document.getElementById('canvas');
  const listViewContainer = document.getElementById('listViewContainer');
  const fileGrid = document.getElementById('fileGrid');
  const previewPanel = document.getElementById('previewPanel');
  const previewFileName = document.getElementById('previewFileName');
  const previewContent = document.getElementById('previewContent');
  const previewEdit = document.getElementById('previewEdit');
  const previewDownload = document.getElementById('previewDownload');

  // Language Icons Map (matching existing tile logic)
  const languageIcons = {
    'python': '🐍',
    'javascript': '🟨',
    'typescript': '🔷',
    'java': '☕',
    'rust': '🦀',
    'go': '🔵',
    'c': '©️',
    'cpp': 'C++',
    'ruby': '💎',
    'php': '🐘',
    'swift': '🦅',
    'kotlin': '🅺',
    'scala': 'ς',
    'html': '🌐',
    'css': '🎨',
    'json': '📋',
    'markdown': '📝',
    'yaml': '⚙️',
    'xml': '📄',
    'sql': '🗄️',
    'shell': '🐚',
    'bash': '🐚',
    'dockerfile': '🐳',
    'default': '📄'
  };

  // Initialize
  function init(){
    if(!listViewButton) return;

    // Toggle button handler
    listViewButton.addEventListener('click', toggleListView);

    // Listen for search results
    window.addEventListener('searchResultsReady', (e) => {
      if(listViewMode && e.detail && e.detail.results){
        currentSearchResults = e.detail.results;
        renderFileGrid(e.detail.results);
      }
    });

    console.log('✅ [List View] Initialized');
  }

  // Toggle between canvas and list view
  function toggleListView(){
    listViewMode = !listViewMode;

    if(listViewMode){
      // Switch to list view
      listViewButton.classList.add('active');
      canvasEl.style.display = 'none';
      canvasEl.style.pointerEvents = 'none'; // Prevent canvas from stealing clicks
      canvasEl.style.zIndex = '-1'; // Move canvas behind everything
      listViewContainer.style.display = 'flex';

      // Get current search results from app.js if available
      if(window.lastSearchResults && window.lastSearchResults.length > 0){
        console.log('[List View] Found existing search results:', window.lastSearchResults.length);
        currentSearchResults = window.lastSearchResults;
        renderFileGrid(currentSearchResults);
      } else if(currentSearchResults.length > 0){
        // Use stored results if window.lastSearchResults not available
        renderFileGrid(currentSearchResults);
      } else {
        console.log('[List View] No search results to display');
      }

      console.log('🔀 [List View] Switched to List View');
    } else {
      // Switch to canvas view
      listViewButton.classList.remove('active');
      canvasEl.style.display = 'block';
      canvasEl.style.pointerEvents = 'auto'; // Re-enable canvas interactions
      canvasEl.style.zIndex = '0'; // Restore canvas z-index
      listViewContainer.style.display = 'none';

      // Clear selection
      selectedFilePath = null;
      clearPreview();

      // Re-render canvas tiles (they were skipped while list view was active)
      console.log('🔀 [List View] Switched to Canvas View - triggering tile refresh');
      if(window.refreshAllTiles){
        window.refreshAllTiles(null).catch(err => {
          console.error('[List View] Failed to refresh tiles:', err);
        });
      }
    }
  }

  // Render search results in file grid
  function renderFileGrid(results){
    fileGrid.innerHTML = '';

    if(!results || results.length === 0){
      fileGrid.innerHTML = '<div style="padding: 32px; text-align: center; opacity: 0.5;">No results found</div>';
      clearPreview();
      return;
    }

    console.log(`📊 [List View] Rendering ${results.length} files in grid`);

    results.forEach((result, idx) => {
      const item = createFileGridItem(result, idx);
      fileGrid.appendChild(item);
    });

    // Auto-select first item
    if(results.length > 0 && !selectedFilePath){
      selectFile(results[0]);
    }
  }

  // Create a single file grid item
  function createFileGridItem(result, index){
    const item = document.createElement('div');
    item.className = 'file-grid-item';
    item.dataset.filePath = result.file_path;

    // Add secondary match class if needed
    if(result.secondary_match){
      item.classList.add('secondary-match');
    }

    // Language icon
    const lang = result.language || 'default';
    const icon = languageIcons[lang.toLowerCase()] || languageIcons['default'];

    // File path (highlight filename)
    const pathParts = result.file_path.split('/');
    const fileName = pathParts.pop();
    const directory = pathParts.join('/');

    // Format file size (from metadata object)
    const size = formatFileSize(result.metadata?.size_bytes || 0);

    // Format lines (from metadata object)
    const lines = result.metadata?.line_count ? result.metadata.line_count.toLocaleString() : '-';

    // Format updated time
    const updated = result.last_modified ? formatTime(result.last_modified) : '-';

    // Match count
    const matchCount = result.matches ? result.matches.length : 0;

    item.innerHTML = `
      <div class="lang-icon">${icon}</div>
      <div class="file-path" title="${result.file_path}">
        <span style="opacity: 0.6;">${directory}/</span><span class="file-name">${fileName}</span>
        ${matchCount > 1 ? `<span class="match-count">${matchCount}</span>` : ''}
      </div>
      <div class="file-size">${size}</div>
      <div class="file-lines">${lines} lines</div>
      <div class="file-updated">${updated}</div>
      <div class="file-actions">
        <button class="btn tiny editbtn" title="Edit">✎</button>
        <button class="btn tiny dlbtn" title="Download">⬇</button>
      </div>
    `;

    // Click handler - select and preview
    item.addEventListener('click', () => {
      selectFile(result);
    });

    // Edit button
    const editBtn = item.querySelector('.editbtn');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openInEditor(result.file_path);
    });

    // Download button
    const dlBtn = item.querySelector('.dlbtn');
    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadFile(result.file_path);
    });

    return item;
  }

  // Select a file and show preview
  function selectFile(result, focusLine = null){
    selectedFilePath = result.file_path;

    // Update selection UI
    document.querySelectorAll('.file-grid-item').forEach(item => {
      if(item.dataset.filePath === result.file_path){
        item.classList.add('selected');
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });

    // Show preview with optional line focus
    showPreview(result, focusLine);
  }

  // Show file preview with syntax highlighting
  async function showPreview(result, focusLine = null){
    console.log('[List View] showPreview called for:', result.file_path, focusLine ? `(line ${focusLine})` : '');

    previewFileName.textContent = result.file_path;
    previewEdit.style.display = 'inline-block';
    previewDownload.style.display = 'inline-block';

    // Show loading
    previewContent.innerHTML = '<div class="loading"></div>';

    try {
      // Fetch file content
      const content = await fetchFileContent(result.file_path);

      if(!content){
        console.error('[List View] No content returned');
        previewContent.innerHTML = '<div class="preview-placeholder"><p>Unable to load file content</p><p style="opacity: 0.5; font-size: 11px;">Check console for details</p></div>';
        return;
      }

      // Detect if binary
      if(result.is_binary || isBinaryContent(content)){
        console.log('[List View] Binary file detected');
        renderBinaryPreview(result, content);
        return;
      }

      // Render text preview with syntax highlighting
      renderTextPreview(content, result, focusLine);

    } catch(err){
      console.error('[List View] Preview error:', err);
      previewContent.innerHTML = `<div class="preview-placeholder"><p>Error loading preview: ${err.message}</p></div>`;
    }
  }

  // Fetch file content from server
  async function fetchFileContent(filePath){
    try {
      console.log('[List View] Fetching content for:', filePath);

      // Use the same /file endpoint that canvas tiles use
      let resp = await fetch(`/file?path=${encodeURIComponent(filePath)}`);

      if(!resp.ok){
        console.warn('[List View] /file returned', resp.status, 'trying tile cache');

        // Check if content is already in tile cache (from main app.js)
        if(window.tileContent && window.tileContent.has(filePath)){
          console.log('[List View] Using cached tile content');
          return window.tileContent.get(filePath);
        }

        throw new Error(`HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const content = data.content || '';
      console.log('[List View] Fetched', content.length, 'bytes');
      return content;
    } catch(err){
      console.error('[List View] Fetch error:', err);
      return null;
    }
  }

  // Render text file with syntax highlighting
  function renderTextPreview(content, result, focusLine = null){
    const language = result.language || 'text';
    const prismLang = mapLanguageToPrism(language);

    console.log('[List View] Rendering text preview:', {
      language,
      prismLang,
      contentLength: content.length,
      matchCount: result.matches ? result.matches.length : 0,
      focusLine
    });

    // Create pre/code element
    const pre = document.createElement('pre');
    pre.className = 'line-numbers';
    pre.dataset.lang = prismLang;

    const code = document.createElement('code');
    code.className = `language-${prismLang}`;
    code.textContent = content;

    pre.appendChild(code);
    previewContent.innerHTML = '';
    previewContent.appendChild(pre);

    // Highlight with Prism.js
    if(window.Prism){
      try {
        Prism.highlightElement(code);
        console.log('[List View] Prism highlighting applied');
      } catch(err){
        console.error('[List View] Prism error:', err);
      }
    } else {
      console.warn('[List View] Prism.js not available, showing plain text');
    }

    // Highlight search matches if available
    if(result.matches && result.matches.length > 0){
      highlightMatches(code, result.matches);
    }

    // Highlight and scroll to specific line if requested
    if(focusLine){
      highlightAndScrollToLine(pre, focusLine);
    }

    console.log(`✨ [List View] Rendered preview for ${result.file_path}`);
  }

  // Render binary file preview (images, etc.)
  function renderBinaryPreview(result, content){
    const ext = result.file_path.split('.').pop().toLowerCase();
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'];

    if(imageExts.includes(ext)){
      // Show image using download endpoint (serves raw file)
      previewContent.innerHTML = `
        <div class="binary-preview">
          <img src="/file/download?path=${encodeURIComponent(result.file_path)}" alt="${result.file_path}" />
          <div class="binary-info">
            <div>${formatFileSize(result.size_bytes)}</div>
            <div>${ext.toUpperCase()}</div>
          </div>
        </div>
      `;
    } else {
      // Generic binary file
      previewContent.innerHTML = `
        <div class="preview-placeholder">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" opacity="0.3">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
            <polyline points="13 2 13 9 20 9"/>
          </svg>
          <p>Binary file (${ext.toUpperCase()})</p>
          <p style="opacity: 0.6;">${formatFileSize(result.size_bytes)}</p>
        </div>
      `;
    }
  }

  // Highlight search matches in preview
  function highlightMatches(codeEl, matches){
    // This is a simplified version - in production you'd want more sophisticated highlighting
    let html = codeEl.innerHTML;

    matches.forEach(match => {
      if(match.highlight){
        // Extract the search term from highlight (between <mark> tags)
        const markMatch = match.highlight.match(/<mark>(.*?)<\/mark>/);
        if(markMatch){
          const term = markMatch[1];
          // Simple case-insensitive highlight (be careful with regex special chars)
          const safeterm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`(${safeterm})`, 'gi');
          html = html.replace(regex, '<mark>$1</mark>');
        }
      }
    });

    codeEl.innerHTML = html;
  }

  // Highlight and scroll to specific line
  function highlightAndScrollToLine(preEl, lineNumber){
    console.log('[List View] Highlighting line:', lineNumber);

    // Remove any existing highlight styles
    const existingStyle = document.getElementById('list-view-line-highlight-style');
    if(existingStyle) existingStyle.remove();

    // Prism line-numbers plugin splits code into lines
    // We need to find the specific line and highlight it
    const codeEl = preEl.querySelector('code');
    if(!codeEl) return;

    // Split content by newlines to find the line
    const lines = codeEl.textContent.split('\n');
    if(lineNumber < 1 || lineNumber > lines.length){
      console.warn('[List View] Line number out of range:', lineNumber, 'max:', lines.length);
      return;
    }

    // Add CSS rule to highlight the specific line number
    // Prism wraps each line, so we can target it with nth-child
    const styleEl = document.createElement('style');
    styleEl.id = 'list-view-line-highlight-style';
    styleEl.textContent = `
      .preview-content pre.line-numbers > code {
        position: relative;
      }
      .preview-content pre.line-numbers > code > .line-numbers-rows > span:nth-child(${lineNumber}),
      .preview-content pre.line-numbers > code > span:nth-child(${lineNumber}) {
        background: rgba(88, 166, 255, 0.2);
        border-left: 3px solid var(--accent);
        display: inline-block;
        width: 100%;
        animation: highlight-pulse 2s ease;
      }
      @keyframes highlight-pulse {
        0%, 100% { background: rgba(88, 166, 255, 0.2); }
        50% { background: rgba(88, 166, 255, 0.35); }
      }
    `;
    document.head.appendChild(styleEl);

    preEl.classList.add('line-highlight-active');

    console.log('[List View] Line highlight applied via CSS, scrolling to line', lineNumber);

    // Scroll to the line
    // Use requestAnimationFrame to ensure Prism has finished rendering
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Get actual line height from the rendered element
        const lineNumbersRows = preEl.querySelector('.line-numbers-rows');
        if(lineNumbersRows && lineNumbersRows.children.length >= lineNumber){
          // Prism creates a span for each line in .line-numbers-rows
          const lineSpan = lineNumbersRows.children[lineNumber - 1];
          if(lineSpan){
            // Calculate scroll position relative to preview content
            const lineOffset = lineSpan.offsetTop;
            const containerHeight = previewContent.clientHeight;
            // Center the line in the viewport
            previewContent.scrollTop = lineOffset - (containerHeight / 2) + 10;
            console.log('[List View] Scrolled to exact line position:', lineOffset);
            return;
          }
        }

        // Fallback: estimate based on line height
        const computedStyle = window.getComputedStyle(preEl);
        const lineHeight = parseFloat(computedStyle.lineHeight) || 20;
        const scrollTop = (lineNumber - 1) * lineHeight - 100;
        previewContent.scrollTop = Math.max(0, scrollTop);
        console.log('[List View] Scrolled to estimated line position');
      });
    });
  }

  // Clear preview
  function clearPreview(){
    previewFileName.textContent = 'Select a file to preview';
    previewContent.innerHTML = `
      <div class="preview-placeholder">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" opacity="0.3">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <p>No file selected</p>
      </div>
    `;
    previewEdit.style.display = 'none';
    previewDownload.style.display = 'none';
  }

  // Utility: Map language to Prism.js language
  function mapLanguageToPrism(lang){
    const map = {
      'python': 'python',
      'javascript': 'javascript',
      'typescript': 'typescript',
      'java': 'java',
      'rust': 'rust',
      'go': 'go',
      'c': 'c',
      'cpp': 'cpp',
      'ruby': 'ruby',
      'php': 'php',
      'swift': 'swift',
      'kotlin': 'kotlin',
      'scala': 'scala',
      'html': 'markup',
      'css': 'css',
      'json': 'json',
      'markdown': 'markdown',
      'yaml': 'yaml',
      'xml': 'markup',
      'sql': 'sql',
      'shell': 'bash',
      'bash': 'bash',
      'dockerfile': 'docker'
    };

    return map[lang.toLowerCase()] || 'text';
  }

  // Utility: Format file size
  function formatFileSize(bytes){
    if(!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Utility: Format timestamp
  function formatTime(ms){
    if(!ms) return '-';
    const date = new Date(ms);
    const now = Date.now();
    const diff = now - date.getTime();

    // Less than 1 hour: show minutes ago
    if(diff < 3600000){
      const mins = Math.floor(diff / 60000);
      return mins === 0 ? 'Just now' : `${mins}m ago`;
    }

    // Less than 24 hours: show hours ago
    if(diff < 86400000){
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }

    // Less than 7 days: show days ago
    if(diff < 604800000){
      const days = Math.floor(diff / 86400000);
      return `${days}d ago`;
    }

    // Otherwise show date
    return date.toLocaleDateString();
  }

  // Utility: Check if content is binary
  function isBinaryContent(content){
    // Simple check: look for null bytes or high percentage of non-printable chars
    if(content.includes('\x00')) return true;

    let nonPrintable = 0;
    for(let i = 0; i < Math.min(1000, content.length); i++){
      const code = content.charCodeAt(i);
      if(code < 32 && code !== 9 && code !== 10 && code !== 13){
        nonPrintable++;
      }
    }

    return (nonPrintable / Math.min(1000, content.length)) > 0.3;
  }

  // Open file in Monaco editor (reuse existing logic)
  function openInEditor(filePath){
    console.log('[List View] Opening in editor:', filePath);
    // Dispatch event or call existing openOverlayEditor function
    if(window.openOverlayEditor){
      window.openOverlayEditor(filePath);
    } else {
      // Fallback: trigger click on existing tile if available
      const tile = document.querySelector(`[data-file-path="${filePath}"] .editbtn`);
      if(tile) tile.click();
    }
  }

  // Download file
  function downloadFile(filePath){
    window.open(`/file/download?path=${encodeURIComponent(filePath)}`, '_blank');
  }

  // Edit button handler
  if(previewEdit){
    previewEdit.addEventListener('click', () => {
      if(selectedFilePath){
        openInEditor(selectedFilePath);
      }
    });
  }

  // Download button handler
  if(previewDownload){
    previewDownload.addEventListener('click', () => {
      if(selectedFilePath){
        downloadFile(selectedFilePath);
      }
    });
  }

  // Select file by path (for integration with search result clicks)
  function selectFileByPath(filePath, focusLine = null){
    console.log('[List View] selectFileByPath called for:', filePath, focusLine ? `(line ${focusLine})` : '');

    // Find the result in current search results
    const result = currentSearchResults.find(r => r.file_path === filePath);

    if(result){
      console.log('[List View] Found result, selecting...');
      selectFile(result, focusLine);
    } else {
      console.warn('[List View] File not found in current results:', filePath);
      console.log('[List View] Available results:', currentSearchResults.map(r => r.file_path));
    }
  }

  // Expose functions to global scope for integration
  window.ListView = {
    init,
    toggleListView,
    renderFileGrid,
    selectFileByPath,
    isActive: () => listViewMode,
    updateResults: (results) => {
      currentSearchResults = results;
      if(listViewMode){
        renderFileGrid(results);
      }
    }
  };

  // Auto-init on DOMContentLoaded
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
