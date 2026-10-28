FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV DATABASE_URL=file:/data/whatnext.db
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts
COPY assets ./assets
RUN npm ci && npm run build && mkdir -p /data/uploads && chown -R node:node /app /data
ENV NODE_ENV=production PORT=3000 UPLOAD_DIR=/data/uploads BACKUP_DIR=/data/backups
USER node
EXPOSE 3000
CMD ["npm", "start"]
