/**
 * WelcomeTab.jsx — VS Code-style welcome / start screen
 *
 * Shown when no file is open in the editor.
 * Primary CTA: Open Folder (like VS Code)
 * Secondary: New File, Open File, Drag & Drop
 *
 * Security: No innerHTML. localStorage keys validated. React JSX auto-escaped.
 */
import React, { useState, useCallback, useRef } from 'react';

const MAX_RECENT = 5;
const RECENT_KEY = 'codesync_recent_rooms';

function getRecentRooms() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRecentRoom(roomId, username) {
  try {
    const existing = getRecentRooms().filter((r) => r.roomId !== roomId);
    const updated = [
      { roomId, username, date: new Date().toISOString() },
      ...existing,
    ].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  } catch {
    // silently fail
  }
}

// ── VS Code-style keyboard shortcut badge ─────────────────────────────────────
function Kbd({ children }) {
  return <kbd className="vsc-kbd">{children}</kbd>;
}

// ── Single start action row ───────────────────────────────────────────────────
function StartItem({ icon, label, shortcut, onClick, primary }) {
  return (
    <button
      className={`vsc-start-item ${primary ? 'vsc-start-primary' : ''}`}
      onClick={onClick}
      aria-label={label}
    >
      <span className="vsc-start-icon" aria-hidden="true">{icon}</span>
      <span className="vsc-start-label">{label}</span>
      {shortcut && (
        <span className="vsc-start-shortcut">
          {shortcut.map((k, i) => (
            <React.Fragment key={k}>
              <Kbd>{k}</Kbd>
              {i < shortcut.length - 1 && <span className="vsc-kbd-sep">+</span>}
            </React.Fragment>
          ))}
        </span>
      )}
    </button>
  );
}

// ── Main WelcomeTab ───────────────────────────────────────────────────────────
function WelcomeTab({ roomId, username, onNewFile, onOpenFile, onOpenFolder, onFileDrop, onJoinRoom }) {
  const [dragOver, setDragOver] = useState(false);
  const [dragError, setDragError] = useState('');
  const dropZoneRef = useRef(null);
  const recentRooms = getRecentRooms();

  // ── Drag & Drop handlers ──────────────────────────────────────────────────
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
    setDragError('');
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    if (!dropZoneRef.current?.contains(e.relatedTarget)) {
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const items = Array.from(e.dataTransfer.items ?? []);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;

    try {
      if (items.length > 0 && 'getAsFileSystemHandle' in items[0]) {
        const fileData = [];
        const folderData = [];

        async function processEntry(item, parentPath = '') {
          const handle = await item.getAsFileSystemHandle?.();
          if (!handle) return;

          if (handle.kind === 'file') {
            const file = await handle.getFile();
            if (file.name.startsWith('.')) return;
            const content = await new Promise((res, rej) => {
              const reader = new FileReader();
              reader.onload = (ev) => res(ev.target.result ?? '');
              reader.onerror = rej;
              reader.readAsText(file);
            });
            const path = parentPath ? `${parentPath}/${file.name}` : file.name;
            fileData.push({ name: file.name, path, content });
          } else if (handle.kind === 'directory') {
            const folderPath = parentPath ? `${parentPath}/${handle.name}` : handle.name;
            const parts = folderPath.split('/');
            folderData.push({
              name: handle.name,
              path: folderPath,
              parentPath: parts.slice(0, -1).join('/'),
            });
            for await (const [, childHandle] of handle.entries()) {
              if (childHandle.name.startsWith('.') || childHandle.name === 'node_modules') continue;
              await processEntry({ getAsFileSystemHandle: async () => childHandle }, folderPath);
            }
          }
        }

        for (const item of items) {
          if (item.kind === 'file') await processEntry(item);
        }

        if (fileData.length > 0 || folderData.length > 0) {
          onFileDrop({ files: fileData, folders: folderData });
          return;
        }
      }

      // Fallback: plain File objects
      const fileData = [];
      for (const file of files) {
        if (file.name.startsWith('.')) continue;
        const content = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = (ev) => res(ev.target.result ?? '');
          reader.onerror = rej;
          reader.readAsText(file);
        });
        fileData.push({ name: file.name, path: file.name, content });
      }
      onFileDrop({ files: fileData, folders: [] });
    } catch {
      setDragError('Could not read some files. Try using Open File instead.');
    }
  }, [onFileDrop]);

  return (
    <div
      className="vsc-welcome"
      onDragOver={handleDragOver}
    >
      {/* Drag-over overlay */}
      {dragOver && (
        <div
          ref={dropZoneRef}
          className="vsc-drag-overlay"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          aria-label="Drop files here"
          role="region"
        >
          <div className="vsc-drag-inner">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <p className="vsc-drag-title">Drop to open</p>
            <p className="vsc-drag-sub">Files and folders will be added to the workspace</p>
          </div>
        </div>
      )}

      <div className="vsc-welcome-inner">
        {/* ── Left column ────────────────────────────────────────────────── */}
        <aside className="vsc-welcome-aside">
          {/* Logo / branding */}
          <div className="vsc-brand">
            <div className="vsc-brand-logo" aria-hidden="true">
              <svg width="36" height="36" viewBox="0 0 100 100" fill="none" aria-hidden="true">
                <path d="M73.5 5L27 52l-16-12L5 46l22 22 52-52-5.5-11z" fill="url(#g1)"/>
                <path d="M73.5 5L95 27 49 73 27 74 5 46l6-6 16 12 46-47z" fill="url(#g2)" opacity=".8"/>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#58a6ff"/>
                    <stop offset="1" stopColor="#bc8cff"/>
                  </linearGradient>
                  <linearGradient id="g2" x1="100" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#bc8cff" stopOpacity="0.5"/>
                    <stop offset="1" stopColor="#58a6ff" stopOpacity="0.2"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div>
              <h1 className="vsc-brand-name">CodeSync</h1>
              <p className="vsc-brand-sub">Real-time collaborative editor</p>
            </div>
          </div>

          {/* Recent rooms */}
          {recentRooms.length > 0 && (
            <section className="vsc-recent-section" aria-labelledby="recent-label">
              <h2 id="recent-label" className="vsc-section-title">Recent</h2>
              <ul className="vsc-recent-list">
                {recentRooms.map((r) => (
                  <li key={r.roomId}>
                    <button
                      className="vsc-recent-item"
                      onClick={() => onJoinRoom && onJoinRoom(r.roomId)}
                      title={`Room: ${r.roomId}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                      </svg>
                      <span className="vsc-recent-id">{r.roomId.slice(0, 22)}&hellip;</span>
                      <span className="vsc-recent-user">as {r.username}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        {/* ── Right column ───────────────────────────────────────────────── */}
        <main className="vsc-welcome-main">
          {/* Start section */}
          <section className="vsc-start-section" aria-labelledby="start-label">
            <h2 id="start-label" className="vsc-section-title">Start</h2>
            <div className="vsc-start-list">
              {/* PRIMARY — Open Folder (most VS Code-like action) */}
              <StartItem
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
                    <polyline points="12 11 12 17"/>
                    <polyline points="9 14 12 11 15 14"/>
                  </svg>
                }
                label="Open Folder…"
                shortcut={['Ctrl', 'Shift', 'O']}
                onClick={onOpenFolder}
                primary
              />
              <StartItem
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="12" y1="18" x2="12" y2="12"/>
                    <line x1="9" y1="15" x2="15" y2="15"/>
                  </svg>
                }
                label="New File"
                shortcut={['Ctrl', 'N']}
                onClick={onNewFile}
              />
              <StartItem
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                }
                label="Open File…"
                shortcut={['Ctrl', 'O']}
                onClick={onOpenFile}
              />
            </div>
          </section>

          {/* Drag & Drop zone */}
          <section
            className={`vsc-dropzone ${dragOver ? 'vsc-dropzone-active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            role="region"
            aria-label="Drag and drop zone"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span className="vsc-dropzone-text">
              Drag &amp; drop files or folders here
            </span>
            <span className="vsc-dropzone-hint">Folder support in Chrome / Edge</span>
          </section>
          {dragError && <p className="vsc-drop-error" role="alert">{dragError}</p>}

          {/* Shortcuts reference */}
          <section className="vsc-shortcuts-section" aria-labelledby="shortcuts-label">
            <h2 id="shortcuts-label" className="vsc-section-title">Keyboard Shortcuts</h2>
            <div className="vsc-shortcuts-grid">
              {[
                { label: 'Command Palette',  keys: ['Ctrl', 'Shift', 'P'] },
                { label: 'Open Folder',      keys: ['Ctrl', 'Shift', 'O'] },
                { label: 'Open File',        keys: ['Ctrl', 'O'] },
                { label: 'New File',         keys: ['Ctrl', 'N'] },
                { label: 'Save / Download',  keys: ['Ctrl', 'S'] },
                { label: 'Toggle Explorer',  keys: ['Ctrl', 'Shift', 'E'] },
                { label: 'Run Code',         keys: ['Ctrl', 'Enter'] },
              ].map(({ label, keys }) => (
                <div key={label} className="vsc-shortcut-row">
                  <span className="vsc-shortcut-label">{label}</span>
                  <span className="vsc-shortcut-keys">
                    {keys.map((k, i) => (
                      <React.Fragment key={k}>
                        <Kbd>{k}</Kbd>
                        {i < keys.length - 1 && <span className="vsc-kbd-sep">+</span>}
                      </React.Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default WelcomeTab;
