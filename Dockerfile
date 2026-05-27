FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p src/uploads
EXPOSE 3000
CMD ["node", "src/server.js"]
