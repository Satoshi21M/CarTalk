FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./
RUN npm install --omit=dev

COPY server ./server

EXPOSE 8787

CMD ["node", "server/index.mjs"]
