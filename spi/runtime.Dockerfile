# syntax=docker/dockerfile:1.24.0
FROM docker.io/library/node:22.22.1-alpine@sha256:8094c002d08262dba12645a3b4a15cd6cd627d30bc782f53229a2ec13ee22a00 AS dependencies

ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm install --global npm@11.12.1 \
    && npm pkg delete scripts.prepare \
    && npm ci --omit=dev --quiet

FROM docker.io/library/node:22.22.1-alpine@sha256:8094c002d08262dba12645a3b4a15cd6cd627d30bc782f53229a2ec13ee22a00

ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY --from=dependencies --chown=node:node /usr/src/app ./
COPY --chown=node:node dist ./dist

USER node
EXPOSE 8003
CMD ["node", "dist/src/lib/restApi/RestServer.js"]
