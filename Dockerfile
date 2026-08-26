# --- Stage 1: build the frontend ---
FROM node:24-alpine AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# --- Stage 2: production dependencies for the backend ---
FROM node:24-alpine AS server-deps
WORKDIR /app/server
COPY server/package*.json ./
# express is the only runtime dependency; the store uses node:sqlite, which
# ships with Node, so this image needs no build toolchain and nothing to
# recompile when the base image moves.
RUN npm ci --omit=dev --no-audit --no-fund

# --- Stage 3: runtime ---
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV SUITE_DATA_DIR=/data

COPY server/package*.json ./
COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server/src ./src
COPY --from=web-build /app/web/dist ./public

# The store holds instance API keys and VPN credentials, so it is created 0600
# by the app itself. Running as a non-root user keeps it that way.
RUN addgroup -S suite && adduser -S suite -G suite && mkdir -p /data && chown suite:suite /data
USER suite

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
