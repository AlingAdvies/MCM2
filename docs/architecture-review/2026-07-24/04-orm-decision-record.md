# ORM/Databaselaag Decision Record — MCM2

**Uitgangspunt, expliciet:** Drizzle is niet het doel en niet het startpunt van deze afweging. De aanleiding is het bevestigde structurele conflict tussen Prisma 7, Jest en de gecompileerde Docker-build. Een eerder in dezelfde sessie opgesteld document (`docs/superpowers/specs/2026-07-24-techstack-evaluatie-drizzle.md`) beval Drizzle aan op basis van onvolledig onderzoek — met name het multi-schema-migratiegedrag van Drizzle was toen niet onderzocht. Deze decision record herstelt de volledige, objectieve vergelijking.

---

## Beoordelingscriteria

Betrouwbaarheid, testbaarheid (Jest), Docker-buildcompatibiliteit, RLS/`SET LOCAL`-transactiegeschiktheid, migratiegedrag bij **multi-schema Postgres** (niet single-schema — dit is onze specifieke situatie: `clm`, `ref`, `audit`), typeveiligheid, leercurve, documentatiekwaliteit, vendorrisico/continuïteit, AI-codegeneratiekwaliteit, onderhoudbaarheid door een klein team met een niet-technische opdrachtgever.

## Gewogen beslismatrix

| Criterium | Gewicht | Prisma 7 | Prisma 6 | Drizzle | Kysely | Kaal `pg` |
|---|---|---|---|---|---|---|
| Betrouwbaarheid Jest+Docker | Hoog | ✗ Bevestigd kapot (GitHub #28627, #28784, geen fix beschikbaar) | ✓ Geen bekend conflict | ✓ Geen native/WASM-laag | ✓ Geen native/WASM-laag | ✓ Geen codegen-laag |
| Multi-schema migraties | **Hoog** (onze specifieke situatie) | ~ Werkt, preview-feature langer gerijpt, maar Prisma 7 zelf onstabiel | ~ Werkt, preview-feature | ✗ Meerdere open bugs: geen `CREATE SCHEMA`-generatie (#3476, dupe #1592), geen schema-targeting in `migrate()` (#908), tabellen in verkeerd schema (#5889), cross-schema-transactieconflicten (#3249) | ✗ Eén globale migratietabel voor alle schemas, geen per-schema-tracking (kysely-ctl #349, open); gedeelde migratie-transactie kan cross-schema-afhankelijkheden breken (#1154) | ✓ Volledige handmatige controle, geen tool-beperking mogelijk |
| RLS/`SET LOCAL`-transactie | Hoog | ✓ Werkt (adapter-pattern) | ✓ Werkt | ✓ Werkt, gedocumenteerd patroon | ✓ Werkt, triviaal | ✓ Werkt, handmatig |
| Typeveiligheid | Middel | ✓ Hoog (gegenereerd) | ✓ Hoog (gegenereerd) | ✓ Hoog (gegenereerd) | ~ Middel (handmatig onderhouden `Database`-type, evt. codegen-tool) | ✗ Laag (geen vangrail zonder eigen laag) |
| Documentatiekwaliteit | Middel | ✓ Uitgebreid, officieel NestJS-recept | ✓ Uitgebreid | ✓ Goed, groeiend | ~ Redelijk, minder NestJS-specifiek | ~ node-postgres-documentatie, geen ORM-laag |
| Vendorrisico/continuïteit | Hoog | ~ VC-gefinancierd (Prisma Data, Inc., $56,5M totaal), laatste ronde 2022, 28%-layoff in 2023, geen nieuwe funding sinds 2022 | ~ Zelfde bedrijf/risico als Prisma 7, oudere/stabielere engine | ✓ Overgenomen door PlanetScale (maart 2026) — kernteam nu in dienst bij grotere, gefinancierde partij; winstgevend sinds 2024 zonder VC | ✗ Bus-factor 1 (individuele maintainer), geen gepubliceerde sustainability-garantie | ✓ node-postgres-org, klein maar stabiele scope |
| AI-codegeneratiekwaliteit | Middel | ✓ Hoogste (sinds 2019, meeste trainingsvoorbeelden, hoogste GitHub-sterren: 47,4k) | ✓ Hoog | ~ Middel — community-bron meldt AI soms verouderde v0.28/v0.30-syntax genereert | ~ Middel-laag (kleinste dataset, ~14k sterren) | ✓ Hoog (generieke SQL/Node-patronen, weinig hallucinatierisico) |
| NestJS-integratiepakket | Laag | ✓ Officieel door Prisma zelf gedocumenteerd | ✓ Idem | ~ `@knaadh/nestjs-drizzle-*`, klein (235 sterren), 1-2 jaar niet bijgewerkt | ~ `@anchan828/nest-kysely`, actiever (4 mnd geleden), ook single-maintainer | n.v.t. (directe DI, geen adapter nodig) |
| Onderhoudbaarheid niet-technisch team | Hoog | ✓ Leesbaar schema-DSL, maar nu instabiel in build | ✓ Leesbaar, stabiel | ✓ Leesbaar schema-DSL | ~ Vereist handmatig geschreven migraties — meer discipline, meer foutkans voor een team van 1 | ✗ Meeste handwerk, minste vangrails |

**Legenda:** ✓ voldoet goed — ~ voldoet met voorbehoud/risico — ✗ bevestigd probleem of hoog risico.

## Analyse

Geen van de vijf opties scoort op alle hoog-gewogen criteria zonder voorbehoud. De twee criteria met het hoogste gewicht voor MCM2 specifiek — **multi-schema-migraties** en **vendorrisico** — wijzen in tegengestelde richtingen:

- **Prisma 6** heeft geen nieuw aangetoond multi-schema-probleem, maar deelt het vendorrisico-profiel van Prisma 7 (zelfde bedrijf, gestagneerde funding) én is een bewust aflopende major-versie — op enig moment moet alsnog gemigreerd worden, mogelijk naar dezelfde Prisma 7-problematiek of een compleet nieuwe aanpak.
- **Drizzle** heeft het beste vendorrisico-profiel van de vier alternatieven ná de PlanetScale-overname (maart 2026), maar heeft **meerdere concrete, open GitHub-issues** die specifiek onze multi-schema-situatie raken (schema-aanmaak, schema-targeting, cross-schema-transacties).
- **Kysely** heeft een vergelijkbare multi-schema-tekortkoming als Drizzle, plus het hoogste bus-factor-risico van alle vier opties.
- **Kaal `pg`** heeft geen van de bovenstaande tool-beperkingen, maar verschuift alle typeveiligheid en discipline naar de developer zonder vangrail — dit weegt zwaar tegen de expliciete eis "fool-proof en onderhoudbaar door een niet-technische opdrachtgever te laten beheren", al is de eigenaar zelf technisch sterk genoeg om hiermee te werken indien bewust gekozen.

**Geen van deze bevindingen is doorslaggevend genoeg om nu al definitief te kiezen zonder de eigen situatie te toetsen** — de gevonden GitHub-issues beschrijven algemene multi-schema-scenario's, niet noodzakelijk exact onze drie-schema-indeling (`clm`/`ref`/`audit`, met foreign keys van `clm` naar `ref`, en `audit` los ernaast).

## Voorgestelde technische spike — nu uitsluitend getoetst aan de Transdev-survey-slice

**Wijziging t.o.v. de eerdere versie van dit document:** de spike wordt niet langer getoetst aan het abstracte 4-modellen-schema, maar uitsluitend aan wat de Transdev-survey-slice (zie 08-transdev-mvp-scope.md) daadwerkelijk nodig heeft. Dit is het **enige** acceptatiecriterium — geen enkele andere toekomstige entiteit (contract, task, requirement, etc.) telt mee in deze spike-beoordeling.

**Concreet te bouwen schema voor de spike** (afgeleid van de zeven journeys en de geactualiseerde klantantwoorden in 08-transdev-mvp-scope.md):
- `clm.vendor`, `clm.vendor_contact` (al bestaand in Fase 0-schema, hergebruiken)
- `clm.survey_template` (versieerbaar — minimaal `version`, en per vraag een `question_type` onderscheid tussen vraagtype A (3-keuze + toelichting) en vraagtype B (bestandsupload), zie 08-transdev-mvp-scope.md)
- `clm.survey_round` (koppelt template-versie aan een startdatum en een vaste 30-dagen-vervaldatum per gegenereerd token)
- `clm.survey_response` (per vendor × ronde, met het tijdgebonden, éénmalig-bruikbare token, status, ingediende antwoorden — geen "heropenen"-state nodig, OV-3: indienen is definitief)
- `clm.survey_response_attachment` of vergelijkbaar (referentie naar het geüploade certificaat in S3/MinIO — dit is een **nieuw element t.o.v. de eerdere versie van deze spike-opzet**, toegevoegd na de klantvragen-antwoorden)
- Cross-schema foreign key: `clm.vendor.category_code → ref.vendor_category.code` (bestaand patroon, blijft representatief voor multi-schema-gedrag)
- RLS op alle nieuwe tabellen, plus een aparte toegangsregel voor `clm.survey_response`/`clm.survey_response_attachment` die **uitsluitend** het token-scoped pad toestaat voor de externe respondent-rol (geen brede tenant-RLS-vrijstelling voor deze rol)

**Spike-verificatiepunten (ongewijzigd qua vorm, nu toegepast op dit concrete schema):**

1. Genereert de migratie-tool zelf de `CREATE SCHEMA`-statements correct?
2. Werkt de cross-schema foreign key zonder handmatige nabewerking?
3. Draait de RLS/`SET LOCAL`-transactiehelper correct, inclusief de aparte, beperktere toegangsregel voor de token-gebaseerde externe respondent-rol (dit is een striktere test dan de vorige versie van deze spike: niet alleen "werkt RLS", maar "werkt RLS met twee verschillende toegangsniveaus binnen dezelfde tabel")?
4. Slaagt een Jest-unit-test én een Jest-e2e-test die **de token-isolatie zelf test** (een tweede testtenant/token mag nooit bij de survey-response van de eerste komen) zonder module-systeem-conflicten?
5. Slaagt een `docker build` + `node dist/main.js`-runtime zonder crashes?

**Tijdvak:** ongewijzigd, één werkdag per optie (twee dagen totaal), wegwerpbare spike-branch, geen productiecode.

**Acceptatiecriterium voor de spike:** de optie die alle vijf punten zonder handmatige workaround doorstaat vóór de Transdev-survey-slice, wordt de aanbevolen keuze — **niet** de optie die in theorie beter zou passen bij een grotere, toekomstige schema-omvang. Als beide opties falen op punt 3 (de striktere dubbele-toegangsniveau-RLS-test), is dat een signaal dat de token-gebaseerde externe toegang mogelijk beter op applicatieniveau (een aparte, smalle service-laag) dan op RLS-niveau moet worden afgedwongen — dit zou een aparte, aparte beslissing vereisen.

## Advies

**Voorlopig, vóór de spike:** ongewijzigd — geen van de twee kandidaten heeft een doorslaggevend voordeel dat de spike overbodig maakt. Prisma 6 blijft de veiligere terugvaloptie als de spike niet uitgevoerd kan worden.

**Na de spike:** dit document wordt bijgewerkt met de daadwerkelijke uitkomst tegen de Transdev-slice specifiek, niet met een aanname vooraf en niet met een uitkomst die alleen tegen het abstracte 4-modellen-schema getoetst is.

## Geen migratie uitvoeren

Deze decision record beschrijft de afweging en de voorgestelde spike. Er wordt in het kader van deze architectuurbeoordeling geen daadwerkelijke ORM-migratie van de bestaande Fase 0-code uitgevoerd — dat vereist een aparte, expliciete goedkeuring na de spike-uitkomst.
