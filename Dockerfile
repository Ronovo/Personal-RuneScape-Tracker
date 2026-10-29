FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53

# The image keeps its dev dependencies and source so git-sync can pull and rebuild on every start.
# NODE_ENV=production would make npm ci skip the dev dependencies the build needs, hence --include=dev.
ENV REPO_URL=https://github.com/Ronovo/Personal-RuneScape-Tracker.git \
    BUILD_CMD="npm ci --include=dev && npm run build && find dist public -name '*.test.js' -delete"

COPY docker/git-sync.sh /usr/local/bin/git-sync
RUN apk add --no-cache git \
    && sed -i 's/\r$//' /usr/local/bin/git-sync && chmod +x /usr/local/bin/git-sync

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node tsconfig.base.json tsconfig.server.json tsconfig.client.json ./
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
RUN npm run build && find dist public -name '*.test.js' -delete

# Express's default error handler includes a stack trace unless this is set.
ENV NODE_ENV=production
ENV PORT=4123
EXPOSE 4123

RUN mkdir -p /app/data/sync /app/data/watchlist
VOLUME /app/data

# The start period covers the rebuild git-sync runs when a start pulls new commits.
HEALTHCHECK --interval=30s --timeout=3s --start-period=180s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-4123}/api/health" || exit 1

ENTRYPOINT ["git-sync"]
CMD ["node", "dist/server.js"]
