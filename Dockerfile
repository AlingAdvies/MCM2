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

# Welke code dit image bevat (pariteitscontract §2, indicator 3). CI vult ze
# via --build-arg; een lokale build laat ze leeg en het health-endpoint meldt
# dan null. Bewust ARG→ENV en geen bestand: het hoort bij het artefact en moet
# op runtime uitleesbaar zijn zonder de container in te gaan.
ARG BUILD_COMMIT=
ARG BUILD_TIJDSTIP=
ENV BUILD_COMMIT=${BUILD_COMMIT}
ENV BUILD_TIJDSTIP=${BUILD_TIJDSTIP}

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY package.json ./

# Migraties draaien als aparte stap, nooit automatisch bij containerstart:
# de migratierol (clm_migrator) verschilt van de runtime-rol
# (clm_api_runtime). Zie ADR-009.
COPY drizzle ./drizzle
COPY scripts ./scripts

# Map voor geüploade bijlagen (vragenlijst-ontwerp §6).
#
# Moet vóór `USER node` aangemaakt worden én van die gebruiker zijn: /app is
# eigendom van root, dus een non-root proces kan er geen submap in maken. Zonder
# deze twee regels faalt élke upload met "EACCES: permission denied, mkdir
# '/app/var'" — gevonden tijdens de OTAP-doorloop van 2026-07-29, niet door de
# e2e-tests, want die draaien met UPLOAD_DIR naar een tijdelijke map.
#
# UPLOAD_DIR staat expliciet in het image in plaats van te leunen op de default
# in BestandOpslagService: het pad hoort bij het uitrolbare artefact, niet bij
# de code.
RUN mkdir -p /app/var/uploads && chown -R node:node /app/var
ENV UPLOAD_DIR=/app/var/uploads

# LET OP BIJ UITROL: dit is een map ín de container. Zonder volume zijn de
# certificaten weg zodra het image vervangen wordt — en het zijn
# compliance-bewijsstukken. Zie ADR-012 en Issue #30.
VOLUME ["/app/var/uploads"]

# Non-root: de node-image levert een 'node'-gebruiker (uid 1000) mee.
USER node

EXPOSE 5001

# dist/main.js, niet dist/src/main.js: met alleen src/ als TypeScript-invoer
# is src/ de rootDir en verdwijnt dat niveau uit de uitvoer. Zolang er geen
# .ts-bestand buiten src/ meegecompileerd wordt, blijft dit pad kloppen.
CMD ["node", "dist/main"]
