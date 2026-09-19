/**
 * Sidebar.jsx — VS Code-style left panel
 *
 * Contains two sections:
 * 1. File Explorer — project file tree (FileExplorer component)
 * 2. Collaborators — connected users list
 *
 * On desktop: fixed left panel.
 * On mobile: overlay drawer that slides in from the left.
 *
 * Security: All user data displayed via React JSX text interpolation (auto-escaped).
 */
import React, { useState } from 'react';
import FileExplorer from './FileExplorer';

function UserAvatar({ user, isSelf }) {
  const initials = user.username
    .trim()
    .split(/\s+/)
    .map(w => w[0]?.toUpperCase() || '')
    .slice(0, 2)
    .join('');

  return (
    <div
      className={`user-avatar ${isSelf ? 'self' : ''}`}
      style={{ backgroundColor: user.color }}
      title={user.username}
      aria-label={`User: ${user.username}${isSelf ? ' (you)' : ''}`}
    >
      {initials || '?'}
    </div>
  );
}

function Sidebar({
  users, roomId, username, isOpen, onClose,
  files, folders, activeFileId,
  onOpenFile, onCreateFile, onCreateFolder,
  onDeleteFile, onDeleteFolder, onRenameFile,
  onOpenFileSystem, onOpenFolderSystem,
}) {
  const [copied, setCopied] = useState(false);
  const [activeSection, setActiveSection] = useState('explorer'); // 'explorer' | 'users'

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  return (
    <aside
      className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}
      aria-label="Room sidebar"
    >
      {/* Mobile close button */}
      <button
        className="sidebar-close-btn"
        onClick={onClose}
        aria-label="Close sidebar"
        title="Close sidebar"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      {/* Section tab switcher */}
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar sections">
        <button
          className={`sidebar-tab-btn ${activeSection === 'explorer' ? 'active' : ''}`}
          onClick={() => setActiveSection('explorer')}
          role="tab"
          aria-selected={activeSection === 'explorer'}
          aria-label="File Explorer"
          title="File Explorer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span>Files</span>
        </button>
        <button
          className={`sidebar-tab-btn ${activeSection === 'users' ? 'active' : ''}`}
          onClick={() => setActiveSection('users')}
          role="tab"
          aria-selected={activeSection === 'users'}
          aria-label="Collaborators"
          title="Collaborators"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <span>Users <span className="user-count-badge">{users.length}</span></span>
        </button>
      </div>

      {/* ── File Explorer Section ── */}
      {activeSection === 'explorer' && (
        <div className="sidebar-section sidebar-explorer-section">
          {/* Quick-access: open from computer */}
          <div className="sidebar-fs-actions">
            <button
              className="sidebar-fs-btn"
              onClick={onOpenFileSystem}
              title="Open File from your computer (Ctrl+O)"
              aria-label="Open file from computer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Open File
            </button>
            <button
              className="sidebar-fs-btn sidebar-fs-btn-folder"
              onClick={onOpenFolderSystem}
              title="Open Folder from your computer (Ctrl+Shift+O)"
              aria-label="Open folder from computer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
              </svg>
              Open Folder
            </button>
          </div>

          <FileExplorer
            files={files}
            folders={folders}
            activeFileId={activeFileId}
            onOpen={onOpenFile}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onDeleteFile={onDeleteFile}
            onDeleteFolder={onDeleteFolder}
            onRenameFile={onRenameFile}
            onOpenFileSystem={onOpenFileSystem}
            onOpenFolderSystem={onOpenFolderSystem}
          />
        </div>
      )}

      {/* ── Users Section ── */}
      {activeSection === 'users' && (
        <div className="sidebar-section">
          {/* Room ID */}
          <div className="room-id-display">
            <code className="room-id-text" title={roomId}>
              {roomId.slice(0, 8)}…
            </code>
            <button
              id="sidebar-btn-copy"
              className="icon-btn"
              onClick={handleCopy}
              aria-label="Copy full Room ID to clipboard"
              title="Copy Room ID"
            >
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <polyline points="20,6 9,17 4,12"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              )}
            </button>
          </div>
          <p className="room-id-full" title="Full Room ID">{roomId}</p>

          {/* Users list */}
          <h2 className="sidebar-section-title" id="users-heading" style={{ marginTop: '1rem' }}>
            Collaborators
            <span className="user-count-badge" aria-label={`${users.length} users online`}>
              {users.length}
            </span>
          </h2>
          <ul className="user-list" aria-label="Connected users" role="list" aria-labelledby="users-heading">
            {users.map(user => {
              const isSelf = user.username === username;
              return (
                <li key={user.id} className={`user-item ${isSelf ? 'self-item' : ''}`} role="listitem">
                  <UserAvatar user={user} isSelf={isSelf} />
                  <div className="user-info">
                    <span className="user-name">
                      {user.username}
                      {isSelf && <span className="self-tag" aria-label="you"> (you)</span>}
                    </span>
                    <span className="user-status" aria-hidden="true">
                      <span className="status-dot online"/>
                      Online
                    </span>
                  </div>
                </li>
              );
            })}
            {users.length === 0 && (
              <li className="no-users" role="listitem">Connecting…</li>
            )}
          </ul>

          {/* Tips */}
          <section className="sidebar-section sidebar-tips" aria-labelledby="tips-heading" style={{ marginTop: '1.5rem' }}>
            <h2 id="tips-heading" className="sidebar-section-title">Tips</h2>
            <ul className="tips-list" aria-label="Editor tips">
              <li>Share the Room ID to invite others</li>
              <li>All file changes sync in real-time</li>
              <li>Run JS, Python, Java, C, C++</li>
              <li>Preview HTML/CSS files live</li>
              <li>Right-click files to rename/delete</li>
              <li>Drag the output panel to resize</li>
            </ul>
          </section>
        </div>
      )}
    </aside>
  );
}

export default Sidebar;
