# Gap-analyse MVM_V2 vs. MCM2

> Vastgelegd 2026-08-23, bij issue #178. Methode: MVM_V2 lokaal gedraaid
> (mock data, poort 3000), 15 schermen bezocht en gefotografeerd met
> Playwright, screenshots gelezen als afbeelding. Broncode van beide
> projecten gelezen voor structuur/logica. Elke bevinding hieronder is
> gebaseerd op wat daadwerkelijk gezien is — geen aannames over MVM_V2's
> gedrag zonder het scherm gezien te hebben.

## Leeswijzer

Per gap: **wat MVM_V2 doet** → **wat MCM2 (nog) niet doet** → **waarom het
intuïtiever/logischer voelt** → **haalbaarheid binnen de huidige
MCM2-stack** (NestJS/Drizzle/Postgres+RLS, multi-tenant, echte backend —
zie `mcm2-mvm-v2-als-bron`-memory: MVM_V2 draait op mock data, dus niet
alles is 1-op-1 over te nemen).

Haalbaarheid wordt beoordeeld op drie niveaus, conform
`c:\dev\CLAUDE.md`'s drie-laags klantaanpassing-denkwijze toegepast op
"hoeveel nieuw werk":
- **Klein** — nieuwe kolom(men) + bestaand patroon herhalen (dagen)
- **Middel** — nieuwe tabel(len) + nieuwe route(s) + nieuw scherm (een sprint)
- **Groot** — nieuw subsysteem, mogelijk externe afhankelijkheid (AI-model,
  documentopslag) — eigen project

---

## Besluiten van de eigenaar (23-08, na eerste lezing)

Vastgelegd zodat ze niet opnieuw gesteld worden. Verwerkt in de secties
hieronder en in de prioriteitentabel.

| Gap | Besluit |
|---|---|
| §9 Granulaire rolmatrix | Later — bevestigd, geen concreet scenario met 3+ rollen nu. |
| §3 Interne leveranciersbeoordeling | **Haalbaarheid herzien: Middel, niet Groot.** Als dit met een tokenlink werkt — de interne Transdev-beoordelaars hoeven **geen** tenant-gebruiker/Entra-account te zijn — hergebruikt dit het bestaande, al gebouwde tokenmechanisme (issue #8) in plaats van een nieuw permissiemodel te vergen. Zie herziene paragraaf hieronder. |
| §6 AI Document Interrogation | Later — bevestigd. |
| §2 Contract 360 / CATS-levenscyclus | De levenscyclus-balk (Initiatie/Implementatie/Uitvoering/Monitoring/Beëindiging) is een **nice-to-have**, niet nu nodig. Kerngegevens + gerelateerde contracten (zonder de fase-balk) blijven wel de moeite waard — zie herziene paragraaf. |
| §4b Certificeringen-sectie | **Scope bevestigd en verbreed.** Vendor IT hangt samen met NIS2-certificering; de verwachting is dat andere normen (ISO27001, BIO, VCA, …) ook tot bewaking én een eigen "survey" gaan leiden, onder verantwoordelijkheid van de contractbeheerder — niet alleen een statusveld maar een eigen bewakings-/beoordelingsstroom per norm. Dit maakt §4b zwaarder dan oorspronkelijk ingeschat; zie herziene paragraaf. |

**Open vraag van de eigenaar, apart behandeld:** hoe verhoudt deze roadmap
zich tot de korte-termijn pilot (een beperkt aantal Transdev-medewerkers en
hun leveranciers zien de app voor het eerst)? Dat is een andere toets dan
"is dit uiteindelijk de juiste richting" — zie
**`docs/architectuur/pilot-versus-roadmap.md`** voor die afweging. De
roadmap-issues in dit document zijn niet automatisch pilot-issues, en
omgekeerd.

---

## 1. Dashboard — ontbreekt volledig in MCM2

**MVM_V2:** `/dashboard` toont vier KPI-tegels (aantal leveranciers,
compliance-percentage, contracten verlopend, gemiddelde risicoscore), een
compacte leveranciers-compliancetabel, een "Contracten verlopend"-widget
met dagen-tot-verlopen (rood bij urgent, oranje bij naderend), en een
"Compliance Verdeling"-balkendiagram.

**MCM2:** geen dashboard-route. De beheerder landt na inloggen direct op
de leverancierslijst.

**Waarom het intuïtiever voelt:** een beheerder met tientallen leveranciers
wil bij het inloggen eerst weten *waar de aandacht nu naartoe moet*, niet
door een lijst scrollen om dat zelf te ontdekken. Dit is precies het
overkoepelende beeld dat vandaag ontbreekt — de contract-waarschuwing
(#174) berekent nu per contract of het aandacht nodig heeft, maar niets
telt dat tenant-breed op.

**Haalbaarheid: Middel.** De bouwstenen bestaan al:
`berekenContractWaarschuwing` (frontend, #174) levert per contract een
staat; de backend heeft `ContractSamenvatting` met `endDate`,
`noticePeriodDays`, `warningDaysBefore` al beschikbaar via de contractenlijst-
route. Een dashboard-scherm zou een nieuwe aggregatie-route nodig hebben
(`GET /dashboard` of hergebruik van bestaande lijst-routes met
client-side telling) plus een nieuw scherm met vier tegels en een
contracten-verlopend-widget. Geen nieuwe tabellen nodig. Risicoscore en
compliance-percentage per leverancier bestaan in MCM2 nog niet als concept
(zie §7) — die twee tegels zouden bij een eerste versie wegvallen of
vervangen worden door wat al gemeten wordt (bijv. aantal open
vragenlijsten, aantal wachtlijst-items).

---

## 2. Contract 360 — losse detailpagina per contract

**MVM_V2:** `/contracts/[id]` is een rijk overzicht: laatste/volgend
overleg met actiepunten, openstaande issues met een "Issue melden"-knop,
leveranciersbeoordeling (score + subscores als balkjes), compliance &
kaders (NIS2/ISO27001-status), gerelateerde contracten, een
levenscyclus-balk (Initiatie → Implementatie → Uitvoering → Monitoring →
Beëindiging, huidige fase gemarkeerd), kerngegevens (type, regime,
overeenkomsttype, domein), omschrijving, documenten.

**MCM2:** contracten hebben geen eigen pagina. Ze zijn een uitklapbare rij
binnen `/beheer/leveranciers/[id]` (Contracten.tsx) — alleen de
kerngegevens (naam, status, looptijd, opzegtermijn-waarschuwing,
contractbeheerder).

**Waarom het intuïtiever voelt:** de gebruiker noemde dit scherm zelf
expliciet tijdens de brainstorm over de leveranciersscherm-dichtheid:
*"dat is een zeer krachtig scherm waar gebruikers van gaan houden."* Een
contract is vaak het ding waar een beheerder concreet over nadenkt (loopt
dit af, is er een issue, wanneer was het laatste overleg) — niet de
leverancier als geheel. Een eigen pagina geeft ruimte voor die diepte
zonder de leverancierspagina te verdrukken.

**Haalbaarheid: Middel tot Groot, gefaseerd.** Dit is al vastgelegd als
apart issue (#173). Kerngegevens zijn **Klein**: een nieuwe route
`/contracten/[id]`, hergebruik van bestaande contract-service-data. Overleg-
log, issues, documenten en leveranciersbeoordeling zijn elk **Middel**:
nieuwe tabellen (`contract_overleg`, `contract_issue`, geen
documentopslag-infrastructuur vandaag — zie §6). Aanrader: eerst
kerngegevens + gerelateerde contracten bouwen (hergebruikt bestaande data),
overleg/issues/documenten als losse vervolgissues.

> **Besluit 23-08: de levenscyclus-balk (CATS-fases) is een nice-to-have,
> niet nu nodig.** De `cats_phase`-kolom en de fase-balk zelf vervallen uit
> de eerste versie van Contract 360 — dat scheelt een nieuw enum-concept
> zonder dat het de kerngegevens-pagina blokkeert.

---

## 3. Interne leveranciersbeoordeling ("Survey") — ander concept dan MCM2's vragenlijst

**MVM_V2:** `/surveys` is een **interne** beoordelingsronde: collega's
(niet de leverancier) beoordelen een leverancier op een vragenlijst met
categorieën, subscores en een NPS-vraag. Respondenten zijn
"Platformgebruiker" (interne collega's) of externen via tokenlink. Los
daarvan bestaat `/questionnaires` (label "Controls" in de navigatie) —
dat is de compliance-vragenlijst die *naar* de leverancier gestuurd wordt
(framework-gebonden: NIS2, ISO27001), met status verstuurd/in
behandeling/ingediend/verlopen.

**MCM2:** heeft alleen het tweede concept — de vragenlijst die naar de
leverancier gaat (`clm.survey_*`-tabellen, `/beheer/vragenlijsten`). Er is
geen intern-beoordelen-concept.

**Waarom dit een precieze, geen oppervlakkige, gap is:** het is verleidelijk
om "survey" in MVM_V2 te lezen als hetzelfde als MCM2's "vragenlijst" —
dat zijn twee verschillende dingen met een overlappende naam. MVM_V2 houdt
ze bewust in aparte navigatie-items (Survey vs. Controls) omdat de
respondent en het doel verschillen: intern oordeel over
leveranciersprestatie versus extern bewijs van compliance.

**Haalbaarheid: Middel (herzien 23-08, was Groot).** De oorspronkelijke
inschatting ging ervan uit dat interne beoordelaars als tenant-gebruiker
zouden inloggen (MVM_V2's "Platformgebruiker"-optie) — dat vergt een nieuw
stuk rechtenmodel. De eigenaar heeft dit gecorrigeerd: de Transdev-
collega's die de beoordeling uitvoeren **hoeven geen gebruiker in de
tenant te zijn**. Met een tokenlink-only aanpak (net als de bestaande
vragenlijst-flow) hergebruikt dit het al gebouwde, tijdgebonden en
niet-raadbare tokenmechanisme (issue #8) in plaats van een nieuw
permissiemodel te vergen. Dat verlaagt de zwaarte aanzienlijk: het blijft
een nieuw subsysteem — geen uitbreiding van `clm.survey_*`, want die
tabellen zijn ingericht op "vragenlijst naar de leverancier", niet
"collega's beoordelen leverancier op score-schaal met subcategorieën en
NPS" — maar wel eigen tabellen (`vendor_review_round`,
`vendor_review_response`, `vendor_review_score`) die het bestaande
tokenpatroon volgen in plaats van een nieuw toegangsconcept.

---

## 4. Leveranciersdetail — rijkere structuur

**MVM_V2:** `/vendors/[id]` toont bovenaan een "Open taken"-widget (3
taken, 2 verlopen), dan twee kolommen: compact links (KvK, website,
eigenaar, hoofdcontactpersoon met directe "Bewerken"-knop, jaarlijkse
spend, aantal contracten, reviewdata, vrije tags), breed rechts
(certificeringen-tabel met status, contracten-tabel met status-badges als
"Nadert einde", documentvereisten, beveiligingsoverleg-sectie).

**MCM2:** na de leveranciersscherm-dichtheid-feature (23-08): badge-strip
+ stamgegevens + classificatiebadges + contactpersonen (linkerkolom),
contracten (rechterkolom). Geen open-taken-widget, geen
certificeringen-sectie, geen vrije tags, geen jaarlijkse spend-veld, geen
beveiligingsoverleg-sectie.

**Waarom het intuïtiever voelt:** "Open taken" bovenaan geeft direct een
actie-gerichte ingang — niet alleen "hier is de data" maar "hier is wat je
nu moet doen". Certificeringen als eigen sectie (met eigen
vervalbewaking, los van contracten) erkent dat een leverancier
certificaten kan hebben die niet aan één specifiek contract hangen.

**Haalbaarheid, per element:**
- **Vrije tags**: **Klein**. `clm.vendor_tag` bestaat al als tabel in
  MCM2's schema — dit lijkt al deels gebouwd of voorbereid; verifiëren of
  hij al gebruikt wordt voordat er iets nieuws bijkomt.
- **Jaarlijkse spend, KvK, website**: **Klein**. Nieuwe kolommen op
  `clm.vendor`, geen nieuwe tabel.
- **Certificeringen-sectie**: **Middel, scope verbreed (besluit 23-08)**.
  Vendor IT hangt samen met NIS2-certificering, en de verwachting is dat
  andere normen (ISO27001, BIO, VCA, …) hetzelfde patroon gaan volgen: niet
  alleen een statusveld, maar een eigen bewakings- én beoordelingsstroom
  per norm, onder verantwoordelijkheid van de contractbeheerder. Dat is
  inhoudelijk dichter bij §3 (interne beoordeling, tokenlink-gedreven) dan
  bij een simpel "status + vervaldatum"-veld — een certificering per norm
  kan zelf weer een "survey" nodig hebben (bijv. een periodieke controle-
  vragenlijst per certificeringstype). Eerste versie: nieuwe tabel
  (`vendor_certification`: norm, status, vervaldatum), eigen vervalbewaking
  analoog aan `contractWaarschuwing.ts` (herbruikbaar patroon). De
  koppeling met een norm-specifieke bewakings-/surveystroom is een
  vervolgstap, niet iets voor de eerste versie.
- **Open taken-widget**: **Groot** — vergt een taken-concept dat vandaag
  nergens in MCM2 bestaat (geen `task`-tabel, geen toewijzing, geen
  status). Zou een eigen mini-project zijn, niet een velduitbreiding.
- **Beveiligingsoverleg-sectie**: overlapt met de "overleg"-sectie in
  Contract 360 (§2) — als daar een generiek overleg-concept gebouwd wordt,
  is een leverancier-brede overlegsectie een kleine uitbreiding daarop
  in plaats van een apart concept.

---

## 5. Contractenlijst — rijkere per-rij informatie en eigen navigatie-item

**MVM_V2:** `/contracts` toont een eigen navigatie-item (naast
Leveranciers), 29 contracten met een portefeuille-totaal bovenaan
(€24.7M/jaar), een Lijst/Tijdlijn-toggle, filters op zowel status als
CATS-levenscyclusfase, en per rij direct "861d resterend" / "54d
verlopen" zonder dat de rij eerst uitgeklapt hoeft te worden.

**MCM2:** contracten hebben geen eigen navigatie-item — ze zijn alleen
bereikbaar via een leverancier. De contractrij toont de
waarschuwingsindicator nu al inline (sinds #174), maar er is geen
tenant-brede contractenlijst, geen portefeuille-totaal, geen Tijdlijn-
weergave.

**Waarom het intuïtiever voelt:** een contractbeheerder denkt vaak in
"welke contracten lopen af" over de hele portefeuille, niet leverancier
voor leverancier. Dit is al vastgelegd uit "21 augustus II" (#171,
#172) als openstaand punt — deze analyse bevestigt het vanuit een tweede
hoek.

**Haalbaarheid: Klein tot Middel.** De contract-service heeft de data al
(`lijst()` haalt nu al `endDate`, `noticePeriodDays`, `warningDaysBefore`
per contract op voor één leverancier); een tenant-brede route is een
kleine uitbreiding — weglaten van het `vendorId`-filter, wel RLS-
tenantscope behouden (die geldt toch al via `withTenant()`). Het scherm
zelf (lijst + filters) is **Middel**. De Tijdlijn-weergave (Gantt-achtig)
is een apart, kleiner stukje UI-werk bovenop een werkende lijst — kan
uitgesteld.

---

## 6. AI Document Interrogation — nieuw subsysteem, hoogste realisatiedrempel

**MVM_V2:** `/ai-interrogation` laat de gebruiker vragen stellen aan
geïndexeerde contractdocumenten ("Wat is de opzegtermijn van dit
contract?"), met antwoord + brondocument + paginanummer. Voorbeeldvragen
staan als knoppen klaar. Het scherm toont expliciet "AI-model: mock
(POC)" — dit is in MVM_V2 zelf ook nog een proof-of-concept, geen
productierijpe functie.

**MCM2:** geen documentopslag, geen AI-integratie, geen
documentenmodel überhaupt.

**Waarom het krachtig zou zijn, maar met een kanttekening:** dit lost een
reëel probleem op — contracten zijn vaak lange PDF's, en "wat staat er
ook alweer over de boeteclausule" is een veelvoorkomende vraag. Maar dit
is het enige scherm in deze analyse waar MVM_V2 zelf óók nog mock/POC is;
het is geen bewezen patroon om over te nemen, het is een richting om zelf
te valideren.

**Haalbaarheid: Groot, met externe afhankelijkheid.** Vergt: documenten-
opslag (welke — lokaal, S3-compatibel, gezien §0 van MCM2-CLAUDE.md
richting AWS: **S3 zou hier het eerste concrete stuk AWS-infrastructuur
zijn dat de applicatie zelf nodig heeft**, niet alleen hosting), een
indexeer-pipeline, en een AI-provider-integratie (MVM_V2's
instellingenscherm toont zelf al `anthropic` als voorkeursprovider — een
aanwijzing, geen vereiste). Dit hoort niet bij een sprint maar bij een
eigen project met eigen brainstorm, ná dat de kernfunctionaliteit
(contracten, vragenlijsten, dashboard) staat.

---

## 7. Compliance-score en risicoscore per leverancier

**MVM_V2:** dashboard en leveranciersdetail tonen een compliance-
percentage en een risicoscore-cirkel per leverancier — een berekend,
samengesteld cijfer.

**MCM2:** heeft `ref.compliance_status` en `ref.business_criticality` als
losse classificatie-badges (zichtbaar sinds de leveranciersscherm-
dichtheid-feature), maar geen samengesteld score-cijfer.

**Waarom het intuïtiever voelt:** één cijfer is sneller te scannen dan
meerdere losse badges wanneer je door tientallen leveranciers moet.

**Haalbaarheid: Middel, maar met een ontwerpvraag eerst.** Technisch is
een berekend veld niet zwaar (Klein qua code), maar *wat* het cijfer
betekent — welke factoren wegen mee, hoe hard mag het zijn — is een
inhoudelijke vraag die eerst met de eigenaar besproken moet worden. Gezien
het principe dat al vastligt in `docs/architectuur/ui-beslissingen.md`
("waarschuwen, niet blokkeren" — de tool is een hulpmiddel voor een
zelfstandig werkende professional), is een hard risicocijfer een groter
risico op "te hard afgedwongen" dan een reeks losse indicatoren. Eerst
een aparte brainstorm waard, geen automatische overname.

---

## 8. Instellingenscherm — tenant-configuratie zichtbaar en bewerkbaar

**MVM_V2:** `/settings` toont AI-instellingen, compliance-drempelwaarden
(cert. verloopwaarschuwing: 60 dagen, **contract verloopwaarschuwing: 90
dagen** — exact de default die MCM2 net in #174 gekozen heeft, hier
bevestigd als hetzelfde patroon in een ander project), actieve regulatoire
kaders (NIS2/AVG/ISO27001/BIO/VCA als los beheerbare tags), contract-
domeinlabels (ICT/Voertuigen/Laadinfrastructuur/Facilitair — beheerbaar
door Tenant Admin), vendor-portal-instellingen (tokengeldigheid, max
bestandsgrootte, toegestane bestandstypen).

**MCM2:** geen instellingenscherm. Drempelwaarden als `warningDaysBefore`
zijn per-contract instelbaar (met vaste default 90), maar er is geen
tenant-breed configuratiescherm om die default zelf te wijzigen, of om
frameworks/domeinlabels te beheren.

**Waarom het intuïtiever voelt:** dit is precies het niveau 1
("Configuratie — labels, drempelwaarden, frameworks") uit `c:\dev\CLAUDE.md`'s
drie-laags klantaanpassing — MVM_V2 laat zien hoe dat er in de UI uitziet
voor de eindgebruiker, niet alleen als iets dat een ontwikkelaar in een
configbestand zet.

**Haalbaarheid: Middel.** De losse velden bestaan grotendeels al
(warningDaysBefore is per contract, niet tenant-breed — dat zou een
nieuwe tenant-instellingentabel of -kolom vergen). Domeinlabels zouden
`ref.vendor_category`-achtig ingericht kunnen worden maar dan
tenant-specifiek beheerbaar in plaats van vaste referentiedata. Dit
scherm heeft weinig technische complexiteit maar raakt meerdere
bestaande concepten tegelijk — het is een verzamelscherm, geen nieuw
subsysteem.

---

## 9. Gebruikersbeheer — granulaire, per-actie rolmatrix

**MVM_V2:** `/admin/users` toont niet alleen een gebruikerslijst met rol,
maar ook een expliciete rolbevoegdheden-matrix (welke van de vier rollen
— Vraageigenaar, Contractmanager, Realisatie/verificatiemanager,
Contractbeheerder — welke actie mag: leveranciers bekijken/aanmaken/
bewerken/verwijderen, contracten bekijken/aanmaken, etc.).

**MCM2:** `src/auth/rol.guard.ts` werkt met één vlakke `role`-string per
sessie (`sessie.role !== vereist`), gecontroleerd per route via
`@VereistRol('...')`. Geen zichtbare matrix, geen per-actie granulariteit
binnen één rol — een rol staat een route toe of niet.

**Waarom het intuïtiever voelt:** de matrix maakt zichtbaar wat een rol
mag zonder dat de beheerder het per scherm moet uitproberen — vooral
waardevol zodra er meer dan twee rollen zijn (vandaag: platformbeheerder
+ tenant-beheerder-achtig, straks mogelijk meer).

**Haalbaarheid: Groot als volledige matrix, Klein als het blijft bij wat
er is.** MCM2's huidige model (één rol per route) is een bewuste, eenvoudige
keuze die tot nu toe volstaat. Een volledige actie-matrix zoals MVM_V2
vergt een herontwerp van `RolGuard` naar een permissie-systeem
(rol → set van acties, niet rol → wel/niet-toegang tot route). Dat is
een architectuurwijziging, geen los scherm — alleen de moeite waard als
er een concreet scenario is met meer dan de huidige twee rollen (bijv.
een "alleen-lezen"-rol, of de eerder genoemde accountmanager-over-alle-
contracten-rol uit de leveranciersscherm-dichtheid-sessie).

> **Besluit 23-08: later.** Bevestigd door de eigenaar — geen concreet
> scenario met 3+ rollen op dit moment.

---

## 10. Landingpagina na Entra-login — geen MVM_V2-vergelijking, eigen punt

**Toegevoegd 27-08** op verzoek van de eigenaar, geen bevinding uit de
MVM_V2-vergelijking (die dit document verder methodisch draagt) maar een
eigen MCM2-punt: na een geslaagde Entra External ID-login komt de
gebruiker nu op wat de eerste route toevallig oplevert, niet op een
bewust gekozen landingpagina die past bij de rol (platformbeheerder,
tenant-admin, medewerker, support-sessie).

**Haalbaarheid: Klein–Middel.** De sessie kent de rol al
(`sessie.rol`/`isPlatformbeheerder`, zie `@/core/auth/rechten.ts`) —
het gaat om een routeringsbeslissing direct na login, geen nieuw
databaseconcept. Raakt mogelijk ook de net gebouwde
platformbeheer-uitbreiding: een support-sessie landt nu default op
`/beheer/platform` (zie `mcm2-diagnosemethode-niet-verzinnen`-sessie,
27-08) — een aparte, rolbewuste landingpagina zou dat kunnen vervangen
door een consistentere regel voor alle rollen tegelijk.

---

## 11. Gebruikshandleidingen voor tenant-admins en tenant-gebruikers

**Toegevoegd 27-08**, eigen MCM2-punt, geen MVM_V2-vergelijking. Er
bestaat geen documentatie voor de mensen die de applicatie daadwerkelijk
gebruiken (tenant-admins, medewerkers) — alle bestaande documentatie
(`docs/`) is ontwikkelaars- of eigenaargericht. Wordt actueel zodra de
pilot draait: Transdev-medewerkers en later andere tenants hebben iets
nodig om zelfstandig te kunnen werken, zonder dat de eigenaar het
voordoet.

**Twee te schrijven handleidingen, verschillende doelgroep:**
- **Tenant-admin:** leden uitnodigen/beheren, tenant-instellingen,
  vragenlijsten uitsturen, rapportage lezen.
- **Tenant-gebruiker (medewerker/beoordelaar):** dagelijks gebruik —
  leveranciers/contracten bekijken, beoordelingen doen, wat een
  "goedkeuren" precies betekent.

**Haalbaarheid: Klein**, maar geen codewerk — dit is documentatie, geen
implementatietaak. Raakt wel §10 hierboven: een handleiding is makkelijker
te schrijven zodra er een vaste landingpagina/navigatiestructuur per rol
ligt, dus logische volgorde is §10 eerst.

---

## Samenvattend prioriteitenoverzicht

**Bijgewerkt 23-08** na de besluiten van de eigenaar (zie boven). Kolom
"Wijziging" toont alleen de rijen waar het besluit de eerdere inschatting
heeft veranderd.

| # | Gap | Haalbaarheid | Advies volgorde | Wijziging 23-08 |
|---|---|---|---|---|
| 5 | Contractenlijst tenant-breed + eigen nav-item | Klein–Middel | **Eerst** — data bestaat al, sluit direct aan op #171/#172 | — |
| 2 | Contract 360 (kerngegevens, zonder levenscyclus-balk) | Klein–Middel | **Tweede** — al belegd in #173, eigenaar wil dit expliciet | CATS-fase geschrapt uit eerste versie |
| 1 | Dashboard met KPI-tegels | Middel | **Derde** — hergebruikt #174's waarschuwingslogica | — |
| 3 | Interne leveranciersbeoordeling (tokenlink, geen tenant-account) | Middel | Kan naar voren — hergebruikt het bestaande tokenmechanisme (#8) | **Groot → Middel** |
| 4a | Vrije tags, spend/KvK/website-velden | Klein | Kan meelopen met bovenstaande, lage kosten | — |
| 8 | Instellingenscherm (drempelwaarden, labels) | Middel | Na de eerste drie — bouwt op wat dan al bestaat | — |
| 4b | Certificeringen-sectie (meerdere normen, eigen bewaking) | Middel–Groot | Losse vervolgstap; scope is breder dan gedacht | Verbreed: meerdere normen, eigen surveystroom per norm |
| 2b | Contract 360: overleg/issues/documenten | Middel–Groot | Losse vervolgstappen op Contract 360 | — |
| 7 | Samengesteld compliance/risicocijfer | Middel + ontwerpvraag | Eerst brainstormen, past het bij "waarschuwen niet blokkeren"? | — |
| 9 | Granulaire rolmatrix | Groot (architectuur) | **Later** — bevestigd, geen scenario met 3+ rollen | Bevestigd: later |
| 4c | Open taken-widget | Groot | Nieuw concept, geen bestaande bouwstenen | — |
| 6 | AI Document Interrogation | Groot + externe afhankelijkheid | **Later** — bevestigd | Bevestigd: later |
| 10 | Landingpagina na Entra-login (rolbewust) | Klein–Middel | Toegevoegd 27-08 — geen MVM_V2-gap, eigen punt | Nieuw |
| 11 | Gebruikshandleidingen (tenant-admin, tenant-gebruiker) | Klein (documentatie) | Toegevoegd 27-08 — na §10, geen MVM_V2-gap | Nieuw |

**Zie ook** `docs/architectuur/pilot-versus-roadmap.md` — deze tabel is de
roadmap-toets ("is dit de juiste productrichting"); de pilot voor een
beperkt aantal Transdev-leveranciers vraagt een andere toets en staat
apart.

## Wat dit niet is

Zoals in issue #178 vastgelegd: dit document is geen architectuurwijziging
en geen directe code-wijziging. Het is een prioriteitenlijst. Elke rij in
de tabel hierboven die de eigenaar wil oppakken, wordt een eigen issue met
eigen brainstorm — vooral de rijen met een ontwerpvraag (risicocijfer,
interne beoordeling) verdienen een gesprek vóór er gebouwd wordt.
