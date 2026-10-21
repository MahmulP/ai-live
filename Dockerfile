# Ucok app: backend, AI chat, TTS, and the built avatar page.
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts persona.md ./
COPY src ./src
RUN npm run build && mkdir -p logs && chown -R node:node logs

USER node
ENV NODE_ENV=production SERVER_HOST=0.0.0.0
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.SERVER_PORT || 8787)).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["npx", "tsx", "src/server/index.ts"]
