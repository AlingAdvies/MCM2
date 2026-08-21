# Statusbord — compact overzicht van openstaande issues

**Automatisch gegenereerd. Niet handmatig bewerken** — wijzigingen gaan
verloren bij de volgende run. Pas in plaats daarvan het issue of het label
aan op GitHub, en draai `npm run statusbord` opnieuw (of wacht op de
geplande workflow).

**Gegenereerd:** 2026-08-21 18:11 UTC · **Bron:** `gh issue list --repo AlingAdvies/MCM2`

Dit is geen vervanging van de issues zelf (details, acceptatiecriteria,
discussie staan daar) en geen vervanging van `docs/STATUS.md` (het
chronologische sessiejournaal). Dit is het compacte tussenniveau: in één
oogopslag zien wat er per thema openstaat, gesorteerd op prioriteit.

---

## Op prioriteit, over alle thema's heen

**P0 — voor elke volgende regel productiecode** — 2 open
**Vóór de pilot** — 6 open
**Vóór bredere productie** — 12 open
**Later — bewust uitgesteld** — 1 open

---

## Per thema

### Product — vragenlijst, leveranciers, contracten, meldingen (12)

- [#23](https://github.com/AlingAdvies/MCM2/issues/23) `before-production` — MVM_V2-frontend-inconsistenties oplossen (tenant demo vs. transdev, vendors-lijstpagina)
- [#52](https://github.com/AlingAdvies/MCM2/issues/52) — Restrisico virusscan vastleggen als bewuste beslissing, met opschalingsvoorwaarde
- [#83](https://github.com/AlingAdvies/MCM2/issues/83) — Gearchiveerde testrondes stapelen op in de demo-database
- [#148](https://github.com/AlingAdvies/MCM2/issues/148) — Notificaties per tenant: signaleren wat blijft liggen
- [#153](https://github.com/AlingAdvies/MCM2/issues/153) — Vragenlijst toont geen contact-/afzenderinfo voor de leverancier
- [#155](https://github.com/AlingAdvies/MCM2/issues/155) — Nieuwe feature: vragenlijst-bouwer voor tenant-beheerders
- [#156](https://github.com/AlingAdvies/MCM2/issues/156) — Veld voor contractbeheerder/contactpersoon ontbreekt bij leverancier
- [#157](https://github.com/AlingAdvies/MCM2/issues/157) — Contractveld ontbreekt, gekoppeld aan leverancierstype en/of vragenlijst
- [#158](https://github.com/AlingAdvies/MCM2/issues/158) — Bulk-upload voor leveranciersstamdata
- [#159](https://github.com/AlingAdvies/MCM2/issues/159) — Leverancierstype makkelijk aanvinken vanuit de leverancierslijst
- [#160](https://github.com/AlingAdvies/MCM2/issues/160) — Bulk-upload voor contractdata (leverancier, begin-/einddatum)
- [#161](https://github.com/AlingAdvies/MCM2/issues/161) — Compliance-status: vrij tekstveld → koppeling met beoordelingsuitkomst?

### Beheermenu (4)

- [#75](https://github.com/AlingAdvies/MCM2/issues/75) `before-production` — Beheermenu: gebruikers en rechten per tenant
- [#76](https://github.com/AlingAdvies/MCM2/issues/76) `before-production` — Beheermenu: e-mailinstellingen (SMTP) per tenant, wachtwoord versleuteld opgeslagen
- [#77](https://github.com/AlingAdvies/MCM2/issues/77) `before-production` — Beheermenu: uitnodigingen versturen — handpicked en in bulk op leverancierscriteria
- [#162](https://github.com/AlingAdvies/MCM2/issues/162) — Bug: tenantnaam ontbreekt in de tenantinstellingen-tekst (hardcoded 'AlingAdvies')

### AWS / productie-infrastructuur (5)

- [#17](https://github.com/AlingAdvies/MCM2/issues/17) `before-pilot` — Logging/monitoring-basislaag vóór de pilot
- [#21](https://github.com/AlingAdvies/MCM2/issues/21) `before-production` — Volledige AWS-beveiligingsdiensten groep 1 (WAF, GuardDuty, KMS, CloudTrail, SNS, malware-scan)
- [#57](https://github.com/AlingAdvies/MCM2/issues/57) `before-production` — Platformbeheer-toegang tot klant-tenants: industry standards onderzoeken vóór definitieve keuze
- [#86](https://github.com/AlingAdvies/MCM2/issues/86) `before-production` — Scripts benoemen hun doelwit niet: een lokale testrun kan ongemerkt met productie praten
- [#61](https://github.com/AlingAdvies/MCM2/issues/61) — Leesbare rookproef voor een uitgerolde omgeving (acceptatie/productie)

### Backup en herstel (6)

- [#30](https://github.com/AlingAdvies/MCM2/issues/30) `p0` — GEEN backups: clm-enterprise draait op Supabase Free Plan
- [#19](https://github.com/AlingAdvies/MCM2/issues/19) `before-pilot` — Backup/restore-test daadwerkelijk uitgevoerd
- [#58](https://github.com/AlingAdvies/MCM2/issues/58) `before-pilot` — Backup hangt af van de ontwikkellaptop: onafhankelijke uitvoering vóór de pilot
- [#78](https://github.com/AlingAdvies/MCM2/issues/78) `before-production` — pg_dump kan niet draaien als clm_migrator: FORCE RLS blokkeert de backup
- [#46](https://github.com/AlingAdvies/MCM2/issues/46) — Duurzame objectopslag voor uploads + ingeplande dump buiten de brondraaimachine
- [#48](https://github.com/AlingAdvies/MCM2/issues/48) — Pilot-runbook en alerting: wie kijkt wanneer naar welk signaal

### OTAP en CI/CD (6)

- [#18](https://github.com/AlingAdvies/MCM2/issues/18) `before-production` — Volledige OTAP-doorloop minimaal één keer bewezen
- [#20](https://github.com/AlingAdvies/MCM2/issues/20) `before-production` — Dockerfile hardenen: npm ci, multi-stage build, non-root user
- [#22](https://github.com/AlingAdvies/MCM2/issues/22) `before-production` — Dependabot-configuratie
- [#59](https://github.com/AlingAdvies/MCM2/issues/59) `before-production` — npm audit: 29 kwetsbaarheden in devDependencies (0 in productie) — opschonen bij de eerste major-onderhoudsronde
- [#51](https://github.com/AlingAdvies/MCM2/issues/51) — Frontend-image promoveerbaar maken: API-URL runtime i.p.v. ingebakken bij build
- [#53](https://github.com/AlingAdvies/MCM2/issues/53) — OTAP-doorloop periodiek automatiseren zonder cross-repo koppeling

### Toegangsmechanisme (tokens, guards) (1)

- [#47](https://github.com/AlingAdvies/MCM2/issues/47) — Eén Playwright-browsertest van de volledige UC1-flow (token → upload → indienen)

### Database, migraties, RLS (6)

- [#14](https://github.com/AlingAdvies/MCM2/issues/14) `before-pilot` — REVOKE UPDATE, DELETE op audit.audit_event voor de runtime-rol
- [#16](https://github.com/AlingAdvies/MCM2/issues/16) `before-pilot` — Export- en reminder-acties krijgen expliciet meegegeven tenantId
- [#49](https://github.com/AlingAdvies/MCM2/issues/49) — max_files structureel afdwingen: quotarij met atomaire reservering (kale trigger volstaat niet)
- [#50](https://github.com/AlingAdvies/MCM2/issues/50) — Vergrendeling bewijzen met twee fysiek gescheiden databaseverbindingen
- [#65](https://github.com/AlingAdvies/MCM2/issues/65) — Aparte eigenaarsrol voor SECURITY DEFINER-functies, zodat FORCE RLS overal kan
- [#96](https://github.com/AlingAdvies/MCM2/issues/96) — db:generate is onbruikbaar: snapshots lopen tot 0007 terwijl er 16 migraties zijn

### Overig (4)

- [#1](https://github.com/AlingAdvies/MCM2/issues/1) `p0` — Wachtwoordrotatie van de postgres-beheerrol
- [#15](https://github.com/AlingAdvies/MCM2/issues/15) `before-pilot` — Resterende open Transdev-klantvragen beantwoorden (OV-4, OV-6, OV-7, OV-8, OV-9)
- [#24](https://github.com/AlingAdvies/MCM2/issues/24) `later` — Later-lijst: uitgestelde items zonder concrete trigger
- [#54](https://github.com/AlingAdvies/MCM2/issues/54) — Unittestlaag voor pure functies (bestandsvalidatie, antwoordvalidatie, opslagsleutel)

---

**Totaal open:** 44
