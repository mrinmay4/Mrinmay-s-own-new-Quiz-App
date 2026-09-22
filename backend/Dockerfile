# Simple backend container for the QuizApp.
# Frontend is deployed separately.

FROM node:20-alpine

WORKDIR /app

# Copy package files first for Docker layer caching.
COPY package.json package-lock.json ./

# Prisma schema is needed by Prisma generate/postinstall.
COPY prisma ./prisma

# Install dependencies, including Prisma CLI.
RUN npm ci

# Copy backend source code.
COPY src ./src

ENV NODE_ENV=production

EXPOSE 5000

# Container healthcheck.
HEALTHCHECK --interval=30s \
            --timeout=5s \
            --start-period=10s \
            --retries=3 \
  CMD wget -qO- http://localhost:5000/health || exit 1

CMD ["sh", "-c", "npx prisma db push --skip-generate && exec node src/index.js"]