# Stage 1: Build & Compile TypeScript
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Stage 2: Minimalist Production Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

# Security: Non-root execution
USER node
EXPOSE 8080

CMD ["node", "dist/index.js"]