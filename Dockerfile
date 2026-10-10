# syntax=docker/dockerfile:1

# ── Stage 1: dependencies ─────────────────────────────────────────────
# Copied in their own layer so a source-only change does not re-run npm ci.
FROM node:24-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# npm workspaces — one install, one node_modules, @khoj/shared importable by name.
RUN npm ci --omit=dev --workspace server --include-workspace-root

# tsx is needed at runtime to run TypeScript directly, so devDependencies of the
# server are installed too. There is no build step and no dist output.
RUN npm install --workspace server tsx


# ── Stage 2: runtime ──────────────────────────────────────────────────
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY data ./data

# Render sets PORT. The app reads it from config.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "-w", "server"]