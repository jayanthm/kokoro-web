# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /app

ENV NODE_ENV=development \
    HOST=0.0.0.0 \
    PORT=5173

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 git && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

FROM base AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

FROM base AS test
COPY . .
CMD ["npm", "test"]

FROM base AS build
ENV NODE_ENV=production
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS prod
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /app/build ./build
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev

EXPOSE 3000
CMD ["node", "build/index.js"]
