# ADR-004 — Valkey in plaats van Redis

- Status: Accepted, geïmplementeerd
- Datum: 2026-07-24
- Context: Redis Ltd. wijzigde de licentie van Redis (RSALv2/SSPL) vanaf versie 7.4 — niet langer een vrije open-sourcelicentie voor een nieuw project.
- Besluit: `valkey/valkey:8.1-alpine` als lokale queue-technologie voor BullMQ, in plaats van een `redis:*`-image.
- Alternatieven: `redis:7-alpine` of ouder (verworpen — bewust een licentierisico introduceren voor een nieuw project terwijl een vrij, protocolcompatibel alternatief bestaat); een andere queue-technologie zoals RabbitMQ (niet overwogen — geen functionele reden om van BullMQ/Redis-protocol af te stappen).
- Gevolgen: Valkey (Linux Foundation, BSD-3-Clause-licentie) is 100% protocolcompatibel met Redis — geen codewijziging nodig, `REDIS_URL`-naamgeving blijft ongewijzigd in de omgevingsvariabelen.
- Reviewmoment: geen aanleiding, tenzij Valkey zelf een vergelijkbare licentiewijziging zou doorvoeren.
- Bronnen: `docs/context/PROJECT-HISTORY-2026-07-24.md`; huidige `MCM2-CLAUDE.md`, sectie Versiebeleid.
