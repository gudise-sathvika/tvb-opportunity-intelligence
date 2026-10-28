# Production Dockerfile for TVB Opportunity Intelligence Node Host
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV TVB_HOST=0.0.0.0
ENV TVB_ALLOW_NON_LOOPBACK=1

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig*.json ./

EXPOSE 4174

CMD ["npm", "start"]

