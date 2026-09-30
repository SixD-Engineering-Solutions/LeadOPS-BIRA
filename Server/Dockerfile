# LeadOps API — see DEPLOYMENT_CHECKLIST.md. Run exactly ONE container of this
# (live notifications and the follow-up reminder job live in process memory).

# ── build: install everything, generate the Prisma client, compile TS ─────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# The generated client (src/generated, not committed) is compiled into dist/ by tsc.
RUN npx prisma generate && npm run build

# ── runtime: production deps + compiled output only ──────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Lets `npx prisma migrate deploy` (run from this image) verify Aiven's TLS cert;
# the API itself pins the same CA in src/prisma.ts.
ENV NODE_EXTRA_CA_CERTS=/app/certs/aiven-ca.pem
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Migrations + config (for `npx prisma migrate deploy`) and the DB CA certificate.
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations
COPY prisma.config.ts ./
COPY certs ./certs
# Uploaded documents — mount a persistent volume here, or every redeploy deletes them.
RUN mkdir -p /app/uploads/documents && chown -R node:node /app/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/index.js"]
