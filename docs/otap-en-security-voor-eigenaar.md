# OTAP, CI en security in MCM2 — uitleg voor de eigenaar

> Dit document legt in gewone taal uit hoe het ontwikkel- en testproces van MCM2 werkt, en welke bekende NIS2-thema's dit ontwerp raakt. Het is geen juridisch advies en geen compliance-verklaring — het is een eerlijk overzicht van wat er nu staat, wat dat oplevert, en wat nog ontbreekt.
>
> Laatst bijgewerkt: 2026-07-27.

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

**Waar staat MCM2 nu?** Alleen de eerste twee stappen (Ontwikkel, Test) bestaan al. Acceptatie en Productie bestaan nog niet — dat komt pas als er een eerste testomgeving in de cloud (AWS) wordt opgezet, wat bewust nog niet is gedaan omdat dat pas nodig is vóór de eerste Transdev-pilot.

**Waarom is dit belangrijk, ook als je geen developer bent?**
Zonder deze stappen zou elke wijziging direct in productie terechtkomen — dat is hetzelfde als een nieuwe medewerker meteen, zonder proefperiode, zelfstandig bij een klant laten werken. OTAP zorgt dat fouten worden opgevangen vóórdat ze schade kunnen doen, en dat er altijd een spoor is van wie wat heeft gewijzigd en wanneer.

---

## 2. Wat is CI, en wat doet het concreet in MCM2?

**CI** staat voor **Continuous Integration** — vrij vertaald: "elke wijziging wordt automatisch getest zodra die wordt aangeboden".

Concreet, bij MCM2: telkens wanneer er nieuwe code naar de centrale opslagplaats (GitHub) wordt gestuurd, start er automatisch een reeks controles. Dat gebeurt op een server van GitHub, niet op mijn of jouw eigen computer — zo is de uitkomst altijd hetzelfde, onafhankelijk van wie het heeft aangeboden of vanaf welke laptop.

### De twee controles die MCM2 nu heeft

**Controle 1 — "Is de code netjes en correct opgebouwd?"**
Dit controleert of de code een consistente stijl volgt, of er geen voor de hand liggende programmeerfouten in staan, en of de code "logisch klopt" volgens de regels van de programmeertaal. Vergelijk het met een spellingscontrole plus een grammaticacontrole, samen uitgevoerd op elke wijziging.

**Controle 2 — "Kan klant A nooit bij klant B's gegevens komen?"**
Dit is de belangrijkste controle voor een systeem dat straks meerdere klanten (tenants) tegelijk bedient. De computer zet automatisch twee nep-klanten op, probeert expliciet om vanuit de ene "klant" bij de gegevens van de andere te komen, en faalt de hele controle als dat op enige manier lukt. Dit gebeurt niet op de echte database van Transdev of een andere klant — de computer zet voor deze test tijdelijk een eigen, wegwerpbare, lege database op, gebruikt die, en gooit hem daarna weg. Er wordt dus nooit met echte klantgegevens getest.

### Wat betekent een "groen" of "rood" resultaat?

- **Groen**: beide controles zijn geslaagd. De wijziging mag in principe verder de OTAP-straat door.
- **Rood**: iets is misgegaan — bijvoorbeeld een programmeerfout, of (bij controle 2) een wijziging die per ongeluk de scheiding tussen klanten zou verzwakken. Bij rood mag de wijziging niet door naar de volgende stap.

**Belangrijke, eerlijke beperking:** een rode uitslag *blokkeert* het samenvoegen naar de hoofdversie van de code nu nog niet automatisch — dat vereist een GitHub-instelling ("branch protection") die op dit moment niet beschikbaar is zonder een betaald GitHub-abonnement voor de organisatie. Tot die tijd is "nooit een rode wijziging doorvoeren" een werkafspraak, geen technisch afgedwongen regel. Zodra dat is opgelost, wordt dit een harde blokkade.

### Wat CI nu nog *niet* controleert

- Of de volledige applicatie ook echt opstart en werkt (dat komt met de Acceptatie-stap, die nog niet bestaat).
- Of het "verpakken" van de software in een Docker-container (het formaat waarin het straks naar de cloud gaat) foutloos werkt.
- De volledige testverzameling van de applicatie (los van de tenant-scheidingstest).

Dit is bewust uitgesteld, omdat er nog een openstaande technische knoop is met een van de gebruikte hulpmiddelen (Prisma) die eerst apart moet worden opgelost — zie `docs/STATUS.md` voor de actuele stand.

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

**Wat nog ontbreekt:**
De applicatie weet momenteel nog niet *zeker* wie een gebruiker daadwerkelijk is — de "welke klant ben ik"-informatie komt nu nog uit een technisch, makkelijk te vervalsen signaal (een stukje informatie dat de gebruiker zelf meestuurt), niet uit een geverifieerd inlogproces. Dit is op dit moment expliciet toegestaan omdat er nog geen tweede, externe klant is — maar moet opgelost zijn vóórdat Transdev's leveranciers echt gaan inloggen.

### Thema: logging en aantoonbaarheid — "kunnen we achteraf bewijzen wat er is gebeurd?"

**Wat er nu staat:**
Er is een apart, technisch beveiligd logboek (`audit_event`) waarin belangrijke wijzigingen in de data worden bijgehouden. Dit logboek is zo ingericht dat de applicatie er wel aan toe mag voegen, maar niets uit mag verwijderen of wijzigen — vergelijkbaar met een notarieel kasboek waar je alleen nieuwe regels bij kunt schrijven.

**Wat nog ontbreekt:**
Dit logboek is nog niet gekoppeld aan de rest van de applicatiefunctionaliteit (er is nog geen feature die er daadwerkelijk gebruik van maakt), en er is nog geen ingerichte manier om dit logboek structureel te bewaken of te doorzoeken bij een incident.

### Thema: wijzigingsbeheer — "hoe voorkomen we dat een fout ongemerkt production bereikt?"

**Wat er nu staat:**
Dit is precies waar hoofdstuk 1 en 2 over gaan: elke wijziging aan de code doorloopt automatische controles vóórdat die verder mag. Er is ook een vastgelegde regel dat wijzigingen aan het datamodel (de structuur van de database) alleen via een genummerd, traceerbaar "migratiebestand" mogen — nooit via een losse, ongedocumenteerde handmatige aanpassing.

**Wat nog ontbreekt:**
Zoals genoemd: de controles kunnen een samenvoeging naar de hoofdversie nog niet technisch blokkeren bij een fout (afhankelijk van een GitHub-abonnement). En de Acceptatie/Productie-stappen van OTAP bestaan nog niet.

### Thema: leveranciers- en afhankelijkheidsbeheer — "hoe goed kennen we de risico's van de bouwstenen die we gebruiken?"

**Wat er nu staat:**
Er is een expliciete, gedocumenteerde afweging gemaakt over welke database-technologie (ORM) wordt gebruikt, inclusief een beoordeling van het risico dat de leverancier van die technologie failliet gaat of ermee stopt (`vendorrisico`). Softwareversies worden vastgepind (niet "altijd de nieuwste versie automatisch"), zodat een onverwachte wijziging bij een leverancier niet ongemerkt het eigen systeem beïnvloedt.

**Wat nog ontbreekt:**
Een automatische scan die waarschuwt als een gebruikte softwarebibliotheek een bekend beveiligingslek heeft (een "dependency scan") staat nog niet in de CI-controles.

### Thema: incidentrespons — "wat doen we als het toch misgaat?"

**Wat er nu staat:** niets structureels — dit is op dit moment het minst uitgewerkte thema.

**Wat nog ontbreekt:** een concreet, geschreven plan voor "wat doen we als er een datalek of storing is, wie moet dat weten, binnen welke tijd". Dit hoort typisch bij de `docs/runbooks/`-map, die nu nog leeg is.

---

## 5. Kort: wat is die "Row-Level Security" waar steeds naar verwezen wordt?

Omdat dit begrip in bijna elk thema hierboven terugkomt: Row-Level Security (RLS) is een beveiligingsfunctie die **in de database zelf** zit, niet in de applicatiecode. Het werkt als een onzichtbare filter die de database dwingt: "toon en accepteer alleen de rijen die bij de huidige klant horen — wat de applicatie ook vraagt."

Het belang hiervan: zelfs als er ooit een fout in de applicatiecode zou zitten die per ongeluk de verkeerde klant zou opvragen, zou de database die vraag alsnog blokkeren. Het is een **tweede, onafhankelijke verdedigingslaag**, niet de enige laag. Dit is precies waarom er zoveel aandacht is besteed aan het bewijzen (via de geautomatiseerde test uit hoofdstuk 2) dat deze laag daadwerkelijk werkt en niet per ongeluk wordt omzeild door een verkeerd geconfigureerde databaserol.

---

## 6. Samenvatting: waar staan we, in één oogopslag

| Onderdeel | Status |
|---|---|
| Automatische codecontrole (CI) bij elke wijziging | ✅ Werkt, bewezen in de praktijk |
| Automatische test die klant-scheiding bewijst | ✅ Werkt, bewezen in de praktijk |
| Blokkade die een "rode" wijziging technisch tegenhoudt | ❌ Nog niet — wacht op GitHub-abonnement |
| Testomgeving die op productie lijkt (Acceptatie) | ❌ Bestaat nog niet |
| Echte productieomgeving | ❌ Bestaat nog niet |
| Wie-ben-ik-echt-verificatie voor gebruikers | ❌ Nog niet — blinde vertrouwen op een technisch signaal |
| Audit-logboek (basis) | 🟡 Bestaat, nog niet gekoppeld aan functionaliteit |
| Geschreven incidentplan | ❌ Bestaat nog niet |
| Bewuste, gedocumenteerde leveranciersafweging | ✅ Gedaan voor de databasetechnologie |
| Actuele, doorzoekbare backlog (bugs/features/planning) | ✅ GitHub Issues, sinds 2026-07-27 |

Voor de actuele, meest up-to-date versie van deze lijst: zie altijd `docs/STATUS.md` — dat document wordt bijgewerkt bij elke relevante wijziging, dit document (`docs/otap-en-security-voor-eigenaar.md`) is bedoeld als uitleg van de *concepten*, niet als dagelijkse statustracker.
