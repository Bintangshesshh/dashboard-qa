# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=web-build --chown=node:node /app/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/web/.next/static ./.next/static
COPY --from=web-build --chown=node:node /app/web/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runner-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY docusaurus/package*.json ./docusaurus/
RUN cd docusaurus && npm ci
COPY scripts/ ./scripts/
COPY server/ ./server/
COPY docusaurus/ ./docusaurus/

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runner
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 RUNS_DIR=/data/runs
WORKDIR /app
COPY --from=runner-build --chown=pwuser:pwuser /app ./
RUN mkdir -p /data/runs && chown -R pwuser:pwuser /data
USER pwuser
EXPOSE 3001
CMD ["node", "server/index.mjs"]

FROM nginxinc/nginx-unprivileged:1.28-alpine AS docs
COPY deploy/docs.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
