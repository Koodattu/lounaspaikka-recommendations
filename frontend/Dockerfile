# syntax=docker/dockerfile:1

FROM node:26.13.1-trixie-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --workspace @lounaspaikka/frontend --include-workspace-root --no-audit --no-fund

COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts frontend/
COPY frontend/src frontend/src
RUN npm run build --workspace @lounaspaikka/frontend

FROM nginx:1.30.6-alpine-slim AS runtime

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
