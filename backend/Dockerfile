# syntax=docker/dockerfile:1

FROM node:24.17.0-bookworm-slim AS base

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

FROM base AS dependencies

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --workspace @lounaspaikka/backend --include-workspace-root \
    --ignore-scripts --no-audit --no-fund

FROM dependencies AS build

COPY backend/tsconfig.json backend/tsconfig.build.json backend/
COPY backend/src backend/src
RUN npm run build --workspace @lounaspaikka/backend

FROM base AS production-dependencies

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --workspace @lounaspaikka/backend --omit=dev \
    --ignore-scripts --no-audit --no-fund

FROM node:24.17.0-alpine3.24 AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist

RUN mkdir /data && chown node:node /data
USER node

EXPOSE 3000
CMD ["node", "backend/dist/server.js"]
