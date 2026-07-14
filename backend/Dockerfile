FROM node:24-bookworm AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

COPY backend backend
RUN npm run build -w backend

FROM node:24-bookworm AS production-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist

RUN mkdir /data && chown node:node /data
USER node

EXPOSE 3000
CMD ["node", "backend/dist/server.js"]
