/**
 * EditorLayout.jsx — Main editor shell
 *
 * Orchestrates the WebSocket connection lifecycle, distributes shared state
 * to Header, Sidebar, Editor, and OutputPanel components.
 *
 * Security:
 * - Socket events validated before state updates
 * - Session fully cleared on leave (no tokens, no localStorage)
 * - Code execution via backend API (never in-browser eval for compiled langs)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import socket from '../socket';
import Header from './Header';
import Sidebar from './Sidebar';
import Editor from './Editor';
import OutputPanel from './OutputPanel';

// In production (same-origin deploy on Render): VITE_SERVER_URL is unset → use '' so
// fetch('/execute') hits the same Render server. In dev: use env var (localhost:3001).
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? '';

const DEFAULT_CODE = '# Welcome to CodeSync!\n# Start typing to share code in real-time.\n\nprint("Hello, World!")';
const DEFAULT_LANG = 'python';

// Default starter templates per language
const LANGUAGE_TEMPLATES = {
  javascript: '// JavaScript\nconsole.log("Hello, World!");',
  python:     '# Python\nprint("Hello, World!")',
  java:       `// Java\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}`,
  c:          `// C\n#include <stdio.h>\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}`,
  cpp:        `// C++\n#include <iostream>\nusing namespace std;\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}`,
  typescript: '// TypeScript\nconst greet = (name: string): string => `Hello, ${name}!`;\nconsole.log(greet("World"));',
};

// Minimum and maximum output panel height (px)
const OUTPUT_MIN_H = 80;
const OUTPUT_MAX_H = 600;
const OUTPUT_DEFAULT_H = 220;

function EditorLayout({ roomId, username, onLeave }) {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [language, setLanguage] = useState(DEFAULT_LANG);
  const [users, setUsers] = useState([]);
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState(false);
  const [output, setOutput] = useState('');
  const [outputError, setOutputError] = useState(false);
  const [outputVisible, setOutputVisible] = useState(false);
  const [running, setRunning] = useState(false);
  const [notifications, setNotifications] = useState([]); // [{id, msg, type}]
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [outputHeight, setOutputHeight] = useState(OUTPUT_DEFAULT_H);

  const versionRef = useRef(0);
  const notifCountRef = useRef(0);
  const dragRef = useRef({ dragging: false, startY: 0, startH: 0 });
  const hasJoinedRef = useRef(false);

  // ── Notification system ─────────────────────────────────────────────────
  const showNotif = useCallback((msg, type = 'info') => {
    const id = ++notifCountRef.current;
    setNotifications((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 3500);
  }, []);

  // ── Socket lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    socket.connect();

    socket.on('connect', () => {
      setConnected(true);
      setConnError(false);
      socket.emit('join-room', { roomId, username });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', () => {
      setConnected(false);
      setConnError(true);
    });

    socket.on('room-state', ({ code: c, language: l, users: u }) => {
      setCode(c);
      setLanguage(l);
      setUsers(u || []);
      // Show share-room toast only on first join
      if (!hasJoinedRef.current) {
        hasJoinedRef.current = true;
        setTimeout(() => {
          showNotif(`📋 Share Room ID to invite others`, 'info');
        }, 800);
      }
    });

    socket.on('code-update', ({ code: c, version }) => {
      // Only apply if incoming version is newer (prevent echo loops)
      if (version >= versionRef.current) {
        versionRef.current = version;
        setCode(c);
      }
    });

    socket.on('language-update', ({ language: l }) => {
      setLanguage(l);
    });

    socket.on('user-joined', ({ user, users: u }) => {
      setUsers(u || []);
      showNotif(`👋 ${user.username} joined the room`, 'join');
    });

    socket.on('user-left', ({ userId, users: u }) => {
      // Find the departed user's name from the current list before updating
      setUsers((prev) => {
        const departed = prev.find((usr) => usr.id === userId);
        if (departed) showNotif(`👋 ${departed.username} left the room`, 'leave');
        return u || [];
      });
    });

    socket.on('error-msg', () => {
      // Generic error — never log sensitive details
      console.error('[Editor] Server error received');
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('room-state');
      socket.off('code-update');
      socket.off('language-update');
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('error-msg');
      socket.off('connect_error');
      socket.disconnect();
    };
  }, [roomId, username, showNotif]);

  // ── Manual reconnect ────────────────────────────────────────────────────
  const handleReconnect = useCallback(() => {
    setConnError(false);
    socket.connect();
  }, []);

  // ── Code change handler ──────────────────────────────────────────────────
  const handleCodeChange = useCallback((newCode) => {
    setCode(newCode);
    versionRef.current += 1;
    socket.emit('code-change', {
      roomId,
      code: newCode,
      version: versionRef.current,
    });
  }, [roomId]);

  // ── Cursor change handler ────────────────────────────────────────────────
  const handleCursorChange = useCallback((position) => {
    socket.emit('cursor-change', { roomId, position });
  }, [roomId]);

  // ── Leave room ───────────────────────────────────────────────────────────
  const handleLeave = useCallback(() => {
    socket.disconnect();
    onLeave();
  }, [onLeave]);

  // ── Language change with template injection ───────────────────────────────
  const handleLanguageChange = useCallback((lang) => {
    setLanguage(lang);
    // Inject a starter template if the editor is still at a default/empty state
    const trimmed = code.trim();
    const isStillDefault = Object.values(LANGUAGE_TEMPLATES).some(
      (tpl) => trimmed === tpl.trim()
    ) || trimmed === '' || trimmed.startsWith('// Welcome') || trimmed.startsWith('# Welcome');
    if (isStillDefault && LANGUAGE_TEMPLATES[lang]) {
      const newCode = LANGUAGE_TEMPLATES[lang];
      setCode(newCode);
      socket.emit('code-change', { roomId, code: newCode, version: versionRef.current + 1 });
      versionRef.current += 1;
    }
    socket.emit('language-change', { roomId, language: lang });
  }, [code, roomId]);

  // ── Run code via backend execution API ────────────────────────────────────
  const handleRun = useCallback(async () => {
    const EXECUTABLE_LANGS = new Set(['javascript', 'python', 'java', 'c', 'cpp']);
    if (!EXECUTABLE_LANGS.has(language)) {
      setOutput(`// Execution is not yet supported for "${language}".\n// Supported: JavaScript, Python, Java, C, C++`);
      setOutputError(false);
      setOutputVisible(true);
      return;
    }

    setRunning(true);
    setOutputVisible(true);
    setOutput('Running…');
    setOutputError(false);

    try {
      const res = await fetch(`${SERVER_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setOutput(data.error || 'Server error during execution.');
        setOutputError(true);
        return;
      }

      const data = await res.json();
      setOutput(data.output || '(no output)');
      setOutputError(!!data.error);
    } catch {
      // Generic message — never expose fetch internals
      setOutput('Could not connect to execution server.');
      setOutputError(true);
    } finally {
      setRunning(false);
    }
  }, [code, language]);

  // ── Sidebar toggle (mobile) ───────────────────────────────────────────────
  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  // ── Output panel drag-to-resize ───────────────────────────────────────────
  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragRef.current = { dragging: true, startY: clientY, startH: outputHeight };

    const onMove = (ev) => {
      if (!dragRef.current.dragging) return;
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const delta = dragRef.current.startY - y; // dragging up = bigger panel
      const newH = Math.min(OUTPUT_MAX_H, Math.max(OUTPUT_MIN_H, dragRef.current.startH + delta));
      setOutputHeight(newH);
    };

    const onUp = () => {
      dragRef.current.dragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, [outputHeight]);

  return (
    <div className="editor-layout">
      {/* Notification toasts */}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`notification-toast toast-${n.type}`}
            role="status"
          >
            {n.msg}
          </div>
        ))}
      </div>

      {connError && (
        <div className="offline-banner" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>Cannot connect to server. Make sure the backend is running on port 3001.</span>
          <button
            id="btn-reconnect"
            className="btn-reconnect"
            onClick={handleReconnect}
            aria-label="Retry connection"
          >
            Reconnect
          </button>
        </div>
      )}

      <Header
        roomId={roomId}
        language={language}
        onLanguageChange={handleLanguageChange}
        connected={connected}
        onRun={handleRun}
        onLeave={handleLeave}
        running={running}
        onToggleSidebar={handleToggleSidebar}
        sidebarOpen={sidebarOpen}
      />

      <div className="editor-body">
        {/* Mobile sidebar backdrop */}
        {sidebarOpen && (
          <div
            className="sidebar-backdrop"
            onClick={handleCloseSidebar}
            aria-hidden="true"
          />
        )}

        <Sidebar
          users={users}
          roomId={roomId}
          username={username}
          isOpen={sidebarOpen}
          onClose={handleCloseSidebar}
        />

        <div className="editor-main">
          <Editor
            code={code}
            language={language}
            onChange={handleCodeChange}
            onCursorChange={handleCursorChange}
          />
          {outputVisible && (
            <OutputPanel
              output={output}
              isError={outputError}
              language={language}
              onClose={() => setOutputVisible(false)}
              height={outputHeight}
              onDragStart={handleDragStart}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default EditorLayout;
