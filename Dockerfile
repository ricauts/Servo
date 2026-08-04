# Servo — self-hosted AI service desk (POC image).
# Single-stage on purpose: the runtime keeps the Prisma CLI + tsx so the
# container can create and seed its own SQLite database on first boot.
FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund && npx prisma generate

# Build the app.
COPY . .
RUN npm run build

# Databases live on a volume; see docker-compose.yml.
ENV NODE_ENV=production \
    DATABASE_URL="file:/data/servo.db" \
    OPS_DATABASE_URL="file:/data/ops.db" \
    PORT=3000 \
    HOSTNAME=0.0.0.0

EXPOSE 3000

RUN chmod +x ./scripts/docker-entrypoint.sh
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
