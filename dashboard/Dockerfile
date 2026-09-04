FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml* package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server.js package.json ./
# server.js is ESM, needs express
RUN npm install express
ENV PORT=3001
ENV SESSIONS_DIR=/root/.pi/agent/sessions/--workspace--
ENV SUBAGENT_RUNS=/tmp/pi-subagents-uid-0/async-subagent-runs
EXPOSE 3001
CMD ["node", "server.js"]
