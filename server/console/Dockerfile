# Build the SPA, then serve it from nginx with a same-origin /api reverse proxy.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# VITE_* values are inlined at build time; rebuild to change the instance name.
ARG VITE_INSTANCE_NAME=Mem0
ARG VITE_API_BASE_URL=/api
# Set true only for previewing against a server that does not set the console cookie yet.
ARG VITE_REFRESH_TOKEN_FALLBACK=false
ENV VITE_INSTANCE_NAME=$VITE_INSTANCE_NAME
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_REFRESH_TOKEN_FALLBACK=$VITE_REFRESH_TOKEN_FALLBACK

RUN pnpm build

FROM nginx:1.27-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

# Browser requests hit this container at /api/*; nginx forwards them to the API.
ENV API_UPSTREAM=http://mem0-server:8000
EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/api/health || exit 1
