# LeadOps web — static React build served by nginx, which also forwards /api/*
# to the API container (see nginx.conf and DEPLOYMENT_CHECKLIST.md).

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Production builds default to "/api" (same origin, proxied by nginx);
# only override this if the API is served from a different address.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:stable-alpine
# Pick up OS security fixes released since the base image was published.
RUN apk upgrade --no-cache
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
