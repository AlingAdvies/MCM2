# Multi-stage productiebuild (Issue #20, gedeeltelijk).
# Doel: een image die het gecompileerde resultaat draait, niet de
# ontwikkelmodus. Dit is tevens criterium 1 uit MCM2-CLAUDE.md §5 — het punt
# waarop Prisma 7 faalde en waarop een ORM-keuze zich moet bewijzen.
#
# De ontwikkelwerkwijze (hot reload via docker-compose) gebruikt bewust een
# andere stage: zie de 'development'-stage onderaan en docker-compose.yml.

# ─── Stage 1: bouwen ───────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# npm ci (niet npm install): reproduceerbare installatie vanuit de lockfile,
# conform MCM2-CLAUDE.md §11.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN npm run build

# ─── Stage 2: ontwikkelen ──────────────────────────────────────────────────
# Gebruikt door docker-compose voor hot reload (--target development).
# Staat bewust vóór de runtime-stage: de laatste stage in het bestand is wat
# 'docker build' zonder --target oplevert, en dat moet de productie-image zijn.
FROM node:24-alpine AS development

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5001

CMD ["npm", "run", "start:dev"]

# ─── Stage 3: productie-dependencies ───────────────────────────────────────
FROM node:24-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── Stage 3: draaien ──────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY package.json ./

# Migraties draaien als aparte stap, nooit automatisch bij containerstart:
# de migratierol (clm_migrator) verschilt van de runtime-rol
# (clm_api_runtime). Zie ADR-009.
COPY drizzle ./drizzle
COPY scripts ./scripts

# Non-root: de node-image levert een 'node'-gebruiker (uid 1000) mee.
USER node

EXPOSE 5001

# dist/main.js, niet dist/src/main.js: met alleen src/ als TypeScript-invoer
# is src/ de rootDir en verdwijnt dat niveau uit de uitvoer. Zolang er geen
# .ts-bestand buiten src/ meegecompileerd wordt, blijft dit pad kloppen.
CMD ["node", "dist/main"]
