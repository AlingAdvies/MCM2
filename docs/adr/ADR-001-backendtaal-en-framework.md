# ADR-001 — Backendtaal en framework: TypeScript / NestJS

- Status: Accepted
- Datum: 2026-05-28 (oorspronkelijk besluit), bevestigd 2026-07-24
- Context: MCM2 vervangt de C#/.NET-pilot `mvm-api-pilot`. De projecteigenaar wil één primaire backendtaal, een modulaire monolith, en onderhoudbaarheid door een niet-fulltime-IT-professional.
- Besluit: NestJS 11.x met TypeScript als enige backendtaal voor MCM2.
- Alternatieven: C#/.NET voortzetten (verworpen — dubbele taalstack tussen frontend en backend); losse Express/Fastify-opzet zonder framework-structuur (verworpen — minder ingebouwde structuur, meer zelf te ontwerpen conventies).
- Gevolgen: `mvm-api-pilot` dient als functionele specificatie (endpointvorm, businessgedrag), niet als technische bron. Eén taal (TypeScript) sluit aan bij de frontend (Next.js/MVM_V2), wat de cognitieve overhead voor een klein team verkleint.
- Reviewmoment: geen aanleiding om te heroverwegen, tenzij een toekomstige teamuitbreiding andere taalvoorkeuren met zich meebrengt.
- Bronnen: `docs/context/PROJECT-HISTORY-2026-07-24.md`, `MVM_V2/docs/architectuur-hosting-onderhoud-sessie-2026-07-23.md`.
