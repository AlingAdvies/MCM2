# Roadmap — Vendor IT survey en contractmanagement

**Type:** roadmap — overzicht; de meeste punten hebben een gekoppeld GitHub
issue (§2–§4, §6); §7 verwijst naar een uitgewerkte spec i.p.v. een los
issue, §8 is bewust nog geen issue (zie daar waarom)
**Eigenaar:** de eigenaar (Chris)
**Opgesteld:** 2026-08-21, uit `docs/opmerkingen Vendor IT survey.txt`;
bijgewerkt 2026-08-22 met de 21-08-vervolgpunten
**Geldt voor:** MCM2 in generieke zin — niet Transdev-specifiek, ook al zijn de
opmerkingen ontstaan tijdens het testen met Transdev als eerste echte tenant.
**Criticality:** productieapp voor een echte klant. Volgorde binnen deze
roadmap ligt nog niet vast; wat wél vaststaat is dat elk punt hieronder ooit
door een echte gebruiker gebruikt gaat worden, niet alleen intern getest.
**Platform:** desktop/PC voor alle punten in dit document.

> **Onderhoud.** Dit is een tussenstap, geen eindpunt. Zodra een punt hieronder
> uitgewerkt wordt tot een GitHub issue, hoort dat issue-nummer hier
> teruggekoppeld te worden — anders raken dit document en de backlog uit de
> pas.

**Koppeling met GitHub Issues.** Dit document is het overzicht; de issues zijn
de detailwerklijst. Elk punt hieronder heeft een `→ #nummer`-verwijzing naar
het issue waar de uitwerking, discussie en voortgang staan. Het statusbord
(`docs/STATUSBORD.md`) toont deze issues onder `thema:product-kern` en
`thema:beheermenu` — dit document geeft de samenhang die het statusbord niet
laat zien.

---

## 0. Wat er al bestond, en wat hier nieuw bijkomt

Voordat dit document ontstond, lag er al een deel van deze scope vast in
specs en issues. Dit document herhaalt die niet, maar wijst ernaar en voegt
toe wat er nog ontbrak.

| Al gedekt door | Onderwerp |
|---|---|
| `docs/superpowers/specs/2026-08-04-beheermenu-tenantinstellingen.md` | Het hele beheermenu: gebruikers/rechten (#75), e-mailinstellingen (#76), selectiescherm voor uitnodigingen (#77) |
| Issue #24 (Later-lijst) | Contract-, task-, issue-, certificeringsmodules — bewust uitgesteld tot na de survey-slice |
| Issue #77 | Bulk/handpicked uitnodigingen versturen — met een expliciete blokkade: welke leverancierscriteria gelden voor bulkselectie? |

**Wat in dit document wél nieuw is:** de losse bevindingen uit het testen op
productie die nog nergens stonden — vooral rond leveranciersdata,
contractvelden en de vragenlijst zelf. Die staan in §2–§4.

---

## 1. De grove volgorde, zoals genoteerd tijdens het testen

Dit was de eerste opzet, en die klopt nog steeds als richting:

1. **Een goede vendor-IT-risk-vragenlijst** — de kernfunctie: een leverancier
   kan een vragenlijst invullen die iets zinnigs meet.
2. **E-mail-uitstuurfaciliteit** — grotendeels al belegd in #76/#77.
3. **Een degelijke, eenvoudige contractmanagement-feature** — nieuw, zie §3.
4. **Vendor third-party-risk-features** — de volgende laag boven de basisvragenlijst.
5. **Overige NIS2-compliance-features** — het bredere doel waar dit platform
   uiteindelijk naartoe werkt.

**Waarom deze volgorde vasthoudt:** elke latere stap leunt op de vorige. Een
contractmodule zonder werkende vragenlijst-flow test niets; NIS2-brede
features zonder een goede basisvragenlijst missen hun fundament. Dat is ook
precies waarom #24 de bredere modules bewust "later" noemt.

---

## 2. Vragenlijst en uitnodiging

### 2.1 Geen link naar de uitstuurder in de vragenlijst zelf → [#153](https://github.com/AlingAdvies/MCM2/issues/153)

**Bevinding:** een leverancier die de vragenlijst invult, ziet nergens een
verwijzing naar wie de uitnodiging heeft verstuurd of waar hij met vragen
terecht kan.

**Aansluiting:** dit is direct verwant aan #76 (afzenderadres per tenant) en
aan het instellingenpunt in §5 hieronder (antwoordadres). Zodra een tenant een
eigen antwoordadres kan instellen, hoort dat adres ook zichtbaar te zijn ín de
vragenlijst zelf — niet alleen in de uitnodigingsmail. Nu ontbreekt die
verwijzing volledig, ook als het antwoordadres wél is ingesteld.

**Voorstel:** een vaste regel onderaan de vragenlijst ("Vragen over deze
vragenlijst? Neem contact op met [naam/adres]"), gevuld met dezelfde waarde
als het antwoordadres uit de tenantinstellingen — of, als dat leeg is, de
contactpersoon-tekst die daar al voor bestaat (zie §5).

### 2.2 "Rondes" is een verwarrende naam voor wat er nu gebeurt → [#154](https://github.com/AlingAdvies/MCM2/issues/154) — **AFGEROND, in productie 21-08**

**Bevinding:** in `/beheer/vragenlijsten` heet elke uitnodiging een "ronde".
Feitelijk is een herhaalde meting (dezelfde vragenlijst, periodiek opnieuw
uitgestuurd om trends te zien) een aparte, latere feature — en die naam is nu
al bezet door iets anders.

**Gekozen oplossing, uitgewerkt via brainstorming (zie
`docs/superpowers/specs/2026-08-21-rondes-weergave-design.md`):** een puur
frontend-wijziging, geen database-/functionaliteitswijziging. Het scherm
groepeert de bestaande data per vragenlijst-titel, uitklapbaar. Ingeklapt
toont de groep de titel + samengevoegde voortgang; uitgeklapt de individuele
verzendingen met een tijdsaanduiding in plaats van het woord "ronde". De
sectiekop is "Verzendingen" geworden. Backend, database en interne
servicenamen (`RondeBeheerService` e.d.) blijven ongewijzigd — dat bleef
bewust intern.

**Bevestigd in productie (21-08):** gemerged via
AlingAdvies/MCM2-frontend#14, doorgelopen via staging, uitgerold naar
`clm.alingadvies.nl`, met eigen ogen bekeken door de eigenaar.

**Vervolgwens (21-08, nieuwe opmerking) → [#170](https://github.com/AlingAdvies/MCM2/issues/170):**
de uitgeklapte weergave uit #154 werkt goed; twee kolommen erbij gevraagd —
vendornaam en e-mailadres van de gebruikte contactpersoon. Vermoedelijk
weer een puur frontend-wijziging, net als #154 zelf.

### 2.3 Nieuwe feature: vragenlijst-bouwer → [#155](https://github.com/AlingAdvies/MCM2/issues/155)

**Bevinding:** tenant-beheerders kunnen nu geen eigen vragenlijsten
samenstellen — de acht Transdev-vragen zijn een vaste seed.

**Ontwerprichtlijn (besproken 21-08):** wanneer dit gebouwd wordt, moet elke
vragenlijst en elke vraag een `tenant_id` dragen met RLS erop, net als de
andere tenant-gebonden tabellen. Geen gedeelde "vraag-bibliotheek" tussen
tenants tenzij dat bewust een aparte, expliciet gedeelde, read-only tabel
wordt (bijvoorbeeld een sjabloon-set "veelgebruikte NIS2-vragen"). Nooit
dezelfde tabel als de tenant-specifieke vragenlijsten met een nullable
`tenant_id` — dat is precies het soort constructie waar RLS omheen gebouwd
moet worden in plaats van ervoor, en dat is de klasse fout die
`docs/architectuur-en-verificatie.md` §3 als kip-ei-probleem beschrijft.

**Status:** nog niet uitgewerkt tot een spec. Dit hoort qua zwaarte bij stap 1
van de grove volgorde (§1) — de kernvragenlijst-functie — niet bij de latere
stappen.

### 2.4 Open vraag: hoe werkt SSO met Entra ID precies?

Dit is geen feature maar een begripsvraag van de eigenaar. Het antwoord staat
al beschreven in `docs/architectuur-en-verificatie.md` §11 (de claims-analyse
uit de echte login-proef) en in `MCM2-CLAUDE.md` (de identiteitslaag). Geen
nieuw werk — wel de moeite waard om dat stuk samen door te nemen zodra er tijd
is, zodat dit niet als losse vraag blijft rondzweven.

---

## 3. Leveranciers en contracten

Dit is het grootste nieuwe blok, en het correspondeert met stap 3
("contractmanagement") uit de grove volgorde.

### 3.1 Contractbeheerder / contactpersoon ontbreekt als veld → [#156](https://github.com/AlingAdvies/MCM2/issues/156)

**Bevinding:** bij een leverancier is er geen veld voor wie er intern
verantwoordelijk is voor het contract of het contact met die leverancier.

**Voorstel:** een nieuw veld op de leverancier (of een aparte, gekoppelde
tabel als één leverancier meerdere contractbeheerders kan hebben — dat is een
scope-vraag die nog niet beantwoord is).

### 3.2 Contractveld, gekoppeld aan leverancierstype en/of vragenlijst → [#157](https://github.com/AlingAdvies/MCM2/issues/157)

**Bevinding:** er moet een contractveld komen dat linkt naar het type
leverancier en/of naar de vragenlijst die voor dat type geldt.

**Wat dit in de praktijk vraagt:** dit is niet één veld maar een relatie —
contract → leverancier, en mogelijk contract → welke vragenlijst van
toepassing is op basis van het leverancierstype. Dit raakt de datamodellering
rond `vendor` en `survey_run`/`vragenlijst`, en verdient een eigen ontwerpstap
vóór er code komt — het is precies het soort keuze waar het
intake-protocol voor bedoeld is wanneer dit wordt opgepakt.

### 3.3 Bulk-upload voor leveranciersstamdata → [#158](https://github.com/AlingAdvies/MCM2/issues/158)

**Bevinding:** er moet een manier zijn om leveranciers in bulk te importeren,
niet één voor één.

**Ontwerprichtlijn (besproken 21-08):**
- Import loopt altijd via de ingelogde sessie van de tenant-admin — de
  tenant-id komt uit `withTenant()`, nooit uit een kolom in het
  geüploade bestand zelf. Dat sluit uit dat een bestand met een
  `tenant_id`-achtige kolom (per ongeluk of expres) data in een andere
  tenant zou kunnen laten belanden.
- De import moet **nieuwe rijen toevoegen of expliciet matchen op een
  sleutel** (bijvoorbeeld leveranciersnaam + KVK-nummer), nooit stilzwijgend
  bestaande velden overschrijven zonder dat eerst te tonen. Praktisch: een
  preview-stap ("dit gaat er gebeuren: X nieuw, Y bijgewerkt") vóór het
  definitief wegschrijven — dezelfde opzet als de bestaande
  vragenlijst-import, die blokkerende fouten vóór het wegschrijven valideert
  (zie de e2e-suite `vragenlijst-import`, 21 tests, in
  `docs/architectuur-en-verificatie.md` §5).
- De actie hoort een `audit_event` te loggen (wie, wanneer, hoeveel rijen) —
  net als tenant-aanmaak dat al doet. Zonder dat is een verkeerde import
  achteraf niet te herleiden.

### 3.4 Leverancierstype makkelijk aanvinken vanuit de lijst → [#159](https://github.com/AlingAdvies/MCM2/issues/159)

**Bevinding:** vanuit de leverancierslijst moet het type leverancier snel
aan te vinken zijn, zonder elke leverancier apart te openen.

**Voorstel:** een inline-bewerkbare kolom of een bulk-actie op geselecteerde
rijen in de lijstweergave. Relatief kleine UI-uitbreiding op een bestaand
scherm.

### 3.5 Bulk-upload voor contractdata → [#160](https://github.com/AlingAdvies/MCM2/issues/160)

**Bevinding:** los van de leveranciersstamdata moet er ook bulk-upload zijn
voor contractdata: leverancier, begindatum, einddatum.

**Aansluiting:** zelfde ontwerprichtlijn als §3.3 — dit is feitelijk dezelfde
feature toegepast op een ander gegevenstype, en kan vermoedelijk dezelfde
import-mechaniek (preview, matching, audit) hergebruiken zodra die eenmaal
gebouwd is voor leveranciers.

### 3.6 Compliance-status: vrij tekstveld → koppeling met beoordelingsuitkomst? → [#161](https://github.com/AlingAdvies/MCM2/issues/161)

**Bevinding:** de compliance-status bij een leverancier is nu een vrij
invulbaar tekstveld. De vraag is of dat gekoppeld moet worden aan de
uitkomst van een beoordeling (`survey_review`).

**Ontwerprichtlijn (aandachtspunt, niet nu uitgewerkt):** als dit een
geautomatiseerde afleiding wordt (status verandert automatisch na een
beoordeling), moet vastliggen wie dat mag triggeren en of het auditspoor dat
vastlegt — zoals de rest van het platform dat al doet
(`audit.audit_event`, append-only). Een status die vanzelf verandert zonder
zichtbaar spoor is een stap terug ten opzichte van hoe `survey_review` nu al
werkt (zie `docs/architectuur-en-verificatie.md` §2, de actorgrens).

**Status:** dit is nog een open vraag, geen besluit. Eerst bepalen: moet de
koppeling een suggestie zijn (beheerder ziet een voorstel, bevestigt zelf) of
een automatische overschrijving? Dat verschil bepaalt de hele aanpak.

---

## 4. Instellingen

### 4.1 Bug: tenantnaam ontbreekt in de instellingentekst → [#162](https://github.com/AlingAdvies/MCM2/issues/162)

**Bevinding:** in de tenantinstellingen staat de tekst:

> *"Uitnodigingen worden verstuurd namens AlingAdvies. Vult u hieronder een
> adres in, dan komen antwoorden van leveranciers daar terecht in plaats van
> bij het platform. Laat u het leeg, dan verwijst de uitnodiging naar 'uw
> contactpersoon'."*

"AlingAdvies" staat hier hardcoded, terwijl dit een generieke tekst voor elke
tenant zou moeten zijn. **Check nodig:** hier hoort de naam van de
tenant zelf te staan, niet altijd "AlingAdvies".

**Dit is het enige punt in dit document dat een concrete bug is, geen
feature-wens.** Klein, geïsoleerd, en losstaand op te pakken los van de rest
van deze roadmap — een goede kandidaat om als eerste, of los van de roadmap,
te fixen.

---

## 5. Testbewijs uit deze sessie

Twee survey-uitnodigingen zijn tijdens het testen aangemaakt op productie
(`clm.alingadvies.nl`), leveranciers `testlev1` en `testlev2`:

```
https://clm.alingadvies.nl/portal/survey/tyfe-VPbotMupcuAOWpTHsgs2zhxY77a9nimUAi5JcA
https://clm.alingadvies.nl/portal/survey/xz2Ha7wKeJQ8RNC6gzokiUod_3L6Nl7yaPpuLlCiHyY
```

Deze staan hier als spoor van waar de bevindingen hierboven vandaan komen,
niet als iets dat verder actie vraagt. Volgens `CLAUDE.md` §0 wordt productie
bewust ook voor demo/bewijs gebruikt — dit is daar een voorbeeld van.

---

## 6. Alle tien punten zijn nu issues — voorgestelde volgorde

Aangemaakt 21-08, elk met een `thema:*`-label zodat ze meelopen in het
statusbord:

| Issue | Sectie | Voorstel volgorde |
|---|---|---|
| [#162](https://github.com/AlingAdvies/MCM2/issues/162) | §4.1 — tenantnaam-bug | Eerst — klein, geen ontwerpvraag |
| [#154](https://github.com/AlingAdvies/MCM2/issues/154) | §2.2 — naamgeving "ronde" | **Afgerond, in productie 21-08** |
| [#153](https://github.com/AlingAdvies/MCM2/issues/153) | §2.1 — contactinfo in vragenlijst | Bij stap 1 (goede vragenlijst) |
| [#155](https://github.com/AlingAdvies/MCM2/issues/155) | §2.3 — vragenlijst-bouwer | Bij stap 1 (goede vragenlijst) |
| [#156](https://github.com/AlingAdvies/MCM2/issues/156) | §3.1 — contractbeheerder-veld | Bij stap 3 (contractmanagement) |
| [#157](https://github.com/AlingAdvies/MCM2/issues/157) | §3.2 — contractveld/type-koppeling | Bij stap 3, na §3.1 (ontwerpstap eerst) |
| [#158](https://github.com/AlingAdvies/MCM2/issues/158) | §3.3 — bulk-upload leveranciers | Bij stap 3 |
| [#160](https://github.com/AlingAdvies/MCM2/issues/160) | §3.5 — bulk-upload contracten | Bij stap 3, na §3.3 (hergebruikt de mechaniek) |
| [#159](https://github.com/AlingAdvies/MCM2/issues/159) | §3.4 — leverancierstype aanvinken | Bij stap 3, kleine UI-uitbreiding |
| [#161](https://github.com/AlingAdvies/MCM2/issues/161) | §3.6 — compliance-status koppeling | Open vraag, geen datum — eerst besluiten wat het moet worden |
| [#170](https://github.com/AlingAdvies/MCM2/issues/170) | §2.2 (vervolg) — kolommen in uitklaplijst | Bij stap 1, kleine UI-uitbreiding op #154 |

**Wat dit document bewust niet doet:** de volgorde hierboven als vaststaand
behandelen. Het is een voorstel; de eigenaar bepaalt de daadwerkelijke
volgorde via het statusbord en de issues zelf.

---

## 7. Contractmanagement — datamodel uitgewerkt → spec

De opmerking van 21-08 (punt 2) over contactpersoon-per-contract en de
survey-koppeling (§3.2/#157 hierboven) is op 22-08 via een brainstorm-sessie
uitgewerkt tot een volledig datamodel-ontwerp:
`docs/superpowers/specs/2026-08-22-contractmanagement-design.md`. Dat
document dekt #156 en #157 in samenhang — een nieuwe `clm.contract`-tabel,
statusmodel, en de koppeling met vragenlijst-templates. Zie dat document voor
de details; dit punt blijft hier alleen als verwijzing zodat de roadmap niet
opnieuw "nog een ontwerpstap nodig" meldt voor iets dat al ontworpen is.

**Notitieveld bij contactpersoon (21-08, punt 2b):** bleek bij het uitwerken
al te bestaan als `vendor_contact.role_description` — alleen nog niet
zichtbaar in de UI. Geen apart issue, wordt meegenomen in de
contractmanagement-implementatie. Zie de spec §1 voor detail.

### 7.1 Vervolgwensen ná de preview (21-08 II) → [#171](https://github.com/AlingAdvies/MCM2/issues/171), [#172](https://github.com/AlingAdvies/MCM2/issues/172)

Bij het bekijken van de eerste preview van de Contracten-sectie (22-08)
kwamen vier nieuwe punten naar boven. Twee daarvan (contactpersoon en
survey-koppeling direct bij het aanmaken van een contract) waren klein
genoeg om nog in dezelfde bouwronde mee te nemen — zie
`docs/superpowers/plans/2026-08-22-contractmanagement-ui.md`, uitgebreid
met een Task 12. De andere twee raken schermen buiten het
vendor-detailscherm (sidebar, startscherm) en zijn losse issues geworden:

- [#171](https://github.com/AlingAdvies/MCM2/issues/171) — Contracten ook
  in de linkerbalk/navigatie opnemen, niet alleen bereikbaar via een
  leverancier.
- [#172](https://github.com/AlingAdvies/MCM2/issues/172) — "Start"
  hernoemen naar "Dashboard", met een overzicht van contracten die binnen
  90 dagen verlopen (ook zonder ingevulde status).

## 8. Productidee: (intake)leveranciersbeoordeling o.b.v. Z-CERT-vragenlijst

**Bevinding (21-08, uit de opmerkingen):** een productidee, geen uitgewerkte
feature — een leveranciersbeoordeling bij de intake van een nieuwe
leverancier, gebaseerd op de Z-CERT excel-vragenlijst (een bestaande
sectorstandaard-vragenlijst voor IT-risicobeoordeling van leveranciers,
gebruikt in de zorgsector).

**Status:** puur een idee, nog niet besproken op scope, doel of verhouding
tot de bestaande acht Transdev-vragen. Geen issue — dat zou voorbarig zijn
zolang niet vastligt of dit een aparte vragenlijst-template wordt (past dan
onder #155, de vragenlijst-bouwer), een uitbreiding van de intake-flow, of
iets anders. Terugkomen zodra stap 1 (goede basisvragenlijst) en de
vragenlijst-bouwer verder gevorderd zijn — dit idee leunt op beide.

---

## Bronnen

- `docs/opmerkingen Vendor IT survey.txt` — de oorspronkelijke, ruwe notities
  (20 en 21 augustus)
- `docs/superpowers/specs/2026-08-22-contractmanagement-design.md` — het
  datamodel-ontwerp voor #156/#157, zie §7
- `docs/superpowers/specs/2026-08-04-beheermenu-tenantinstellingen.md` — het beheermenu waar §2.1, §4.1 en de #75/#76/#77-issues in landen
- Issue #24 — de bewuste later-lijst voor bredere modules
- Issue #77 — bulk/handpicked uitnodigingen, met de nog openstaande criteriavraag
- `docs/architectuur-en-verificatie.md` §2–§3 — de tenantgrens-discipline die elk nieuw datamodel (contract, bulk-upload, vragenlijst-bouwer) moet volgen
