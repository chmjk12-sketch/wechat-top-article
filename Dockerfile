# 阶段1: 构建前端
FROM node:22-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npx vite build

# 阶段2: 运行后端 + 静态文件
FROM node:22-alpine
WORKDIR /app

# 复制后端代码
COPY backend/server.js ./server.js
COPY backend/article_forge.db.json* ./article_forge.db.json*

# 复制前端构建产物
COPY --from=builder /app/dist ./frontend/dist

# 暴露端口
EXPOSE 80

# 环境变量
ENV PORT=80
ENV NODE_ENV=production

# 启动
CMD ["node", "server.js"]
