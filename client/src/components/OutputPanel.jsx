/**
 * OutputPanel.jsx — Code execution output panel
 *
 * Shows language badge, error/success styling, and output from backend execution.
 * Includes a drag handle at the top for vertical resizing.
 * Security: Output rendered as React text node (never innerHTML / dangerouslySetInnerHTML).
 */
import React from 'react';

const LANG_LABELS = {
  javascript: { label: 'JavaScript', icon: '🟨' },
  python:     { label: 'Python',     icon: '🐍' },
  java:       { label: 'Java',       icon: '☕' },
  c:          { label: 'C',          icon: '🔵' },
  cpp:        { label: 'C++',        icon: '🔷' },
};

function OutputPanel({ output, isError, language, onClose, height, onDragStart }) {
  const meta = LANG_LABELS[language];

  return (
    <div
      className={`output-panel ${isError ? 'output-error' : 'output-success'}`}
      role="region"
      aria-label="Code output"
      style={{ height: `${height}px`, minHeight: `${height}px` }}
    >
      {/* Drag handle — drag up to expand, drag down to shrink */}
      <div
        className="output-drag-handle"
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
        title="Drag to resize output panel"
        aria-label="Resize output panel"
        role="separator"
        aria-orientation="horizontal"
      >
        <span className="drag-handle-bar" aria-hidden="true" />
      </div>

      <div className="output-header">
        <div className="output-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="4,17 10,11 4,5"/><line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
          <span>Output</span>
          {meta && (
            <span className={`lang-badge ${isError ? 'lang-badge-error' : 'lang-badge-ok'}`} aria-label={`Language: ${meta.label}`}>
              {meta.icon} {meta.label}
            </span>
          )}
          {isError && (
            <span className="error-badge" aria-label="Error">
              ✗ Error
            </span>
          )}
          {!isError && output && output !== 'Running…' && (
            <span className="success-badge" aria-label="Success">
              ✓ Success
            </span>
          )}
        </div>
        <button
          id="btn-close-output"
          className="icon-btn output-close"
          onClick={onClose}
          aria-label="Close output panel"
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <pre
        className={`output-content ${isError ? 'output-content-error' : ''}`}
        aria-live="polite"
      >
        {output || '(no output)'}
      </pre>
    </div>
  );
}

export default OutputPanel;
