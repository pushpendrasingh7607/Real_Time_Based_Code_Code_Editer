# ──────────────────────────────────────────────────────────────
# CodeSync Backend — Dockerfile
# Includes: Node.js 20, Python 3, OpenJDK 21, GCC/G++
# Security: runs as non-root user "codesync"
# Build context: repo root (Railway uses root as build context)
# ──────────────────────────────────────────────────────────────

FROM node:20-slim AS base

# Install system dependencies for code execution
# python3, openjdk-21-jdk, gcc, g++, make
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    default-jdk \
    gcc \
    g++ \
    make \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create symlinks for consistency
RUN ln -sf /usr/bin/python3 /usr/local/bin/python3

# ── Create non-root user (security: never run as root) ────────
RUN groupadd --gid 1001 codesync && \
    useradd --uid 1001 --gid codesync --shell /bin/bash --create-home codesync

WORKDIR /app

# ── Install Node.js dependencies ──────────────────────────────
# Copy from server/ subfolder (build context is repo root)
COPY server/package.json server/package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

# ── Copy source ───────────────────────────────────────────────
COPY server/server.js ./

# ── Drop to non-root user ─────────────────────────────────────
USER codesync

# Expose port (Railway injects $PORT; default 3001)
EXPOSE 3001

# Health check so Railway knows when the service is ready
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT||3001) + '/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
