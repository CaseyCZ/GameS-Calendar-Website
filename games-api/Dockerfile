FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/data
ENV PORT=8787 GAMES_API_DB=/app/data/games-api.sqlite
EXPOSE 8787
CMD ["node", "src/server.js"]
