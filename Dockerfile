FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public

ENV PORT=4123
EXPOSE 4123

USER node

CMD ["node", "server.js"]
