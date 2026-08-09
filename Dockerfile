FROM node:22.19.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY server ./server
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:22.19.0-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
WORKDIR /app
RUN groupadd --system fil && useradd --system --gid fil --home /app fil && mkdir -p /app/data && chown -R fil:fil /app
COPY --from=build --chown=fil:fil /app/package.json /app/package-lock.json ./
COPY --from=build --chown=fil:fil /app/node_modules ./node_modules
COPY --from=build --chown=fil:fil /app/dist ./dist
COPY --from=build --chown=fil:fil /app/dist-server ./dist-server
USER fil
EXPOSE 8787
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
STOPSIGNAL SIGTERM
CMD ["node", "dist-server/index.js"]
