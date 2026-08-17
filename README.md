# CodeSync 🖥️

> **Real-time collaborative code editor** — Write and run code together, in the browser, from anywhere in the world.

[![Deploy Backend on Railway](https://railway.app/button.svg)](https://railway.app)

---

## ✨ Features

- ⚡ **Real-time sync** — edits appear instantly for all users in the same room
- 👥 **Multi-user presence** — see who's connected with color-coded avatars
- 🌐 **5 languages** — JavaScript, Python, Java, C, C++
- 🎨 **Monaco Editor** — full VS Code editing experience
- 🔒 **Secure** — Helmet.js, strict CORS, rate limiting, sandboxed code execution

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Monaco Editor |
| Backend | Node.js, Express, Socket.IO |
| Real-time | WebSockets (Socket.IO) |
| Code Execution | Docker (Python, Java, GCC, Node.js) |
| Deployment | Vercel (frontend) + Railway (backend) |

---

## 🚀 Deployment

### Step 1 — Deploy Backend to Railway

1. Push this repository to **GitHub**
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Select your repo → choose the **`server/`** folder as the root
4. Railway will auto-detect the `Dockerfile` and build it
5. After deploy, go to **Settings → Domains** → **Generate Domain**
6. Copy your Railway URL (e.g. `https://codesync-backend.railway.app`)
7. In Railway **Variables** tab, add:
   ```
   NODE_ENV=production
   CLIENT_URL=https://your-vercel-app.vercel.app   ← set this after Vercel deploy
   ```

### Step 2 — Deploy Frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project** → Import your GitHub repo
2. Set **Root Directory** to `client`
3. Set **Build Command**: `npm run build`
4. Set **Output Directory**: `dist`
5. Add **Environment Variable**:
   ```
   VITE_SERVER_URL = https://your-railway-url.railway.app
   ```
6. Click **Deploy** → copy your Vercel URL

### Step 3 — Connect Frontend ↔ Backend

1. Go back to **Railway** → **Variables**
2. Set `CLIENT_URL` = your Vercel URL (e.g. `https://codesync.vercel.app`)
3. Railway will redeploy automatically

### ✅ Done!
Open your Vercel URL on **any device**, create a room, share the Room ID, and collaborate!

---

## 💻 Local Development

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/realtime-code-editor.git
cd realtime-code-editor

# Start everything with one command
bash start.sh
```

Or manually:
```bash
# Terminal 1 — Backend
cd server && npm install && node server.js

# Terminal 2 — Frontend
cd client && npm install && npm run dev
```

Open `http://localhost:5173` (or the port shown in terminal).

---

## 📁 Project Structure

```
realtime-code-editor/
├── start.sh              ← One-command local startup
├── .gitignore
├── server/
│   ├── Dockerfile        ← Multi-runtime Docker image
│   ├── railway.json      ← Railway deployment config
│   ├── package.json
│   └── server.js         ← Express + Socket.IO + Code Execution
└── client/
    ├── vercel.json       ← Vercel deployment config
    ├── .env.example      ← Environment variable template
    └── src/
        ├── socket.js
        ├── App.jsx
        └── components/
            ├── Landing.jsx
            ├── EditorLayout.jsx
            ├── Header.jsx
            ├── Sidebar.jsx
            ├── Editor.jsx
            └── OutputPanel.jsx
```

---

## 🔒 Security

- All code execution uses `child_process.spawn()` with `shell: false` (no injection)
- Binary paths are hardcoded allow-list (never derived from user input)
- 10-second execution timeout + 50KB output cap
- Helmet.js security headers on all responses
- Strict CORS — only the configured `CLIENT_URL` is allowed
- Rate limiting: 30 code executions per minute per IP
- Docker container runs as **non-root user**

> ⚠️ For production at scale, wrap code execution in a Docker-in-Docker or gVisor sandbox.
