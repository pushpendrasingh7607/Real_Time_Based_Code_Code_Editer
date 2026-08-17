/**
 * Header.jsx — Top app bar
 *
 * Contains: Logo, Language selector, Run button, Connection status, Leave button
 * Security: All rendered text is via React JSX (auto-escaped). No innerHTML.
 */
import React, { useState } from 'react';

const LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'scala', label: 'Scala' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'sql', label: 'SQL' },
  { value: 'shell', label: 'Shell' },
  { value: 'plaintext', label: 'Plain Text' },
];

// Language display metadata
const LANG_META = {
  javascript: { icon: '🟨', label: 'JavaScript', runnable: true },
  python:     { icon: '🐍', label: 'Python',     runnable: true },
  java:       { icon: '☕', label: 'Java',        runnable: true },
  c:          { icon: '🔵', label: 'C',           runnable: true },
  cpp:        { icon: '🔷', label: 'C++',         runnable: true },
  typescript: { icon: '🔷', label: 'TypeScript',  runnable: false },
};

function Header({ roomId, language, onLanguageChange, connected, onRun, onLeave, running }) {

  const [copied, setCopied] = useState(false);

  const handleCopyRoom = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available — silently fail
    }
  };

  return (
    <header className="app-header" role="banner">
      <div className="header-left">
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
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>{copied ? 'Copied!' : roomId.slice(0, 8) + '…'}</span>
        </button>
      </div>

      <div className="header-center">
        <label htmlFor="language-select" className="sr-only">Select language</label>
        <select
          id="language-select"
          className="language-select"
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          aria-label="Programming language"
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>

      <div className="header-right">
        <div
          className={`connection-badge ${connected ? 'connected' : 'disconnected'}`}
          role="status"
          aria-live="polite"
          aria-label={connected ? 'Connected' : 'Disconnected'}
        >
          <span className="connection-dot" aria-hidden="true"></span>
          <span>{connected ? 'Live' : 'Offline'}</span>
        </div>

        <button
          id="btn-run-code"
          className={`btn-run ${running ? 'btn-run-loading' : ''}`}
          onClick={onRun}
          disabled={running}
          aria-label={running ? 'Running…' : 'Run code'}
          title={`Run ${LANG_META[language]?.label || language} code`}
        >
          {running ? (
            <span className="run-spinner" aria-hidden="true"></span>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          )}
          <span>{running ? 'Running…' : 'Run'}</span>
        </button>

        <button
          id="btn-leave-room"
          className="btn-leave"
          onClick={onLeave}
          aria-label="Leave room"
          title="Leave room"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span>Leave</span>
        </button>
      </div>
    </header>
  );
}

export default Header;
