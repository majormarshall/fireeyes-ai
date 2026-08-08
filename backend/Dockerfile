# Build with root context so we can also pull in ../dashboard, e.g.:
#   docker build -f backend/Dockerfile -t fireeyes-backend .
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --production
COPY backend/ .
COPY dashboard/ /dashboard
EXPOSE 4000
CMD ["node", "src/server.js"]
