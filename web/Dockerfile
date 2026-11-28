# Stage 1: Build React + Vite production bundle (no secrets in build args)
FROM node:22.14-alpine AS builder
WORKDIR /app

ARG VITE_API_MODE=http
ARG VITE_API_BASE_URL=/api
ARG VITE_SHOW_DEMO_ACCOUNTS=false

ENV VITE_API_MODE=${VITE_API_MODE}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_SHOW_DEMO_ACCOUNTS=${VITE_SHOW_DEMO_ACCOUNTS}

COPY package.json package-lock.json ./
COPY gateway/package.json ./gateway/package.json
COPY web/package.json ./web/package.json
COPY judge/package.json ./judge/package.json
RUN npm ci --workspace=web --include-workspace-root=false

COPY web ./web
RUN npm run build --workspace=web

# Stage 2: Minimal non-root Nginx runtime serving SPA + reverse proxy to Gateway
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
