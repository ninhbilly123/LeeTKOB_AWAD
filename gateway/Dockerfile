# Stage 1: Build NestJS Gateway TypeScript output
FROM node:22.14-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY gateway/package.json ./gateway/package.json
COPY web/package.json ./web/package.json
RUN npm ci --workspace=gateway --include-workspace-root=false

COPY gateway ./gateway
RUN npm run build --workspace=gateway

# Stage 2: Minimal non-root runtime image (docs/engineering-rules.md Session 08)
FROM node:22.14-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY gateway/package.json ./gateway/package.json
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev --workspace=gateway --include-workspace-root=false

COPY --from=builder /app/gateway/dist ./gateway/dist
COPY --from=builder /app/gateway/migrations ./gateway/migrations

RUN chown -R node:node /app
USER node

WORKDIR /app/gateway
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
