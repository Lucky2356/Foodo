# Foodo web image: the built PWA served by nginx, which also proxies /api and /admin to the API.
# Build context: repository root (the app bundles shared/data).
FROM node:22-alpine AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared /app/shared
COPY frontend /app/frontend
ARG FOODO_VERSION=dev
ENV FOODO_VERSION=${FOODO_VERSION}
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
