FROM node:22-alpine

WORKDIR /app

# 复制后端代码
COPY backend/server.js ./server.js
COPY backend/wechat-proxy.js ./wechat-proxy.js
COPY backend/article_forge.db.json* ./article_forge.db.json*

# 复制前端构建产物
COPY frontend/dist ./frontend/dist

# 暴露端口
EXPOSE 8000

# 环境变量
ENV PORT=8000
ENV NODE_ENV=production

# 启动
CMD ["node", "server.js"]
