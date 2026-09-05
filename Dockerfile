FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.base.json tsconfig.server.json tsconfig.client.json ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN npm run build && find dist public -name '*.test.js' -delete

FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# Express's default error handler includes a stack trace unless this is set.
# The app registers its own JSON error handler (src/lib/app.ts) so nothing
# should reach that fallback, but a production build should say so anyway.
ENV NODE_ENV=production
ENV PORT=4123
EXPOSE 4123

RUN mkdir -p /app/data/sync /app/data/watchlist && chown -R node:node /app/data
VOLUME /app/data

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://localhost:${PORT:-4123}/api/health" || exit 1

USER node

CMD ["node", "dist/server.js"]
