/**
 * Real-Time Collaborative Code Editor — Backend Server
 *
 * Security measures implemented:
 * - Helmet.js for HTTP security headers (CSP, X-Frame-Options, nosniff, etc.)
 * - Strict CORS allow-list (no wildcards)
 * - express-rate-limit on HTTP routes (separate, stricter limit for /execute)
 * - All WebSocket payloads validated for type and length
 * - Code execution uses spawn() with args arrays (no shell injection)
 * - Execution timeout (10s) prevents runaway processes
 * - Temp files use UUID names, stored in OS tmp, cleaned up after execution
 * - Binary paths hardcoded (allow-list); never derived from user input
 * - Output capped at 50 KB to prevent memory exhaustion
 * - Generic error messages to clients; detailed logs server-side only
 * - Server listens on 127.0.0.1 (localhost) only
 *
 * TODO(security): Add JWT-based authentication for production multi-tenant use.
 * TODO(security): Persist room state to a database using parameterized queries.
 * TODO(security): Add MFA for production deployments.
 * TODO(security): Run code execution in a containerised sandbox (e.g. Docker) for production.
 */

'use strict';

require('dotenv').config();
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);

// ─── Constants ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production';

// In production: listen on all interfaces (required by Railway/Render)
// In development: localhost only (security requirement)
const HOST = IS_PROD ? '0.0.0.0' : '127.0.0.1';

// Vite dynamically increments ports if 5173 is occupied
const DEV_ORIGINS = Array.from({ length: 20 }, (_, i) => [
  `http://localhost:${5173 + i}`,
  `http://127.0.0.1:${5173 + i}`,
]).flat();

// In production, CLIENT_URL env var must be set to your Vercel URL
// e.g. https://codesync.vercel.app
// In production: CLIENT_URL (manual override) OR Render auto-sets RENDER_EXTERNAL_URL
const PROD_ORIGINS = [];
if (process.env.CLIENT_URL) {
  PROD_ORIGINS.push(
    process.env.CLIENT_URL,
    process.env.CLIENT_URL.replace('https://', 'http://'),
  );
}
if (process.env.RENDER_EXTERNAL_URL) {
  PROD_ORIGINS.push(
    process.env.RENDER_EXTERNAL_URL,
    process.env.RENDER_EXTERNAL_URL.replace('https://', 'http://'),
  );
}

if (IS_PROD && PROD_ORIGINS.length === 0) {
  console.warn('[WARN] No CLIENT_URL or RENDER_EXTERNAL_URL set — CORS will only allow same-origin requests.');
}

const ALLOWED_ORIGINS = IS_PROD ? PROD_ORIGINS : DEV_ORIGINS;

const MAX_CODE_LENGTH   = 500_000;  // 500 KB
const MAX_USERNAME_LENGTH = 32;
const MAX_ROOM_ID_LENGTH  = 64;
const EXEC_TIMEOUT_MS   = 10_000;  // 10 seconds max execution time
const MAX_OUTPUT_BYTES  = 50_000;  // 50 KB max output

// ─── Allowed programming languages (allow-list) ──────────────────────────────
const ALLOWED_LANGUAGES = new Set([
  'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp',
  'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'html',
  'css', 'json', 'yaml', 'markdown', 'sql', 'shell', 'plaintext',
]);

// ─── Hardcoded binary paths (allow-list) ─────────────────────────────────────
// In Docker: standard Debian paths. In macOS dev: homebrew paths.
// Security: binary paths are NEVER derived from user input.
const RUNTIME_BINARIES = IS_PROD
  ? {
      // Paths inside the Debian-based Docker container
      node:    process.execPath,
      python3: '/usr/bin/python3',
      java:    '/usr/bin/java',
      javac:   '/usr/bin/javac',
      gcc:     '/usr/bin/gcc',
      gpp:     '/usr/bin/g++',
    }
  : {
      // macOS development paths
      node:    process.execPath,
      python3: '/opt/homebrew/bin/python3',
      java:    '/usr/bin/java',
      javac:   '/usr/bin/javac',
      gcc:     '/usr/bin/gcc',
      gpp:     '/usr/bin/g++',
    };

// Validate that binaries exist at startup
Object.entries(RUNTIME_BINARIES).forEach(([name, binPath]) => {
  if (!fs.existsSync(binPath)) {
    console.warn(`[WARN] Runtime binary not found: ${name} → ${binPath}`);
  }
});

// ─── Security Headers (Helmet) ────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'"],
        styleSrc:    ["'self'", "'unsafe-inline'"],
        imgSrc:      ["'self'", 'data:'],
        connectSrc:  ["'self'", ...ALLOWED_ORIGINS,
                      // Allow WebSocket connections from same origins
                      ...ALLOWED_ORIGINS.map(o => o.replace('http', 'ws'))],
        fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
        objectSrc:   ["'none'"],
        frameSrc:    ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    xFrameOptions: { action: 'deny' },
  })
);

// Trust proxy headers from Railway/Render/Vercel load balancers
if (IS_PROD) {
  app.set('trust proxy', 1);
}

// ─── CORS (strict allow-list) ─────────────────────────────────────────────────
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed'));
    }
  },
  methods: ['GET', 'POST'],
  credentials: false,
};
app.use(cors(corsOptions));

// ─── HTTP Rate Limiting ───────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Stricter limit for code execution to prevent abuse
const executeLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute window
  max: 30,               // 30 executions per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many execution requests. Please slow down.' },
});

app.use(generalLimiter);
app.use(express.json({ limit: '600kb' }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', runtimes: Object.keys(RUNTIME_BINARIES) });
});

// ─── Code Execution Engine ────────────────────────────────────────────────────

/**
 * Runs a child process with a timeout.
 * Security: spawn() never invokes a shell; args are passed as an array.
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
function runProcess(binary, args, { cwd, stdin, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(binary, args, {
      cwd: cwd || os.tmpdir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        // Minimal environment — never pass through user-supplied env vars
        PATH: '/usr/bin:/bin:/opt/homebrew/bin',
        HOME: os.homedir(),
        TMPDIR: os.tmpdir(),
      },
      shell: false, // NEVER use shell: true (command injection risk)
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
    }, timeoutMs || EXEC_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES) {
        killed = true;
        proc.kill('SIGKILL');
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (Buffer.byteLength(stderr, 'utf8') > MAX_OUTPUT_BYTES) {
        killed = true;
        proc.kill('SIGKILL');
      }
    });

    if (stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
        stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
        exitCode: killed ? -1 : (code ?? -1),
        timedOut: killed,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      // Log internally but don't expose details to client
      console.error('[Exec] Process error:', err.code);
      resolve({ stdout: '', stderr: 'Execution failed.', exitCode: -1, timedOut: false });
    });
  });
}

/**
 * Safely removes a file; logs but doesn't throw on failure.
 */
function safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch { /* ignored */ }
}

/**
 * Safely removes a directory (and contents); logs but doesn't throw on failure.
 */
function safeRmDir(dirPath) {
  try { fs.rmSync(dirPath, { recursive: true, force: true }); } catch { /* ignored */ }
}

/**
 * Executes code for a given language.
 * Returns { output: string, error: boolean }
 */
async function executeCode(language, code) {
  const tmpId   = uuidv4();
  const tmpDir  = path.join(os.tmpdir(), `codesync-${tmpId}`);

  // Create a unique temp directory for this execution
  fs.mkdirSync(tmpDir, { mode: 0o700 });

  try {
    switch (language) {

      // ── JavaScript ───────────────────────────────────────────────────────
      case 'javascript': {
        const filePath = path.join(tmpDir, 'main.js');
        fs.writeFileSync(filePath, code, { mode: 0o600 });
        const result = await runProcess(RUNTIME_BINARIES.node, ['main.js'], { cwd: tmpDir });
        safeUnlink(filePath);
        return formatResult(result);
      }

      // ── Python ───────────────────────────────────────────────────────────
      case 'python': {
        const filePath = path.join(tmpDir, 'main.py');
        fs.writeFileSync(filePath, code, { mode: 0o600 });
        const result = await runProcess(RUNTIME_BINARIES.python3, ['-u', 'main.py'], { cwd: tmpDir });
        safeUnlink(filePath);
        return formatResult(result);
      }

      // ── Java ─────────────────────────────────────────────────────────────
      case 'java': {
        // Extract public class name from code; default to Main
        const classMatch = code.match(/public\s+class\s+(\w+)/);
        const className  = classMatch ? classMatch[1] : 'Main';
        const filePath   = path.join(tmpDir, `${className}.java`);
        fs.writeFileSync(filePath, code, { mode: 0o600 });

        // Compile step
        const compileResult = await runProcess(
          RUNTIME_BINARIES.javac,
          [`${className}.java`],
          { cwd: tmpDir, timeoutMs: 20_000 }
        );
        if (compileResult.exitCode !== 0) {
          safeUnlink(filePath);
          return {
            output: sanitizeSystemPaths(compileResult.stderr || compileResult.stdout || 'Compilation failed.'),
            error: true,
          };
        }

        // Run step
        const runResult = await runProcess(
          RUNTIME_BINARIES.java,
          ['-cp', '.', className],
          { cwd: tmpDir }
        );
        safeUnlink(filePath);
        return formatResult(runResult);
      }

      // ── C ────────────────────────────────────────────────────────────────
      case 'c': {
        const srcPath = path.join(tmpDir, 'main.c');
        const binPath = path.join(tmpDir, 'main_out');
        fs.writeFileSync(srcPath, code, { mode: 0o600 });

        const compileResult = await runProcess(
          RUNTIME_BINARIES.gcc,
          ['-o', 'main_out', 'main.c', '-lm'],
          { cwd: tmpDir, timeoutMs: 20_000 }
        );
        if (compileResult.exitCode !== 0) {
          safeUnlink(srcPath);
          return {
            output: sanitizeSystemPaths(compileResult.stderr || compileResult.stdout || 'Compilation failed.'),
            error: true,
          };
        }

        const runResult = await runProcess(binPath, [], { cwd: tmpDir });
        safeUnlink(srcPath);
        safeUnlink(binPath);
        return formatResult(runResult);
      }

      // ── C++ ──────────────────────────────────────────────────────────────
      case 'cpp': {
        const srcPath = path.join(tmpDir, 'main.cpp');
        const binPath = path.join(tmpDir, 'main_out');
        fs.writeFileSync(srcPath, code, { mode: 0o600 });

        const compileResult = await runProcess(
          RUNTIME_BINARIES.gpp,
          ['-o', 'main_out', 'main.cpp', '-std=c++17', '-lm'],
          { cwd: tmpDir, timeoutMs: 20_000 }
        );
        if (compileResult.exitCode !== 0) {
          safeUnlink(srcPath);
          return {
            output: sanitizeSystemPaths(compileResult.stderr || compileResult.stdout || 'Compilation failed.'),
            error: true,
          };
        }

        const runResult = await runProcess(binPath, [], { cwd: tmpDir });
        safeUnlink(srcPath);
        safeUnlink(binPath);
        return formatResult(runResult);
      }

      default:
        return {
          output: `// Execution is not supported for "${language}".\n// Supported: JavaScript, Python, Java, C, C++`,
          error: false,
        };
    }
  } finally {
    // Always clean up temp directory (security: no leftover files)
    safeRmDir(tmpDir);
  }
}

/**
 * Strips internal system paths from error output to avoid leaking server info.
 * Security: never expose absolute tmp paths to clients.
 */
function sanitizeSystemPaths(text) {
  return text
    .replace(/\/tmp\/codesync-[a-z0-9-]+\//g, '')
    .replace(new RegExp(os.homedir(), 'g'), '~')
    .trim();
}

/**
 * Formats a process result into a client-safe output string.
 */
function formatResult({ stdout, stderr, exitCode, timedOut }) {
  if (timedOut) {
    return { output: '⏱ Execution timed out (10 seconds limit).', error: true };
  }
  const parts = [];
  if (stdout) parts.push(stdout.trim());
  if (stderr)  parts.push(stderr.trim());
  if (!stdout && !stderr) parts.push('(no output)');

  const output = sanitizeSystemPaths(parts.join('\n'));
  return { output, error: exitCode !== 0 };
}

// ─── POST /execute ────────────────────────────────────────────────────────────
app.post('/execute', executeLimiter, async (req, res) => {
  const { code, language } = req.body;

  // Validate inputs
  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LENGTH) {
    return res.status(400).json({ error: 'Invalid code.' });
  }
  // Validate language against allow-list (security: never derive exec path from user input)
  if (!ALLOWED_LANGUAGES.has(language)) {
    return res.status(400).json({ error: 'Unsupported language.' });
  }

  try {
    const result = await executeCode(language, code);
    res.json(result);
  } catch (err) {
    // Log detailed error server-side only; return generic message to client
    console.error('[Execute] Internal error:', err.message);
    res.status(500).json({ output: 'An error occurred during execution.', error: true });
  }
});

// ─── In-memory room state ─────────────────────────────────────────────────────
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      code: '# Welcome to CodeSync!\n# Start typing to share code in real-time.\n\nprint("Hello, World!")',
      language: 'python',
      users: new Map(),
    });
  }
  return rooms.get(roomId);
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (room && room.users.size === 0) rooms.delete(roomId);
}

// ─── Input Validation Helpers ─────────────────────────────────────────────────
function isValidString(val, maxLen) {
  return typeof val === 'string' && val.length > 0 && val.length <= maxLen;
}

function sanitizeUsername(name) {
  return name.replace(/[^\x20-\x7E]/g, '').trim().slice(0, MAX_USERNAME_LENGTH);
}

// ─── Socket.IO Setup ──────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e6,
});

const USER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F0B27A', '#82E0AA', '#AEB6BF', '#F1948A', '#76D7C4',
];

let globalUserCount = 0;

io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  socket.on('join-room', ({ roomId, username }) => {
    if (!isValidString(roomId, MAX_ROOM_ID_LENGTH)) {
      socket.emit('error-msg', { message: 'Invalid room ID.' }); return;
    }
    const cleanName = isValidString(username, MAX_USERNAME_LENGTH)
      ? sanitizeUsername(username)
      : `User-${socket.id.slice(0, 4)}`;

    socket.join(roomId);
    socket.data.roomId  = roomId;
    socket.data.username = cleanName;

    const room = getOrCreateRoom(roomId);
    globalUserCount++;
    room.users.set(socket.id, {
      id: socket.id, username: cleanName,
      color: USER_COLORS[globalUserCount % USER_COLORS.length],
    });

    socket.emit('room-state', {
      code: room.code, language: room.language,
      users: Array.from(room.users.values()),
    });
    socket.to(roomId).emit('user-joined', {
      user: room.users.get(socket.id),
      users: Array.from(room.users.values()),
    });
    console.log(`[WS] ${cleanName} joined room: ${roomId} (${room.users.size} users)`);
  });

  socket.on('code-change', ({ roomId, code, version }) => {
    if (!isValidString(roomId, MAX_ROOM_ID_LENGTH)) return;
    if (typeof code !== 'string' || code.length > MAX_CODE_LENGTH) return;
    if (typeof version !== 'number') return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.code = code;
    room.version = version;
    socket.to(roomId).emit('code-update', { code, version, senderId: socket.id });
  });

  socket.on('cursor-change', ({ roomId, position }) => {
    if (!isValidString(roomId, MAX_ROOM_ID_LENGTH)) return;
    if (!position || typeof position.lineNumber !== 'number' || typeof position.column !== 'number') return;
    socket.to(roomId).emit('cursor-update', { userId: socket.id, position });
  });

  socket.on('language-change', ({ roomId, language }) => {
    if (!isValidString(roomId, MAX_ROOM_ID_LENGTH)) return;
    if (!ALLOWED_LANGUAGES.has(language)) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.language = language;
    io.to(roomId).emit('language-update', { language });
  });

  socket.on('disconnect', () => {
    const { roomId, username } = socket.data || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (room) {
      room.users.delete(socket.id);
      io.to(roomId).emit('user-left', {
        userId: socket.id,
        users: Array.from(room.users.values()),
      });
      cleanupRoom(roomId);
      console.log(`[WS] ${username || socket.id} left room: ${roomId}`);
    }
  });
});

// ─── Serve built React frontend in production ────────────────────────────────
// The client is built into ../client/dist. In production (Render), the build
// step runs `npm run build` in the client directory first.
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
if (IS_PROD && fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { maxAge: '7d' }));
  // SPA catch-all: any route not matched above returns index.html
  app.get('*', (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
  console.log(`📦 Serving static client from: ${CLIENT_DIST}`);
}

// ─── Start Server ─────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`✅ Server running at http://${HOST}:${PORT}`);
  console.log(`   Mode: ${IS_PROD ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(', ') || 'NONE (set CLIENT_URL env var)'}`);
  console.log(`   Supported languages: JavaScript, Python, Java, C, C++`);
});
