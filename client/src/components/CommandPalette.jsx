/**
 * CommandPalette.jsx — VS Code-style Ctrl+Shift+P command launcher
 *
 * Fuzzy-searches a list of commands and executes them on selection.
 * Security: No innerHTML. All content via React JSX.
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

/**
 * Simple fuzzy match — returns true if all chars of `query` appear in order in `target`.
 */
function fuzzyMatch(query, target) {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Highlight matched characters in the label string.
 */
function HighlightedLabel({ label, query }) {
  if (!query) return <span>{label}</span>;

  const q = query.toLowerCase();
  const chars = label.split('');
  const result = [];
  let qi = 0;

  for (let i = 0; i < chars.length; i++) {
    const matched = qi < q.length && chars[i].toLowerCase() === q[qi];
    if (matched) {
      result.push(<mark key={i} className="palette-match">{chars[i]}</mark>);
      qi++;
    } else {
      result.push(<span key={i}>{chars[i]}</span>);
    }
  }
  return <span aria-label={label}>{result}</span>;
}

function CommandPalette({ commands, onClose }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape or click outside
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const filtered = useMemo(() => {
    const matches = commands.filter(
      (cmd) => !cmd.hidden && fuzzyMatch(query, cmd.label + ' ' + (cmd.category ?? ''))
    );
    return matches;
  }, [commands, query]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelected(0);
  }, [query]);

  const execute = useCallback((cmd) => {
    if (cmd.disabled) return;
    onClose();
    cmd.action();
  }, [onClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[selected];
      if (cmd) execute(cmd);
    }
  }, [filtered, selected, execute]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selected];
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div
      className="palette-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <div
        className="palette-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="palette-search-row">
          <svg className="palette-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            placeholder="Type a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-activedescendant={filtered[selected] ? `palette-item-${selected}` : undefined}
            role="combobox"
            aria-expanded={filtered.length > 0}
          />
          <kbd className="palette-esc-hint">Esc</kbd>
        </div>

        {/* Results */}
        <ul
          ref={listRef}
          className="palette-list"
          role="listbox"
          aria-label="Commands"
        >
          {filtered.length === 0 ? (
            <li className="palette-no-results" role="option" aria-selected="false">
              No commands match "{query}"
            </li>
          ) : (
            filtered.map((cmd, i) => (
              <li
                key={cmd.id ?? cmd.label}
                id={`palette-item-${i}`}
                className={`palette-item ${i === selected ? 'palette-item-selected' : ''} ${cmd.disabled ? 'palette-item-disabled' : ''}`}
                role="option"
                aria-selected={i === selected}
                onClick={() => execute(cmd)}
                onMouseEnter={() => setSelected(i)}
              >
                <span className="palette-item-icon" aria-hidden="true">{cmd.icon ?? '>'}</span>
                <span className="palette-item-body">
                  {cmd.category && (
                    <span className="palette-item-category">{cmd.category}: </span>
                  )}
                  <HighlightedLabel label={cmd.label} query={query} />
                </span>
                {cmd.shortcut && (
                  <span className="palette-item-shortcut" aria-label={`Shortcut: ${cmd.shortcut}`}>
                    {cmd.shortcut}
                  </span>
                )}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

export default CommandPalette;
