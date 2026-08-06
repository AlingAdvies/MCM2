# ADR-004 — Valkey in plaats van Redis

- Status: **Accepted, nog niet toegepast** — bijgesteld op 2026-08-06, zie de noot onderaan
- Datum: 2026-07-24
- Context: Redis Ltd. wijzigde de licentie van Redis (RSALv2/SSPL) vanaf versie 7.4 — niet langer een vrije open-sourcelicentie voor een nieuw project.
- Besluit: `valkey/valkey:8.1-alpine` als lokale queue-technologie voor BullMQ, in plaats van een `redis:*`-image.
- Alternatieven: `redis:7-alpine` of ouder (verworpen — bewust een licentierisico introduceren voor een nieuw project terwijl een vrij, protocolcompatibel alternatief bestaat); een andere queue-technologie zoals RabbitMQ (niet overwogen — geen functionele reden om van BullMQ/Redis-protocol af te stappen).
- Gevolgen: Valkey (Linux Foundation, BSD-3-Clause-licentie) is 100% protocolcompatibel met Redis — geen codewijziging nodig, `REDIS_URL`-naamgeving blijft ongewijzigd in de omgevingsvariabelen.
- Reviewmoment: geen aanleiding, tenzij Valkey zelf een vergelijkbare licentiewijziging zou doorvoeren.
- Bronnen: `docs/context/PROJECT-HISTORY-2026-07-24.md`; huidige `MCM2-CLAUDE.md`, sectie Versiebeleid.

---

## Noot 2026-08-06 — het besluit staat, de infrastructuur is teruggedraaid

Bij het opstellen van `docs/architectuur/exit-route-hosting.md` bleek dat er **geen enkele
regel code met Valkey praat**: geen `bullmq`, geen `ioredis`, geen dependency in
`package.json`. Wel draaide er een container in `docker-compose.yml` en stond `REDIS_URL` in
`.env.example`.

Dit ADR ging over *welke* queue-technologie, niet over *of* er een queue nodig was. De
achtergrondtaken waarvoor hij bedoeld was — bulkmail, herinneringen, verlopen rondes
markeren, exports — zijn nog niet gebouwd. De uitnodigingen die op 2026-08-06 zijn gebouwd,
versturen serieel binnen het verzoek; voor vijf tot vijftig leveranciers is dat passend.

**Besluit eigenaar 2026-08-06: eruit halen tot het nodig is** ("simpel houden zolang het
kan"). Container en variabele verwijderd.

**Wat er níét verandert:** de afweging in dit ADR. Komt er een queue, dan is het Valkey en
niet Redis — de licentieredenering staat onverkort. Terugzetten is de container en de
variabele herstellen.

**Waarom dit als noot en niet als "Superseded":** het besluit is niet vervangen of onjuist
gebleken. Alleen de aanname dat er op korte termijn een queue zou zijn, klopte niet.
