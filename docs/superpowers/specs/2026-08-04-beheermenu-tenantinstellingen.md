# Ontwerp — beheermenu: tenantinstellingen, gebruikersrechten en e-mailverzending

**Datum:** 2026-08-04
**Status:** ONTWERP — niet gebouwd, geen migratie, geen besluit gevraagd op de invulling
**Aanleiding:** de tenantbeheerder kan vandaag niets instellen. Er is geen scherm waar
iets van de tenant zelf te configureren valt — geen afzender, geen gebruikers, geen rechten.
**Raakt:** Issue #13 (SMTP), fase D van `docs/superpowers/plans/2026-08-03-surveybeheer.md`,
spec `2026-08-03-feature-flags-en-rechten.md` (laag 2), Issue #57 (platformbeheer), ADR-006

---

## 0. Waar dit over gaat, in één alinea

MCM2 kent tenants, gebruikers met een rol, en straks vragenlijstrondes die uitgezet moeten
worden. Wat er niet is: een plek waar de tenant zijn eigen zaken regelt. Wie mag wat, en
onder welk e-mailadres gaan de uitnodigingen de deur uit. Dit document beschrijft dat
**beheermenu** als één samenhangende feature: een menu-item met drie onderdelen —
**gebruikers en rechten**, **e-mailinstellingen (SMTP)**, en **uitnodigingen versturen**
(handmatig geselecteerd of in bulk op basis van leverancierscriteria).

**Er wordt niets gebouwd op basis hiervan** tot de eigenaar de invulling heeft gekozen.
De open keuzes staan in §8.

---

## 1. Uitgangspunten van de eigenaar (2026-08-04)

Vastgelegd bij de intake, en sturend voor alles hieronder:

| Vraag | Antwoord |
|---|---|
| Reikwijdte | Per tenant. Ook gebruikersrechten horen hierin. |
| Verzenden | Zowel handmatig geselecteerd ("handpicked") als in bulk op basis van leverancierscriteria. |
| Apparaat | PC. Geen mobiel ontwerp voor beheerschermen. |
| Criticality | Productie, gaat naar klanten — per tenant. |
| Wie mag erbij | Alleen de tenantbeheerder (`admin`). Uitdrukkelijk **niet** de leverancier. |
| SMTP-wachtwoord | Versleuteld in de database. |

Op 2026-08-04 verscherpt tot een expliciete dreigingseis: de SMTP-gegevens moeten beschermd
zijn tegen **gebruikers van een andere tenant** én tegen **ondeskundige gebruikers binnen de
eigen tenant** — waarbij een tenantgebruiker een geautoriseerde, ingelogde gebruiker is op
het deel van zijn eigen tenant. Dat is uitgewerkt in §4; het is bewust géén enkele maatregel
maar vier, want de twee bedreigingen vragen verschillende mechanismen.

Het laatste punt is een besluit dat afwijkt van Issue #13, dat "SMTP-credentials via
omgevingsvariabelen" als acceptatiecriterium noemt. Dat criterium is geschreven toen er
één tenant was. Zie §4 — de afwijking is bewust en heeft een reden, maar hij moet expliciet
vastgelegd worden in een ADR en niet stilzwijgend in een migratie sluipen.

---

## 2. Wat er vandaag is

Geverifieerd op 2026-08-04 tegen de code, niet uit gespreksgeheugen.

| Onderdeel | Stand |
|---|---|
| `clm.tenant_membership.role` — `admin` of `reviewer`, CHECK-constraint | ✅ migratie 0009 |
| Rol reist mee tot in de sessie (`clm.sessie_oplossen()`) | ✅ migratie 0010 |
| `RolGuard` + `@VereistRol('admin')` — backendcontrole op rol | ✅ `src/auth/rol.guard.ts` |
| `app.current_actor` — database onderscheidt medewerker en leverancier | ✅ migratie 0013 |
| `FORCE ROW LEVEL SECURITY` op alle tabellen | ✅ migratie 0011 |
| **Gebruikers uitnodigen, rol wijzigen, gebruiker deactiveren** | ❌ bestaat nergens |
| **Enige vorm van tenantinstelling** | ❌ geen tabel, geen route, geen scherm |
| **Versleuteling van gegevens in de database** | ❌ nergens; `pgcrypto` wordt niet gebruikt |
| **E-mailverzending** | ❌ geen enkele regel; geen mailbibliotheek in `package.json` |
| **Beheermenu in de sidebar** | ❌ er is `/beheer/leveranciers`, meer niet |

Twee dingen om scherp te hebben. Ten eerste: **er is nog nooit iets versleuteld opgeslagen
in MCM2.** Dit wordt de eerste keer, en daarmee ook de eerste keer dat er een sleutel te
beheren, te roteren en bij een herstel terug te zetten valt. Dat is de kern van §4.

Ten tweede: **membership-rijen worden vandaag met de hand in de database gezet.** Er bestaat
geen weg waarlangs een tenantbeheerder een collega toegang geeft. Zolang er één klant en
één beheerder is, valt dat niet op; bij de tweede klant is het een blokkade.

---

## 3. De drie onderdelen, en waarom ze in één menu horen

Ze horen bij elkaar omdat ze dezelfde vraag beantwoorden — *wat geldt er binnen deze tenant*
— en dezelfde grens delen: alleen `admin`, nooit de leverancier. Ze zijn wel afzonderlijk
te bouwen, en dat is ook het voorstel (§7).

### 3a. Gebruikers en rechten

Wat een tenantbeheerder moet kunnen:

1. Zien wie er toegang heeft tot deze tenant, met rol en status.
2. Een collega uitnodigen (e-mailadres + rol).
3. De rol van een bestaande gebruiker wijzigen.
4. Toegang intrekken.

Dit is **laag 2** uit `2026-08-03-feature-flags-en-rechten.md`: gebruikersrecht, beheerd door
de klant. Laag 1 (tenantrecht: heeft deze klant deze module ingekocht) hoort hier
uitdrukkelijk **niet** — dat is een besluit van Bizaline, niet van de klant, en het staat
in die spec §4 nog open. Een beheerscherm waarin de klant zijn eigen modules kan aanzetten,
is precies de fout die die spec beschrijft.

Drie regels die geen implementatiedetail zijn:

- **Een beheerder kan zichzelf niet degraderen of verwijderen als hij de laatste admin is.**
  Anders is een tenant met één onhandige klik onbeheerbaar, en is er geen weg terug behalve
  databasetoegang — precies wat Issue #57 juist wil vermijden.
- **Toegang intrekken is niet hetzelfde als de gebruiker weggooien.** Wat die persoon heeft
  gedaan — een leverancier gewijzigd, een oordeel gegeven — blijft aan zijn naam hangen.
  De audittrail is append-only (MCM2-CLAUDE.md §7.7) en een beoordeling wordt nooit
  overschreven (surveybeheerplan §2a); een verdwenen gebruiker maakt die historie
  onleesbaar. Dus: `deleted_at` / een status, geen `DELETE`.
- **Uitnodigen loopt via Entra External ID, niet via een wachtwoord dat MCM2 zet.** ADR-006
  legt de CIAM-laag vast. Het uitnodigingsmechanisme moet aansluiten op hoe een gebruiker
  daar tot stand komt — dat is een open punt, zie §8.

### 3b. E-mailinstellingen (SMTP)

Wat een tenantbeheerder moet kunnen:

1. De SMTP-gegevens van zijn eigen organisatie invullen: host, poort, versleuteling,
   gebruikersnaam, wachtwoord, afzenderadres en afzendernaam.
2. **De verbinding testen** — een testmail naar zichzelf, met een zichtbare uitkomst.
3. Zien wanneer de instellingen voor het laatst gewijzigd zijn en door wie.

Punt 2 is geen luxe. SMTP-instellingen zijn de klassieke plek waar iets stilletjes fout
staat: een poort ernaast, een verkeerd wachtwoord, een relay die de afzender weigert. Zonder
testknop merkt de beheerder dat pas wanneer zeventien leveranciers geen uitnodiging kregen —
en dan is niet te zien of de mail niet verstuurd is of niet aangekomen.

**De reden dat dit per tenant is en niet één centrale instelling:** Transdev wil dat de
uitnodiging van `contractmanagement@transdev.nl` komt (Issue #13). Een leverancier die een
mail krijgt van een hem onbekend platform, klikt niet op de link — of hij meldt hem als
phishing. Dat is geen cosmetische wens maar de voorwaarde waaronder de vragenlijst überhaupt
ingevuld wordt.

### 3c. Uitnodigingen versturen — handpicked en in bulk

Dit is waar het beheermenu de survey raakt. Twee manieren om deelnemers aan een ronde te
kiezen:

- **Handpicked** — de beheerder vinkt leveranciers aan in een lijst.
- **Bulk op criteria** — de beheerder selecteert op eigenschappen van de leverancier
  (categorie, compliancestatus, contractstatus — welke precies is een open vraag, §8) en
  krijgt de resulterende lijst te zien vóórdat hij verstuurt.

**De volgorde in dat scherm is niet vrijblijvend: selecteren, vervolgens de lijst tonen,
pas daarna versturen.** Een criterium dat één teken naast de bedoeling zit, is het verschil
tussen vijf en vijfhonderd uitnodigingen aan externe partijen. Dat is een handeling die niet
terug te draaien is: een verstuurde mail is verstuurd. Een bevestigingsstap met het aantal
en de namen erin is daarom onderdeel van de feature, geen verfijning voor later.

Waar dit op leunt: fase B van het surveybeheerplan geeft de tokens uit, fase D verstuurt de
mail. Dit onderdeel is het **selectiescherm** dat daarvoor staat, plus de bulkvariant die in
dat plan nog niet beschreven is.

---

## 4. Bescherming van de SMTP-gegevens

Dit is het enige onderdeel van deze feature dat een nieuw soort risico introduceert. De rest
is schermen en routes op bestaande mechaniek.

De eigenaar formuleerde de eis op 2026-08-04 zo:

> het gaat mij erom dat de smtp data afdoend beschermd is tegen toegang door niet
> tennant gebruikers. En tegen niet deskundige tennant gebruikers.

Twee bedreigingen dus — en ze vragen **twee verschillende mechanismen**. Dat onderscheid is
de kern van deze paragraaf, want het wordt gemakkelijk verward: versleuteling in de database
lost geen van beide op. Zij lost een derde probleem op (§4c).

| Bedreiging | Mechanisme | Nieuw werk |
|---|---|---|
| Gebruiker van een **andere tenant** | RLS + `FORCE` + geen `BYPASSRLS` | Nee — bestaat |
| **Leverancier** binnen dezelfde tenant | `clm.current_actor() = 'medewerker'` in de policy | Nee — migratie 0013 |
| **Ondeskundige eigen gebruiker** | **Write-only wachtwoord** + `admin`-only + testknop + audit | **Ja — dit is de kern** |
| Gestolen dump of backup | Versleuteling met datasleutel per rij | Ja — vraagt een ADR |

---

### 4a. Andere tenants — al afgedekt, drie grendels diep

Geverifieerd op 2026-08-04:

1. De applicatie draait als `clm_api_runtime`, **zonder `BYPASSRLS`** — en
   `DatabaseService.onModuleInit()` weigert op te starten als die rol dat recht wél heeft.
   Een actieve controle bij elke start, geen aanname in een document.
2. `FORCE ROW LEVEL SECURITY` op alle tabellen (migratie 0011), dus ook voor de tabeleigenaar.
3. Buiten `withTenant()` bestaat er geen tenantcontext, dus geeft elke tenantgebonden query
   nul rijen.

De SMTP-tabel krijgt exact dezelfde behandeling als elke andere tabel. **Hier is niets nieuws
te bedenken**, en dat is precies de winst van de bestaande opzet.

### 4b. De leverancier binnen dezelfde tenant

De policy krijgt de actor-eis uit migratie 0013, in `USING` én in `WITH CHECK`:

```sql
USING      (tenant_id = clm.current_tenant_id() AND clm.current_actor() = 'medewerker')
WITH CHECK (tenant_id = clm.current_tenant_id() AND clm.current_actor() = 'medewerker')
```

Die eis is niet decoratief. Een leverancier heeft een geldig token bínnen dezelfde tenant;
zonder deze regel houdt "hij kan er niet bij" alleen stand zolang niemand een route bouwt
die de instellingen meestuurt. Dat is het faalpatroon dat migratie 0013 in detail beschrijft
en waarvoor hij vooruit is gehaald. Dit is de tweede tabel die ervan profiteert.

De eis staat ook in `WITH CHECK`, niet alleen in `USING`: zonder dat zou een leverancierspad
wél kunnen schrijven wat het niet kan lezen — een lek dat pas opvalt als de rij er al staat.

### 4c. De ondeskundige eigen gebruiker — hier zit het werk

Dit is de bedreiging waar nog niets voor bestaat, en het is **geen versleutelingsvraag**.
Die gebruiker praat met de applicatie, en de applicatie heeft de sleutel. Mag hij het
wachtwoord via een scherm opvragen, dan krijgt hij het ontsleuteld — versleuteld opgeslagen
of niet.

Wat kan hij fout doen, in oplopende ernst:

| | Wat er gebeurt | Ernst |
|---|---|---|
| Kapotmaken | Poort of host verkeerd — mail gaat niet meer weg | Vervelend, herstelbaar, zichtbaar |
| Onbedoeld omleiden | Afzender wijzigen naar een adres dat de organisatie niet beheert | Mail wordt geweigerd of leest als phishing |
| Weglekken | Het wachtwoord uit het scherm halen en elders plakken | Onherstelbaar en onzichtbaar |

De derde is de enige die er werkelijk toe doet, en die is met één ontwerpregel volledig weg
te nemen.

#### Maatregel 1 — het wachtwoord is write-only (de belangrijkste)

**Er bestaat geen weg waarlangs een ingelogde gebruiker het SMTP-wachtwoord terugkrijgt.**
Niet in een GET, niet gemaskeerd, niet "alleen voor de admin", niet in een export, niet in
een logregel.

Het scherm toont: *"Wachtwoord ingesteld op 12 juni door Sophie de Vries — [vervangen]"*.
Invoeren en vervangen kan; uitlezen niet.

Dit is dezelfde regel als bij het surveytoken, waar het ruwe token één keer bestaat en
daarna alleen de hash (surveybeheerplan, fase B). Het verschil: het SMTP-wachtwoord moet
wél terughaalbaar zijn om mail te kunnen versturen, dus het is versleuteling en geen hash.
Maar **het ontsleutelen gebeurt uitsluitend in de verzendcode**, nooit in een route die iets
aan een gebruiker teruggeeft.

Dit is de maatregel met verreweg de beste verhouding tussen moeite en effect: één regel, en
de ernstigste faalvorm bestaat niet meer — ook niet voor de tenantbeheerder zelf, en ook
niet voor de platformbeheerder.

#### Maatregel 2 — alleen `admin`, met een backendcontrole

`@VereistRol('admin')` op elke route. `RolGuard` doet dit al goed: een `reviewer` krijgt 403
op de route zelf, niet alleen een verborgen menu-item. Het commentaar in `rol.guard.ts` zegt
het zelf — een verborgen knop is geen beveiliging.

#### Maatregel 3 — de testknop maakt fouten zichtbaar vóór ze schade doen

Niet primair gemak maar een beveiligingsmaatregel tegen de ondeskundige gebruiker. Wie iets
wijzigt, ziet meteen of het werkt, in plaats van er over drie weken achter te komen dat
zeventien uitnodigingen nooit zijn aangekomen.

**Overweging voor de bouw:** een gewijzigde instelling pas actief maken nadat de testmail
geslaagd is. Dan kan een verkeerde poort de verzending niet stilzwijgend breken. Dit is een
open keuze — het maakt het scherm iets omslachtiger en de bescherming aanzienlijk sterker.

#### Maatregel 4 — elke wijziging in de audittrail

Wie, wanneer, welk veld. **Niet de waarde van het wachtwoord** — alleen dát het vervangen
is. `audit.audit_event` bestaat al en is append-only (MCM2-CLAUDE.md §7.7). Dit maakt van
"iemand heeft iets veranderd en niemand weet wat" een beantwoordbare vraag.

### 4d. Waar versleuteling dan wél voor is

Nu §4a tot en met §4c de twee genoemde bedreigingen afdekken, blijft er precies één scenario
over waarin versleuteling iets toevoegt: **de data verlaat de database zonder de
applicatie.** Een gestolen backup, een dump op een laptop, een databasegebruiker die
meeleest — `db/roles/bootstrap-roles.sql` definieert een `clm_readonly`-rol die alles kan
lezen.

Dat is een reëel scenario en de bescherming is echt. Maar het is een **derde** bedreiging,
niet die van de eigenaar. Dit staat hier expliciet omdat "het staat versleuteld in de
database" gemakkelijk gaat klinken als het antwoord op §4c, en dat is het niet.

**Het verschil met een omgevingsvariabele is bovendien kleiner dan het lijkt** — in beide
gevallen kan de draaiende applicatie erbij. De echte reden om af te wijken van Issue #13 is
niet dat de database veiliger zou zijn, maar dat één afzender per omgeving onbruikbaar is
zodra elke tenant zijn eigen afzender heeft.

#### De vorm: twee lagen, ook al zit er nu één omgeving achter

- **Een datasleutel per rij**, meeversleuteld opgeslagen naast de gegevens.
- **Een hoofdsleutel** die de datasleutels versleutelt, buiten de database bewaard — nu een
  omgevingsvariabele, later AWS KMS (staat al in Issue #21).

Waarom niet één sleutel voor alles? Omdat rotatie dan betekent dat elke tenant zijn
wachtwoord opnieuw moet invoeren. Dat gebeurt dus nooit — ook niet wanneer het moet,
bijvoorbeeld nadat iemand die de sleutel gezien heeft uit dienst gaat. Met twee lagen raakt
rotatie alleen de hoofdsleutel: datasleutels ontsleutelen en opnieuw versleutelen, klant
merkt niets.

Nu ongeveer een half uur extra werk. Achteraf invoeren is een migratie over productiedata.

#### Versleutelen in de applicatie, niet met `pgcrypto`

Bij `pgcrypto` gaat de sleutel als parameter door de query heen en kan hij in
`pg_stat_statements` of een querylog belanden — precies de plek waar je hem niet wilt hebben.
In de applicatie versleutelen houdt de sleutel uit de database én uit de logs.

#### De prijs die hiermee geaccepteerd wordt

Er ontstaat een sleutel die **mee moet in het herstelplan**. Een backup terugzetten zonder
die sleutel geeft een database waarin de SMTP-instellingen onleesbaar zijn.

Dat raakt Issue #30 (geen backups) en #19 (backup/restore-test) rechtstreeks. **Advies: dit
gerust bouwen, maar niet in productie zetten vóór #30 is opgelost.** Een tweede reden
waarom een herstel mislukt toevoegen aan een situatie zonder werkende backups is de
verkeerde volgorde. En de hersteltest moet vanaf dat moment óók bewijzen dat de instellingen
ná herstel wérken — niet alleen dat de rijen er weer staan.

### 4e. Wat de tegenproeven moeten zijn

Conform MCM2-CLAUDE.md §15b horen deze te falen vóórdat de code bestaat.

1. **Geen enkele route geeft het wachtwoord terug.** Doorzoek elk antwoord van elke route
   uit dit onderdeel op de ingevoerde waarde. Dit is de belangrijkste van de drie, want dit
   is de grens die §4c afdekt — en het is de enige die ook geldt voor iemand met alle
   rechten.
2. **Voeg de SMTP-instellingen toe aan wat een leverancierspad teruggeeft** en controleer
   dat een test faalt op nul rijen. Slaagt hij, dan ligt de grens niet in de database maar
   in de gewoonte om de juiste route te schrijven.
3. **Lees het wachtwoordveld rechtstreeks uit de tabel** en controleer dat er niets
   leesbaars staat. Dat bewijst dat er versleuteld wordt en niet dat een kolom zo heet.

### 4f. Volgorde van bouwen

1. **Write-only en `admin`-only.** Dit is het antwoord op §4c en kost bijna niets.
2. **De policy met actor-eis** (§4b).
3. **Pas daarna de versleuteling** met het sleutelbeheer eromheen (§4d), na het ADR.

Reden voor deze volgorde: de bedreiging die de eigenaar als tweede noemde, is met stap 1
volledig afgedekt, terwijl stap 3 het meeste werk en de meeste gevolgen heeft.

---

## 5. Wat dit ontwerp expliciet niet doet

- **Geen laag-1 feature flags.** Welke modules een tenant heeft ingekocht is een besluit van
  Bizaline. Zie `2026-08-03-feature-flags-en-rechten.md` §4 — die keuze staat nog open en
  hoort niet in een klantenscherm.
- **Geen platformbeheer-toegang.** Een Bizaline-medewerker die meekijkt bij een klant is een
  derde soort recht, buiten beide lagen. Dat is Issue #57 en wordt hier niet opgelost.
- **Geen derde rol.** `admin` en `reviewer` blijven zoals ze zijn. Een fijnmaziger
  permissiemodel is voorzien maar niet aan de orde (rechten-spec §3).
- **Geen mailsjablooneditor.** De inhoud van de uitnodiging is voorlopig vast, met hooguit
  de afzendernaam eruit gehaald. Een sjablooneditor is een eigen project.
- **Geen herinneringen of vervolgacties.** Issue #16 raakt dit en hangt aan fase D.
- **Geen afwijkende SMTP per ronde.** Eén instelling per tenant. Meer varianten pas als een
  klant erom vraagt.

---

## 6. Risico's

**Bulkverzending is onomkeerbaar en extern zichtbaar.** Dit is het eerste onderdeel van MCM2
waarmee een gebruiker in één handeling honderden externe partijen kan aanschrijven. Alles wat
tot nu toe gebouwd is, blijft binnen het systeem. Het risico is niet technisch maar
procedureel: een verkeerd criterium is een reputatiekwestie bij de klant van de klant. Vandaar
de bevestigingsstap in §3c, en vandaar dat de testadressen met de plus-truc uit fase D hier
extra waarde hebben.

**Een verkeerd ingestelde SMTP faalt stil.** Mail die niet aankomt, geeft geen foutmelding in
het scherm. Fase D neemt bewust over dat een mailfout logt maar de handeling niet breekt —
juist daarom moet het verzendscherm laten zien wat er met elke uitnodiging gebeurd is, en
niet alleen "verstuurd".

**De sleutel raakt het herstelplan.** Zie §4. Dit is de reden dat deze feature niet vóór
Issue #30 (geen backups) afgerond moet worden: een tweede reden waarom een herstel mislukt,
toevoegen aan een situatie zonder werkende backups, is de verkeerde volgorde.

**Rechtenbeheer is de eerste plek waar een gebruiker zichzelf kan buitensluiten.** Zie de
laatste-admin-regel in §3a.

---

## 7. Voorgestelde knip

Drie stukken, elk apart bruikbaar, in deze volgorde:

1. **Beheermenu + gebruikers en rechten.** Hangt nergens van af, lost een bestaande
   handmatige databasehandeling op, en levert het menu waar de rest in landt.
2. **E-mailinstellingen.** Vereist het ADR-besluit over sleutelbeheer (§4) vóór de migratie.
   Levert op zichzelf nog geen verstuurde mail op — wel een testbare verbinding.
3. **Verzendscherm, handpicked en bulk.** Hangt aan fase B van het surveybeheerplan (tokens)
   en aan stuk 2 (afzender). Hoort daarom ná fase B en samen met of ná fase D.

Reden voor deze volgorde: stuk 1 is het minst risicovol en maakt de rest bereikbaar; stuk 3
is het meest risicovol en leunt op beide andere.

---

## 8. Openstaande vragen voor de eigenaar

Geen daarvan blokkeert het surveybeheerplan; ze blokkeren wel de bouw van deze feature.

1. **Hoe komt een uitgenodigde collega tot stand in Entra External ID?** MCM2 zet geen
   wachtwoorden (ADR-006). Nodigt MCM2 uit en maakt Entra het account, of bestaat de
   gebruiker daar al en koppelt MCM2 alleen een membership? Dit bepaalt of stuk 1 een
   scherm is of een integratie.
2. **Welke leveranciercriteria gelden voor de bulkselectie?** Categorie, compliancestatus,
   contractstatus, laatste ronde — welke combinatie is nodig? Zonder één concreet voorbeeld
   is het filterscherm niet te ontwerpen.
3. **Waar leeft de hoofdsleutel?** De vórm is bepaald (§4d: datasleutel per rij onder een
   hoofdsleutel, versleuteld in de applicatie). Wat nog open staat is waar die hoofdsleutel
   woont: omgevingsvariabele nu met KMS later (Issue #21 noemt KMS), of meteen KMS. Dit is
   het ADR-besluit.
4. **Wordt een gewijzigde instelling pas actief ná een geslaagde testmail?** Zie §4c,
   maatregel 3. Sterkere bescherming tegen een stille verzendfout, iets omslachtiger scherm.
5. **Blijft Issue #13 gelden zoals hij er staat?** Zijn acceptatiecriterium noemt
   omgevingsvariabelen; dit ontwerp zegt database-met-versleuteling. Een van de twee moet
   worden bijgesteld.
6. **Wat gebeurt er met lopende rondes als de SMTP-instelling wijzigt?** Vermoedelijk niets
   — verstuurde mail is verstuurd — maar het is beter dat expliciet te zeggen dan het te
   ontdekken.
