FROM node:22-alpine AS build
WORKDIR /app
COPY dashboard/package.json dashboard/pnpm-lock.yaml* dashboard/package-lock.json* ./
RUN npm install
COPY dashboard/. .
COPY docs ./docs-src
RUN npm run build && mkdir -p dist/docs && if [ -d docs-src ]; then cp -r docs-src/* dist/docs/; echo "[dashboard-build] baked docs to dist/docs"; ls -l dist/docs | head -n 20; fi

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY dashboard/server.js dashboard/package.json ./
# server.js is ESM, needs express; docker-cli for Pi mode (docker exec pi-personal-agent)
RUN apk add --no-cache docker-cli && npm install express
ENV PORT=3001
ENV SESSIONS_DIR=/root/.pi/agent/sessions/--workspace--
ENV SUBAGENT_RUNS=/tmp/pi-subagents-uid-0/async-subagent-runs
EXPOSE 3001
CMD ["node", "server.js"]
