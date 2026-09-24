# Vendor-dossier: notitie erbij — design

> **Vervolg op** `2026-09-24-vendor-dossiers-design.md`. Deze aanvulling voegt
> een notitieveld toe aan de al gebouwde vendor-dossiers-feature
> (`feat/vendor-engagement-dossiers`, nog niet gemerged naar `main`).

## Aanleiding

Na het eerste bouwen en handmatig testen bleek: het dossier had alleen een
titel + optionele bijlagen. Om te weten wat er speelt, moest je altijd een
bijlage openen. De eigenaar wil in één oogopslag — zonder bestand te openen —
de kern en eventuele status kunnen zien.

Verduidelijking van de eerdere requirement "voorkeur voor bijlages": dat
betekende "ook bestanden" naast tekst, niet "bestanden in plaats van tekst".

## Wat er verandert

### Datamodel

Nieuwe tabel `clm.vendor_engagement_note` — append-only, zelfde patroon als
`clm.response_note`:

| Kolom | Type | Opmerking |
|---|---|---|
| `note_id` | uuid, pk | |
| `engagement_id` | uuid, FK cascade → `vendor_engagement` | |
| `tenant_id` | uuid, FK restrict | |
| `tekst` | text | verplicht, max 500 tekens |
| `created_by_user_id` | uuid, FK restrict | |
| `created_at` | timestamptz | |
| `deleted_at` | timestamptz, nullable | soft-delete, zelfde patroon als overal |

RLS + GRANT/REVOKE identiek aan `vendor_engagement`/`vendor_engagement_attachment`
(`NIET_VERWIJDEREN`-rechtenpatroon: SELECT/INSERT/UPDATE, geen DELETE).

**Waarom een eigen tabel en geen kolom op `vendor_engagement`:** een kolom
zou bij wijzigen de vorige tekst onherroepelijk overschrijven. Rijen toevoegen
kost nu vrijwel niets extra, en voorkomt een pijnlijke latere migratie als
geschiedenis alsnog nodig blijkt (dat is al aangekondigd als aankomende vraag).
Nu bouwen we de UI er nog niet voor — zie "Uit scope" — maar de data is er
klaar voor.

### Gedrag

- **Aanmaken van een dossier**: titel + notitie zijn allebei verplicht.
  Zonder notitie kan een dossier niet worden opgeslagen (zelfde niveau van
  verplichting als titel nu al heeft).
- **Notitie toevoegen aan een bestaand dossier**: mogelijk, los van
  aanmaken. Elke toevoeging is een nieuwe rij — er wordt nooit een bestaande
  notitie-rij overschreven.
- **Weergave**: de dossier-rij toont altijd de tekst van de meest recente,
  niet-ingetrokken notitie, direct zichtbaar (geen inklappen/uitklappen
  nodig).
- **Intrekken van een notitie** (soft-delete via `deleted_at`): als de
  ingetrokken notitie de meest recente was, valt de weergave terug op de
  daaropvolgende meest recente, niet-ingetrokken notitie. Zijn er geen
  notities meer over (kan alleen als eerdere notities ook zijn ingetrokken),
  dan toont de rij "geen notitie".
- **Lengte**: max. 500 tekens per notitie — dwingt bondigheid af, past bij
  "status in 1-2 zinnen".

### Uit scope (bewust, voor nu)

- **Geschiedenis-UI** (alle notities van een dossier tonen, niet alleen de
  laatste): de data ligt er klaar voor (append-only), maar de UI hiervoor
  bouwen we nu niet. Zodra dit gevraagd wordt: geen nieuwe migratie nodig,
  alleen een UI-uitbreiding (bijv. een uitklapbare lijst).
- **Los statusveld** (bijv. een dropdown "open/wacht op reactie/akkoord"):
  niet nu. De notitie-tekst zelf draagt de status ("wacht op reactie" als
  losse zin) — een gestructureerd statusveld was al bewust uit de MVP
  gehouden bij de oorspronkelijke vendor-dossiers-design en blijft dat.

## Backend — wijzigingen

- Nieuwe migratie (volgnummer na de laatste in `feat/vendor-engagement-dossiers`,
  dus na `0042`): `clm.vendor_engagement_note`, met RLS + expliciete
  REVOKE ALL/GRANT (zelfde valkuil als bij de vorige drie migraties —
  niet vertrouwen op `ALTER DEFAULT PRIVILEGES`).
- `rechten-contract.ts`: `'clm.vendor_engagement_note': NIET_VERWIJDEREN`.
- `test/opruimen.ts`: toevoegen aan `TABELLEN_IN_VOLGORDE`, vóór
  `vendor_engagement` (child eerst).
- `VendorEngagementService`:
  - `aanmaken(...)` krijgt een verplicht `notitieTekst`-argument, valideert
    max. 500 tekens (net als bestandsvalidatie: een aparte, kleine
    invoer-validatiefunctie in `vendor-engagement-invoer.ts`), en schrijft de
    notitie-rij in dezelfde transactie als het dossier.
  - Nieuwe methode `notitieToevoegen(tenantId, engagementId, tekst,
    createdByUserId)`.
  - Nieuwe methode `notitieIntrekken(tenantId, engagementId, noteId)` —
    soft-delete.
  - `lijstVoorVendor(...)` haalt per dossier ook de notities op en geeft de
    meest recente, niet-ingetrokken notitie mee als `laatsteNotitie` (tekst +
    createdAt + createdByNaam) — de eerdere notities worden nu niet
    meegegeven (YAGNI, komt bij de geschiedenis-uitbreiding).
- `VendorEngagementController`: nieuwe routes
  `POST /engagements/:id/notes` en `DELETE /engagements/:id/notes/:noteId`,
  zelfde `@VereistRol('admin', 'user')`-patroon als de bestaande routes.
- `test/test-ids.ts`: nieuwe, unieke UUID-staarten voor deze suite (opzoeken
  welke tails nog vrij zijn, niet aannemen).

## Frontend — wijzigingen

- `EngagementPanel.tsx`:
  - Aanmaakformulier krijgt een notitie-tekstveld (verplicht, max 500
    tekens, karaktertelling zichtbaar), naast het al bestaande titelveld.
    "Dossier opslaan" blijft uitgeschakeld zolang titel of notitie leeg is.
  - Elke dossier-rij toont de laatste notitie-tekst direct onder de titel
    (vóór de links/bijlagen-badges).
  - Elke dossier-rij krijgt een knop "Notitie toevoegen" die een klein
    inline tekstveld + opslaan-knop toont (zelfde interactiepatroon als het
    aanmaakformulier, maar kleiner).
  - Verwijderknop bij de getoonde notitie (net als bij bijlagen), die
    `notitieIntrekken` aanroept.
- `vendorEngagement.ts` (model) en `vendorEngagementService.ts`: nieuwe
  types/functies voor `laatsteNotitie`, `voegNotitieToe`, `trekNotitieIn`.
- Playwright e2e: uitbreiden met een test voor "aanmaken zonder notitie mag
  niet", "notitie toevoegen aan bestaand dossier verschijnt direct", en
  "intrekken van de laatste notitie valt terug op de voorlaatste".

## Migratiepad voor bestaande (lokale, niet-productie) test-data

Deze branch is nog niet gemerged naar `main` en nog niet uitgerold — er is
dus geen productiedata met dossiers zonder notitie om rekening mee te
houden. Geen backfill nodig.
