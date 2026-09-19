/**
 * Header.jsx — Top app bar
 *
 * Contains: Logo, active file language badge, Run/Preview buttons,
 *           connection status, Leave button, and mobile sidebar toggle.
 *
 * Language is now auto-detected from the active file extension — not a
 * user-selectable dropdown, since each file has its own language.
 *
 * Security: All rendered text via React JSX (auto-escaped). No innerHTML.
 */
import React, { useState } from 'react';

// Languages that can be run via the execution backend
const RUNNABLE_LANGS = new Set(['javascript', 'typescript', 'python', 'java', 'c', 'cpp']);
// Languages that show a Preview button instead of (or in addition to) Run
const PREVIEWABLE_LANGS = new Set(['html', 'css', 'markdown']);

const LANG_META = {
  javascript: { icon: '🟨', label: 'JavaScript' },
  typescript: { icon: '🔷', label: 'TypeScript' },
  python:     { icon: '🐍', label: 'Python' },
  java:       { icon: '☕', label: 'Java' },
  c:          { icon: '🔵', label: 'C' },
  cpp:        { icon: '🔷', label: 'C++' },
  csharp:     { icon: '🟣', label: 'C#' },
  go:         { icon: '🐹', label: 'Go' },
  rust:       { icon: '🦀', label: 'Rust' },
  ruby:       { icon: '💎', label: 'Ruby' },
  php:        { icon: '🐘', label: 'PHP' },
  swift:      { icon: '🍎', label: 'Swift' },
  kotlin:     { icon: '🎯', label: 'Kotlin' },
  scala:      { icon: '🔴', label: 'Scala' },
  html:       { icon: '🌐', label: 'HTML' },
  css:        { icon: '🎨', label: 'CSS' },
  json:       { icon: '📋', label: 'JSON' },
  yaml:       { icon: '⚙️', label: 'YAML' },
  markdown:   { icon: '📝', label: 'Markdown' },
  sql:        { icon: '🗄️', label: 'SQL' },
  shell:      { icon: '💻', label: 'Shell' },
  plaintext:  { icon: '📄', label: 'Text' },
};

function Header({
  roomId, language, activeFile, connected,
  onRun, onPreview, onLeave, running,
  onToggleSidebar, sidebarOpen, onCommandPalette,
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyRoom = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  const meta        = LANG_META[language] || { icon: '📄', label: language };
  const canRun      = activeFile && RUNNABLE_LANGS.has(language);
  const canPreview  = activeFile && PREVIEWABLE_LANGS.has(language);

  return (
    <header className="app-header" role="banner">
      <div className="header-left">
        {/* Mobile hamburger */}
        <button
          id="btn-sidebar-toggle"
          className="sidebar-hamburger"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          aria-expanded={sidebarOpen}
          title="Toggle sidebar"
        >
          {sidebarOpen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          )}
        </button>

        <div className="header-logo" aria-hidden="true">
          <span className="logo-symbol">{'</>'}</span>
        </div>
        <span className="header-app-name">CodeSync</span>

        <button
          id="btn-copy-room-id"
          className="room-id-chip"
          onClick={handleCopyRoom}
          title="Click to copy Room ID"
          aria-label={`Room ID: ${roomId}. Click to copy.`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>{copied ? 'Copied!' : roomId.slice(0, 8) + '…'}</span>
        </button>
      </div>

      {/* Center: active file language badge */}
      <div className="header-center">
        {activeFile ? (
          <div className="lang-badge" aria-label={`Current language: ${meta.label}`}>
            <span className="lang-icon" aria-hidden="true">{meta.icon}</span>
            <span className="lang-label">{meta.label}</span>
            <span className="lang-filename">— {activeFile.name}</span>
          </div>
        ) : (
          <div className="lang-badge lang-badge-empty">
            <span className="lang-icon" aria-hidden="true">📂</span>
            <span className="lang-label">No file open</span>
          </div>
        )}
      </div>

      <div className="header-right">
        <div
          className={`connection-badge ${connected ? 'connected' : 'disconnected'}`}
          role="status"
          aria-live="polite"
          aria-label={connected ? 'Connected' : 'Disconnected'}
        >
          <span className="connection-dot" aria-hidden="true"/>
          <span className="connection-label">{connected ? 'Live' : 'Offline'}</span>
        </div>

        {/* Command Palette trigger */}
        {onCommandPalette && (
          <button
            id="btn-command-palette"
            className="btn-palette-trigger"
            onClick={onCommandPalette}
            aria-label="Open Command Palette (Ctrl+Shift+P)"
            title="Command Palette (Ctrl+Shift+P)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="4" y1="6" x2="20" y2="6"/>
              <line x1="4" y1="12" x2="14" y2="12"/>
              <line x1="4" y1="18" x2="11" y2="18"/>
            </svg>
          </button>
        )}

        {/* Preview button — for HTML/CSS/Markdown */}
        {canPreview && (
          <button
            id="btn-preview"
            className="btn-preview"
            onClick={onPreview}
            aria-label={`Preview ${meta.label} output`}
            title={`Preview ${activeFile.name}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <span className="btn-run-label">Preview</span>
          </button>
        )}

        {/* Run button — for executable languages */}
        {(canRun || (!canPreview && activeFile)) && (
          <button
            id="btn-run-code"
            className={`btn-run ${running ? 'btn-run-loading' : ''}`}
            onClick={onRun}
            disabled={running || !activeFile}
            aria-label={running ? 'Running…' : `Run ${meta.label} code`}
            title={`Run ${activeFile?.name ?? 'file'}`}
          >
            {running ? (
              <span className="run-spinner" aria-hidden="true"/>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
            )}
            <span className="btn-run-label">{running ? 'Running…' : 'Run'}</span>
          </button>
        )}

        <button
          id="btn-leave-room"
          className="btn-leave"
          onClick={onLeave}
          aria-label="Leave room"
          title="Leave room"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16,17 21,12 16,7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span className="btn-leave-label">Leave</span>
        </button>
      </div>
    </header>
  );
}

export default Header;
