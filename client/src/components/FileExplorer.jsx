/**
 * FileExplorer.jsx — VS Code-style file tree
 *
 * Features:
 * - Recursive folder / file rendering
 * - Click file to open in editor
 * - Inline create file / folder
 * - Right-click context menu: Rename, Delete
 * - Expand/collapse folders
 *
 * Performance (v2):
 * - React.memo on FileNode + FolderNode prevents unnecessary re-renders
 * - Parent pre-builds folderChildren + filesByFolder maps → O(1) lookups,
 *   eliminates the O(N²) per-node filter scan on every render.
 *
 * Security: No dangerouslySetInnerHTML. All user content via React JSX.
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

// ── File-type icon map ─────────────────────────────────────────────────────────
const FILE_ICONS = {
  js: '🟨', jsx: '⚛️', ts: '🔷', tsx: '⚛️',
  py: '🐍', java: '☕', c: '🔵', cpp: '🔷', cs: '🟣',
  go: '🐹', rs: '🦀', rb: '💎', php: '🐘',
  html: '🌐', css: '🎨', scss: '🎨', json: '📋',
  md: '📝', yaml: '⚙️', yml: '⚙️', sql: '🗄️',
  sh: '💻', bash: '💻', env: '🔐', txt: '📄',
  swift: '🍎', kt: '🎯', vue: '💚', svelte: '🔥',
};

function getFileIcon(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return FILE_ICONS[ext] || '📄';
}

// ── Context Menu ──────────────────────────────────────────────────────────────
function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <ul
      ref={ref}
      className="context-menu"
      style={{ top: y, left: x }}
      role="menu"
      aria-label="File options"
    >
      {items.map((item) => (
        <li
          key={item.label}
          className={`context-menu-item ${item.danger ? 'danger' : ''}`}
          onClick={() => { item.action(); onClose(); }}
          role="menuitem"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') { item.action(); onClose(); } }}
        >
          <span className="ctx-icon">{item.icon}</span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// ── Inline Name Input ──────────────────────────────────────────────────────────
function InlineInput({ defaultValue = '', placeholder, onConfirm, onCancel }) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
    else onCancel();
  };

  return (
    <input
      ref={inputRef}
      className="inline-input"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onBlur={commit}
      aria-label={placeholder}
    />
  );
}

// ── FileNode ───────────────────────────────────────────────────────────────────
// React.memo: only re-renders when its own props change, not when sibling files change.
const FileNode = React.memo(function FileNode({ file, activeFileId, onOpen, onDelete, onRename }) {
  const [renaming, setRenaming] = useState(false);
  const [ctx, setCtx] = useState(null);
  const isActive = file.id === activeFileId;

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY });
  };

  const ctxItems = [
    { icon: '✏️', label: 'Rename', action: () => setRenaming(true) },
    { icon: '🗑️', label: 'Delete', danger: true, action: () => onDelete(file.id) },
  ];

  return (
    <div className="fe-file-row">
      {renaming ? (
        <InlineInput
          defaultValue={file.name}
          placeholder="New name…"
          onConfirm={(n) => { onRename(file.id, n); setRenaming(false); }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <button
          className={`fe-file-btn ${isActive ? 'fe-file-active' : ''}`}
          onClick={() => onOpen(file.id)}
          onContextMenu={handleContextMenu}
          title={file.path}
          aria-label={`Open ${file.name}`}
          aria-current={isActive ? 'page' : undefined}
        >
          <span className="fe-file-icon" aria-hidden="true">{getFileIcon(file.name)}</span>
          <span className="fe-file-name">{file.name}</span>
        </button>
      )}

      {ctx && (
        <ContextMenu
          x={ctx.x} y={ctx.y}
          items={ctxItems}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  );
});

// ── FolderNode ─────────────────────────────────────────────────────────────────
// Receives pre-filtered folderFiles + childFolders as props — no scanning here.
const FolderNode = React.memo(function FolderNode({
  folder, folderFiles, childFolders,
  // maps passed down so recursive children can also do O(1) lookups
  filesByFolderPath, foldersByParentPath,
  activeFileId,
  onOpen, onDelete, onRename, onCreateFile, onCreateFolder, onDeleteFolder,
  depth = 0,
}) {
  const [open, setOpen] = useState(true);
  const [creatingFile, setCreatingFile] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [ctx, setCtx] = useState(null);

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY });
  };

  const ctxItems = [
    { icon: '📄', label: 'New File',   action: () => setCreatingFile(true) },
    { icon: '📁', label: 'New Folder', action: () => setCreatingFolder(true) },
    { icon: '✏️', label: 'Rename',     action: () => setRenamingFolder(true) },
    { icon: '🗑️', label: 'Delete',     danger: true, action: () => onDeleteFolder(folder.path) },
  ];

  return (
    <div className="fe-folder" style={{ '--depth': depth }}>
      {renamingFolder ? (
        <InlineInput
          defaultValue={folder.name}
          placeholder="Folder name…"
          onConfirm={(n) => { /* TODO: folder rename */ setRenamingFolder(false); }}
          onCancel={() => setRenamingFolder(false)}
        />
      ) : (
        <button
          className="fe-folder-btn"
          onClick={() => setOpen(o => !o)}
          onContextMenu={handleContextMenu}
          aria-expanded={open}
          title={folder.path}
        >
          <span className="fe-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className="fe-folder-icon" aria-hidden="true">{open ? '📂' : '📁'}</span>
          <span className="fe-folder-name">{folder.name}</span>
        </button>
      )}

      {ctx && (
        <ContextMenu
          x={ctx.x} y={ctx.y}
          items={ctxItems}
          onClose={() => setCtx(null)}
        />
      )}

      {open && (
        <div className="fe-folder-children">
          {/* Child folders — use pre-built map for O(1) lookup */}
          {childFolders.map(sf => (
            <FolderNode
              key={sf.id}
              folder={sf}
              folderFiles={filesByFolderPath[sf.path] ?? []}
              childFolders={foldersByParentPath[sf.path] ?? []}
              filesByFolderPath={filesByFolderPath}
              foldersByParentPath={foldersByParentPath}
              activeFileId={activeFileId}
              onOpen={onOpen}
              onDelete={onDelete}
              onRename={onRename}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onDeleteFolder={onDeleteFolder}
              depth={depth + 1}
            />
          ))}

          {/* Files directly in this folder */}
          {folderFiles.map(f => (
            <FileNode
              key={f.id}
              file={f}
              activeFileId={activeFileId}
              onOpen={onOpen}
              onDelete={onDelete}
              onRename={onRename}
            />
          ))}

          {creatingFile && (
            <div className="fe-inline-create">
              <span className="fe-file-icon" aria-hidden="true">📄</span>
              <InlineInput
                placeholder="filename.ext"
                onConfirm={(n) => { onCreateFile(n, folder.path); setCreatingFile(false); }}
                onCancel={() => setCreatingFile(false)}
              />
            </div>
          )}

          {creatingFolder && (
            <div className="fe-inline-create">
              <span className="fe-file-icon" aria-hidden="true">📁</span>
              <InlineInput
                placeholder="folder name"
                onConfirm={(n) => { onCreateFolder(n, folder.path); setCreatingFolder(false); }}
                onCancel={() => setCreatingFolder(false)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ── FileExplorer (root) ────────────────────────────────────────────────────────
function FileExplorer({ files, folders, activeFileId, onOpen, onCreateFile, onCreateFolder, onDeleteFile, onDeleteFolder, onRenameFile, onOpenFileSystem, onOpenFolderSystem }) {
  const [creatingRootFile, setCreatingRootFile] = useState(false);
  const [creatingRootFolder, setCreatingRootFolder] = useState(false);

  /**
   * Build O(1) lookup maps once per files/folders change.
   * filesByFolderPath:   folderPath → File[]
   * foldersByParentPath: parentPath → Folder[]
   */
  const { filesByFolderPath, foldersByParentPath } = useMemo(() => {
    const fbf = {};
    for (const f of files) {
      const parts = f.path.split('/');
      const parentDir = parts.slice(0, -1).join('/');
      if (!fbf[parentDir]) fbf[parentDir] = [];
      fbf[parentDir].push(f);
    }

    const fbp = {};
    for (const folder of folders) {
      const key = folder.parentPath ?? '';
      if (!fbp[key]) fbp[key] = [];
      fbp[key].push(folder);
    }

    return { filesByFolderPath: fbf, foldersByParentPath: fbp };
  }, [files, folders]);

  // Root-level files (not inside any folder)
  const rootFiles   = filesByFolderPath[''] ?? [];
  // Root-level folders
  const rootFolders = foldersByParentPath[''] ?? [];

  return (
    <div className="file-explorer" role="tree" aria-label="Project files">
      {/* Explorer header with action buttons */}
      <div className="fe-header">
        <span className="fe-header-title">EXPLORER</span>
        <div className="fe-header-actions">
          {/* New File */}
          <button
            className="fe-action-btn"
            onClick={() => setCreatingRootFile(true)}
            title="New File (in room)"
            aria-label="Create new file"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
          </button>
          {/* New Folder */}
          <button
            className="fe-action-btn"
            onClick={() => setCreatingRootFolder(true)}
            title="New Folder (in room)"
            aria-label="Create new folder"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              <line x1="12" y1="11" x2="12" y2="17"/>
              <line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
          </button>
          {/* Open File from system */}
          {onOpenFileSystem && (
            <button
              className="fe-action-btn"
              onClick={onOpenFileSystem}
              title="Open File from computer (Ctrl+O)"
              aria-label="Open file from computer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </button>
          )}
          {/* Open Folder from system */}
          {onOpenFolderSystem && (
            <button
              className="fe-action-btn fe-action-btn-folder"
              onClick={onOpenFolderSystem}
              title="Open Folder from computer (Ctrl+Shift+O)"
              aria-label="Open folder from computer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
                <polyline points="12 11 12 17"/>
                <polyline points="9 14 12 11 15 14"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="fe-tree">
        {/* Root folders */}
        {rootFolders.map(folder => (
          <FolderNode
            key={folder.id}
            folder={folder}
            folderFiles={filesByFolderPath[folder.path] ?? []}
            childFolders={foldersByParentPath[folder.path] ?? []}
            filesByFolderPath={filesByFolderPath}
            foldersByParentPath={foldersByParentPath}
            activeFileId={activeFileId}
            onOpen={onOpen}
            onDelete={onDeleteFile}
            onRename={onRenameFile}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onDeleteFolder={onDeleteFolder}
            depth={0}
          />
        ))}

        {/* Root files */}
        {rootFiles.map(f => (
          <FileNode
            key={f.id}
            file={f}
            activeFileId={activeFileId}
            onOpen={onOpen}
            onDelete={onDeleteFile}
            onRename={onRenameFile}
          />
        ))}

        {/* Root-level inline creates */}
        {creatingRootFile && (
          <div className="fe-inline-create">
            <span className="fe-file-icon" aria-hidden="true">📄</span>
            <InlineInput
              placeholder="filename.ext"
              onConfirm={(n) => { onCreateFile(n, ''); setCreatingRootFile(false); }}
              onCancel={() => setCreatingRootFile(false)}
            />
          </div>
        )}

        {creatingRootFolder && (
          <div className="fe-inline-create">
            <span className="fe-file-icon" aria-hidden="true">📁</span>
            <InlineInput
              placeholder="folder name"
              onConfirm={(n) => { onCreateFolder(n, ''); setCreatingRootFolder(false); }}
              onCancel={() => setCreatingRootFolder(false)}
            />
          </div>
        )}

        {files.length === 0 && folders.length === 0 && (
          <div className="fe-empty">
            <p>No files yet.</p>
            <p>Click + to create one.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default FileExplorer;

