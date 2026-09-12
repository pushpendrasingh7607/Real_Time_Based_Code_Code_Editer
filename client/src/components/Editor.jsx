/**
 * Editor.jsx — Monaco Editor wrapper with real-time WebSocket sync
 *
 * Key behaviours:
 * - Debounces outgoing code-change events to avoid flooding the server
 * - Uses a "isRemoteChange" ref to prevent echo loops when applying
 *   incoming updates from other users
 * - Cursor position emitted on every change for presence awareness
 *
 * Security:
 * - Monaco is loaded via npm package (not CDN), no SRI needed
 * - No dangerouslySetInnerHTML; Monaco manages its own safe DOM
 */
import React, { useRef, useCallback, useEffect } from 'react';
import MonacoEditor, { loader } from '@monaco-editor/react';

// ── Critical: use local npm monaco-editor instead of CDN (jsDelivr) ──────────
// By default @monaco-editor/react loads Monaco from cdn.jsdelivr.net which is
// blocked by our CSP. Pointing loader to the local npm package fixes the
// "Loading editor..." hang in production.
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });


// Debounce helper
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Monaco editor options — full VS Code-like experience
const MONACO_OPTIONS = {
  fontSize: 14,
  fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
  fontLigatures: true,
  lineHeight: 22,
  minimap: { enabled: true, scale: 1 },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  wordWrap: 'on',
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true },
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  padding: { top: 16, bottom: 16 },
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
    useShadows: false,
  },
  renderLineHighlight: 'all',
  colorDecorators: true,
  suggestOnTriggerCharacters: true,
  quickSuggestions: true,
  parameterHints: { enabled: true },
  formatOnPaste: true,
  formatOnType: false,
};

function Editor({ code, language, onChange, onCursorChange }) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const isRemoteChange = useRef(false);

  // Debounced emit — only send after 80ms of no typing
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedEmit = useCallback(
    debounce((newCode) => {
      onChange(newCode);
    }, 80),
    [onChange]
  );

  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Configure Monaco theme
    monaco.editor.defineTheme('codesync-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'function', foreground: 'DCDCAA' },
        { token: 'variable', foreground: '9CDCFE' },
      ],
      colors: {
        'editor.background': '#0D1117',
        'editor.foreground': '#E6EDF3',
        'editor.lineHighlightBackground': '#161B22',
        'editor.selectionBackground': '#264F78',
        'editorLineNumber.foreground': '#3D444D',
        'editorLineNumber.activeForeground': '#E6EDF3',
        'editor.findMatchBackground': '#9E6A03',
        'editorCursor.foreground': '#58A6FF',
        'editorWhitespace.foreground': '#3D444D',
        'editorIndentGuide.background': '#21262D',
        'editorIndentGuide.activeBackground': '#30363D',
        'scrollbarSlider.background': '#30363D88',
        'scrollbarSlider.hoverBackground': '#30363DCC',
        'minimap.background': '#0D1117',
      },
    });
    monaco.editor.setTheme('codesync-dark');

    // Cursor change listener
    editor.onDidChangeCursorPosition((e) => {
      onCursorChange({
        lineNumber: e.position.lineNumber,
        column: e.position.column,
      });
    });
  };

  const handleEditorChange = (value) => {
    if (isRemoteChange.current) return; // Don't re-emit remote changes
    debouncedEmit(value ?? '');
  };

  // Apply incoming remote code change without triggering our own emit
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const currentValue = editor.getValue();
    if (currentValue === code) return; // No change needed

    isRemoteChange.current = true;
    // Preserve cursor position during remote update
    const pos = editor.getPosition();
    editor.setValue(code);
    if (pos) editor.setPosition(pos);
    isRemoteChange.current = false;
  }, [code]);

  return (
    <div className="monaco-wrapper" aria-label="Code editor">
      <MonacoEditor
        height="100%"
        language={language}
        value={code}
        onChange={handleEditorChange}
        onMount={handleEditorMount}
        options={MONACO_OPTIONS}
        theme="codesync-dark"
        loading={
          <div className="editor-loading" aria-busy="true" aria-label="Loading editor">
            <div className="loading-spinner" aria-hidden="true"></div>
            <span>Loading editor…</span>
          </div>
        }
      />
    </div>
  );
}

export default Editor;
