/**
 * TabBar.jsx — Multi-file editor tab strip
 *
 * Renders one tab per open file. Supports:
 * - Click to switch active file
 * - × button to close tab
 * - Scrollable when many tabs open
 * - Visual indicator for active tab
 * - Unsaved change dot (future: dirty state)
 *
 * Security: All content via React JSX (auto-escaped).
 */
import React, { useRef, useEffect } from 'react';

// ── File-type icon (small, used in tab) ──────────────────────────────────────
const TAB_ICONS = {
  js: '🟨', jsx: '🟨', mjs: '🟨',
  ts: '🔷', tsx: '🔷',
  py: '🐍',
  java: '☕',
  c: '🔵', h: '🔵',
  cpp: '🔷', cc: '🔷',
  cs: '🟣',
  go: '🐹',
  rs: '🦀',
  rb: '💎',
  php: '🐘',
  html: '🌐', htm: '🌐',
  css: '🎨', scss: '🎨', sass: '🎨', less: '🎨',
  json: '📋',
  md: '📝', mdx: '📝',
  yaml: '⚙️', yml: '⚙️',
  sql: '🗄️',
  sh: '💻', bash: '💻',
  env: '🔐',
  txt: '📄',
};

function getTabIcon(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return TAB_ICONS[ext] || '📄';
}

function TabBar({ openTabs, activeFileId, onSwitch, onClose }) {
  const scrollRef = useRef(null);

  // Auto-scroll to active tab when it changes
  useEffect(() => {
    if (!scrollRef.current) return;
    const activeTab = scrollRef.current.querySelector('[data-active="true"]');
    if (activeTab) {
      activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeFileId]);

  if (!openTabs || openTabs.length === 0) {
    return (
      <div className="tab-bar tab-bar-empty" aria-label="No files open">
        <span className="tab-bar-hint">Open a file from the explorer →</span>
      </div>
    );
  }

  return (
    <div className="tab-bar" role="tablist" aria-label="Open files">
      <div className="tab-bar-scroll" ref={scrollRef}>
        {openTabs.map((file) => {
          const isActive = file.id === activeFileId;
          return (
            <div
              key={file.id}
              className={`tab ${isActive ? 'tab-active' : ''}`}
              data-active={isActive}
              role="tab"
              aria-selected={isActive}
              aria-label={file.path || file.name}
              title={file.path || file.name}
            >
              <button
                className="tab-select-btn"
                onClick={() => onSwitch(file.id)}
                aria-label={`Switch to ${file.name}`}
                tabIndex={isActive ? 0 : -1}
              >
                <span className="tab-icon" aria-hidden="true">{getTabIcon(file.name)}</span>
                <span className="tab-name">{file.name}</span>
              </button>

              <button
                className="tab-close-btn"
                onClick={(e) => { e.stopPropagation(); onClose(file.id); }}
                aria-label={`Close ${file.name}`}
                title={`Close ${file.name}`}
                tabIndex={-1}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default TabBar;
