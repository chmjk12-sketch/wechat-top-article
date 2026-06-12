FROM node:22-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npx vite build

FROM node:22-alpine
WORKDIR /app

# 后端
COPY work/server.js ./server.js

# 前端构建产物（server.js 期望在 /frontend/dist）
COPY --from=builder /app/dist /frontend/dist

EXPOSE 80
ENV PORT=80
ENV NODE_ENV=production
CMD ["node", "server.js"]
