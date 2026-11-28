# Stage 1: Compile Judge Worker TypeScript output
FROM node:22.14-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY gateway/package.json ./gateway/package.json
COPY web/package.json ./web/package.json
COPY judge/package.json ./judge/package.json
RUN npm ci --workspace=judge --include-workspace-root=false

COPY judge ./judge
RUN npm run build --workspace=judge

# Stage 2: Minimal non-root runtime with g++ (C++17) and zero LLM provider secrets
FROM node:22.14-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY gateway/package.json ./gateway/package.json
COPY web/package.json ./web/package.json
COPY judge/package.json ./judge/package.json
RUN npm ci --omit=dev --workspace=judge --include-workspace-root=false

COPY --from=builder /app/judge/dist ./judge/dist

RUN chown -R node:node /app
USER node

WORKDIR /app/judge
CMD ["node", "dist/main.js"]
