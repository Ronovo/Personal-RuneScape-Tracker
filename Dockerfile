FROM node:24-alpine

RUN apk add --no-cache git

WORKDIR /app

RUN git clone --depth 1 https://github.com/Ronovo/Personal-RuneScape-Tracker.git .

RUN npm ci --omit=dev

ENV PORT=4123
EXPOSE 4123

USER node

CMD ["node", "server.js"]
