# ──────────────────────────────────────────────────────────────
# CodeSync — Root Dockerfile (Render single-deploy)
# Stage 1: Build React client
# Stage 2: Production Node.js server (serves built client + API)
# Includes: Node.js 20, Python 3, OpenJDK, GCC/G++
# Security: runs as non-root user "codesync"
# ──────────────────────────────────────────────────────────────

# ── Stage 1: Build the React frontend ────────────────────────
FROM node:20-slim AS client-build

WORKDIR /build/client

# Install client deps
COPY client/package.json client/package-lock.json* ./
RUN npm ci

# Copy client source and build
COPY client/ ./
# Clear any local env so VITE_SERVER_URL is unset → same-origin mode
RUN rm -f .env.local .env
RUN npm run build
# Output: /build/client/dist

# ── Stage 2: Production server ────────────────────────────────
FROM node:20-slim AS production

# Install runtimes needed for code execution
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    default-jdk \
    gcc \
    g++ \
    make \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create symlink for python3
RUN ln -sf /usr/bin/python3 /usr/local/bin/python3

# Create non-root user
RUN groupadd --gid 1001 codesync && \
    useradd --uid 1001 --gid codesync --shell /bin/bash --create-home codesync

WORKDIR /app

# Install server deps
COPY server/package.json server/package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

# Copy server source
COPY server/server.js ./

# Copy built React client from Stage 1
COPY --from=client-build /build/client/dist ./client/dist

# Drop to non-root user
USER codesync

# Expose port (Render injects $PORT; default 3001)
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT||3001) + '/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
