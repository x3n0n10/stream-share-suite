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

# su-exec drops privileges in the entrypoint. The store holds instance API keys
# and VPN credentials and is created 0600 by the app, so the process that owns
# it must not be root.
RUN apk add --no-cache su-exec && mkdir -p /data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Deliberately no USER: the entrypoint starts as root only long enough to make
# the data directory owned by PUID:PGID, then execs the app as that user. A
# bind-mounted directory keeps its host ownership, which is why the image
# cannot simply bake in a uid and hope it matches. Pin `user:` in compose
# instead if you would rather the container never start as root — the
# entrypoint detects that and skips straight to the app.
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
