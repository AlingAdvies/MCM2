# Statusbord — compact overzicht van openstaande issues

**Automatisch gegenereerd. Niet handmatig bewerken** — wijzigingen gaan
verloren bij de volgende run. Pas in plaats daarvan het issue of het label
aan op GitHub, en draai `npm run statusbord` opnieuw (of wacht op de
geplande workflow).

**Gegenereerd:** 2026-09-03 09:41 UTC · **Bron:** `gh issue list --repo AlingAdvies/MCM2`

Dit is geen vervanging van de issues zelf (details, acceptatiecriteria,
discussie staan daar) en geen vervanging van `docs/STATUS.md` (het
chronologische sessiejournaal). Dit is het compacte tussenniveau: in één
oogopslag zien wat er per thema openstaat, gesorteerd op prioriteit.

---

## Op prioriteit, over alle thema's heen

**P0 — voor elke volgende regel productiecode** — 0 open
**Vóór de pilot** — 1 open
**Vóór bredere productie** — 1 open
**Later — bewust uitgesteld** — 11 open

---

## Per thema

### Product — vragenlijst, leveranciers, contracten, meldingen (20)

- [#190](https://github.com/AlingAdvies/MCM2/issues/190) `before-pilot` — Contractdata-uploadtool: Coupa-CSV importeren in MCM2
- [#23](https://github.com/AlingAdvies/MCM2/issues/23) `later` — MVM_V2-frontend-inconsistenties oplossen (tenant demo vs. transdev, vendors-lijstpagina)
- [#187](https://github.com/AlingAdvies/MCM2/issues/187) `later` — Contracttype-veld toevoegen (placeholder, richting volwaardig contractmanagement)
- [#52](https://github.com/AlingAdvies/MCM2/issues/52) — Restrisico virusscan vastleggen als bewuste beslissing, met opschalingsvoorwaarde
- [#83](https://github.com/AlingAdvies/MCM2/issues/83) — Gearchiveerde testrondes stapelen op in de demo-database
- [#148](https://github.com/AlingAdvies/MCM2/issues/148) — Notificaties per tenant: signaleren wat blijft liggen
- [#155](https://github.com/AlingAdvies/MCM2/issues/155) — Nieuwe feature: vragenlijst-bouwer voor tenant-beheerders
- [#156](https://github.com/AlingAdvies/MCM2/issues/156) — Veld voor contractbeheerder/contactpersoon ontbreekt bij leverancier
- [#157](https://github.com/AlingAdvies/MCM2/issues/157) — Contractveld ontbreekt, gekoppeld aan leverancierstype en/of vragenlijst
- [#158](https://github.com/AlingAdvies/MCM2/issues/158) — Bulk-upload voor leveranciersstamdata
- [#159](https://github.com/AlingAdvies/MCM2/issues/159) — Leverancierstype makkelijk aanvinken vanuit de leverancierslijst
- [#160](https://github.com/AlingAdvies/MCM2/issues/160) — Bulk-upload voor contractdata (leverancier, begin-/einddatum)
- [#161](https://github.com/AlingAdvies/MCM2/issues/161) — Compliance-status: vrij tekstveld → koppeling met beoordelingsuitkomst?
- [#170](https://github.com/AlingAdvies/MCM2/issues/170) — Uitklaplijst 'rondes' (#154): kolommen vendornaam en e-mailadres contactpersoon toevoegen
- [#171](https://github.com/AlingAdvies/MCM2/issues/171) — Contracten opnemen in de navigatie (linkerbalk)
- [#172](https://github.com/AlingAdvies/MCM2/issues/172) — Dashboard: 'Start' hernoemen en overzicht van bijna-verlopen contracten
- [#185](https://github.com/AlingAdvies/MCM2/issues/185) — Coupa-import: contract.coupaSupplierNumber toevoegen als matchsleutel
- [#186](https://github.com/AlingAdvies/MCM2/issues/186) — Vendor-categorielijst: Coupa 'Commodity' overnemen + categorieën tenant-uitbreidbaar maken
- [#188](https://github.com/AlingAdvies/MCM2/issues/188) — Business-risk-classificatie (Tier 1/2/3) als apart veld, los van vendor-categorie
- [#189](https://github.com/AlingAdvies/MCM2/issues/189) — DPA-vlag (Ja/Nee) overnemen bij contract-import

### Beheermenu (3)

- [#75](https://github.com/AlingAdvies/MCM2/issues/75) — Beheermenu: gebruikers en rechten per tenant
- [#76](https://github.com/AlingAdvies/MCM2/issues/76) — Beheermenu: e-mailinstellingen (SMTP) per tenant, wachtwoord versleuteld opgeslagen
- [#162](https://github.com/AlingAdvies/MCM2/issues/162) — Bug: tenantnaam ontbreekt in de tenantinstellingen-tekst (hardcoded 'AlingAdvies')

### AWS / productie-infrastructuur (5)

- [#21](https://github.com/AlingAdvies/MCM2/issues/21) `later` — Volledige AWS-beveiligingsdiensten groep 1 (WAF, GuardDuty, KMS, CloudTrail, SNS, malware-scan)
- [#57](https://github.com/AlingAdvies/MCM2/issues/57) `later` — Platformbeheer-toegang tot klant-tenants: industry standards onderzoeken vóór definitieve keuze
- [#86](https://github.com/AlingAdvies/MCM2/issues/86) `later` — Scripts benoemen hun doelwit niet: een lokale testrun kan ongemerkt met productie praten
- [#17](https://github.com/AlingAdvies/MCM2/issues/17) — Logging/monitoring-basislaag vóór de pilot
- [#61](https://github.com/AlingAdvies/MCM2/issues/61) — Leesbare rookproef voor een uitgerolde omgeving (acceptatie/productie)

### Backup en herstel (6)

- [#78](https://github.com/AlingAdvies/MCM2/issues/78) `later` — pg_dump kan niet draaien als clm_migrator: FORCE RLS blokkeert de backup
- [#19](https://github.com/AlingAdvies/MCM2/issues/19) — Backup/restore-test daadwerkelijk uitgevoerd
- [#30](https://github.com/AlingAdvies/MCM2/issues/30) — GEEN backups: clm-enterprise draait op Supabase Free Plan
- [#46](https://github.com/AlingAdvies/MCM2/issues/46) — Duurzame objectopslag voor uploads + ingeplande dump buiten de brondraaimachine
- [#48](https://github.com/AlingAdvies/MCM2/issues/48) — Pilot-runbook en alerting: wie kijkt wanneer naar welk signaal
- [#58](https://github.com/AlingAdvies/MCM2/issues/58) — Backup hangt af van de ontwikkellaptop: onafhankelijke uitvoering vóór de pilot

### OTAP en CI/CD (5)

- [#20](https://github.com/AlingAdvies/MCM2/issues/20) `later` — Dockerfile hardenen: npm ci, multi-stage build, non-root user
- [#22](https://github.com/AlingAdvies/MCM2/issues/22) `later` — Dependabot-configuratie
- [#59](https://github.com/AlingAdvies/MCM2/issues/59) `later` — npm audit: 29 kwetsbaarheden in devDependencies (0 in productie) — opschonen bij de eerste major-onderhoudsronde
- [#51](https://github.com/AlingAdvies/MCM2/issues/51) — Frontend-image promoveerbaar maken: API-URL runtime i.p.v. ingebakken bij build
- [#53](https://github.com/AlingAdvies/MCM2/issues/53) — OTAP-doorloop periodiek automatiseren zonder cross-repo koppeling

### Toegangsmechanisme (tokens, guards) (1)

- [#47](https://github.com/AlingAdvies/MCM2/issues/47) — Eén Playwright-browsertest van de volledige UC1-flow (token → upload → indienen)

### Database, migraties, RLS (6)

- [#16](https://github.com/AlingAdvies/MCM2/issues/16) `later` — Export- en reminder-acties krijgen expliciet meegegeven tenantId
- [#14](https://github.com/AlingAdvies/MCM2/issues/14) — REVOKE UPDATE, DELETE op audit.audit_event voor de runtime-rol
- [#49](https://github.com/AlingAdvies/MCM2/issues/49) — max_files structureel afdwingen: quotarij met atomaire reservering (kale trigger volstaat niet)
- [#50](https://github.com/AlingAdvies/MCM2/issues/50) — Vergrendeling bewijzen met twee fysiek gescheiden databaseverbindingen
- [#65](https://github.com/AlingAdvies/MCM2/issues/65) — Aparte eigenaarsrol voor SECURITY DEFINER-functies, zodat FORCE RLS overal kan
- [#96](https://github.com/AlingAdvies/MCM2/issues/96) — db:generate is onbruikbaar: snapshots lopen tot 0007 terwijl er 16 migraties zijn

### Overig (3)

- [#24](https://github.com/AlingAdvies/MCM2/issues/24) `later` — Later-lijst: uitgestelde items zonder concrete trigger
- [#1](https://github.com/AlingAdvies/MCM2/issues/1) — Wachtwoordrotatie van de postgres-beheerrol
- [#54](https://github.com/AlingAdvies/MCM2/issues/54) — Unittestlaag voor pure functies (bestandsvalidatie, antwoordvalidatie, opslagsleutel)

### ⚠ Niet ingedeeld (6)

Deze issues missen een `thema:*`-label. Voeg er een toe op GitHub, of
maak een nieuw thema aan in `scripts/statusbord.js` als geen van de
bestaande thema's past.

- [#212](https://github.com/AlingAdvies/MCM2/issues/212) — Tenant-lid intrekken toont foutmelding terwijl het intrekken wél slaagt (204 zonder body)
- [#206](https://github.com/AlingAdvies/MCM2/issues/206) — FORCE ROW LEVEL SECURITY ontbreekt op 8 tabellen
- [#205](https://github.com/AlingAdvies/MCM2/issues/205) — Archiveerfunctie voor vragenlijst-rondes (periode-afsluiting)
- [#197](https://github.com/AlingAdvies/MCM2/issues/197) `before-production` — Vragenlijst aanmaken/importeren door tenant- of platformbeheerder ontbreekt
- [#192](https://github.com/AlingAdvies/MCM2/issues/192) — Visuele markering voor gebruiker zonder actief tenant-membership bij historische koppelingen
- [#173](https://github.com/AlingAdvies/MCM2/issues/173) — Contract 360: eigen toppagina /contracten/[id]

---

**Totaal open:** 55
