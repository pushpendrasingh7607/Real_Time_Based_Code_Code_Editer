/**
 * App.jsx — Root component
 *
 * Manages the two-phase app state:
 *  1. Landing page — user enters username and room ID (or creates a new room)
 *  2. Editor view — the collaborative Monaco editor environment
 *
 * Security: React JSX auto-escaping used throughout. No dangerouslySetInnerHTML.
 */
import React, { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Landing from './components/Landing';
import EditorLayout from './components/EditorLayout';
import './index.css';

function App() {
  const [session, setSession] = useState(null); // { roomId, username }

  const handleJoin = useCallback(({ roomId, username }) => {
    setSession({ roomId, username });
  }, []);

  const handleLeave = useCallback(() => {
    // Clear client-side state fully on leave (security: session lifecycle)
    setSession(null);
  }, []);

  return (
    <div className="app-root">
      {session ? (
        <EditorLayout
          roomId={session.roomId}
          username={session.username}
          onLeave={handleLeave}
        />
      ) : (
        <Landing onJoin={handleJoin} />
      )}
    </div>
  );
}

export default App;
