# MCM2 — backend

Multitenant platform voor **vendor-compliance en contractmanagement**:
leveranciers, contracten, compliance-vragenlijsten en het bewijs daaromheen,
per klant (tenant) strikt gescheiden. Ontwikkeld door AlingAdvies.

Dit is de backend (API). De webfrontend staat in een aparte, gekoppelde
repository (`MCM2-frontend`).

## Techniek

- **NestJS** (TypeScript, Node 24) als API
- **PostgreSQL** met Row-Level Security: de tenantgrens wordt in de database
  afgedwongen, niet alleen in de code
- **Drizzle** met handgeschreven SQL-migraties in `drizzle/`
- Inloggen via **Microsoft Entra External ID**
- Uitrol via GitHub Actions naar AWS, met een verplicht menselijk akkoord
  vóór productie

## Waar staat wat

| Map | Inhoud |
|---|---|
| `src/` | De API, per domein een module |
| `drizzle/` | Databasemigraties (volgorde staat in `drizzle/meta/_journal.json`) |
| `test/` | E2e-tests, inclusief tenant-isolatietests |
| `scripts/` | Beheer, uitrol, backup en verificatie |
| `db/seeds/` | Vragenlijsten en verzonnen voorbeelddata |
| `docs/` | Architectuur, besluiten (`adr/`), runbooks en status |

Beginnen met lezen: [`CLAUDE.md`](CLAUDE.md) (werkafspraken),
[`docs/ARCHITECTUUR.md`](docs/ARCHITECTUUR.md) (wat het systeem garandeert) en
[`docs/runbooks/commandos-en-omgeving.md`](docs/runbooks/commandos-en-omgeving.md)
(welke commando's er zijn en waar ze naartoe praten).

## Lokaal ontwikkelen

```bash
npm ci
npm run test:db -- "waarvoor"   # wegwerp-Postgres in Docker, met rollen en migraties
npm run start:dev
```

Groen is pas groen via de volledige controle, dezelfde stappen als CI:

```bash
npm run verify:volledig
```

## Geen klantdata in deze repository

Deze repository is openbaar. Klantbestanden (uploads, exports, rapporten)
horen er nooit in; voorbeelddata gebruikt alleen adressen op `voorbeeld.nl`.
`npm run check:klantdata` bewaakt dat, ook in CI.

## Licentie

Niet vrij te gebruiken (`UNLICENSED`). Alle rechten voorbehouden.
