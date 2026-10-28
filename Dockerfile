# Production image. Node 24 so the built-in node:sqlite module runs without a flag.
FROM node:24-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# App source
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
# Store the SQLite file on a mounted volume so it survives container restarts.
ENV DB_PATH=/data/data.sqlite
VOLUME ["/data"]

EXPOSE 3000

# Basic container healthcheck hitting the app's /healthz endpoint.
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
