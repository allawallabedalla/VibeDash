# syntax=docker/dockerfile:1
# VibeDash: static app + read-only server. Data source config comes from
# environment variables (--env-file .env) and a mounted local/mapping.json.

ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm budget

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 MAPPING_PATH=/app/local/mapping.json
# The server bundle only uses Node built-ins: no node_modules at runtime.
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /app/local && chown node:node /app/local
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "dist-server/main.js"]
