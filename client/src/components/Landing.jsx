/**
 * Landing.jsx — Room creation / join page
 *
 * Security:
 * - React JSX auto-escaping; no dangerouslySetInnerHTML
 * - Username sanitized to 32 chars max; no special characters rendered unsafely
 */
import React, { useState, useId } from 'react';
import { v4 as uuidv4 } from 'uuid';

const MAX_USERNAME_LEN = 32;
const MAX_ROOM_ID_LEN = 64;

function Landing({ onJoin }) {
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('create'); // 'create' | 'join'

  const usernameId = useId();
  const roomInputId = useId();

  const handleCreate = (e) => {
    e.preventDefault();
    setError('');
    const name = username.trim();
    if (!name) { setError('Please enter a username.'); return; }
    onJoin({ roomId: uuidv4(), username: name.slice(0, MAX_USERNAME_LEN) });
  };

  const handleJoin = (e) => {
    e.preventDefault();
    setError('');
    const name = username.trim();
    const room = roomId.trim();
    if (!name) { setError('Please enter a username.'); return; }
    if (!room) { setError('Please enter a Room ID.'); return; }
    onJoin({ roomId: room.slice(0, MAX_ROOM_ID_LEN), username: name.slice(0, MAX_USERNAME_LEN) });
  };

  return (
    <div className="landing-page">
      {/* Animated background orbs */}
      <div className="orb orb-1" aria-hidden="true"></div>
      <div className="orb orb-2" aria-hidden="true"></div>
      <div className="orb orb-3" aria-hidden="true"></div>

      <div className="landing-card" role="main">
        <div className="landing-logo" aria-hidden="true">
          <span className="logo-icon">{'</>'}</span>
        </div>
        <h1 className="landing-title">CodeSync</h1>
        <p className="landing-subtitle">
          Real-time collaborative code editing, powered by WebSockets
        </p>

        <div className="tab-row" role="tablist" aria-label="Room options">
          <button
            id="tab-create"
            role="tab"
            aria-selected={tab === 'create'}
            aria-controls="panel-create"
            className={`tab-btn ${tab === 'create' ? 'active' : ''}`}
            onClick={() => { setTab('create'); setError(''); }}
          >
            Create Room
          </button>
          <button
            id="tab-join"
            role="tab"
            aria-selected={tab === 'join'}
            aria-controls="panel-join"
            className={`tab-btn ${tab === 'join' ? 'active' : ''}`}
            onClick={() => { setTab('join'); setError(''); }}
          >
            Join Room
          </button>
        </div>

        {tab === 'create' ? (
          <form
            id="panel-create"
            role="tabpanel"
            aria-labelledby="tab-create"
            className="landing-form"
            onSubmit={handleCreate}
            noValidate
          >
            <div className="form-group">
              <label htmlFor={usernameId} className="form-label">Your Name</label>
              <input
                id={usernameId}
                type="text"
                className="form-input"
                placeholder="e.g. Alice"
                value={username}
                maxLength={MAX_USERNAME_LEN}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button id="btn-create-room" type="submit" className="btn-primary">
              <span>Create New Room</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </form>
        ) : (
          <form
            id="panel-join"
            role="tabpanel"
            aria-labelledby="tab-join"
            className="landing-form"
            onSubmit={handleJoin}
            noValidate
          >
            <div className="form-group">
              <label htmlFor={usernameId + '-join'} className="form-label">Your Name</label>
              <input
                id={usernameId + '-join'}
                type="text"
                className="form-input"
                placeholder="e.g. Bob"
                value={username}
                maxLength={MAX_USERNAME_LEN}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor={roomInputId} className="form-label">Room ID</label>
              <input
                id={roomInputId}
                type="text"
                className="form-input"
                placeholder="Paste the room ID here"
                value={roomId}
                maxLength={MAX_ROOM_ID_LEN}
                onChange={(e) => setRoomId(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button id="btn-join-room" type="submit" className="btn-primary">
              <span>Join Room</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </form>
        )}

        <div className="landing-features" aria-label="Feature highlights">
          <div className="feature-chip">⚡ Real-time sync</div>
          <div className="feature-chip">👥 Multi-user</div>
          <div className="feature-chip">🎨 20+ languages</div>
          <div className="feature-chip">🔒 Secure</div>
        </div>
      </div>
    </div>
  );
}

export default Landing;
