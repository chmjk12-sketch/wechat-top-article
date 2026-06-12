FROM node:22-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npx vite build

FROM node:22-alpine
WORKDIR /app
COPY backend/server.js ./server.js
COPY --from=builder /app/dist /frontend/dist
EXPOSE 80
ENV PORT=80
ENV NODE_ENV=production
CMD ["node", "server.js"]
