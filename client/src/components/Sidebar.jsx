/**
 * Sidebar.jsx — Connected users & room info panel
 *
 * Security: All user data displayed via React JSX text interpolation (auto-escaped).
 * No dangerouslySetInnerHTML or innerHTML used.
 */
import React, { useState } from 'react';

function UserAvatar({ user, isSelf }) {
  // Generate initials from username (safe: React auto-escapes)
  const initials = user.username
    .trim()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() || '')
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

function Sidebar({ users, roomId, username }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail if clipboard API unavailable
    }
  };

  return (
    <aside className="sidebar" aria-label="Room sidebar">
      {/* Room info */}
      <section className="sidebar-section" aria-labelledby="room-info-heading">
        <h2 id="room-info-heading" className="sidebar-section-title">Room</h2>
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
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            )}
          </button>
        </div>
      </section>

      {/* Users list */}
      <section className="sidebar-section" aria-labelledby="users-heading">
        <h2 id="users-heading" className="sidebar-section-title">
          Users
          <span className="user-count-badge" aria-label={`${users.length} users online`}>
            {users.length}
          </span>
        </h2>

        <ul className="user-list" aria-label="Connected users" role="list">
          {users.map((user) => {
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
                    <span className="status-dot online"></span>
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
      </section>

      {/* Tips */}
      <section className="sidebar-section sidebar-tips" aria-labelledby="tips-heading">
        <h2 id="tips-heading" className="sidebar-section-title">Tips</h2>
        <ul className="tips-list" aria-label="Editor tips">
          <li>Share the Room ID to invite others</li>
          <li>Changes sync in real-time</li>
          <li>Run JS, Python, Java, C, C++</li>
          <li>Switch language for starter code</li>
        </ul>
      </section>
    </aside>
  );
}

export default Sidebar;
