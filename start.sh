#!/bin/bash
# start.sh — Starts both the CodeSync backend server and frontend dev server
# Usage: bash start.sh

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
CLIENT_DIR="$ROOT_DIR/client"

echo "🚀 Starting CodeSync..."
echo ""

# Kill any existing instances
echo "🔴 Stopping any existing instances..."
pkill -f "node server.js" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

# Start backend server
echo "⚙️  Starting backend server (Node.js + Socket.IO)..."
cd "$SERVER_DIR"
node server.js > /tmp/codesync-server.log 2>&1 &
SERVER_PID=$!

# Wait for server to be ready
sleep 2
if curl -s http://127.0.0.1:3001/health > /dev/null 2>&1; then
  echo "✅ Backend server running at http://127.0.0.1:3001 (PID: $SERVER_PID)"
else
  echo "❌ Backend server failed to start. Check /tmp/codesync-server.log"
  exit 1
fi

echo ""
echo "🎨 Starting frontend dev server (React + Vite)..."
cd "$CLIENT_DIR"
npm run dev &
CLIENT_PID=$!

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ CodeSync is running!"
echo "  🌐 Open: http://localhost:5173 (or next free port)"
echo "  📋 Server PID: $SERVER_PID  |  Client PID: $CLIENT_PID"
echo "  🛑 Press Ctrl+C to stop both servers"
echo "═══════════════════════════════════════════════"
echo ""

# Wait for both processes; kill both on Ctrl+C
trap "echo ''; echo '🛑 Stopping CodeSync...'; kill $SERVER_PID $CLIENT_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait $SERVER_PID $CLIENT_PID
