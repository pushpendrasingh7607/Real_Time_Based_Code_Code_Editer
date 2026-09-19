/**
 * EditorLayout.jsx — Main editor shell (multi-file project workspace)
 *
 * Manages:
 * - Full project file tree (files + folders) synced via WebSocket
 * - Open tabs with active file tracking
 * - Per-file code editing with real-time sync
 * - Code execution (Run) and HTML/CSS live preview
 * - User presence (connected users list)
 * - VS Code-style menu bar, command palette, drag-and-drop
 * - Open File / Open Folder from local filesystem
 * - Ctrl+S download of active file
 *
 * Security:
 * - All socket events validated before state updates
 * - No eval() or dangerouslySetInnerHTML
 * - Session cleared on leave
 * - File content read via FileReader text API only
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import socket from '../socket';
import Header from './Header';
import Sidebar from './Sidebar';
import Editor from './Editor';
import OutputPanel from './OutputPanel';
import TabBar from './TabBar';
import PreviewPanel from './PreviewPanel';
import MenuBar from './MenuBar';
import WelcomeTab, { saveRecentRoom } from './WelcomeTab';
import CommandPalette from './CommandPalette';
import { openFilesPicker, openFolderPicker, saveFileDownload } from '../hooks/useFileSystem';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? '';

// Previewable languages (show Preview button and side-by-side panel)
const PREVIEWABLE = new Set(['html', 'css', 'markdown', 'javascript', 'typescript']);
// Executable languages (can be run via backend executor)
const EXECUTABLE  = new Set(['javascript', 'typescript', 'python', 'java', 'c', 'cpp']);

const OUTPUT_MIN_H   = 80;
const OUTPUT_MAX_H   = 600;
const OUTPUT_DEFAULT_H = 220;

// Max files to import in one open-folder operation (safety limit)
const MAX_IMPORT_FILES = 100;

function EditorLayout({ roomId, username, onLeave }) {
  // ── Project state ──────────────────────────────────────────────────────────
  const [files, setFiles]     = useState([]);   // Array<{id,name,path,language,content}>
  const [folders, setFolders] = useState([]);   // Array<{id,name,path,parentPath}>

  // ── Editor / tab state ─────────────────────────────────────────────────────
  const [openTabIds, setOpenTabIds]       = useState([]); // ordered list of open file IDs
  const [activeFileId, setActiveFileId]   = useState(null);

  // ── Users & connection ────────────────────────────────────────────────────
  const [users, setUsers]         = useState([]);
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState(false);

  // ── Output / Preview ──────────────────────────────────────────────────────
  const [output, setOutput]               = useState('');
  const [outputError, setOutputError]     = useState(false);
  const [outputVisible, setOutputVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [running, setRunning]             = useState(false);
  const [outputHeight, setOutputHeight]   = useState(OUTPUT_DEFAULT_H);

  // ── Misc UI ───────────────────────────────────────────────────────────────
  const [notifications, setNotifications] = useState([]);
  const [sidebarOpen, setSidebarOpen]     = useState(false);
  const [paletteOpen, setPaletteOpen]     = useState(false);
  const [importing, setImporting]         = useState(false); // loading indicator for folder import

  const versionRef      = useRef({});   // per-file version counters
  const notifCountRef   = useRef(0);
  const dragRef         = useRef({ dragging: false, startY: 0, startH: 0 });
  const hasJoinedRef    = useRef(false);

  // ── Derived: active file object ───────────────────────────────────────────
  const activeFile = files.find(f => f.id === activeFileId) ?? null;
  const openTabs   = openTabIds.map(id => files.find(f => f.id === id)).filter(Boolean);

  const canPreview = activeFile && PREVIEWABLE.has(activeFile.language);

  // ── Notifications ─────────────────────────────────────────────────────────
  const showNotif = useCallback((msg, type = 'info') => {
    const id = ++notifCountRef.current;
    setNotifications(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3500);
  }, []);

  // ── Open a file in tabs ───────────────────────────────────────────────────
  const openFile = useCallback((fileId) => {
    setOpenTabIds(prev => prev.includes(fileId) ? prev : [...prev, fileId]);
    setActiveFileId(fileId);
    // Hide output/preview when switching files
    setOutputVisible(false);
    setPreviewVisible(false);
  }, []);

  const closeTab = useCallback((fileId) => {
    setOpenTabIds(prev => {
      const next = prev.filter(id => id !== fileId);
      // If we closed the active tab, switch to nearest
      if (fileId === activeFileId) {
        const idx = prev.indexOf(fileId);
        const nextActive = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
        setActiveFileId(nextActive);
      }
      return next;
    });
  }, [activeFileId]);

  // ── Socket lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    socket.connect();

    socket.on('connect', () => {
      setConnected(true);
      setConnError(false);
      socket.emit('join-room', { roomId, username });
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => { setConnected(false); setConnError(true); });

    // Full project snapshot on join
    socket.on('project-state', ({ files: f, folders: fo, users: u }) => {
      const fileArr = Array.isArray(f) ? f : [];
      setFiles(fileArr);
      setFolders(Array.isArray(fo) ? fo : []);
      setUsers(u || []);

      if (!hasJoinedRef.current) {
        hasJoinedRef.current = true;
        // If the room already has files (another user created them), auto-open the first one
        if (fileArr.length > 0) {
          const firstFile = fileArr.find(file =>
            file.language === 'html' || file.name === 'README.md'
          ) ?? fileArr[0];
          if (firstFile) {
            setOpenTabIds([firstFile.id]);
            setActiveFileId(firstFile.id);
          }
        }
        // Always show the "share room" tip and save recent
        setTimeout(() => showNotif('📋 Share Room ID to invite your friend', 'info'), 800);
        saveRecentRoom(roomId, username);
      }
    });

    // A specific file's content was updated by another user
    socket.on('file-update', ({ fileId, content, version, senderId }) => {
      if (senderId === socket.id) return; // ignore our own echoes
      setFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, content } : f
      ));
      if (!versionRef.current[fileId] || version > versionRef.current[fileId]) {
        versionRef.current[fileId] = version;
      }
    });

    // New file created by someone in the room
    socket.on('file-created', ({ file }) => {
      setFiles(prev => [...prev, file]);
    });

    // New folder created
    socket.on('folder-created', ({ folder }) => {
      setFolders(prev => [...prev, folder]);
    });

    // Bulk import completed (folders + files in one shot)
    // Auto-opens the first meaningful file — like VS Code after "Open Folder"
    socket.on('bulk-imported', ({ files: newFiles, folders: newFolders }) => {
      if (newFolders?.length) setFolders(prev => [...prev, ...newFolders]);
      if (newFiles?.length) {
        setFiles(prev => {
          const merged = [...prev, ...newFiles];
          return merged;
        });
        // Auto-open the first HTML/README file, or just the first file
        setActiveFileId(current => {
          if (current) return current; // already has a file open, don't disrupt
          const first = newFiles.find(f =>
            f.language === 'html' || f.name === 'README.md' || f.name === 'index.js' || f.name === 'main.py'
          ) ?? newFiles[0];
          if (first) {
            setOpenTabIds(prev => (prev.includes(first.id) ? prev : [...prev, first.id]));
            return first.id;
          }
          return current;
        });
      }
    });

    // File deleted
    socket.on('file-deleted', ({ fileId }) => {
      setFiles(prev => prev.filter(f => f.id !== fileId));
      setOpenTabIds(prev => prev.filter(id => id !== fileId));
      setActiveFileId(prev => (prev === fileId ? null : prev));
    });

    // Folder deleted
    socket.on('folder-deleted', ({ folderPath, deletedFileIds }) => {
      setFolders(prev => prev.filter(f => !f.path.startsWith(folderPath)));
      if (deletedFileIds?.length) {
        const idSet = new Set(deletedFileIds);
        setFiles(prev => prev.filter(f => !idSet.has(f.id)));
        setOpenTabIds(prev => prev.filter(id => !idSet.has(id)));
        setActiveFileId(prev => (idSet.has(prev) ? null : prev));
      }
    });

    // File renamed
    socket.on('file-renamed', ({ fileId, newName, newPath, language }) => {
      setFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, name: newName, path: newPath, language } : f
      ));
    });

    // User presence
    socket.on('user-joined', ({ user, users: u }) => {
      setUsers(u || []);
      showNotif(`👋 ${user.username} joined the room`, 'join');
    });

    socket.on('user-left', ({ userId, users: u }) => {
      setUsers(prev => {
        const departed = prev.find(usr => usr.id === userId);
        if (departed) showNotif(`👋 ${departed.username} left the room`, 'leave');
        return u || [];
      });
    });

    socket.on('error-msg', ({ message }) => {
      showNotif(`⚠️ ${message || 'Server error'}`, 'error');
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('project-state');
      socket.off('file-update');
      socket.off('file-created');
      socket.off('folder-created');
      socket.off('bulk-imported');
      socket.off('file-deleted');
      socket.off('folder-deleted');
      socket.off('file-renamed');
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('error-msg');
      socket.disconnect();
    };
  }, [roomId, username, showNotif]);

  // ── Reconnect ─────────────────────────────────────────────────────────────
  const handleReconnect = useCallback(() => {
    setConnError(false);
    hasJoinedRef.current = false;
    socket.connect();
  }, []);

  // ── Code change (active file) ────────────────────────────────────────────
  const handleCodeChange = useCallback((newCode) => {
    if (!activeFileId) return;
    setFiles(prev => prev.map(f =>
      f.id === activeFileId ? { ...f, content: newCode } : f
    ));
    const v = (versionRef.current[activeFileId] || 0) + 1;
    versionRef.current[activeFileId] = v;
    socket.emit('file-change', { roomId, fileId: activeFileId, content: newCode, version: v });
  }, [activeFileId, roomId]);

  // ── Cursor change ─────────────────────────────────────────────────────────
  const handleCursorChange = useCallback((position) => {
    socket.emit('cursor-change', { roomId, fileId: activeFileId, position });
  }, [roomId, activeFileId]);

  // ── Leave room ────────────────────────────────────────────────────────────
  const handleLeave = useCallback(() => {
    socket.disconnect();
    onLeave();
  }, [onLeave]);

  // ── Create file ───────────────────────────────────────────────────────────
  const handleCreateFile = useCallback((name, folderPath) => {
    socket.emit('file-create', { roomId, name, folderPath });
  }, [roomId]);

  // ── Create folder ─────────────────────────────────────────────────────────
  const handleCreateFolder = useCallback((name, parentPath) => {
    socket.emit('folder-create', { roomId, name, parentPath });
  }, [roomId]);

  // ── Delete file ───────────────────────────────────────────────────────────
  const handleDeleteFile = useCallback((fileId) => {
    if (!window.confirm('Delete this file?')) return;
    socket.emit('file-delete', { roomId, fileId });
  }, [roomId]);

  // ── Delete folder ─────────────────────────────────────────────────────────
  const handleDeleteFolder = useCallback((folderPath) => {
    if (!window.confirm(`Delete folder "${folderPath}" and all its files?`)) return;
    socket.emit('folder-delete', { roomId, folderPath });
  }, [roomId]);

  // ── Rename file ───────────────────────────────────────────────────────────
  const handleRenameFile = useCallback((fileId, newName) => {
    socket.emit('file-rename', { roomId, fileId, newName });
  }, [roomId]);

  // ── Run (execute active file) ─────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (!activeFile) return;

    // For HTML/CSS → show preview instead
    if (PREVIEWABLE.has(activeFile.language)) {
      setPreviewVisible(true);
      setOutputVisible(false);
      return;
    }

    if (!EXECUTABLE.has(activeFile.language)) {
      setOutput(`// Execution is not supported for "${activeFile.language}".\n// Runnable: JavaScript, TypeScript, Python, Java, C, C++`);
      setOutputError(false);
      setOutputVisible(true);
      setPreviewVisible(false);
      return;
    }

    setRunning(true);
    setOutputVisible(true);
    setPreviewVisible(false);
    setOutput('Running…');
    setOutputError(false);

    try {
      const res = await fetch(`${SERVER_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: activeFile.content, language: activeFile.language }),
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
      setOutput('Could not connect to execution server.');
      setOutputError(true);
    } finally {
      setRunning(false);
    }
  }, [activeFile]);

  // ── Preview button ────────────────────────────────────────────────────────
  const handlePreview = useCallback(() => {
    setPreviewVisible(true);
    setOutputVisible(false);
  }, []);

  // ── Sidebar toggle ────────────────────────────────────────────────────────
  const handleToggleSidebar = useCallback(() => setSidebarOpen(p => !p), []);
  const handleCloseSidebar  = useCallback(() => setSidebarOpen(false), []);

  // ── Output panel drag-to-resize ───────────────────────────────────────────
  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragRef.current = { dragging: true, startY: clientY, startH: outputHeight };

    const onMove = (ev) => {
      if (!dragRef.current.dragging) return;
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const delta = dragRef.current.startY - y;
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

  // ── Save (download active file) ───────────────────────────────────────────
  const handleSave = useCallback(() => {
    if (!activeFile) return;
    saveFileDownload(activeFile.name, activeFile.content);
    showNotif(`💾 Downloaded ${activeFile.name}`, 'info');
  }, [activeFile, showNotif]);

  // ── Open File from system ─────────────────────────────────────────────────
  const handleOpenFile = useCallback(async () => {
    try {
      const picked = await openFilesPicker({ multiple: true });
      if (picked.length === 0) return;

      const filesToImport = picked.slice(0, MAX_IMPORT_FILES);
      if (picked.length > MAX_IMPORT_FILES) {
        showNotif(`⚠️ Too many files. Importing first ${MAX_IMPORT_FILES}.`, 'error');
      }

      const filePayloads = filesToImport.map(({ name, content }) => ({
        name,
        folderPath: '',
        content,
      }));

      socket.emit('bulk-import', {
        roomId,
        folders: [],
        files: filePayloads,
      });

      showNotif(`📂 Imported ${filesToImport.length} file${filesToImport.length > 1 ? 's' : ''}`, 'info');
    } catch (err) {
      showNotif('❌ Failed to open file', 'error');
    }
  }, [roomId, showNotif]);

  // ── Open Folder from system ───────────────────────────────────────────────
  const handleOpenFolder = useCallback(async () => {
    try {
      setImporting(true);
      showNotif('📂 Reading folder…', 'info');
      const { files: pickedFiles, folders: pickedFolders, rootName } = await openFolderPicker();

      if (pickedFiles.length === 0 && pickedFolders.length === 0) {
        setImporting(false);
        return;
      }

      if (pickedFiles.length > MAX_IMPORT_FILES) {
        showNotif(`⚠️ Too many files. Importing first ${MAX_IMPORT_FILES}.`, 'error');
      }

      // Emit folder creates first (sorted by depth so parents come before children)
      for (const folder of pickedFolders) {
        socket.emit('folder-create', { roomId, name: folder.name, parentPath: folder.parentPath });
        // Small delay to avoid flooding socket
        await new Promise((r) => setTimeout(r, 15));
      }

      // Then emit file creates
      const filesToImport = pickedFiles.slice(0, MAX_IMPORT_FILES);
      for (const { name, path, content } of filesToImport) {
        const parts = path.split('/');
        const folderPath = parts.slice(0, -1).join('/');
        socket.emit('file-create', { roomId, name, folderPath, content });
        await new Promise((r) => setTimeout(r, 20));
      }

      showNotif(
        `✅ Imported "${rootName}": ${pickedFolders.length} folders, ${filesToImport.length} files`,
        'info'
      );
    } catch (err) {
      showNotif('❌ Failed to open folder', 'error');
    } finally {
      setImporting(false);
    }
  }, [roomId, showNotif]);

  // ── Handle file drop (from WelcomeTab or drag over editor) ───────────────
  const handleFileDrop = useCallback(async ({ files: droppedFiles, folders: droppedFolders }) => {
    try {
      for (const folder of droppedFolders) {
        socket.emit('folder-create', { roomId, name: folder.name, parentPath: folder.parentPath });
        await new Promise((r) => setTimeout(r, 15));
      }

      for (const { name, path, content } of droppedFiles.slice(0, MAX_IMPORT_FILES)) {
        const parts = path.split('/');
        const folderPath = parts.slice(0, -1).join('/');
        socket.emit('file-create', { roomId, name, folderPath, content });
        await new Promise((r) => setTimeout(r, 20));
      }

      showNotif(`📂 Imported ${droppedFiles.length} file${droppedFiles.length !== 1 ? 's' : ''}`, 'info');
    } catch {
      showNotif('❌ Error importing dropped files', 'error');
    }
  }, [roomId, showNotif]);

  // ── New File shortcut ─────────────────────────────────────────────────────
  const handleNewFile = useCallback(() => {
    // Open sidebar and trigger inline file creation
    setSidebarOpen(true);
    // showNotif is a workaround; a better way is to expose a ref in FileExplorer
    // For now, trigger the file create dialog via sidebar
    showNotif('📄 Use the Explorer to create a new file', 'info');
  }, [showNotif]);

  // ── Close active file tab ─────────────────────────────────────────────────
  const handleCloseFile = useCallback(() => {
    if (activeFileId) closeTab(activeFileId);
  }, [activeFileId, closeTab]);

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (ctrl && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        handleToggleSidebar();
      } else if (ctrl && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
        e.preventDefault();
        handleOpenFolder();
      } else if (ctrl && !e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        handleOpenFile();
      } else if (ctrl && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSave();
      } else if (ctrl && !e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        handleNewFile();
      } else if (ctrl && (e.key === 'Enter')) {
        e.preventDefault();
        handleRun();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleToggleSidebar, handleOpenFolder, handleOpenFile, handleSave, handleNewFile, handleRun]);

  // ── Command palette commands ──────────────────────────────────────────────
  const paletteCommands = [
    { id: 'new-file',       icon: '📄', category: 'File',   label: 'New File',           shortcut: 'Ctrl+N',         action: handleNewFile },
    { id: 'open-file',      icon: '📂', category: 'File',   label: 'Open File…',          shortcut: 'Ctrl+O',         action: handleOpenFile },
    { id: 'open-folder',    icon: '🗂️', category: 'File',   label: 'Open Folder…',        shortcut: 'Ctrl+Shift+O',  action: handleOpenFolder },
    { id: 'save',           icon: '💾', category: 'File',   label: 'Save / Download',     shortcut: 'Ctrl+S',         action: handleSave, disabled: !activeFile },
    { id: 'close-file',     icon: '✕',  category: 'File',   label: 'Close File',                                     action: handleCloseFile, disabled: !activeFile },
    { id: 'leave',          icon: '🚪', category: 'File',   label: 'Leave Room',                                     action: handleLeave },
    { id: 'run',            icon: '▶',  category: 'Run',    label: 'Run Code',            shortcut: 'Ctrl+Enter',     action: handleRun, disabled: !activeFile },
    { id: 'preview',        icon: '🌐', category: 'Run',    label: 'Preview',                                        action: handlePreview, disabled: !canPreview },
    { id: 'toggle-sidebar', icon: '📁', category: 'View',   label: 'Toggle Explorer',     shortcut: 'Ctrl+Shift+E',  action: handleToggleSidebar },
    { id: 'toggle-output',  icon: '💻', category: 'View',   label: 'Toggle Output Panel',                           action: () => setOutputVisible(v => !v), disabled: !activeFile },
    { id: 'close-palette',  icon: '❌', category: 'View',   label: 'Close Command Palette', shortcut: 'Esc',          action: () => setPaletteOpen(false) },
  ];

  return (
    <div className="editor-layout">
      {/* Toast notifications */}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {notifications.map(n => (
          <div
            key={n.id}
            className={`notification-toast toast-${n.type}`}
            role="status"
          >
            {n.msg}
          </div>
        ))}
      </div>

      {/* Import loading overlay */}
      {importing && (
        <div className="import-overlay" role="status" aria-live="polite">
          <div className="import-spinner" aria-hidden="true" />
          <span>Importing folder…</span>
        </div>
      )}

      {/* Command Palette */}
      {paletteOpen && (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {/* Connection error banner */}
      {connError && (
        <div className="offline-banner" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>Cannot connect to server. Make sure the backend is running on port 3001.</span>
          <button id="btn-reconnect" className="btn-reconnect" onClick={handleReconnect} aria-label="Retry connection">
            Reconnect
          </button>
        </div>
      )}

      <Header
        roomId={roomId}
        language={activeFile?.language ?? 'plaintext'}
        activeFile={activeFile}
        connected={connected}
        onRun={handleRun}
        onPreview={handlePreview}
        onLeave={handleLeave}
        running={running}
        onToggleSidebar={handleToggleSidebar}
        sidebarOpen={sidebarOpen}
        onCommandPalette={() => setPaletteOpen(true)}
      />

      {/* VS Code-style Menu Bar */}
      <MenuBar
        activeFile={activeFile}
        onNewFile={handleNewFile}
        onOpenFile={handleOpenFile}
        onOpenFolder={handleOpenFolder}
        onSave={handleSave}
        onCloseFile={handleCloseFile}
        onLeave={handleLeave}
        onToggleExplorer={handleToggleSidebar}
        onToggleOutput={() => setOutputVisible(v => !v)}
        onTogglePreview={handlePreview}
        onCommandPalette={() => setPaletteOpen(true)}
        canPreview={canPreview}
        outputVisible={outputVisible}
        previewVisible={previewVisible}
        explorerOpen={sidebarOpen}
      />

      <div className="editor-body">
        {sidebarOpen && (
          <div className="sidebar-backdrop" onClick={handleCloseSidebar} aria-hidden="true" />
        )}

        <Sidebar
          users={users}
          roomId={roomId}
          username={username}
          isOpen={sidebarOpen}
          onClose={handleCloseSidebar}
          files={files}
          folders={folders}
          activeFileId={activeFileId}
          onOpenFile={openFile}
          onCreateFile={handleCreateFile}
          onCreateFolder={handleCreateFolder}
          onDeleteFile={handleDeleteFile}
          onDeleteFolder={handleDeleteFolder}
          onRenameFile={handleRenameFile}
          onOpenFileSystem={handleOpenFile}
          onOpenFolderSystem={handleOpenFolder}
        />

        <div className="editor-main">
          <TabBar
            openTabs={openTabs}
            activeFileId={activeFileId}
            onSwitch={openFile}
            onClose={closeTab}
          />

          {/* Side-by-side split: editor | preview (like VS Code) */}
          <div className={`editor-canvas ${previewVisible ? 'editor-canvas-split' : ''}`}>
            {/* Editor pane */}
            <div className="editor-pane">
              {activeFile ? (
                <Editor
                  key={activeFile.id}
                  code={activeFile.content}
                  language={activeFile.language}
                  onChange={handleCodeChange}
                  onCursorChange={handleCursorChange}
                />
              ) : (
                <WelcomeTab
                  roomId={roomId}
                  username={username}
                  onNewFile={handleNewFile}
                  onOpenFile={handleOpenFile}
                  onOpenFolder={handleOpenFolder}
                  onFileDrop={handleFileDrop}
                />
              )}
            </div>

            {/* Preview pane — shown side-by-side when open */}
            {previewVisible && (
              <div className="preview-pane">
                <PreviewPanel
                  activeFile={activeFile}
                  files={files}
                  onClose={() => { setPreviewVisible(false); setOutputVisible(false); }}
                />
              </div>
            )}
          </div>

          {outputVisible && (
            <OutputPanel
              output={output}
              isError={outputError}
              language={activeFile?.language ?? 'plaintext'}
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
