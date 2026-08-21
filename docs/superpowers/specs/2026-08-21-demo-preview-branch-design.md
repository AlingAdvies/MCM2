# Ontwerp — betrouwbare frontend-preview vóór mergen

**Datum:** 2026-08-21
**Issue:** [#165](https://github.com/AlingAdvies/MCM2/issues/165) — OTAP-fout: geen betrouwbare manier om een feature te zien/testen vóór mergen
**Scope:** alleen frontend-previews. Geen backend-previews, geen nieuwe omgeving.

---

## Aanleiding

Tijdens het testen van PR [MCM2-frontend#14](https://github.com/AlingAdvies/MCM2-frontend/pull/14)
(issue #154, rondes groeperen per vragenlijst) bleek er geen betrouwbare manier
te zijn om de wijziging te bekijken vóór mergen. Drie samenlopende problemen,
in de volgorde waarin ze zich toonden:

1. **Fragiel deel-mechanisme.** De inlog-link van `npm run demo` draagt het
   sessietoken achter een `#`. Bij het kopiëren/plakken van die link (via
   chat) werd het fragment herhaaldelijk afgekapt — het scherm meldde dan
   "Geen sessie in de link" of "De sessie werkt niet", zonder dat de echte
   oorzaak zichtbaar was.
2. **Stille migratie-achterstand.** De demo-database bleek 7 migraties te
   zijn achtergelopen (20 van 27) — dat gaf een 500-fout die op het eerste
   gezicht leek op "sessie verlopen", maar in werkelijkheid kwam doordat
   `clm.platform_admin` nog niet bestond op die database. Niemand had dit
   gemerkt, want er is geen signaal dat de demo-database achterloopt.
3. **Onopgemerkte branch-mismatch.** Tijdens het debuggen bleek de
   backend-repo (`MCM2`) op een andere branch te staan dan de frontend-repo
   (`MCM2-frontend`). Toevallig gaf dat geen schade (de actieve
   backend-branch bevatte alleen een documentwijziging), maar het
   mechanisme dat dit voorkwam bestond niet — `demo-stack.js` start de
   frontend simpelweg vanuit wat er toevallig in `MCM2-frontend` is
   uitgecheckt, zonder dat te controleren of te melden.

## Wat hier bewust buiten scope blijft

- **Geen preview voor backend-wijzigingen.** Backend-wijzigingen hebben al
  de CI-poort (`rls-isolation`-job) als geautomatiseerd bewijs; het gat zit
  specifiek bij "met eigen ogen zien", en dat speelt op dit moment vooral
  bij UI-wijzigingen.
- **Geen nieuwe omgeving.** Een vijfde, permanent draaiende preview-omgeving
  (bijvoorbeeld op `saxombp`) zou een architectuurwijziging zijn — een
  nieuwe rij in `docs/architectuur/stack-otap-en-devops.md` §1, en een
  extra continue dienst op een machine die al drie dingen draait. Expliciet
  afgewezen door de eigenaar (21-08): "geen grote architectuur ingreep".
- **Geen externe/gedeelde toegang.** De preview hoeft alleen door de
  eigenaar zelf, lokaal, bekeken te worden.
- **Geen eigen dataset per preview.** Hergebruik van de bestaande
  demo-database is voldoende; geen behoefte aan isolatie tussen previews.
- **Opstarttijd van een paar minuten is acceptabel** — geen eis tot een
  instant-beschikbare omgeving.

## Ontwerp

Twee gerichte uitbreidingen van het bestaande `scripts/demo-stack.js`, geen
nieuw mechanisme.

### 1. Expliciete branch-parameter: `npm run demo -- --branch <naam>`

**Probleem dat dit oplost:** de frontend-branch werd nooit expliciet gekozen
door het script — het vertrouwde op wat er toevallig in `MCM2-frontend`
stond uitgecheckt.

**Gedrag:**

- Met `--branch <naam>`: het script checkt die branch uit in de
  `MCM2-frontend`-map (`FRONTEND`, al een bekende constante in
  `demo-stack.js`) vóórdat `frontendStarten()` draait. Dit landt als een
  nieuwe stap tussen de bestaande stappen "2/5 Demo-database" en
  "3/5 Backend starten" (of wordt ingebed in een van die stappen — een
  detail voor de implementatie, niet voor dit ontwerp).
- Zonder `--branch`: ongewijzigd gedrag — wat er nu al in `MCM2-frontend`
  staat uitgecheckt, blijft gebruikt worden.
- **Foutafhandeling volgt het bestaande patroon** van de rest van het
  bestand: bestaat de branch niet, of blokkeren ongecommitte wijzigingen de
  checkout, dan stopt het script met een duidelijke reden — net zoals
  `databaseKlaarzetten()` en `backendStarten()` nu al doen.
- **Backend wisselt nooit automatisch mee.** Consistent met de scope
  "voorlopig alleen frontend" (besluit eigenaar 21-08). Het script *meldt*
  wel op welke branch/commit de backend draait (zie punt 3), maar wisselt
  hem niet.

### 2. Altijd tonen welke branch/commit er daadwerkelijk draait

**Probleem dat dit oplost:** zelfs zonder `--branch` moet een mens kunnen
zien wat hij precies bekijkt, zonder dat zelf in git te hoeven opzoeken —
dat voorkomt dezelfde verwarring structureel, niet alleen wanneer `--branch`
gebruikt wordt.

**Gedrag:** in de afsluitende samenvatting die het script al toont (waar nu
"Ingelogd als Sophie van der Berg (admin)" staat), komen twee regels bij:

```
Frontend: feat/154-rondes-groeperen @ 0611302 (VragenlijstGroep-component, uitklapbaar per vragenlijst)
Backend:  main @ 04a97e7 (roadmap-punten omgezet naar issues #153-#162)
```

Gelezen via `git -C <pad> branch --show-current` en
`git -C <pad> log -1 --format=...` in beide repositories — hetzelfde soort
`draai()`-aanroep dat het script al overal gebruikt.

**Als de backend niet op `main` staat:** een waarschuwingsregel erbij (geen
blokkade), bijvoorbeeld "Let op: backend staat niet op main, dit is geen
standaard-previewcombinatie." Dat signaleert precies de situatie van vandaag
zonder het script te laten weigeren — er kunnen legitieme redenen zijn om
ook de backend op een branch te zetten.

### 3. Migratiecontrole/auto-fix bij het opstarten van de demo-database

**Probleem dat dit oplost:** de demo-database kan stilzwijgend achterlopen
op de repo-migraties, zonder enig signaal — precies wat vandaag gebeurde.

**Waar dit landt:** in `databaseKlaarzetten()`, ná `npm run demo:start`
(dat de container zelf opzet) en vóór het script doorgaat naar stap
"3/5 Backend starten".

**Gedrag, stap voor stap:**

1. Migratiestand van de demo-database vergelijken met
   `drizzle/meta/_journal.json` — hergebruik van het bestaande
   `scripts/migratiestand.js --volgens-journal`, geen nieuwe vergelijkingslogica.
2. **Loopt de demo-database achter:** automatisch `scripts/migrate.js --extern`
   draaien tegen de demo-database (rol `clm_migrator`, poort 55450, zoals
   vandaag handmatig gedaan).
3. **Na de migratie opnieuw verifiëren** — de melding van `migrate.js` wordt
   niet vertrouwd, exact de kernregel van dit project ("Migraties voltooid
   is geen bewijs"). Pas als de tweede meting de migratiestand bevestigt
   gelijk aan het journal, gaat het script door.
4. **Faalt de migratie zelf** (bijvoorbeeld door een handmatige wijziging op
   de demo-database die conflicteert): het script stopt met een duidelijke
   reden, in dezelfde stijl als de bestaande foutmeldingen. Geen poging tot
   automatisch herstel bij een echte fout.

**Waarom dit geen architectuurwijziging is:** er komt geen nieuwe
infrastructuur, database of omgeving bij. Het is het toepassen van een
bestaande, al-beproefde controle (vergelijkbaar met wat `verify:omgevingen`
voor acceptatie/staging/productie doet) op een omgeving die er nog geen
had, binnen het bestaande opstartscript.

**Kosten:** een paar extra seconden bij elke `npm run demo`-start voor de
read-only vergelijking; een daadwerkelijke migratie alleen wanneer er
verschil is. Ruim binnen de eerder vastgestelde tolerantie ("een paar
minuten wachten is prima").

## Wat dit niet doet

- Geen wijziging aan `.github/workflows/*` — dit blijft een lokaal
  hulpmiddel, geen CI-stap.
- Geen wijziging aan het OTAP-ketenschema in
  `docs/architectuur/stack-otap-en-devops.md` §3 — de demo-omgeving krijgt
  hierdoor geen officiële plek in die keten (dat zou wél een
  architectuurwijziging zijn, bewust buiten scope).
- Geen wijziging aan het linkmechanisme zelf (`#`-fragment). Het
  afkap-probleem bij het delen van de link is in deze sessie al opgelost
  door de link expliciet in twee delen (basis-URL + token) te geven bij
  het communiceren ervan — geen codewijziging nodig gebleken.

## Bronnen

- Issue [#165](https://github.com/AlingAdvies/MCM2/issues/165)
- `docs/architectuur/stack-otap-en-devops.md` — het OTAP-overzicht waarvan
  dit ontwerp bewust geen nieuwe rij toevoegt
- `scripts/demo-stack.js` — het bestaande mechanisme dat dit ontwerp
  uitbreidt, niet vervangt
- `scripts/migratiestand.js`, `scripts/migrate.js` — hergebruikte,
  bestaande scripts
