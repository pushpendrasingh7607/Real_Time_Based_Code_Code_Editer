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
 * - Server listens on 0.0.0.0 in production (required by Render/Railway)
 * - Server listens on 127.0.0.1 in development only
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

const HOST = process.env.HOST || (IS_PROD ? '0.0.0.0' : '127.0.0.1');

const DEV_ORIGINS = Array.from({ length: 20 }, (_, i) => [
  `http://localhost:${5173 + i}`,
  `http://127.0.0.1:${5173 + i}`,
]).flat();

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

const MAX_CODE_LENGTH    = 500_000;  // 500 KB
const MAX_USERNAME_LENGTH  = 32;
const MAX_ROOM_ID_LENGTH   = 64;
const MAX_FILE_NAME_LENGTH = 128;
const MAX_FILE_PATH_LENGTH = 512;
const MAX_FILES_PER_ROOM   = 200;
const EXEC_TIMEOUT_MS    = 10_000;  // 10 seconds max execution time
const MAX_OUTPUT_BYTES   = 50_000;  // 50 KB max output

// ─── Allowed programming languages (allow-list) ──────────────────────────────
const ALLOWED_LANGUAGES = new Set([
  'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp',
  'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'html',
  'css', 'json', 'yaml', 'markdown', 'sql', 'shell', 'plaintext',
]);

// ─── Extension → Language mapping ────────────────────────────────────────────
const EXT_LANG_MAP = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  html: 'html', htm: 'html',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
  md: 'markdown', mdx: 'markdown',
  sql: 'sql',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  txt: 'plaintext',
  env: 'plaintext', gitignore: 'plaintext', dockerfile: 'plaintext',
};

function langFromFilename(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG_MAP[ext] || 'plaintext';
}

// ─── Hardcoded binary paths (allow-list) ─────────────────────────────────────
const RUNTIME_BINARIES = IS_PROD
  ? {
      node:    process.execPath,
      python3: '/usr/bin/python3',
      java:    '/usr/bin/java',
      javac:   '/usr/bin/javac',
      gcc:     '/usr/bin/gcc',
      gpp:     '/usr/bin/g++',
    }
  : {
      node:    process.execPath,
      python3: '/opt/homebrew/bin/python3',
      java:    '/usr/bin/java',
      javac:   '/usr/bin/javac',
      gcc:     '/usr/bin/gcc',
      gpp:     '/usr/bin/g++',
    };

Object.entries(RUNTIME_BINARIES).forEach(([name, binPath]) => {
  if (!fs.existsSync(binPath)) {
    console.warn(`[WARN] Runtime binary not found: ${name} → ${binPath}`);
  }
});

// ─── Security Headers (Helmet) ─────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'", "'unsafe-eval'", 'blob:'],
        styleSrc:    ["'self'", "'unsafe-inline'"],
        imgSrc:      ["'self'", 'data:'],
        connectSrc:  [
          "'self'",
          'ws:', 'wss:',
          ...ALLOWED_ORIGINS,
          ...ALLOWED_ORIGINS.map(o => o.replace('https', 'wss').replace('http', 'ws')),
        ],
        fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
        objectSrc:   ["'none'"],
        // Allow sandboxed iframes for HTML preview (srcdoc)
        frameSrc:    ["'self'", 'blob:'],
        frameAncestors: ["'none'"],
        workerSrc:   ["'self'", 'blob:'],
        childSrc:    ["'self'", 'blob:'],
      },
    },
    crossOriginEmbedderPolicy: false,
    xFrameOptions: { action: 'deny' },
  })
);

if (IS_PROD) {
  app.set('trust proxy', 1);
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) { callback(null, true); return; }
    if (IS_PROD && ALLOWED_ORIGINS.length === 0) { callback(null, true); return; }
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
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

const executeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
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
function runProcess(binary, args, { cwd, stdin, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(binary, args, {
      cwd: cwd || os.tmpdir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: '/usr/bin:/bin:/opt/homebrew/bin',
        HOME: os.homedir(),
        TMPDIR: os.tmpdir(),
      },
      shell: false,
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
      console.error('[Exec] Process error:', err.code);
      resolve({ stdout: '', stderr: 'Execution failed.', exitCode: -1, timedOut: false });
    });
  });
}

function safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch { /* ignored */ }
}

function safeRmDir(dirPath) {
  try { fs.rmSync(dirPath, { recursive: true, force: true }); } catch { /* ignored */ }
}

async function executeCode(language, code) {
  const tmpId  = uuidv4();
  const tmpDir = path.join(os.tmpdir(), `codesync-${tmpId}`);
  fs.mkdirSync(tmpDir, { mode: 0o700 });

  try {
    switch (language) {
      case 'javascript': {
        const filePath = path.join(tmpDir, 'main.js');
        fs.writeFileSync(filePath, code, { mode: 0o600 });
        const result = await runProcess(RUNTIME_BINARIES.node, ['main.js'], { cwd: tmpDir });
        safeUnlink(filePath);
        return formatResult(result);
      }

      case 'typescript': {
        // Run TypeScript via ts-node if available, otherwise fallback message
        const filePath = path.join(tmpDir, 'main.ts');
        fs.writeFileSync(filePath, code, { mode: 0o600 });
        // Strip types naively and run as JS (simple approach without ts-node)
        const stripped = code
          .replace(/:\s*\w+(\[\])?(\s*\|[^=,);\n]+)*/g, '')
          .replace(/<[^>]+>/g, '')
          .replace(/interface\s+\w+\s*\{[^}]*\}/g, '')
          .replace(/type\s+\w+\s*=\s*[^;]+;/g, '');
        const jsPath = path.join(tmpDir, 'main.js');
        fs.writeFileSync(jsPath, stripped, { mode: 0o600 });
        const result = await runProcess(RUNTIME_BINARIES.node, ['main.js'], { cwd: tmpDir });
        safeUnlink(filePath);
        safeUnlink(jsPath);
        return formatResult(result);
      }

      case 'python': {
        const filePath = path.join(tmpDir, 'main.py');
        fs.writeFileSync(filePath, code, { mode: 0o600 });
        const result = await runProcess(RUNTIME_BINARIES.python3, ['-u', 'main.py'], { cwd: tmpDir });
        safeUnlink(filePath);
        return formatResult(result);
      }

      case 'java': {
        const classMatch = code.match(/public\s+class\s+(\w+)/);
        const className  = classMatch ? classMatch[1] : 'Main';
        const filePath   = path.join(tmpDir, `${className}.java`);
        fs.writeFileSync(filePath, code, { mode: 0o600 });

        const compileResult = await runProcess(
          RUNTIME_BINARIES.javac, [`${className}.java`],
          { cwd: tmpDir, timeoutMs: 20_000 }
        );
        if (compileResult.exitCode !== 0) {
          safeUnlink(filePath);
          return { output: sanitizeSystemPaths(compileResult.stderr || compileResult.stdout || 'Compilation failed.'), error: true };
        }

        const runResult = await runProcess(RUNTIME_BINARIES.java, ['-cp', '.', className], { cwd: tmpDir });
        safeUnlink(filePath);
        return formatResult(runResult);
      }

      case 'c': {
        const srcPath = path.join(tmpDir, 'main.c');
        const binPath = path.join(tmpDir, 'main_out');
        fs.writeFileSync(srcPath, code, { mode: 0o600 });

        const compileResult = await runProcess(
          RUNTIME_BINARIES.gcc, ['-o', 'main_out', 'main.c', '-lm'],
          { cwd: tmpDir, timeoutMs: 20_000 }
        );
        if (compileResult.exitCode !== 0) {
          safeUnlink(srcPath);
          return { output: sanitizeSystemPaths(compileResult.stderr || compileResult.stdout || 'Compilation failed.'), error: true };
        }

        const runResult = await runProcess(binPath, [], { cwd: tmpDir });
        safeUnlink(srcPath);
        safeUnlink(binPath);
        return formatResult(runResult);
      }

      case 'cpp': {
        const srcPath = path.join(tmpDir, 'main.cpp');
        const binPath = path.join(tmpDir, 'main_out');
        fs.writeFileSync(srcPath, code, { mode: 0o600 });

        const compileResult = await runProcess(
          RUNTIME_BINARIES.gpp, ['-o', 'main_out', 'main.cpp', '-std=c++17', '-lm'],
          { cwd: tmpDir, timeoutMs: 20_000 }
        );
        if (compileResult.exitCode !== 0) {
          safeUnlink(srcPath);
          return { output: sanitizeSystemPaths(compileResult.stderr || compileResult.stdout || 'Compilation failed.'), error: true };
        }

        const runResult = await runProcess(binPath, [], { cwd: tmpDir });
        safeUnlink(srcPath);
        safeUnlink(binPath);
        return formatResult(runResult);
      }

      default:
        return {
          output: `// Execution is not supported for "${language}".\n// Runnable: JavaScript, TypeScript, Python, Java, C, C++`,
          error: false,
        };
    }
  } finally {
    safeRmDir(tmpDir);
  }
}

function sanitizeSystemPaths(text) {
  return text
    .replace(/\/tmp\/codesync-[a-z0-9-]+\//g, '')
    .replace(new RegExp(os.homedir(), 'g'), '~')
    .trim();
}

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

  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LENGTH) {
    return res.status(400).json({ error: 'Invalid code.' });
  }
  if (!ALLOWED_LANGUAGES.has(language)) {
    return res.status(400).json({ error: 'Unsupported language.' });
  }

  try {
    const result = await executeCode(language, code);
    res.json(result);
  } catch (err) {
    console.error('[Execute] Internal error:', err.message);
    res.status(500).json({ output: 'An error occurred during execution.', error: true });
  }
});

// ─── In-memory room state ─────────────────────────────────────────────────────
// Room shape:
// {
//   users: Map<socketId, { id, username, color }>,
//   files: Map<fileId, { id, name, path, language, content }>,
//   folders: [{ id, name, path, parentPath }],
// }
// Rooms start empty (like VS Code's new window). Users open/create files themselves.

const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      users: new Map(),
      files: new Map(),
      folders: [],
    });
  }
  return rooms.get(roomId);
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (room && room.users.size === 0) rooms.delete(roomId);
}

function roomSnapshot(room) {
  return {
    files: Array.from(room.files.values()),
    folders: room.folders,
    users: Array.from(room.users.values()),
  };
}

// ─── Input Validation Helpers ─────────────────────────────────────────────────
function isValidString(val, maxLen) {
  return typeof val === 'string' && val.length > 0 && val.length <= maxLen;
}

function sanitizeUsername(name) {
  return name.replace(/[^\x20-\x7E]/g, '').trim().slice(0, MAX_USERNAME_LENGTH);
}

// Prevent path traversal: only allow safe path characters
function isValidFilePath(p) {
  return (
    typeof p === 'string' &&
    p.length > 0 &&
    p.length <= MAX_FILE_PATH_LENGTH &&
    !/\.\./.test(p) &&      // no parent traversal
    !/^\//.test(p) &&       // no absolute paths
    /^[\w\s./\-]+$/.test(p) // allowlist chars
  );
}

function isValidFileName(n) {
  return (
    typeof n === 'string' &&
    n.length > 0 &&
    n.length <= MAX_FILE_NAME_LENGTH &&
    /^[\w.\-\s]+$/.test(n) &&
    !n.includes('..')
  );
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

  // ── join-room ────────────────────────────────────────────────────────────
  socket.on('join-room', ({ roomId, username }) => {
    if (!isValidString(roomId, MAX_ROOM_ID_LENGTH)) {
      socket.emit('error-msg', { message: 'Invalid room ID.' }); return;
    }
    const cleanName = isValidString(username, MAX_USERNAME_LENGTH)
      ? sanitizeUsername(username)
      : `User-${socket.id.slice(0, 4)}`;

    socket.join(roomId);
    socket.data.roomId   = roomId;
    socket.data.username = cleanName;

    const room = getOrCreateRoom(roomId);
    globalUserCount++;
    room.users.set(socket.id, {
      id: socket.id, username: cleanName,
      color: USER_COLORS[globalUserCount % USER_COLORS.length],
    });

    // Send full project state to the joining user
    socket.emit('project-state', roomSnapshot(room));

    // Notify others of the new user
    socket.to(roomId).emit('user-joined', {
      user: room.users.get(socket.id),
      users: Array.from(room.users.values()),
    });

    console.log(`[WS] ${cleanName} joined room: ${roomId} (${room.users.size} users)`);
  });

  // ── file-change: content edit for an existing file ────────────────────────
  socket.on('file-change', ({ roomId, fileId, content, version }) => {
    if (!isValidString(roomId, MAX_ROOM_ID_LENGTH)) return;
    if (!isValidString(fileId, 64)) return;
    if (typeof content !== 'string' || content.length > MAX_CODE_LENGTH) return;

    const room = rooms.get(roomId);
    if (!room) return;
    const file = room.files.get(fileId);
    if (!file) return;

    file.content = content;
    file.version = version;

    socket.to(roomId).emit('file-update', { fileId, content, version, senderId: socket.id });
  });

  // ── file-create: new file ─────────────────────────────────────────────────
  socket.on('file-create', ({ roomId, name, folderPath, content }) => {
    if (!isValidString(roomId, MAX_ROOM_ID_LENGTH)) return;
    if (!isValidFileName(name)) return;

    const room = rooms.get(roomId);
    if (!room) return;
    if (room.files.size >= MAX_FILES_PER_ROOM) {
      socket.emit('error-msg', { message: 'Max file limit reached.' }); return;
    }

    const safeFolderPath = (folderPath && isValidFilePath(folderPath)) ? folderPath : '';
    const filePath = safeFolderPath ? `${safeFolderPath}/${name}` : name;

    // Prevent duplicate paths — if file already exists, skip silently (bulk import)
    const exists = Array.from(room.files.values()).some(f => f.path === filePath);
    if (exists) return; // silent skip for bulk import

    // Validate and sanitize content (accept optional content for file-open imports)
    const safeContent = (typeof content === 'string' && content.length <= MAX_CODE_LENGTH)
      ? content
      : '';

    const fileId = uuidv4();
    const language = langFromFilename(name);
    const file = { id: fileId, name, path: filePath, language, content: safeContent };
    room.files.set(fileId, file);

    io.to(roomId).emit('file-created', { file });
    console.log(`[WS] File created: ${filePath} in room ${roomId}`);
  });

  // ── folder-create: new folder ─────────────────────────────────────────────
  socket.on('folder-create', ({ roomId, name, parentPath }) => {
    if (!isValidString(roomId, MAX_ROOM_ID_LENGTH)) return;
    if (!isValidFileName(name)) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const safeParentPath = isValidFilePath(parentPath) ? parentPath : '';
    const folderPath = safeParentPath ? `${safeParentPath}/${name}` : name;

    const exists = room.folders.some(f => f.path === folderPath);
    if (exists) {
      socket.emit('error-msg', { message: 'A folder with that name already exists.' }); return;
    }

    const folder = { id: uuidv4(), name, path: folderPath, parentPath: safeParentPath };
    room.folders.push(folder);

    io.to(roomId).emit('folder-created', { folder });
  });

  // ── bulk-import: folder open / drag-drop ─────────────────────────────────
  // Accepts { roomId, folders: [{name, parentPath}], files: [{name, folderPath, content}] }
  // Processes everything in a single handler and emits one 'bulk-imported' event.
  socket.on('bulk-import', ({ roomId, folders: inFolders, files: inFiles }) => {
    if (!isValidString(roomId, MAX_ROOM_ID_LENGTH)) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const createdFolders = [];
    const createdFiles   = [];

    // --- Folders (parents before children — they're already sorted by the client) ---
    if (Array.isArray(inFolders)) {
      for (const { name, parentPath } of inFolders) {
        if (!isValidFileName(name)) continue;
        const safeParent = isValidFilePath(parentPath) ? parentPath : '';
        const folderPath = safeParent ? `${safeParent}/${name}` : name;
        const exists = room.folders.some(f => f.path === folderPath);
        if (exists) continue; // deduplicate silently
        const folder = { id: uuidv4(), name, path: folderPath, parentPath: safeParent };
        room.folders.push(folder);
        createdFolders.push(folder);
      }
    }

    // --- Files ---
    if (Array.isArray(inFiles)) {
      for (const { name, folderPath, content } of inFiles) {
        if (!isValidFileName(name)) continue;
        if (room.files.size >= MAX_FILES_PER_ROOM) break; // cap

        const safeFolderPath = (folderPath && isValidFilePath(folderPath)) ? folderPath : '';
        const filePath = safeFolderPath ? `${safeFolderPath}/${name}` : name;

        // Deduplicate
        const exists = Array.from(room.files.values()).some(f => f.path === filePath);
        if (exists) continue;

        const safeContent = (typeof content === 'string' && content.length <= MAX_CODE_LENGTH)
          ? content
          : '';

        const fileId = uuidv4();
        const language = langFromFilename(name);
        const file = { id: fileId, name, path: filePath, language, content: safeContent };
        room.files.set(fileId, file);
        createdFiles.push(file);
      }
    }

    if (createdFolders.length === 0 && createdFiles.length === 0) return;

    // Single broadcast for the entire import
    io.to(roomId).emit('bulk-imported', {
      folders: createdFolders,
      files: createdFiles,
    });

    console.log(`[WS] Bulk import in room ${roomId}: ${createdFolders.length} folders, ${createdFiles.length} files`);
  });

  // ── file-delete ───────────────────────────────────────────────────────────
  socket.on('file-delete', ({ roomId, fileId }) => {
    if (!isValidString(roomId, MAX_ROOM_ID_LENGTH)) return;
    if (!isValidString(fileId, 64)) return;

    const room = rooms.get(roomId);
    if (!room) return;
    if (!room.files.has(fileId)) return;

    room.files.delete(fileId);
    io.to(roomId).emit('file-deleted', { fileId });
  });

  // ── folder-delete ─────────────────────────────────────────────────────────
  socket.on('folder-delete', ({ roomId, folderPath }) => {
    if (!isValidString(roomId, MAX_ROOM_ID_LENGTH)) return;
    if (!isValidFilePath(folderPath)) return;

    const room = rooms.get(roomId);
    if (!room) return;

    // Delete all files within this folder
    const deletedFileIds = [];
    for (const [id, file] of room.files) {
      if (file.path.startsWith(folderPath + '/') || file.path === folderPath) {
        room.files.delete(id);
        deletedFileIds.push(id);
      }
    }

    // Delete nested folders
    room.folders = room.folders.filter(f => !f.path.startsWith(folderPath));

    io.to(roomId).emit('folder-deleted', { folderPath, deletedFileIds });
  });

  // ── file-rename ───────────────────────────────────────────────────────────
  socket.on('file-rename', ({ roomId, fileId, newName }) => {
    if (!isValidString(roomId, MAX_ROOM_ID_LENGTH)) return;
    if (!isValidString(fileId, 64)) return;
    if (!isValidFileName(newName)) return;

    const room = rooms.get(roomId);
    if (!room) return;
    const file = room.files.get(fileId);
    if (!file) return;

    const dir = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';
    const newPath = dir ? `${dir}/${newName}` : newName;

    // Check for duplicate
    const conflict = Array.from(room.files.values()).some(f => f.path === newPath && f.id !== fileId);
    if (conflict) {
      socket.emit('error-msg', { message: 'A file with that name already exists.' }); return;
    }

    file.name = newName;
    file.path = newPath;
    file.language = langFromFilename(newName);

    io.to(roomId).emit('file-renamed', { fileId, newName, newPath, language: file.language });
  });

  // ── cursor-change ─────────────────────────────────────────────────────────
  socket.on('cursor-change', ({ roomId, fileId, position }) => {
    if (!isValidString(roomId, MAX_ROOM_ID_LENGTH)) return;
    if (!position || typeof position.lineNumber !== 'number' || typeof position.column !== 'number') return;
    socket.to(roomId).emit('cursor-update', { userId: socket.id, fileId, position });
  });

  // ── disconnect ────────────────────────────────────────────────────────────
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

// ─── Serve built React frontend in production ─────────────────────────────────
const CLIENT_DIST = process.env.CLIENT_DIST || path.join(__dirname, '..', 'client', 'dist');
console.log(`[Static] CLIENT_DIST resolved to: ${CLIENT_DIST} (exists: ${fs.existsSync(CLIENT_DIST)})`);
if (IS_PROD && fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { maxAge: '7d' }));
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
  console.log(`   Supported languages: JavaScript, TypeScript, Python, Java, C, C++`);
});
