/**
 * socket.js — Socket.IO client singleton
 *
 * SERVER_URL is read from VITE_SERVER_URL environment variable.
 * - In development: set in .env.local (default: http://127.0.0.1:3001)
 * - In production:  set in Vercel dashboard as VITE_SERVER_URL = https://your-railway-url.railway.app
 *
 * Security:
 * - Never store auth tokens in localStorage
 * - TODO(security): Add JWT cookie-based auth for production
 */
import { io } from 'socket.io-client';

// Falls back to local dev server if env var not set
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://127.0.0.1:3001';

const socket = io(SERVER_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.3,
  timeout: 10000,
  transports: ['websocket', 'polling'],
});

export default socket;
