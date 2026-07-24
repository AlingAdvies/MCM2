# Context Restructure Plan — MCM2

**Datum:** 2026-07-24
**Branch:** `chore/restructure-project-context`
**Status:** Fase A — analyse en voorstel, wacht op expliciete goedkeuring vóór Fase B.
**Regels tijdens deze fase:** geen productiecode, schema's, migraties, dependencies, Docker/cloudconfiguratie of secrets gewijzigd. Geen `.env` gelezen. Niets verwijderd. Read-only inventarisatie.

---

## 1. Classificatie van de huidige `MCM2-CLAUDE.md` (375 regels)

| Sectie (regels) | Classificatie | Toelichting |
|---|---|---|
| Intro + werkhouding (1-9) | **Actieve permanente instructie** | Rolopvatting, verwijzingen naar globale/workspace-CLAUDE.md. Blijft. |
| Wat is dit project? (12-34) | **Actieve permanente instructie** | Projectdoel, mapverhoudingen, kernprioriteit. Blijft, hoort in de nieuwe compacte versie. |
| Architectuur — beknopt schema (38-73) | **Actieve permanente instructie, met één achterhaald detail** | Lokaal/AWS-schema correct. "Geen AWS-specifieke code vóór Fase 5" is **al eerder in deze sessie gecorrigeerd** naar een expliciete pilot-uitzondering (kleine AWS-acceptatieomgeving) — huidige tekst is al bijgewerkt en consistent met `06-prioritized-roadmap.md`. |
| Authenticatie — Cognito vóór Entra ID (77-85) | **Actieve permanente instructie, ondertussen genuanceerd door P0/P1** | Het besluit zelf (Cognito als federatielaag) staat, maar de architecture review (`08-transdev-mvp-scope.md`, OV-1) introduceerde een tweesporen-aanpak (Spoor A: Cognito+EntraID-spike met `kees@alingadvies.nl`, Spoor B: tijdelijk vereenvoudigd) specifiek voor de Transdev-pilot. Dit is **geen tegenspraak** maar een concretisering — hoort samengevoegd te worden, zie conflict-tabel. |
| Aanvullende AWS-beveiligingsdiensten (89-102) | **Actieve permanente instructie, met prioriteitsnuance** | De zes diensten zelf blijven geldig als toekomstige basislaag. **Conflict:** de roadmap (`06-prioritized-roadmap.md`, PR4) zegt nu expliciet dat deze groep **niet** nodig is vóór de Transdev-pilot — alleen "Before production". De huidige MCM2-CLAUDE.md-tekst ("inbouwen vanaf Fase 0/1, niet uitstellen") is dus **verouderd** t.o.v. de meest recente, expliciete prioritering. Zie conflict-tabel. |
| OTAP-proces (106-123) | **Actieve permanente instructie** | Inclusief de recent toegevoegde aanvullingen (immutable image, geen SSH-patches, geen K8s zonder noodzaak). Blijft. |
| Benodigde tooling (127-141) | **Actieve permanente instructie, met kleine achterhaalde regel** | Tabel noemt nog "Redis (via Docker)" als lokale queue — **achterhaald**, project gebruikt Valkey (zie Versiebeleid-tabel verderop in hetzelfde bestand, die wél correct Valkey noemt). Interne inconsistentie binnen het huidige bestand zelf. |
| Versiebeleid + versietabel + Prisma-generatorinstellingen (145-182) | **Actieve permanente instructie + technische bevinding, beide nog geldig** | Het beleid (altijd verifiëren) blijft. De versietabel is een momentopname die correct als zodanig gelabeld is. De Prisma-generatorinstellingen zijn een concrete, nog geldige technische fix — **maar** relevant alleen als Prisma de gekozen ORM blijft; de architecture review (`04-orm-decision-record.md`) heeft de ORM-keuze **heropend** (spike Prisma 6 vs. Drizzle, nog niet definitief). Dit gedeelte is dus voorwaardelijk geldig, geen vaststaand feit meer. |
| Kruischeck-verplichting (186-206) | **Actieve permanente instructie** | Recent toegevoegd, blijft volledig geldig en actueel. |
| Database-regels 1-6 (210-219) | **Actieve permanente instructie** | Ongewijzigd geldig. |
| Database-regels 7-8 (220-221) | **Actieve permanente instructie, direct voortkomend uit P0-bevindingen** | Regel 7 (tenantcontext nooit blind uit header) en regel 8 (rolscheiding, geen BYPASSRLS) zijn de **directe codificatie van de P0-bevindingen** uit de architecture review. Consistent, geen conflict — wel: dit zijn nu **regels**, terwijl de review ze nog als **openstaande actiepunten** (P0-1, P0-2, database-regel-achtig) beschrijft. De regel zegt "moet zo zijn", de review zegt "is nog niet zo". Beide blijven waar, maar horen in de nieuwe structuur duidelijk als "actieve regel" vs. "nog niet vervulde status" uit elkaar getrokken te worden — dat is precies waar `docs/STATUS.md` voor bedoeld is. |
| Guardrails-checklist (225-239) | **Actieve permanente instructie** | Inclusief de recent toegevoegde stop-en-vraag-drempel en de kruischeck-regel. Blijft. |
| Sessiestatus sessies 1-5 (243-357) | **Historische sessiecontext** | Volledig chronologisch verslag van: WSL2/Docker-installatietraject, databaseverbindings-uitzoekwerk, Prisma 7-versie-audit, de schema-drop-actie, Taak 1-4-uitvoering. Waardevol als naslag, **niet** als actieve instructie — dit leest nu als een dagboek middenin het instructiebestand, precies het probleem dat deze herstructurering oplost. |
| Sessiestart protocol (361-370) | **Actieve permanente instructie, met een achterhaalde verwijzing** | Punt 2 verwijst naar "de sessiestatus hierboven" — na deze herstructurering wordt dat `docs/STATUS.md`, niet een sectie in hetzelfde bestand. Moet worden aangepast in de nieuwe versie. |
| Slotnoot (374) | **Metadata, geen instructie** | Verplaatst mee naar waar dit bestand landt. |

### Wat is vervangen of achterhaald (samenvattend)

1. "Redis (via Docker)" in de Benodigde tooling-tabel — moet Valkey zijn (interne inconsistentie, niet extern veroorzaakt).
2. AWS-beveiligingsdiensten-tekst "inbouwen vanaf Fase 0/1, niet uitstellen" — achterhaald door de expliciete Transdev-pilot-prioritering (Before production, niet Before pilot).
3. Prisma-specifieke generatorinstellingen — technisch nog correct, maar voorwaardelijk aan een ORM-keuze die inmiddels heropend is.
4. Sessiestart-protocolverwijzing naar "sessiestatus hierboven" — moet naar `docs/STATUS.md` wijzen na herstructurering.

### Wat nog als open besluit of risico geldt

- **P0 (kritiek, nog niet opgelost):** runtime-databaserol heeft nog `BYPASSRLS`; tenantcontext komt nog blind uit een client-header. Beide zijn in MCM2-CLAUDE.md al als *regel* vastgelegd (regels 7-8), maar de *status* (nog niet vervuld) staat nergens centraal — dit is precies de leemte die `docs/STATUS.md` vult.
- **P1 (blokkerend besluit, nog niet genomen):** ORM-keuze Prisma 6 vs. Drizzle, spike nog niet uitgevoerd.
- **Open, niet-technisch:** vijf resterende Transdev-klantvragen (OV-4, OV-6 t/m OV-9 uit `08-transdev-mvp-scope.md`) — met name OV-9 (SMTP-details) blokkeert een deel van de roadmap.
- **Bekend, niet-blokkerend:** `mvm-api-pilot/appsettings.Development.json`-wachtwoordlek (ander project, al meermaals genoemd, nooit opgelost).

---

## 2. Voorgestelde doelstructuur

```text
MCM2-CLAUDE.md              — compacte, actuele governanceversie (permanente instructies + verwijzingen)
docs/STATUS.md               — enige actuele operationele waarheid, max ~120 regels
docs/adr/                    — alleen reeds genomen, nog geldige besluiten als ADR
docs/architecture-review/    — ongewijzigd, blijft staan zoals het is
docs/runbooks/                — nog leeg; eerste concrete runbooks volgen zodra de bijbehorende functionaliteit bestaat
docs/archive/                — MCM2-CLAUDE-2026-07-24-pre-restructure.md (volledige huidige inhoud, gemarkeerd)
docs/context/                — PROJECT-HISTORY-2026-07-24.md (compacte, gelabelde samenvatting van sessiegeschiedenis)
```

`docs/superpowers/` blijft ongewijzigd staan (plannen/specs van vóór deze herstructurering) — geen onderdeel van deze opdracht om te verplaatsen.

---

## 3. Concrete verplaatsings- en behoudlijst

**Blijft ongewijzigd, geen actie:**
- `docs/architecture-review/2026-07-24/*.md` (alle tien documenten)
- `docs/superpowers/plans/2026-07-24-fase0-skeleton-vendors.md`
- `docs/superpowers/specs/2026-07-24-fase0-skeleton-vendors-design.md`
- `docs/superpowers/specs/2026-07-24-techstack-evaluatie-drizzle.md` (blijft staan als historisch document — de architecture review heeft de daarin gedane Drizzle-aanbeveling al inhoudelijk herzien/genuanceerd, dit bestand zelf hoeft niet verwijderd, wel is het overtuigingskracht-niveau er dus lager dan bij eerste lezing lijkt)
- `README.md` (nog ongewijzigde NestJS-boilerplate — buiten scope van deze contextherstructurering, wel een aparte bevinding waard: dit bestand bevat nul projectspecifieke inhoud)
- `claude_master.md` (de opdrachtinstructie die tot de architecture review leidde — blijft in de repository-root staan als herkomstdocument van die opdracht, geen onderdeel van deze herstructurering om te verplaatsen tenzij expliciet gevraagd)

**Gaat naar `docs/archive/`:**
- Volledige huidige inhoud van `MCM2-CLAUDE.md` → `docs/archive/MCM2-CLAUDE-2026-07-24-pre-restructure.md`, met de gevraagde waarschuwing bovenaan.

**Gaat naar `docs/context/`:**
- Sessiestatus sessies 1 t/m 5 (regels 243-357 van het huidige bestand) → samengevat en gelabeld in `docs/context/PROJECT-HISTORY-2026-07-24.md`. Concreet, met labels:
  - `Historisch feit`: WSL2/Docker-installatietraject, databaseverbindings-uitzoekwerk (welke Supabase-projectref/rol), de schema-drop-actie (met bevestiging dat dit bewust en toegestaan gebeurde), Taak 1-4-uitvoeringsstatus.
  - `Vervangen besluit`: "Prisma ORM gekozen, niet Drizzle/Kysely" (sessiestatus sessie 0/1) — vervangen door de heropende ORM-vraag in de architecture review.
  - `Nog te verifiëren`: of `mvm-api-pilot/appsettings.Development.json` al dan niet in een eerdere git-commit heeft gestaan (genoemd als "nog te verifiëren" in de huidige tekst zelf).
  - `Open risico`: het genoemde wachtwoordlek zelf; de P0-bevindingen (rolbypassrls, blinde tenantheader).
  - `Actuele verwijzing`: waar de opvolging van elk punt nu daadwerkelijk staat (`docs/architecture-review/2026-07-24/06-prioritized-roadmap.md` voor P0/P1, `08-transdev-mvp-scope.md` voor de Transdev-scope).

**Komt (samengevat) in `docs/STATUS.md`:**
- P0-status (rol-koppeling nog niet uitgevoerd, tenantcontext nog blind).
- P1-status (ORM-spike nog niet uitgevoerd).
- Transdev als eerste concrete MVP-doel, met de vijf nog openstaande klantvragen.
- Huidige branch/git-status op het moment van schrijven.
- Verwijzingen naar architecture review, ADR's, runbooks (nog leeg), en het historische contextdocument.

**Wordt ADR (alleen reeds genomen, nog geldige besluiten — geen ORM-keuze, die is nog niet definitief):**
- ADR: Backendtaal/framework (TypeScript/NestJS) — al vastgesteld, niet heroverwogen in de review.
- ADR: Database (Supabase `clm-enterprise`, hergebruikt bestaand project) — al vastgesteld, met een openstaand controlepunt (backup/tier-verificatie) dat in `docs/STATUS.md` als open item hoort, niet in de ADR zelf als onopgelost besluit.
- ADR: Multi-schema-indeling (`clm`/`ref`/`audit`) — al vastgesteld.
- ADR: Valkey i.p.v. Redis — al vastgesteld en geïmplementeerd.
- ADR: Node.js 24 als versie — al vastgesteld en geïmplementeerd.
- ADR: Cognito als federatielaag vóór Entra ID — al vastgesteld als principe; **de concrete Spoor A/B-uitvoering voor de Transdev-pilot is nog niet afgerond** en hoort dus niet als "Accepted, klaar" maar als "Accepted principe, uitvoering in behandeling" — subtiel onderscheid, verduidelijken in de ADR-tekst zelf, niet negeren.
- **Nadrukkelijk geen ADR voor:** de ORM-keuze (Prisma 6 vs. Drizzle) — dit is precies wat de opdracht verbiedt ("maak geen ADR waarin een nog niet genomen ORM-keuze als definitief wordt vastgelegd"), en terecht: de spike moet nog gebeuren.

---

## 4. Conflicttabel

| Onderwerp | Oude instructie/context | Actuele bevinding | Voorgestelde actieve waarheid | Actie |
|---|---|---|---|---|
| Lokale queue-technologie | `MCM2-CLAUDE.md` "Benodigde tooling"-tabel noemt "Redis (via Docker)" | Versiebeleid-tabel in hetzelfde bestand én `docker-compose.yml` gebruiken al `valkey/valkey:8.1-alpine` | Valkey is de enige juiste term, overal | Corrigeer de tooling-tabel in de nieuwe `MCM2-CLAUDE.md` |
| AWS-beveiligingsdiensten-timing | "inbouwen vanaf Fase 0/1, niet uitstellen tot vlak vóór Fase 5" | `06-prioritized-roadmap.md` PR4: expliciet "Before production", **niet** nodig vóór de Transdev-pilot | Groep 1-diensten blijven de vaste basislaag vóór *volledige productie*, maar zijn expliciet **niet** een Before-pilot-vereiste | Herformuleer in de nieuwe `MCM2-CLAUDE.md`: onderscheid "vaste basislaag richting productie" vs. "niet nodig voor de pilot zelf" |
| Cognito-uitvoering | "authenticatie (Fase 2) bouwen tegen AWS Cognito" als vaststaand, ongeclausuleerd besluit | `08-transdev-mvp-scope.md`: tweesporenontwerp (Spoor A: Cognito+EntraID-spike, Spoor B: tijdelijk vereenvoudigd met einddatum), BP0/BP3 in de roadmap nog niet uitgevoerd | Cognito blijft het architectuurprincipe (ADR), maar de concrete uitvoeringsstatus (welk spoor, is de spike al gedaan) hoort in `docs/STATUS.md`, niet als afgerond feit in de governance-tekst | Nieuwe `MCM2-CLAUDE.md` verwijst naar het principe + `docs/STATUS.md` voor actuele voortgang |
| ORM-keuze | Sessiestatus/design-spec: "Prisma ORM gekozen... expliciet omdat..." als afgerond besluit; latere Prisma 7-generatorinstellingen als "noodzakelijk, niet optioneel" | `04-orm-decision-record.md`: keuze expliciet heropend, spike Prisma 6 vs. Drizzle nog uit te voeren, geen definitieve keuze | Geen ORM-keuze is momenteel definitief — dit hoort als open P1-item in `docs/STATUS.md`, niet als afgerond besluit in `MCM2-CLAUDE.md` of als ADR | Prisma-specifieke technische instellingen verhuizen naar `docs/context/` (historisch/voorwaardelijk), niet naar de actieve governance-tekst |
| Tenantcontext- en rolscheidingsregels | Database-regels 7-8 in `MCM2-CLAUDE.md` beschrijven de **vereiste**, alsof het een geldende regel is die nageleefd wordt | `03-data-security-and-rls.md` en `06-prioritized-roadmap.md` (P0-1/P0-2): **nog niet vervuld**, actief risico | De regel (wat hoort te gebeuren) blijft in `MCM2-CLAUDE.md`; de status (nog niet vervuld) hoort expliciet in `docs/STATUS.md` onder "Actieve blokkades", niet stilzwijgend verondersteld als al opgelost | Beide bestanden moeten elkaar aanvullen, niet overlappen — regel in CLAUDE.md, status in STATUS.md |
| Databasebackup/-tier | `MCM2-CLAUDE.md` noemt Supabase als database zonder voorbehoud | `06-prioritized-roadmap.md` PR2: backup/restore nog nooit getest, tier/garanties nog niet bevestigd | Database-keuze zelf is een geldig ADR; het openstaande controlepunt (backup-tier-verificatie) hoort als item in `docs/STATUS.md`, niet verzwegen | ADR voor databasekeuze expliciet vermelden met een "openstaand controlepunt"-regel |
| Sessiestart-protocolverwijzing | Verwijst naar "de sessiestatus hierboven" (in hetzelfde bestand) | Na herstructurering bestaat die sectie niet meer in `MCM2-CLAUDE.md` | Verwijzing moet naar `docs/STATUS.md` wijzen | Aanpassen in de nieuwe governanceversie |

---

## 5. Afsluitend

**Wat er aantoonbaar al werkt:**
- NestJS-skeleton, health-check-endpoint (Taak 1-2), gecommit en getest.
- Docker Compose-stack (api + minio + valkey) draait, health-check via Docker geverifieerd.
- Eerste Prisma-schema en migratie (4 modellen) uitgevoerd tegen de Supabase-database, inclusief RLS-policies (correct opgesteld, maar zie hieronder — niet effectief door de rolkeuze) en seed-data.
- WSL2 en Docker Desktop werken op de ontwikkelmachine.

**Wat geblokkeerd is:**
- P0: de runtime-databaseverbinding gebruikt nog de Supabase `postgres`-superuser-rol (`rolbypassrls: true`) — RLS is hierdoor momenteel geen werkende beveiligingsgrens, ongeacht hoe correct de policies zelf zijn.
- P0: `TenantMiddleware` leidt de tenant nog blind af uit een client-header, zonder identiteitsverificatie.
- P1: ORM-keuze (Prisma 6 vs. Drizzle) niet definitief; Prisma 7 zelf heeft een bevestigd, structureel Jest/Docker-buildconflict.
- Vijf resterende Transdev-klantvragen (OV-4, OV-6 t/m OV-9), met OV-9 (SMTP-details) als expliciet "volgt nog".
- Geen `.github/workflows/` — geen enkele CI-kwaliteitspoort is nu geautomatiseerd actief.

**Welke informatie historisch waardevol blijft:**
- Het volledige WSL2/Docker-installatietraject (root cause + oplossing) — waardevol als een vergelijkbaar probleem zich ooit herhaalt.
- De exacte Supabase-projectref/rol-uitzoekgeschiedenis (`ClmConnection` vs. `DefaultConnection`) — voorkomt dat dit uitzoekwerk ooit opnieuw gedaan moet worden.
- De volledige Prisma 7-breaking-change-geschiedenis (generator-instellingen, WASM/Jest-conflict) — essentieel als bewijs/onderbouwing mocht de ORM-spike alsnog voor Prisma 6 kiezen in plaats van Drizzle, of als een toekomstige Prisma-upgrade weer tegen iets vergelijkbaars aanloopt.
- De schema-drop-beslissing (bevestigd, toegestaan, met de exacte SQL) — bewijs dat dit weloverwogen en met expliciete toestemming gebeurde, niet per ongeluk.

**Drie besluiten of bevestigingen die ik nu nodig heb van jou:**
1. **Akkoord op de voorgestelde doelstructuur** (mappen, welke bestanden waarheen) zoals hierboven beschreven, of aanpassingen daarop vóór ik verder ga.
2. **Akkoord op de conflicttabel-oplossingen** — met name: ga je akkoord dat de Prisma-specifieke technische instellingen naar `docs/context/` verhuizen (historisch/voorwaardelijk) in plaats van in de actieve `MCM2-CLAUDE.md` te blijven staan, gezien de ORM-keuze nog open is?
3. **Bevestiging dat ik in Fase B uitsluitend de door jou geplakte governance-tekst als nieuwe `MCM2-CLAUDE.md`-inhoud gebruik** (stap 6 van de opdracht noemt dat die tekst "hieronder" zou volgen — die heb ik in dit bericht nog niet ontvangen; graag bevestigen of/wanneer die nog komt, anders kan Fase B stap 6 niet worden uitgevoerd).
