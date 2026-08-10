# OTAP, CI en security in MCM2 — uitleg voor de eigenaar

> Dit document legt in gewone taal uit hoe het ontwikkel- en testproces van MCM2 werkt, en welke bekende NIS2-thema's dit ontwerp raakt. Het is geen juridisch advies en geen compliance-verklaring — het is een eerlijk overzicht van wat er nu staat, wat dat oplevert, en wat nog ontbreekt.
>
> Laatst bijgewerkt: 2026-08-10 — acceptatie en productie draaien nu echt (§1), CI heeft vier controles in plaats van twee (§2), en er is een uitrolketen met rollback (§2b). De stand van 27 juli klopte op acht punten niet meer.

---

## 1. Wat is OTAP, in gewone taal?

OTAP staat voor **Ontwikkel, Test, Acceptatie, Productie** — vier stappen die elke wijziging aan de software doorloopt vóórdat die bij een echte gebruiker terechtkomt.

Denk aan het als een kwaliteitscontrole in een fabriek: je zet geen product op de vrachtwagen zonder dat het eerst door een aantal controlestations is gegaan. Bij software heet dat OTAP.

| Stap | Wat gebeurt hier? | Wie/wat controleert? |
|---|---|---|
| **Ontwikkel** | Ik (of een toekomstige developer) bouwt een wijziging op een eigen "werkkopie" van de code (een *branch*) | Niemand nog — dit is nog volledig geïsoleerd |
| **Test** | De wijziging wordt automatisch gecontroleerd door een computer, niet door een mens | **CI** (zie hoofdstuk 2) |
| **Acceptatie** | De wijziging draait op een testomgeving die op productie lijkt, zodat je het zelf kan proberen vóórdat het "echt" is | Jij, functioneel |
| **Productie** | De wijziging is live voor echte gebruikers (bijv. Transdev) | — |

**Waar staat MCM2 nu?** Sinds 2026-08-10 bestaan **alle vier de stappen**. Acceptatie en Productie draaien op een aparte machine (`saxombp`, de thuisserver die ook de Saxo-app draait), elk met een eigen database die niets deelt met de ander.

| Omgeving | Waar | Bereikbaar op |
|---|---|---|
| Ontwikkel | jouw laptop | `localhost:3000` / `:5001` |
| Test | jouw laptop, tijdelijk | wegwerpdatabase, verdwijnt na de test |
| **Acceptatie** | saxombp | `http://saxombp:5011/health` |
| **Productie** | saxombp | `http://saxombp:5021/health` |

Alleen bereikbaar via Tailscale — dus vanaf jouw eigen apparaten, niet vanaf internet.

> **Wat dit wél en niet is.** Dit is een **procesbewijs**: het toont aan dat dezelfde software die door de controles kwam ook echt draait op een andere machine, dat een nieuwe versie de oude vervangt, en dat terugdraaien werkt. Het is **geen** productieomgeving met garanties — één machine, thuisinternet, geen reservestroom. Voor de Transdev-pilot is een echte cloudomgeving nodig; ADR-011 heeft dat al vastgesteld.
>
> Het verschil is belangrijk genoeg om te herhalen: het proces is bewezen, de beschikbaarheid niet.

**Wat is er van de frontend?** De backend doorloopt de volledige keten. De frontend nog niet: die heeft een technisch probleem waardoor één "verpakking" al weet met welke server hij praat (Issue #51). Twee verpakkingen maken — één voor acceptatie, één voor productie — zou dat oplossen, maar breekt het hele uitgangspunt: dan is wat je test niet meer wat je uitrolt. Daarom draait de frontend voorlopig bewust niet mee.

**Waarom is dit belangrijk, ook als je geen developer bent?**
Zonder deze stappen zou elke wijziging direct in productie terechtkomen — dat is hetzelfde als een nieuwe medewerker meteen, zonder proefperiode, zelfstandig bij een klant laten werken. OTAP zorgt dat fouten worden opgevangen vóórdat ze schade kunnen doen, en dat er altijd een spoor is van wie wat heeft gewijzigd en wanneer.

---

## 2. Wat is CI, en wat doet het concreet in MCM2?

**CI** staat voor **Continuous Integration** — vrij vertaald: "elke wijziging wordt automatisch getest zodra die wordt aangeboden".

Concreet, bij MCM2: telkens wanneer er nieuwe code naar de centrale opslagplaats (GitHub) wordt gestuurd, start er automatisch een reeks controles. Dat gebeurt op een server van GitHub, niet op mijn of jouw eigen computer — zo is de uitkomst altijd hetzelfde, onafhankelijk van wie het heeft aangeboden of vanaf welke laptop.

### De vier controles die MCM2 nu heeft

**Controle 1 — "Is de code netjes en correct opgebouwd?"**
Dit controleert of de code een consistente stijl volgt, of er geen voor de hand liggende programmeerfouten in staan, en of de code "logisch klopt" volgens de regels van de programmeertaal. Vergelijk het met een spellingscontrole plus een grammaticacontrole, samen uitgevoerd op elke wijziging.

**Controle 2 — "Kan klant A nooit bij klant B's gegevens komen?"**
Dit is de belangrijkste controle voor een systeem dat straks meerdere klanten (tenants) tegelijk bedient. De computer zet automatisch twee nep-klanten op, probeert expliciet om vanuit de ene "klant" bij de gegevens van de andere te komen, en faalt de hele controle als dat op enige manier lukt. Dit gebeurt niet op de echte database van Transdev of een andere klant — de computer zet voor deze test tijdelijk een eigen, wegwerpbare, lege database op, gebruikt die, en gooit hem daarna weg. Er wordt dus nooit met echte klantgegevens getest.

**Controle 3 — "Kan de software ingepakt worden, en start hij dan ook?"** *(sinds 2026-08)*
De software wordt verpakt in een container — het formaat waarin hij naar een server gaat. Dat die verpakking *lukt* is niet genoeg: de controle start hem daarna ook op en verwacht dat hij netjes klaagt over een ontbrekende databaseverbinding. Doet hij dat, dan weten we dat het gecompileerde resultaat echt laadt.

Die tweede stap is er niet voor niets: bij een eerder probleem met een hulpmiddel (Prisma) slaagde de verpakking wél en faalde pas het opstarten.

**Controle 4 — "Klopt de documentatie nog met de werkelijkheid?"** *(sinds 2026-08-10)*
Een controle die faalt als een runbook langer dan zes maanden niet is bijgewerkt, als er een runbook bestaat dat niet in de index staat, of als de lijst van wat er in een backup hoort achterloopt op de database.

Die laatste is de belangrijkste. Op 2026-08-10 bleek die lijst twaalf versies achter te lopen, waardoor de dagelijkse backupcontrole "compleet" meldde over een backup die vijf tabellen miste. De controle stond er wel, maar hij vergeleek met een verouderde verwachting.

### Wat betekent een "groen" of "rood" resultaat?

- **Groen**: beide controles zijn geslaagd. De wijziging mag in principe verder de OTAP-straat door.
- **Rood**: iets is misgegaan — bijvoorbeeld een programmeerfout, of (bij controle 2) een wijziging die per ongeluk de scheiding tussen klanten zou verzwakken. Bij rood mag de wijziging niet door naar de volgende stap.

**Belangrijke, eerlijke beperking:** een rode uitslag *blokkeert* het samenvoegen naar de hoofdversie van de code nu nog niet automatisch — dat vereist een GitHub-instelling ("branch protection") die op dit moment niet beschikbaar is zonder een betaald GitHub-abonnement voor de organisatie. Tot die tijd is "nooit een rode wijziging doorvoeren" een werkafspraak, geen technisch afgedwongen regel. Zodra dat is opgelost, wordt dit een harde blokkade.

### Wat CI nu nog *niet* controleert

- **Of de schermen werken zoals bedoeld.** CI test de motor, niet het dashboard. Daarvoor zijn er aparte browsertests die een echte browser openen en door de app klikken — die draaien op de ontwikkelmachine, niet in CI, omdat ze twee projecten tegelijk nodig hebben.
- **Of een bibliotheek een bekend beveiligingslek heeft.** Een automatische scan daarop ontbreekt nog (Issue #22 en #59).
- **Of een "rode" wijziging technisch geblokkeerd wordt.** Zie de beperking hieronder.

De knoop met Prisma die hier eerder stond is opgelost: dat hulpmiddel is vervangen door Drizzle (ADR-010), en de tests die daarop wachtten draaien inmiddels.

---

## 2b. Van goedgekeurde code naar een draaiende server

*Nieuw sinds 2026-08-10. Dit was het grootste gat in dit document.*

Code die door alle controles komt, moet ook ergens gaan draaien. Dat gebeurt nu zo:

```
Wijziging goedgekeurd en samengevoegd
  → de software wordt ingepakt en opgeslagen met een uniek versienummer
     → uitrollen naar ACCEPTATIE   (één commando)
        → jij kijkt of het klopt
           → promoveren naar PRODUCTIE   (vraagt bevestiging)
```

**Het belangrijkste principe: er wordt niets opnieuw ingepakt.** Productie krijgt exact dezelfde verpakking die op acceptatie stond — niet een nieuwe die "hetzelfde zou moeten zijn". Zou de server zelf inpakken, dan is het per definitie een ander product dan wat getest is, en dan bewijst een geslaagde acceptatietest niets.

**Wat er bij elke uitrol gebeurt, in deze volgorde:**

| Stap | Wat | Waarom deze volgorde |
|---|---|---|
| 1 | Verpakking ophalen | Een tikfout faalt hier, vóórdat er iets vervangen is |
| 2 | Database bijwerken | Vóór de nieuwe software start — die verwacht de nieuwe structuur |
| 3 | **Terugkijken of dat echt gebeurd is** | Zie hieronder |
| 4 | Software vervangen | — |
| 5 | Rookproef | Antwoordt de app, of is alleen de container gestart? |

**Stap 3 verdient uitleg**, want die is er gekomen door een fout die precies op deze dag optrad. De eerste uitrol meldde "geslaagd" over een **lege database**. De rookproef werd zelfs groen — een applicatie zonder gegevens antwoordt prima op de vraag "leef je nog". Pas een telling in de database liet zien dat er nul tabellen stonden.

Sindsdien leest de uitrol terug uit de database hoeveel wijzigingen er werkelijk zijn doorgevoerd, en stopt hij bij nul. **Een geruststellende melding is geen bewijs** — dat is in dit project inmiddels drie keer duur gebleken.

**Als de rookproef faalt, draait het systeem zichzelf terug** naar de vorige versie en controleert opnieuw. Dat is beproefd, niet aangenomen: op 2026-08-10 is een oudere versie teruggezet en daarna weer de nieuwe, beide keren met succes.

**Wat dit oplevert voor de verhuizing naar een echte cloud:** de stap "waar gaat de verpakking naartoe" is de enige die dan verandert. Inpakken, bijwerken, controleren en terugdraaien blijven identiek. Dat was de opzet — zie `docs/runbooks/uitrol-acceptatie-en-productie.md`.

---

## 3. Hoe houden we bugs, ideeën en de planning bij?

Tot 2026-07-27 stond dit in een los Word/Markdown-achtig document (`06-prioritized-roadmap.md`). Dat document bleek een bekend probleem te hebben: het werd geschreven op één moment, maar niemand werkte het structureel bij zodra er iets werd opgelost of nieuw ontstond. Na een paar dagen klopte het dus al niet meer — precies zoals een papieren to-do-lijst die je nooit doorstreept.

**De oplossing: GitHub Issues.**

GitHub (waar de code ook staat) heeft een ingebouwd systeem voor "dingen die nog gedaan moeten worden": een lijst met kaartjes, elk met een titel, een beschrijving, en een status (open of gesloten). Zie het als een digitaal, doorzoekbaar Post-it-bord dat bij de code zelf hoort — je hoeft er geen apart abonnement voor te nemen, het zit al bij de repository die er al is.

### Wat staat er in elk kaartje ("Issue")?

- **Titel** — kort, wat moet er gebeuren.
- **Beschrijving** — waarom dit nodig is, en wanneer het "klaar" is (het acceptatiecriterium).
- **Type-label** — is het een **bug** (iets werkt niet zoals het zou moeten), een **enhancement** (iets nieuws, een feature-idee), of een **chore** (technisch onderhoud, bijv. "versie van een bibliotheek bijwerken")?
- **Prioriteit-label** — vier niveaus, dezelfde indeling die al in de oude roadmap stond, nu als label in plaats van als losse rij in een tabel:
  - `priority:p0` — moet gebeuren vóórdat er ook maar één regel nieuwe functionaliteit bij komt.
  - `priority:before-pilot` — nodig vóór de eerste Transdev-pilot.
  - `priority:before-production` — nodig vóórdat er (meerdere) betalende klanten op draaien.
  - `priority:later` — bewust uitgesteld, tenzij er een concrete aanleiding ontstaat.

### Hoe kijk je dit zelf na, zonder dat ik het moet uitleggen?

Je kunt gewoon naar `https://github.com/AlingAdvies/MCM2/issues` gaan in je browser — dat is een normale webpagina, geen speciale tool nodig. Je kunt filteren op label (bijvoorbeeld: "toon me alleen de dingen die vóór de pilot moeten gebeuren") en zien of iets nog open staat of al is afgerond ("gesloten").

### Wat betekent dit voor jou in de praktijk?

- Als jij een bug tegenkomt of een idee hebt: dat wordt een nieuw kaartje, niet een regel in een chatgesprek die daarna kwijtraakt.
- Als ik iets oplos: ik verwijs in de commit (de opgeslagen wijziging) naar het kaartjesnummer, zodat je achteraf kan terugvinden welke code-wijziging bij welk kaartje hoorde.
- `docs/STATUS.md` blijft de plek voor "waar staan we nu, in het algemeen" — de Issues zijn de plek voor "wat moet er nog specifiek gebeuren, punt voor punt".

---

## 4. Welke NIS2-achtige thema's raakt dit ontwerp?

NIS2 is een Europese wet die eisen stelt aan hoe organisaties omgaan met cyberrisico's — met name rond risicobeheer, toegangsbeheer, logging en incidentrespons. **MCM2 is op dit moment geen NIS2-compliant systeem, en dit document claimt dat ook niet.** Wat hier volgt is een eerlijk overzicht van welke *thema's* uit NIS2 dit ontwerp raakt, en wat daarvan al staat versus nog ontbreekt.

### Thema: toegangsbeheer — "wie mag wat, en hoe wordt dat afgedwongen?"

**Wat er nu staat:**
Database-toegang is opgesplitst in gescheiden rollen met elk een beperkt doel:
- Een rol die de applicatie zelf gebruikt (kan alleen data lezen/schrijven binnen de eigen tenant, dankzij een technische maatregel genaamd Row-Level Security — zie hoofdstuk 5).
- Een aparte rol die uitsluitend gebruikt wordt om het datamodel te wijzigen (bijv. een nieuwe tabel toevoegen) — deze rol wordt nooit door de applicatie zelf gebruikt.
- Geen van beide rollen kan de veiligheidsmaatregel (Row-Level Security) omzeilen.

Dit is het principe van **"least privilege"**: elke identiteit krijgt precies genoeg rechten om zijn taak te doen, niet meer. Dat is een kernprincipe dat NIS2 verwacht bij risicobeheer.

**Wat er sinds eind juli bij is gekomen:**
De applicatie weet nu wél zeker wie een gebruiker is. Inloggen loopt via Microsoft Entra (ADR-006): de gebruiker logt in bij Microsoft, en de applicatie krijgt een identiteit terug die niet door de gebruiker zelf te verzinnen is. De "welke klant ben ik"-informatie komt daarna uit de sessie in de database, niet uit iets dat de browser meestuurt.

Op 2026-08-09 is dat voor het eerst in productie doorlopen: een echte tenant (AlingAdvies) aangemaakt, uitnodiging verstuurd, en ingelogd met een echte Microsoft-identiteit.

**Wat nog ontbreekt:**
- De verificatie van het Microsoft-token is nog nooit tegen de échte Entra-omgeving beproefd onder productieomstandigheden.
- Er is geen procedure voor het vervangen van wachtwoorden en sleutels. Die staan nu in één bestand op de ontwikkelmachine en op de server; bij vertrek van een betrokkene of een vermoed lek is er niets om te volgen. **Dit staat als openstaand gat in de onderhoudskalender en verdient aandacht vóór de pilot.**

### Thema: logging en aantoonbaarheid — "kunnen we achteraf bewijzen wat er is gebeurd?"

**Wat er nu staat:**
Er is een apart, technisch beveiligd logboek (`audit_event`) waarin belangrijke wijzigingen in de data worden bijgehouden. Dit logboek is zo ingericht dat de applicatie er wel aan toe mag voegen, maar niets uit mag verwijderen of wijzigen — vergelijkbaar met een notarieel kasboek waar je alleen nieuwe regels bij kunt schrijven.

**Wat er sinds eind juli bij is gekomen:**
Het logboek wordt nu daadwerkelijk gevuld. Elke inzending van een leverancier, elk oordeel van een beoordelaar en elke goedkeuring schrijft een regel — inclusief wie het deed en wanneer. Dat is de aantoonbaarheid waar NIS2 om vraagt: niet dat er een logboek *bestaat*, maar dat er in staat wat er gebeurd is.

**Wat nog ontbreekt:**
Er is nog geen ingerichte manier om dit logboek te bewaken of te doorzoeken bij een incident. Er is ook geen alarm dat afgaat bij verdacht gedrag — je zou er met de hand in moeten kijken, en dan moet je al weten dát er iets aan de hand is.

### Thema: wijzigingsbeheer — "hoe voorkomen we dat een fout ongemerkt production bereikt?"

**Wat er nu staat:**
Dit is precies waar hoofdstuk 1 en 2 over gaan: elke wijziging aan de code doorloopt automatische controles vóórdat die verder mag. Er is ook een vastgelegde regel dat wijzigingen aan het datamodel (de structuur van de database) alleen via een genummerd, traceerbaar "migratiebestand" mogen — nooit via een losse, ongedocumenteerde handmatige aanpassing.

**Wat er sinds eind juli bij is gekomen:**
De Acceptatie- en Productiestappen bestaan nu (§1 en §2b), inclusief de mogelijkheid om een slechte versie terug te draaien. Dat laatste is het onderdeel dat in de praktijk het vaakst nooit beproefd is — hier wel, en het staat als kwartaaltaak in de onderhoudskalender.

**Wat nog ontbreekt:**
De controles kunnen een samenvoeging naar de hoofdversie nog steeds niet technisch blokkeren bij een fout (afhankelijk van een GitHub-abonnement). Tot die tijd blijft "nooit een rode wijziging doorvoeren" een werkafspraak.

Daar hoort een eerlijke kanttekening bij: **op 2026-08-10 is er één wijziging rechtstreeks op de hoofdversie gezet**, zonder de gebruikelijke tussenstap. De wijziging zelf was beproefd en groen, maar de werkwijze klopte niet. Dat is precies waar een technische blokkade voor bedoeld is — een werkafspraak sneuvelt onder tijdsdruk.

### Thema: leveranciers- en afhankelijkheidsbeheer — "hoe goed kennen we de risico's van de bouwstenen die we gebruiken?"

**Wat er nu staat:**
Er is een expliciete, gedocumenteerde afweging gemaakt over welke database-technologie (ORM) wordt gebruikt, inclusief een beoordeling van het risico dat de leverancier van die technologie failliet gaat of ermee stopt (`vendorrisico`). Softwareversies worden vastgepind (niet "altijd de nieuwste versie automatisch"), zodat een onverwachte wijziging bij een leverancier niet ongemerkt het eigen systeem beïnvloedt.

**Wat nog ontbreekt:**
Een automatische scan die waarschuwt als een gebruikte softwarebibliotheek een bekend beveiligingslek heeft (een "dependency scan") staat nog niet in de CI-controles. Dat is nu een handmatige maandelijkse taak in de onderhoudskalender — een afspraak dus, geen afdwinging (Issue #22 en #59).

### Thema: continuïteit — "wat als de gegevens weg zijn?"

*Dit thema stond hier eerder niet in, terwijl het het meest concrete werk van de afgelopen twee weken opleverde.*

**Wat er nu staat:**
Er draait elke ochtend om 07:00 een backup van de productiedatabase naar OneDrive, en een half uur later een controle die drie dingen nagaat: is er een backup van vandaag, zit alles erin wat erin hoort, en — wekelijks — komt het er ook weer uit als je hem terugzet. Bij een probleem krijg je een bericht op je telefoon; blijft alles goed, dan krijg je één keer per week een levensteken.

Dat laatste is minder vanzelfsprekend dan het klinkt: zonder levensteken weet je bij stilte niet of alles goed gaat of dat de melder zelf stuk is.

**Wat nog ontbreekt:**
De backup draait op dezelfde machine als waar ontwikkeld wordt. Staat de laptop uit, dan draait geen van beide en komt er geen bericht. Het wekelijkse levensteken is de enige afdekking (Issue #58).

### Thema: incidentrespons — "wat doen we als het toch misgaat?"

**Wat er sinds eind juli bij is gekomen:**
Voor twee soorten problemen is er nu een geschreven procedure:

- **Een mislukte uitrol** — de uitrol draait zichzelf terug, en het runbook beschrijft hoe je handmatig naar een oudere versie gaat.
- **Een backup die faalt of achterloopt** — je krijgt een bericht, en het runbook beschrijft per melding wat je doet.

**Wat nog ontbreekt, en dit is het zwaarste gat in dit document:**
Er is nog steeds geen plan voor een echt incident — een datalek, een omgeving die spontaan omvalt, een vermoeden van ongeautoriseerde toegang. Wie moet dat weten, binnen welke tijd, en wat doe je in het eerste half uur? Voor NIS2 is dat een meldplicht binnen 24 uur; die klok loopt of je een plan hebt of niet.

Er is bovendien **geen enkele bewaking** die je waarschuwt als een omgeving omvalt. Je zou het merken doordat iemand belt.

Dat staat als openstaand punt in `docs/runbooks/onderhoudskalender.md` §5, met urgentie "hoog vanaf de pilotstart".

---

## 5. Kort: wat is die "Row-Level Security" waar steeds naar verwezen wordt?

Omdat dit begrip in bijna elk thema hierboven terugkomt: Row-Level Security (RLS) is een beveiligingsfunctie die **in de database zelf** zit, niet in de applicatiecode. Het werkt als een onzichtbare filter die de database dwingt: "toon en accepteer alleen de rijen die bij de huidige klant horen — wat de applicatie ook vraagt."

Het belang hiervan: zelfs als er ooit een fout in de applicatiecode zou zitten die per ongeluk de verkeerde klant zou opvragen, zou de database die vraag alsnog blokkeren. Het is een **tweede, onafhankelijke verdedigingslaag**, niet de enige laag. Dit is precies waarom er zoveel aandacht is besteed aan het bewijzen (via de geautomatiseerde test uit hoofdstuk 2) dat deze laag daadwerkelijk werkt en niet per ongeluk wordt omzeild door een verkeerd geconfigureerde databaserol.

---

## 6. Samenvatting: waar staan we, in één oogopslag

| Onderdeel | Status | Sinds |
|---|---|---|
| Automatische codecontrole (CI) bij elke wijziging | ✅ Werkt, bewezen in de praktijk | juli |
| Automatische test die klant-scheiding bewijst | ✅ Werkt, bewezen in de praktijk | juli |
| Verpakking wordt gebouwd én gestart in CI | ✅ | augustus |
| Controle dat de documentatie niet veroudert | ✅ | 10-08 |
| **Acceptatieomgeving** | ✅ Draait op saxombp, eigen database | 10-08 |
| **Productieomgeving (als procesbewijs)** | ✅ Draait op saxombp, gescheiden data | 10-08 |
| **Uitrol met één commando, inclusief terugdraaien** | ✅ Beproefd, niet aangenomen | 10-08 |
| Frontend doorloopt dezelfde keten | ❌ Nog niet — Issue #51 | — |
| Wie-ben-ik-echt-verificatie voor gebruikers | ✅ Microsoft Entra, in productie doorlopen | 09-08 |
| Audit-logboek | ✅ Wordt gevuld bij inzendingen en oordelen | augustus |
| Dagelijkse backup met controle op de inhoud | ✅ Plus melding op je telefoon | 04-08 |
| Herstel uit een backup beproefd | ✅ Wekelijks, automatisch | 04-08 |
| Blokkade die een "rode" wijziging technisch tegenhoudt | ❌ Wacht op GitHub-abonnement | — |
| Scan op bekende lekken in bibliotheken | 🟡 Handmatig, maandelijks | — |
| **Geschreven incidentplan** | ❌ Zwaarste openstaande gat | — |
| **Bewaking die waarschuwt bij uitval** | ❌ Bestaat niet | — |
| **Procedure voor het vervangen van sleutels** | ❌ Bestaat niet | — |
| Echte cloudomgeving met beschikbaarheidsgarantie | ❌ Nodig vóór de pilot | — |
| Bewuste, gedocumenteerde leveranciersafweging | ✅ Databasetechnologie, hosting, identity | juli |
| Actuele, doorzoekbare backlog | ✅ GitHub Issues | 27-07 |

**De drie vetgedrukte rode regels horen bij elkaar** en vormen samen het beeld: er kan iets misgaan zonder dat iemand het merkt, en als het gemerkt wordt is er geen procedure. Dat is verdedigbaar zolang er geen klantdata in zit — maar sinds 2026-08-09 leeft er een echte tenant in productie.

Voor de actuele, meest up-to-date versie van deze lijst: zie altijd `docs/STATUS.md` — dat document wordt bijgewerkt bij elke relevante wijziging, dit document (`docs/otap-en-security-voor-eigenaar.md`) is bedoeld als uitleg van de *concepten*, niet als dagelijkse statustracker.

Wat er terugkeert en wanneer, staat in `docs/runbooks/onderhoudskalender.md`.
