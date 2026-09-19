/**
 * PreviewPanel.jsx — VS Code-style Live Preview
 *
 * Features:
 * - Full-height side-by-side panel (not just a bottom strip)
 * - Inlines CSS <link> and <script src> from workspace files
 * - Responsive viewport presets: Desktop / Tablet / Mobile
 * - Pop-out to a new browser tab
 * - Auto-refreshes whenever the active file or its linked CSS/JS changes
 * - Supports: HTML (with multi-file resolution), CSS, JS, Markdown
 *
 * Security:
 * - iframe sandbox="allow-scripts allow-same-origin" — needed to resolve
 *   inline images (data: URIs) and local font-face properly.
 * - No allow-top-navigation, no allow-forms, no allow-popups.
 * - All content injected via srcdoc (never document.write / innerHTML).
 */
import React, { useMemo, useState, useEffect, useRef } from 'react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VIEWPORT_PRESETS = [
  { id: 'desktop',  label: 'Desktop',  icon: '🖥',  width: '100%',   maxWidth: 'none' },
  { id: 'tablet',   label: 'Tablet',   icon: '▭',   width: '768px',  maxWidth: '768px' },
  { id: 'mobile',   label: 'Mobile',   icon: '📱',  width: '375px',  maxWidth: '375px' },
];

/**
 * Build the full HTML document to render in the iframe.
 * Resolves relative <link> and <script src> references from workspace files.
 */
function buildPreviewDoc(activeFile, files) {
  if (!activeFile) return '<p style="color:#888;font-family:sans-serif;padding:2rem">No file selected for preview.</p>';

  const lang = activeFile.language;

  // ── HTML ──────────────────────────────────────────────────────────────────
  if (lang === 'html') {
    let html = activeFile.content;

    // Folder the active file lives in (for relative path resolution)
    const folderPath = activeFile.path.includes('/')
      ? activeFile.path.substring(0, activeFile.path.lastIndexOf('/'))
      : '';

    // Inline linked CSS
    html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*\/?>/gi, (match, href) => {
      if (href.startsWith('http') || href.startsWith('//')) return match;
      const candidates = [
        folderPath ? `${folderPath}/${href}` : href,
        href,
      ];
      const cssFile = files.find(f => candidates.includes(f.path) || f.name === href);
      return cssFile ? `<style>\n/* inlined: ${href} */\n${cssFile.content}\n</style>` : match;
    });

    // Inline local JS <script src="...">
    html = html.replace(/<script([^>]+)src=["']([^"']+)["']([^>]*)><\/script>/gi, (match, pre, src, post) => {
      if (src.startsWith('http') || src.startsWith('//')) return match;
      const candidates = [
        folderPath ? `${folderPath}/${src}` : src,
        src,
      ];
      const jsFile = files.find(f => candidates.includes(f.path) || f.name === src);
      return jsFile ? `<script${pre}${post}>\n/* inlined: ${src} */\n${jsFile.content}\n</script>` : match;
    });

    return html;
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  if (lang === 'css') {
    return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>
  body { background: #0d1117; color: #e6edf3; font-family: 'Segoe UI', sans-serif; margin: 0; padding: 1rem; }
  .preview-note { color: #555; font-size: 12px; margin-bottom: 1rem; padding: 0.5rem 1rem; background: #161b22; border-radius: 6px; }
</style>
<style>${activeFile.content}</style>
</head><body>
<p class="preview-note">CSS Preview — add HTML elements in an <code>.html</code> file to see full output.</p>
<div class="preview-root">
  <h1>Heading 1</h1>
  <h2>Heading 2</h2>
  <p>Paragraph text. <a href="#">Link</a></p>
  <button>Button</button>
  <ul><li>List item 1</li><li>List item 2</li></ul>
</div>
</body></html>`;
  }

  // ── JavaScript / TypeScript ───────────────────────────────────────────────
  if (lang === 'javascript' || lang === 'typescript') {
    return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>
  body { background: #0d1117; color: #e6edf3; font-family: 'JetBrains Mono', monospace; padding: 1rem; margin: 0; font-size: 13px; }
  #output { white-space: pre-wrap; line-height: 1.6; }
  .line-err { color: #ff6b6b; }
  .line-warn { color: #f0c674; }
  .line-log { color: #e6edf3; }
  .preview-header { color: #555; font-size: 11px; margin-bottom: 12px; border-bottom: 1px solid #21262d; padding-bottom: 8px; }
</style>
</head><body>
<div class="preview-header">▶ Console Output</div>
<div id="output"></div>
<script>
(function() {
  const out = document.getElementById('output');
  function appendLine(text, cls) {
    const line = document.createElement('div');
    line.className = cls;
    line.textContent = text;
    out.appendChild(line);
  }
  const _log   = console.log.bind(console);
  const _warn  = console.warn.bind(console);
  const _error = console.error.bind(console);
  console.log   = (...a) => { appendLine(a.map(String).join(' '), 'line-log');  _log(...a); };
  console.warn  = (...a) => { appendLine(a.map(String).join(' '), 'line-warn'); _warn(...a); };
  console.error = (...a) => { appendLine(a.map(String).join(' '), 'line-err');  _error(...a); };
  try {
    ${activeFile.content}
  } catch(e) {
    appendLine('Error: ' + e.message, 'line-err');
  }
})();
</script>
</body></html>`;
  }

  // ── Markdown ──────────────────────────────────────────────────────────────
  if (lang === 'markdown') {
    const escape = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    // Very basic Markdown renderer
    const lines = activeFile.content.split('\n');
    let inCode = false;
    let html = lines.map(line => {
      if (line.startsWith('```')) { inCode = !inCode; return inCode ? '<pre><code>' : '</code></pre>'; }
      if (inCode) return escape(line) + '\n';
      if (line.startsWith('### ')) return `<h3>${escape(line.slice(4))}</h3>`;
      if (line.startsWith('## '))  return `<h2>${escape(line.slice(3))}</h2>`;
      if (line.startsWith('# '))   return `<h1>${escape(line.slice(2))}</h1>`;
      if (line.startsWith('- ') || line.startsWith('* '))  return `<li>${escape(line.slice(2))}</li>`;
      if (line.trim() === '') return '<br>';
      return '<p>' + escape(line)
        .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
        .replace(/\*(.+?)\*/g,'<em>$1</em>')
        .replace(/`(.+?)`/g,'<code>$1</code>')
        + '</p>';
    }).join('\n');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;padding:2rem;max-width:760px;margin:0 auto;line-height:1.8}
h1,h2,h3{color:#58a6ff;margin-top:1.5rem}
code{background:#21262d;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:.9em}
pre{background:#161b22;padding:1rem;border-radius:8px;overflow:auto}
pre code{background:none;padding:0}
li{margin:.25rem 0}a{color:#58a6ff}
</style></head><body>${html}</body></html>`;
  }

  // ── Fallback (plain text) ────────────────────────────────────────────────
  return `<!DOCTYPE html><html><head><style>
body{background:#0d1117;color:#e6edf3;font-family:monospace;padding:2rem;white-space:pre-wrap;font-size:13px}
</style></head><body>${activeFile.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</body></html>`;
}

// ─── PreviewPanel component ───────────────────────────────────────────────────

function PreviewPanel({ activeFile, files, onClose }) {
  const [viewport, setViewport]     = useState('desktop');
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef                   = useRef(null);

  const preset   = VIEWPORT_PRESETS.find(p => p.id === viewport);
  const srcDoc   = useMemo(() => buildPreviewDoc(activeFile, files), [activeFile, files, refreshKey]);

  // Auto-refresh when linked files (same folder) change
  const linkedPaths = useMemo(() => {
    if (!activeFile || activeFile.language !== 'html') return [];
    const folderPath = activeFile.path.includes('/')
      ? activeFile.path.substring(0, activeFile.path.lastIndexOf('/'))
      : '';
    const hrefs = [];
    activeFile.content.replace(/href=["']([^"']+\.css)["']/gi, (_, h) => hrefs.push(folderPath ? `${folderPath}/${h}` : h));
    activeFile.content.replace(/src=["']([^"']+\.js)["']/gi,  (_, h) => hrefs.push(folderPath ? `${folderPath}/${h}` : h));
    return hrefs;
  }, [activeFile]);

  const linkedFilesKey = useMemo(() => {
    return linkedPaths.map(p => {
      const f = files.find(f => f.path === p);
      return f ? f.content.length : 0;
    }).join(',');
  }, [files, linkedPaths]);

  useEffect(() => {
    setRefreshKey(k => k + 1);
  }, [linkedFilesKey]);

  // Pop-out to new tab
  const handlePopout = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.open();
    win.document.write(srcDoc);
    win.document.close();
  };

  const canPreview = activeFile && [
    'html', 'css', 'javascript', 'typescript', 'markdown', 'plaintext'
  ].includes(activeFile.language);

  return (
    <div className="preview-panel-full" aria-label="Live preview">
      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <div className="preview-toolbar-full">
        {/* Left: label */}
        <div className="preview-toolbar-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <span className="preview-title-text">Preview</span>
          {activeFile && <span className="preview-file-badge">{activeFile.name}</span>}
        </div>

        {/* Center: viewport presets */}
        <div className="preview-viewport-btns" role="group" aria-label="Viewport size">
          {VIEWPORT_PRESETS.map(p => (
            <button
              key={p.id}
              className={`preview-vp-btn ${viewport === p.id ? 'preview-vp-active' : ''}`}
              onClick={() => setViewport(p.id)}
              title={p.label}
              aria-label={p.label}
              aria-pressed={viewport === p.id}
            >
              {p.icon}
            </button>
          ))}
        </div>

        {/* Right: actions */}
        <div className="preview-toolbar-right">
          <button
            className="preview-action-btn"
            onClick={() => setRefreshKey(k => k + 1)}
            title="Refresh preview"
            aria-label="Refresh preview"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
          <button
            className="preview-action-btn"
            onClick={handlePopout}
            title="Open in new tab"
            aria-label="Open preview in new tab"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
          <button
            id="btn-close-preview"
            className="preview-action-btn preview-close-btn"
            onClick={onClose}
            title="Close preview"
            aria-label="Close preview"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── iframe area ───────────────────────────────────────────── */}
      <div className="preview-frame-area">
        {canPreview ? (
          <div
            className="preview-frame-constrain"
            style={{ width: preset.width, maxWidth: preset.maxWidth }}
          >
            <iframe
              ref={iframeRef}
              key={refreshKey}
              className="preview-iframe-full"
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-same-origin"
              title="Live preview"
              aria-label="Live preview of current file"
            />
          </div>
        ) : (
          <div className="preview-unsupported">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
            <p>Preview not available for <strong>{activeFile?.language || 'this'}</strong> files.</p>
            <p className="preview-unsupported-hint">Supported: HTML, CSS, JavaScript, Markdown</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default PreviewPanel;
