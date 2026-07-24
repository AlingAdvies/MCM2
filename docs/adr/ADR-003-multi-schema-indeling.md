# ADR-003 — Multi-schema-indeling: `clm` / `ref` / `audit`

- Status: Accepted
- Datum: oorspronkelijk vastgesteld vóór 2026-07-24 (Hay CDM-conventie, overgenomen uit de C#-pilot-specificatie), bevestigd tijdens de architectuurbeoordeling
- Context: het datamodel volgt de Hay CDM-standaardconventie: `clm` voor tenant-gebonden kerndata, `ref` voor tenant-agnostische lookup-tabellen, `audit` voor een append-only audit-trail. `mvm-api-pilot` gebruikte daarnaast nog `notification` en `staging`-schemas, die MCM2 (nog) niet gebruikt.
- Besluit: drie Postgres-schemas (`clm`, `ref`, `audit`) voor de huidige Transdev-survey-slice. `ref` krijgt bewust geen RLS (tenant-agnostische data).
- Alternatieven: alles in één `public`-schema (verworpen — verliest de expliciete scheiding tussen tenant-gebonden, gedeelde en audit-data die de Hay CDM-conventie en de NIS2/DORA-onderbouwing vereisen).
- Gevolgen: deze indeling is de directe oorzaak van specifieke multi-schema-migratiebeperkingen die tijdens de ORM-beslismatrix zijn ontdekt (zowel Drizzle als Kysely hebben bekende, bronvermelde tekortkomingen bij migraties over meerdere Postgres-schemas). De schema-indeling zelf wordt **niet** heroverwogen naar aanleiding daarvan — de ORM-keuze moet hiertegen getoetst worden, niet andersom.
- Reviewmoment: na de P1-ORM-spike (Prisma 6 vs. Drizzle) — als beide kandidaten falen op multi-schema-migratiegedrag, is dat een signaal om deze indeling zelf te heroverwegen (bijvoorbeeld tijdelijk alles in één schema, met een latere, geplande schema-split). Dat zou een apart, nieuw ADR vereisen.
- Bronnen: `docs/architecture-review/2026-07-24/04-orm-decision-record.md`, `07-decision-log.md` (oorspronkelijke ADR-003 in de architectuurbeoordeling).
