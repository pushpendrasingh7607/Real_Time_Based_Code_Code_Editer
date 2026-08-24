/**
 * socket.js — Socket.IO client singleton
 *
 * SERVER_URL behaviour:
 * - Development: reads VITE_SERVER_URL from .env.local (defaults to http://127.0.0.1:3001)
 * - Production (single-deployment on Render): VITE_SERVER_URL is NOT set,
 *   so we pass an empty string '' which tells socket.io-client to connect
 *   to the same origin as the page — i.e. the Render URL that serves both
 *   the API and the built React app.
 *
 * Security:
 * - Never store auth tokens in localStorage
 */
import { io } from 'socket.io-client';

// Dev: 'http://127.0.0.1:3001'  |  Prod (single-deploy): '' (same origin)
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? '';

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
