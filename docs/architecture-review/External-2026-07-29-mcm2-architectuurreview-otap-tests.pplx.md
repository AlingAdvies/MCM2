# Architectuurreview MCM2 — OTAP-straat en teststrategie

**Datum:** 2026-07-29
**Reviewvorm:** onafhankelijke tweede mening op `00-review-aanvraag-architectuur-otap-tests.md`, inclusief Bijlage A
**Volgorde:** conform §11 — eerst de drie prioriteiten uit vraag 9, daarna vragen 1 t/m 8, afgesloten met tegenspraak op §8

---

## Deel 1 — De drie dingen die vóór de pilot af moeten (vraag 9)

Precies drie. Databaseback-up is inhoudelijk aanwezig, maar samengevoegd met gegevensduurzaamheid in prioriteit 1, zodat de telling op drie blijft — bestanden en database vormen samen "kan de pilot een dataverlies overleven" en horen als één werkpakket behandeld te worden, niet als twee losse issues die apart geprioriteerd worden.

### 1. Duurzame objectopslag + herstelpad/back-up voor uploads (en database)

```
Vraag:        9
Bevinding:    Bestanden op de containerschijf en de database-dump op dezelfde machine
              betekenen dat één ongeluk (image-vervanging, laptopstoring) al het
              bewijsmateriaal van de pilot onherstelbaar wist.
Ernst:        blokkerend-voor-pilot
Onderbouwing: §8.1 en §8.2 beschrijven dit apart, maar het is één risico met twee
              staarten. Bijlage A9 toont VOLUME ["/app/var/uploads"] met het eigen
              commentaar "zonder volume zijn de certificaten weg zodra het image
              vervangen wordt" — dat is geen persistente opslag, slechts een
              waarschuwing in commentaarvorm. AWS App Runner biedt geen persistente
              schijf tussen deployments/scale-events; het platform is voor stateless
              containers bedoeld ([AWS App Runner-documentatie](https://docs.aws.amazon.com/apprunner/latest/dg/develop.html)). Voor de
              huidige pilotomgeving (niet App Runner) geldt hetzelfde principe zonder
              extern volume: het risico is er nu al, niet pas bij migratie. Daarnaast
              meldt de huidige database-provider expliciet "does not include project
              backups" (§8.1), en de wél gebouwde dagelijkse dump staat nog niet
              ingepland en schrijft naar dezelfde machine als de bron.
Aanbeveling:  Eén werkpakket vóór pilotstart: (a) verplaats uploads naar object-
              opslag (S3 of S3-compatibel, bijvoorbeeld via MinIO die al in de
              ontwikkelstack staat) zodat bestanden een leven hebben los van het
              containerbestandssysteem, en (b) plan de reeds gebouwde databasedump
              in op een cron met bestemming buiten de brondraaimachine (bijv. dezelfde
              objectopslag-bucket). Beide routes landen in dezelfde opslag, dus dit is
              één ontwerpbeslissing en één stuk werk, geen twee.
Niets doen:   Bij de eerste onvermijdelijke gebeurtenis (image-redeploy, providerpauze
              na 7 dagen inactiviteit, schijfstoring) verliest de pilot leverancier-
              certificaten en/of complete surveydata zonder enige herstelmogelijkheid.
              Voor een compliance-instrument waarvan het bewijsmateriaal de kern van
              de waarde is, is dat een showstopper, geen ongemak.
Zekerheid:    zeker
```

### 2. Geautomatiseerde minimale browser-smoketest van upload+indienen, met herstel van de twee bekende frontendblokkades

```
Vraag:        9
Bevinding:    De twee bekende frontendbugs (ontbrekend uploadveld, leesblok met
              keuzerondjes) maken de kernflow van UC1 — een leverancier die een
              vragenlijst met bijlage indient — vandaag niet uitvoerbaar in de
              browser, en niets in de CI zou een derde, nog onbekende blokkade van
              dit type opvangen.
Ernst:        blokkerend-voor-pilot
Onderbouwing: §5 punt 5 en §6 bevestigen dat het portaal nog geen bestanden kan
              uploaden waardoor een leverancier niet via de browser kan afronden;
              §6 stelt vast dat beide bekende bugs "niet door een test gevonden maar
              door de browser open te doen" zijn. 155 backend e2e-tests dekken dit
              niet, want die roepen de HTTP-laag aan, niet de gerenderde pagina.
Aanbeveling:  Eén Playwright-scenario (of vergelijkbaar) dat een geldige tokenlink
              opent, een bestand uploadt, een vraag met leesblok correct rendert
              (geen keuzerondjes) en de ronde indient tot en met de bevestiging.
              Dit scenario draait tegen de al bestaande OTAP-stack (beide images als
              productie-artefact, zoals §5 al beschrijft) en wordt — minimaal
              handmatig vóór elke pilotrelease, idealiter als CI-stap — verplicht
              gesteld voordat de eerste leverancier een link ontvangt.
Niets doen:   De pilot start met een flow die vandaag aantoonbaar niet werkt voor de
              eindgebruiker, ontdekt via een reële leverancier in plaats van vóór
              livegang, met reputatieschade bij Transdev als gevolg.
Zekerheid:    zeker
```

### 3. Minimale operationele waarneembaarheid en een expliciet pilot-runbook/alerting

```
Vraag:        9
Bevinding:    Bij een incident tijdens de pilot is er niets om in te kijken behalve
              containerlogs, en er is geen procedure die vastlegt wie wanneer moet
              reageren op welk signaal.
Ernst:        blokkerend-voor-pilot
Onderbouwing: §8.7 noemt "geen logging/monitoring-laag" en "bij een incident in de
              pilot is er niets om in te kijken behalve containerlogs" als kleiner
              punt, maar voor een pilot met échte leveranciers en een 30-dagen-
              geldige link is het ontbreken van élke waarneembaarheid een operationeel
              risico van dezelfde orde als het dataverliesrisico: een stille storing
              (bijv. de EACCES-uploadfout die §5 beschrijft, of een variant daarop)
              kan dagenlang onopgemerkt blijven omdat niemand de logs actief bekijkt.
Aanbeveling:  Vóór pilotstart: (1) een health-check-monitor met alert (e-mail/Slack)
              op basis van de al bestaande `/health`-route, (2) een korte
              pilot-runbook die vastlegt wie de containerlogs controleert, met welke
              frequentie, en wat de eerste stappen zijn bij een 5xx-piek of een
              gefaalde upload, (3) behoud van logs voor minstens de looptijd van een
              ronde (30+ dagen) zodat een klacht achteraf te herleiden is.
Niets doen:   Een storing tijdens de pilot wordt pas ontdekt wanneer een leverancier
              klaagt dat een link niet werkt, na het verstrijken van de 30 dagen
              geldigheid, met een dan niet meer herleidbare oorzaak.
Zekerheid:    waarschijnlijk
```

**Waarom niet virusscanning, niet de servicelaagregels, niet de rangorde-vraag over portabiliteit.** Deze staan hieronder uitgewerkt bij vraag 1, 2 en de tegenspraak op §8.4/§8.3, maar horen niet in de top drie: virusscanning is voor-productie, geen pilotblokkade, gegeven de compenserende controles die al aanwezig zijn (zie tegenspraak-sectie); de servicelaagregels zijn een reëel maar geen acuut risico zolang de testdekking op die regels staat; en portabiliteitswerk voor AWS App Runner is pas relevant ná een succesvolle pilot op het huidige platform.

---

## Deel 2 — Antwoorden op vraag 1 t/m 8

### Vraag 1 — Portabiliteitsrangorde: wat breekt het eerst bij AWS App Runner

```
Vraag:        1
Bevinding:    Rangorde van wat het eerst breekt bij een verhuizing naar AWS App
              Runner: (a) bestanden op containerschijf > (c) NEXT_PUBLIC_API_URL per
              omgeving > (b) rollenmodel met CREATE ROLE > (d) SECURITY DEFINER-
              functie.
Ernst:        blokkerend-voor-pilot (voor a, ná migratiebesluit) | later (voor c, b, d)
Onderbouwing: (a) breekt gegarandeerd en onmiddellijk: App Runner-services zijn
              stateless containers zonder garantie van persistente lokale opslag
              tussen requests of over herstarts/schaalacties heen ([AWS App Runner-documentatie](https://docs.aws.amazon.com/apprunner/latest/dg/develop.html)).
              Bijlage A9 bevestigt dat de huidige VOLUME-declaratie een in-container
              map is die alleen lokaal/in Docker Compose iets betekent — op App
              Runner is er geen equivalent volume-mechanisme voor persistente
              bestandsopslag. Dit breekt bij de eerste upload na de eerste
              herstart/redeploy, dus vóór enige andere migratiestap zichtbaar wordt.
              (c) breekt niet de werking maar het OTAP-principe zelf: met
              NEXT_PUBLIC_API_URL ingebakken bij build (Bijlage A9) kan geen enkel
              image gepromoveerd worden tussen App Runner-omgevingen zonder herbouw,
              wat de kern van de gevraagde OTAP-straat ondermijnt zodra er een echte
              acceptatieomgeving bijkomt ([Next.js self-hosting-documentatie](https://nextjs.org/docs/app/guides/self-hosting)). Dit "breekt" niet
              functioneel, maar breekt het beloofde deployproces zodra een tweede
              omgeving naast productie ontstaat. (b) is een reëel maar geen acuut
              risico op Amazon RDS for PostgreSQL specifiek: het beheeraccount
              (rds_superuser) heeft CREATEROLE en kan rollen en privileges beheren,
              al is het geen native PostgreSQL-superuser ([AWS RDS for PostgreSQL-documentatie](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html)).
              Op RDS breekt dit dus vermoedelijk niet; het risico is reëel bij
              bepaalde serverless Postgres-aanbieders die CREATE ROLE beperken, niet
              bij RDS zelf. (d) is het minst risicovol: SECURITY DEFINER is
              standaard-PostgreSQL-functionaliteit, geen AWS- of App-Runner-
              specifiek obstakel, en de aangeleverde functie (Bijlage A3) past al
              SET search_path en REVOKE ALL FROM PUBLIC toe — precies de governance
              die dit patroon draagbaar en veilig houdt.
Aanbeveling:  Behandel (a) als eis vóór elke AWS-migratie (S3 + presigned URLs of
              gelijkwaardig, ongeacht of de rest van de architectuur ongewijzigd
              blijft). Behandel (c) als ontwerpbeslissing te nemen bij het opzetten
              van de eerste echte acceptatieomgeving, niet pas bij golive. Behandel
              (b) als aandachtspunt bij providerkeuze (RDS is hier geen probleem;
              een serverless Postgres-aanbieder mogelijk wel) — niet als blocker voor
              App Runner specifiek. Beschouw (d) als afgehandeld: geen actie nodig
              buiten het vasthouden aan de huidige governance.
Niets doen:   Kosten nu vs. later, kwalitatief:
              (a) Nu: laag — één service (BestandOpslagService) aanpassen naar een
                  object-storage-client, storage_key blijft ongewijzigd (§7 stelt dit
                  al vast). Later (na livegang met echte pilotdata op ephemere
                  schijf): hoog — datamigratie onder tijdsdruk, mogelijk na een
                  dataverliesincident, met leveranciers die al bestanden hebben
                  geüpload die niet meer terug te halen zijn.
              (c) Nu: middel — een server-side Next.js route/proxy of same-origin
                  reverse proxy bouwen die runtime een API_BASE_URL leest, eenmalig
                  werk. Later: middel tot hoog — niet duurder in techniek, maar
                  duurder in proces: elke nieuwe omgeving vereist dan een aparte
                  buildpijplijn per doel-URL, wat de OTAP-belofte ("promoveer exact
                  dezelfde image") permanent breekt in plaats van eenmalig op te
                  lossen.
              (b) Nu: laag — geen actie nodig bij RDS-keuze; documenteren als
                  aandachtspunt bij evaluatie van alternatieve providers. Later:
                  laag tot middel — alleen relevant als bewust voor een provider
                  zonder CREATE ROLE gekozen wordt, wat dan een rollenmodel-
                  herontwerp vergt (rollen buiten migratiescript laten aanmaken).
              (d) Nu: laag — niets te doen. Later: laag — blijft draagbaar zolang op
                  PostgreSQL gebleven wordt.
Zekerheid:    zeker voor (a) en (d); waarschijnlijk voor (b) en (c)
```

### Vraag 2 — De vijf servicelaagregels: per regel een besluit

```
Vraag:        2
Bevinding:    Van de vijf servicelaagregels verdienen er drie "laten staan" (met
              contract-/metadatatests als vangnet), één "anders" (max_files, niet als
              simpele trigger maar structureel met concurrency-veilige aanpak), en
              één "anders" (JSONB-configschema, valideren bij import/schrijven in
              plaats van in de database bewaken).
Ernst:        later (voor optie/rating/multi_choice) | voor-productie (voor max_files)
              | later (voor JSONB-configschema)
Onderbouwing: §2-tabel en Bijlage A5 tonen dat de databasegaranties werken op basis
              van vaste kolomstructuur en enumeraties die per rij bekend zijn; de vijf
              regels in de servicelaag hebben stuk voor stuk een gemeenschappelijk
              kenmerk — ze vergen kennis van de vraagdefinitie (config.options[],
              min/max, max_files) die niet in de answer-rij zelf zit, of vergen tellen
              over rijen heen. Een trigger die dat oplost moet dus altijd een join of
              subquery naar survey_question doen, wat de eenvoud van de bestaande
              CHECK-constraints (die alleen binnen de eigen rij kijken, Bijlage A5)
              doorbreekt.
Aanbeveling:  Per regel:

              1. Gekozen optie bestaat in config.options[] — LATEN STAAN in
                 servicelaag. Dit is per-vraag-metadata die al bij het inladen van de
                 vragenlijst bekend is aan de service; een trigger zou dezelfde JSONB
                 moeten uitlezen die de service al in handen heeft, zonder
                 aantoonbare winst in garantiesterkte. Vangnet: contract-/metadata-
                 test die bij elke nieuwe vraagtype-import verifieert dat elke
                 ingevoerde optie voorkomt in config.options[] van de bijbehorende
                 vraag (uit te breiden in de bestaande `vragenlijst-import`-suite,
                 §6).

              2. Rating binnen min…max — LATEN STAAN in servicelaag, zelfde
                 redenering als 1. Vangnet: grens-testgevallen (min-1, min, max,
                 max+1) in de bestaande `antwoord-indienen`-suite, expliciet met
                 tegenproef (validatie tijdelijk uitschakelen, test moet rood worden
                 — conform de gewoonte uit §6).

              3. multi_choice-aantallen en duplicaten — LATEN STAAN in servicelaag,
                 zelfde redenering. Vangnet: testgeval met duplicaat in answer_codes[]
                 en met een aantal buiten de toegestane grens, plus tegenproef.

              4. Aantal bestanden per vraag ≤ max_files — ANDERS: structureel in de
                 database, maar niet als kale trigger zonder lock (dat lost de
                 concurrency-fout uit §8.4 niet op — twee gelijktijdige uploads die
                 allebei de trigger vóór elkaars commit passeren, tellen allebei "nog
                 onder de grens"). Schets van een uitvoerbare aanpak — kies één van
                 twee routes:
                 (i) Quotarij: maak
                 `survey_attachment_quota(response_id, question_id, max_files,
                 used_files)` met `CHECK (used_files BETWEEN 0 AND max_files)` en een
                 primary key op `(response_id, question_id)`. Leg `max_files` bij het
                 aanmaken van de respons vast als snapshot van de dan al bevroren
                 vraagconfiguratie. Reserveer een plek met één atomair statement:
                 `UPDATE ... SET used_files = used_files + 1
                 WHERE used_files < max_files RETURNING used_files`, binnen dezelfde
                 transactie als de attachment-INSERT. Nul geretourneerde rijen
                 betekent dat de limiet is bereikt.
                 (ii) Kleinere wijziging: laat een DB-trigger eerst de bovenliggende
                 `survey_response`-rij (of een specifieke per-vraag lockrij) met
                 `SELECT ... FOR UPDATE` vergrendelen, lees daarna `max_files` uit de
                 bevroren vraag en tel de bestaande attachments. De lock serialiseert
                 concurrerende tellingen; een kale trigger met alleen `COUNT(*)`
                 doet dat niet. Route (i) is explicieter en beter toetsbaar, route
                 (ii) wijzigt het model minder maar serialiseert mogelijk meer werk.
                 Vangnet: de concurrency-test uit vraag 7, toegepast op de gekozen
                 lock- of quotarij.

              5. Inhoud van de config-JSONB — ANDERS: niet in de database bewaken via
                 een generieke trigger (te complex voor de winst, JSONB-structuur-
                 validatie in PL/pgSQL is onderhoudsintensief en moeilijk leesbaar),
                 maar valideren bij import/schrijven in de servicelaag met een
                 JSON Schema-validator (bijv. ajv), toegepast op het moment dat een
                 vragenlijst geïmporteerd wordt, gevolgd door het "bevriezen" van
                 templates zodra er een niet-draft-ronde aan hangt — een mechanisme
                 dat al bestaat via de trigger in Bijlage A7. Het bevriezen is dus al
                 opgelost; het ontbrekende stuk is uitsluitend de schemavalidatie
                 vóór het invoerpunt, niet een doorlopende databasegarantie.
Niets doen:   Voor 1–3: geen aanvullende actie nodig zolang de contract-/grenstests
              bestaan; zonder die tests kan een servicelaagbug een ongeldig antwoord
              doorlaten dat pas bij rapportage opvalt. Voor 4: zonder structurele
              aanpak blijft de concurrency-garantie ongetoetst en potentieel
              overtreedbaar bij gelijktijdige uploads via twee afzonderlijke
              verbindingen (bijv. dubbele browsertabs of een client die twee keer
              snel achter elkaar post) — precies het scenario dat §8.4 beschrijft.
              Voor 5: zonder validatie bij import kan een malvormde JSONB-config een
              vraag onbruikbaar maken pas bij het eerste antwoord, niet bij het
              importeren, wat de fout laat in de verkeerde fase van de pijplijn.
Zekerheid:    waarschijnlijk voor 1–3 en 5; zeker voor 4 (de FOR UPDATE-aanpak is
              aantoonbaar niet bewezen werkzaam, zie §8.4 en vraag 7)
```

### Vraag 3 — Eerste frontendtestinvestering

```
Vraag:        3
Bevinding:    De eerste en enige investering die maandag gebouwd zou moeten worden
              is één end-to-end browsertest van de volledige UC1-flow (token openen →
              vragen beantwoorden → bestand uploaden → indienen → bevestiging), niet
              componenttests.
Ernst:        blokkerend-voor-pilot
Onderbouwing: §6 stelt vast dat de twee bekende bugs (ontbrekend uploadveld, leesblok
              met keuzerondjes) allebei gevonden zijn door de browser open te doen,
              niet door enige test — dat is het signaal dat het risico op
              integratieniveau zit (rendering + backend-koppeling), niet op
              geïsoleerd componentniveau. Componenttests zouden een leesblok-
              component in isolatie kunnen testen, maar zouden de daadwerkelijke bug
              (verkeerd component gekozen voor het veldtype in de rendering-keten)
              waarschijnlijk niet vangen tenzij toevallig exact dat pad getest wordt.
Aanbeveling:  Eén Playwright-scenario dat tegen de bestaande OTAP-stack draait (echte
              backend-image, geen mock — conform de bestaande gewoonte in §5/§9) en
              de volledige UC1-flow met een echte bestandsupload doorloopt tot en met
              de bevestigingspagina. Dit dekt in één keer de twee bekende
              blokkerende bugs en fungeert als regressienet voor toekomstige
              rendering- of koppelingsfouten.
Niets doen:   Zonder deze test blijft de enige manier om frontendregressies te
              ontdekken "de browser open doen", wat niet schaalt zodra de vragenlijst
              groeit van acht naar meer vragen of naar UC2, en wat vóór de pilot al
              een aantoonbaar niet-werkende flow heeft laten liggen (§5, punt 5).
Zekerheid:    zeker
```

### Vraag 4 — Is de backendverhouding (155 e2e / 1 unittest) scheef?

```
Vraag:        4
Bevinding:    De verhouding is voor de databasegaranties verdedigbaar, maar er is één
              concreet gat: pure, database-onafhankelijke functies verdienen een
              eigen unittestlaag omdat e2e-tests daar onnodig traag en indirect
              geworden zijn voor wat in feite invoer-naar-uitvoer-logica is, zonder
              dat dit betekent dat databasegaranties gemockt moeten worden.
Ernst:        later
Onderbouwing: Bijlage A8 (`valideerBestand`, `maakOpslagsleutel`) en de vijf
              servicelaagregels uit §2 (optie-, rating-, multi_choice-validatie) zijn
              stuk voor stuk pure functies: gegeven een buffer of een antwoordwaarde
              plus vraagconfiguratie, retourneren ze een oordeel zonder database-
              interactie. Deze worden nu uitsluitend indirect getoetst via de
              `bijlage-upload`- en `antwoord-indienen`-e2e-suites (§6), die voor élk
              testgeval een wegwerp-Postgres, een HTTP-rondgang en tokenopzet nodig
              hebben — kostbaar voor logica die geen databaseinteractie heeft. Dit
              kost nu al tijd (CI-doorlooptijd van de e2e-suite) en dekking
              (randgevallen zoals lege buffers, precies-op-de-grens-bytes voor
              magic-byte-detectie, of grensgevallen van rating min/max zijn
              omslachtiger te schrijven als e2e-testgeval dan als directe
              functieaanroep).
Aanbeveling:  Voeg een unittestlaag toe specifiek voor: (1) `valideerBestand` en
              `bepaalContentType` uit Bijlage A8 — test direct met byte-buffers voor
              elk bestandstype, corrupte headers, exact-op-de-grens groottes; (2) de
              servicelaagvalidatiefuncties voor optie/rating/multi_choice uit §2,
              zodra die als pure functies (input: antwoord + config-object, output:
              geldig/ongeldig) geïsoleerd worden van de transactielaag; (3)
              `maakOpslagsleutel` voor padveiligheid tegen padinjectie-payloads. Dit
              zijn functies zonder databasegaranties om te mocken — de test bewijst
              precies wat de functie zelf beweert, niets over RLS of constraints.
              De 155 e2e-tests blijven ongewijzigd verantwoordelijk voor alles wat
              door de database wordt afgedwongen.
Niets doen:   Randgevallen in bestandsvalidatie en servicelaagregels blijven duurder
              om te testen dan nodig, wat in de praktijk betekent dat ze minder vaak
              getest worden dan wenselijk — niet omdat de e2e-aanpak fout is, maar
              omdat de kost per testgeval de dekking drukt.
Zekerheid:    waarschijnlijk
```

### Vraag 5 — `vendor_id` naast `subject_vendor_id`: valkuil of houdbaar?

```
Vraag:        5
Bevinding:    Het model is houdbaar voor de huidige twee use cases en hoeft niet
              vervangen te worden, mits het faalscenario hieronder expliciet met een
              test wordt afgedekt — dit is geen polymorfe-relatieconstructie maar een
              expliciete tweekolomsmodellering met een heldere betekenisscheiding.
Ernst:        later
Onderbouwing: Bijlage A3 en A6 tonen dat `subject_vendor_id` (over wie) en
              `vendor_id` (wie vult in) elk een eigen, benoembare rol hebben, en dat
              de partiële unieke index in A6 specifiek op `vendor_id` werkt om UC1's
              garantie te bewaren zonder UC2 te belemmeren. Dit is geen polymorfe
              relatie (waarbij één kolom naar verschillende tabellen zou kunnen
              wijzen); het zijn twee gewone foreign keys naar dezelfde tabel met een
              verschillende betekenis. Het concrete faalscenario: als een derde use
              case ontstaat waarbij een leverancier een andere leverancier beoordeelt
              (bijv. een hoofdaannemer die een onderaannemer scoort), dan is het
              onderscheid "vendor_id = null betekent UC2" niet meer voldoende, en zou
              er een expliciete `respondent_type`-kolom (enum: 'self' | 'internal' |
              'vendor-on-vendor') nodig zijn om te disambigueren of `vendor_id` de
              deelnemer of de invuller-namens-een-derde is. Bijlage A3 zelf toont al
              een instantie van dit risico: de `LEFT JOIN` op `subject_vendor_id` was
              tot 2026-07-29 een bug die op `vendor_id` joinde, waardoor elke UC2-link
              410 gaf — gevonden door de OTAP-doorloop, niet door een test. Dat is
              geen modelfout maar een teken dat de tweekoloms-betekenis makkelijk
              door elkaar gehaald wordt in code die met beide kolommen werkt.
Aanbeveling:  Geen migratie nu. Voeg wel een gerichte e2e-test toe die expliciet de
              tokenlookup voor een UC2-link over HTTP test (niet alleen via directe
              SQL) — dit exacte gat veroorzaakte de bug die A3 beschrijft en is
              blijkbaar nog niet in de 155 tests gedekt op HTTP-niveau. Documenteer
              in een ADR of in `docs/STATUS.md` expliciet de aanname "een use case
              heeft precies één deelnemer en één onderwerp" zodat een toekomstige
              derde use case bewust tegen deze aanname aangehouden wordt in plaats
              van stilzwijgend te breken.
Niets doen:   Zolang er twee use cases zijn, gaat niets mis. Bij een derde use case
              met een ander deelnemer/onderwerp-patroon ontstaat een stille
              modelleerfout die pas na livegang van die derde use case zichtbaar
              wordt, wanneer er al gevulde rondes op het huidige model staan — de
              migratiekost is dan een datamigratie op productiedata plus een nieuwe
              kolom, geen databreuk maar wel plannings- en testwerk.
Zekerheid:    waarschijnlijk
```

### Vraag 6 — Handmatige OTAP-doorloop: houdbaar?

```
Vraag:        6
Bevinding:    Het realistische faalscenario is niet dat de doorloop "vergeten" wordt
              in de zin van nooit uitgevoerd, maar dat hij inconsistent uitgevoerd
              wordt — bijvoorbeeld wel bij een grote release maar niet bij een kleine
              wijziging die toevallig net de OTAP-relevante laag raakt (permissies,
              build-args, health-check) — waardoor precies het type fouten dat de
              doorloop bewijsbaar vindt (§5: EACCES, routepad-lek, non-idempotentie)
              weer binnensluipt zonder dat iemand het opmerkt tot een volgende
              toevallige handmatige run.
Ernst:        voor-productie
Onderbouwing: §5 zelf erkent dat de doorloop vijf bevindingen opleverde die geen
              enkele unit- of e2e-test zag — dat is het bewijs van waarde, niet van
              risico. Het risico zit in de aard van "handmatig": er is geen
              afdwingingsmechanisme dat een release tegenhoudt als de doorloop niet
              gedraaid is, vergelijkbaar met de "geen branch protection"-situatie in
              §6 (technisch geblokkeerd, dus een werkafspraak zonder afdwinging). Een
              werkafspraak zonder afdwinging vervalt doorgaans niet abrupt maar
              geleidelijk, naarmate deadlinedruk toeneemt.
Aanbeveling:  Goedkope tussenvorm vóór volledige automatisering: verplaats de negen
              stappen niet naar een cross-repo CI-workflow (dat vraagt inderdaad
              beide repositories in één workflow, een grotere investering), maar
              richt één losstaande, periodieke GitHub Actions-workflow in (bijv.
              nachtelijk of wekelijks, en verplicht vóór elke pilotrelease) die beide
              al bestaande productie-images pulled of bouwt, `docker-compose.otap.yml`
              opstart, en het bestaande `scripts/otap-doorloop.js` uitvoert — zonder
              dit te koppelen aan de PR-merge-flow van beide repositories. Dit hergebruikt
              het bestaande script volledig, vergt geen wijziging aan twee CI-pijplijnen
              tegelijk, en verandert de doorloop van "iemand moet eraan denken" naar
              "draait vanzelf, mens leest de uitkomst". Volledige automatisering
              (verplicht vóór elke merge, in beide repo's) blijft een latere stap.
Niets doen:   Zonder afdwinging herhaalt zich het patroon uit §5 waarbij vijf reële
              bevindingen (waaronder een permissiefout die élke upload blokkeerde)
              alleen gevonden werden omdat iemand toevallig de moeite nam de doorloop
              te draaien — bij toenemende tijdsdruk in de aanloop naar de pilot is
              precies dát moment het meest waarschijnlijke om over te slaan.
Zekerheid:    waarschijnlijk
```

### Vraag 7 — Hoe toets je de FOR UPDATE-vergrendeling?

```
Vraag:        7
Bevinding:    De vergrendeling is met de huidige testopzetten niet aantoonbaar, omdat
              alle drie geprobeerde opzetten via dezelfde connectiepool liepen; een
              geldige tegenproef vereist twee fysiek gescheiden databaseverbindingen
              die met een expliciete coördinatiebarrière gegarandeerd overlappen op
              het kritieke moment.
Ernst:        voor-productie
Onderbouwing: §8.4 en §6 beschrijven exact het probleem: "twee transacties via
              dezelfde connectiepool achter elkaar aan de beurt komen" maakt elke
              race-conditie-test met een gedeelde pool waardeloos, want de pool
              serialiseert de transacties toch al voordat de vergrendeling ooit een
              rol kan spelen.
Aanbeveling:  Test de echte uploadroute zonder productiehaak met een externe lock en
              twee fysiek gescheiden databaseverbindingen:
              1. Maak testdata waarbij nog precies één uploadplek beschikbaar is.
              2. Open een losse `pg.Client` A, start `BEGIN` en vergrendel handmatig
                 exact dezelfde rij die de productiecode met `FOR UPDATE` hoort te
                 vergrendelen. Laat A de transactie openhouden.
              3. Start daarna via HTTP een echte uploadrequest. Die request gebruikt
                 de normale applicatiepool, dus een andere fysieke verbinding. Als
                 de productielogica dezelfde lock neemt, blijft de HTTP-promise
                 pending zolang A de lock vasthoudt.
              4. Controleer eerst deterministisch dat de request na een korte, ruime
                 wachttijd nog niet is voltooid; commit vervolgens A en controleer
                 dat de request nu wel voltooit. Gebruik daarnaast `lock_timeout` of
                 een Jest-timeout zodat een fout de suite nooit onbeperkt laat hangen.
              5. Start voor de functionele raceproef twee echte uploadrequests terwijl
                 nog één plek vrij is. Na het vrijgeven van A moet precies één request
                 slagen en één de limiet krijgen, en de database moet precies
                 `max_files` attachmentrijen bevatten.
              6. Tegenproef: verwijder `FOR UPDATE` tijdelijk. De eerste blokkeer-
                 assertie moet dan rood worden doordat de HTTP-request voltooit
                 terwijl A de rij nog vasthoudt. Daarmee bewijst de test de
                 aanwezigheid van het productiemechanisme, niet alleen algemeen
                 PostgreSQL-lockgedrag.
              Deze opzet vraagt geen wijziging aan productiecode. Het testbestand
              creëert alleen een externe transactie die de bestaande lockrij bezet
              en observeert vervolgens de echte HTTP-route.
Niets doen:   Zonder deze test blijft de claim "twee gelijktijdige uploads worden
              geserialiseerd" ongetoetst in productiecode die wél bestaat en wél
              onderhouden wordt — bij een toekomstige refactor van de transactielaag
              kan de vergrendeling stilzwijgend verdwijnen zonder dat een enkele test
              het opmerkt, identiek aan wat er nu al drie keer is gebeurd.
Zekerheid:    zeker (de opzet is technisch standaard voor het testen van
              rijvergrendeling in PostgreSQL); vermoeden voor de exacte
              timingdrempel, die per testomgeving gekalibreerd moet worden
```

### Vraag 8 — Wat is te veel?

```
Vraag:        8
Bevinding:    Geen van de drie genoemde kandidaten (38-regelconstraint, zeven
              survey-tabellen, twaalf ADR's) is overbodig; het zijn stuk voor stuk
              proportionele investeringen voor een compliance-instrument, en het
              risico van "te veel" zit niet hier maar is elders in het document al
              correct benoemd (zie tegenspraak-sectie).
Ernst:        cosmetisch
Onderbouwing: De vormconstraint (Bijlage A5) is één CHECK die acht antwoordtypen
              onderscheidt — de lengte komt voort uit het aantal typen, niet uit
              overbodige complexiteit per type; elke tak is een simpele kolom-
              aanwezigheidscontrole. Dit vervangt bovendien precies het soort bug
              (rating als tekst weggeschreven, keuzecode in answer_number) dat pas
              maanden later bij rapportage ontdekt zou worden — de asymmetrie tussen
              "nu 38 regels SQL" en "straks onherleidbare foutieve rapportagedata" is
              scherp in het voordeel van de constraint. Zeven tabellen voor de
              survey-cluster (§3: template, category, question, run, response,
              answer, attachment) is een normale genormaliseerde structuur voor een
              domeinmodel met vragenlijst-definitie, uitvoeringsronde, antwoord én
              bijlage als afzonderlijke concepten — samenvoegen zou de heldere
              scheiding tussen "wat is de vraag" en "wat is het antwoord" opofferen
              voor een schijnbare eenvoud die de CHECK-constraints en RLS-policies
              juist ingewikkelder zou maken. Twaalf ADR's voor een project van deze
              omvang (twee repositories, een expliciete portabiliteitseis, een
              beveiligingsmodel zonder gebruikersaccounts) is niet excessief:
              ADR-012 (containerimages i.p.v. Vercel) alleen al voorkomt dat een
              toekomstige ontwikkelaar dezelfde afweging opnieuw moet maken.
Aanbeveling:  Geen actie op deze drie kandidaten. Richt de "wat is te veel"-vraag in
              plaats daarvan op kandidaten die wél degelijk overengineering kunnen
              zijn zodra ze zonder scherpe noodzaak verder uitgebreid worden: een
              generieke DB-trigger voor JSONB-configvalidatie (zie vraag 2, regel 5)
              zou wél overbodige complexiteit toevoegen ten opzichte van validatie
              bij import, en zou als kandidaat voor "te veel" moeten gelden als die
              ooit gebouwd wordt.
Niets doen:   Geen gevolg — er is hier niets om weg te gooien; tijd besteed aan het
              vereenvoudigen van deze drie zou tijd zijn die niet aan een reëel
              risico besteed wordt.
Zekerheid:    waarschijnlijk voor de constraint en de tabellen; vermoeden voor de
              ADR's, omdat de inhoudelijke kwaliteit van de twaalf ADR's niet is
              meegeleverd in Bijlage A en dus niet individueel beoordeeld kon worden
```

---

## Tegenspraak op §8

Waar de eigen inschatting van de opsteller overschat, onderschat of verkeerd gerangschikt is.

**§8.1 en §8.2 zijn niet twee losse punten — en de rangorde "zwaarste eerst" klopt, maar de scheiding niet.** Het ontbreken van databaseback-ups en het ontbreken van bestandsback-ups zijn twee symptomen van hetzelfde onderliggende probleem: er is geen duurzame opslag met herstelpad voor pilotdata, punt. Door ze als twee aparte punten (8.1, 8.2) te behandelen ontstaat het risico dat ze als twee aparte werkpakketten ingepland worden, terwijl de oplossing (objectopslag + ingeplande dump naar een externe bestemming) in de praktijk één ontwerpbeslissing is. Dit is in Deel 1, prioriteit 1 hierboven, samengevoegd — niet om het risico te verkleinen, maar om de aanpak te verscherpen.

**§8.3 (geen virusscan) staat op plek drie in de eigen lijst; dat is een overschatting van de urgentie voor de pilot.** De opsteller noemt zelf drie compenserende feiten — het bestand wordt nooit uitgevoerd, de opslagnaam is servergegenereerd (Bijlage A8: `maakOpslagsleutel` bevat geen teken uit de invoer), en er is geen route die inline serveert — en concludeert dan toch "het is niet nul" zonder de vervolgvraag te stellen of nul nodig is vóór een gecontroleerde pilot met een beperkt aantal bekende leveranciers. Voor een pilot waarin downloads uitsluitend door bevoegde, geïdentificeerde Transdev-gebruikers gebeuren (niet door anonieme derden) en bestanden nooit inline worden geserveerd of uitgevoerd, is dit een voor-productie-risico, geen pilotblokkade. Wat wél vastgelegd moet worden — en dat ontbreekt nu — zijn deze compenserende controles expliciet als bewuste beslissing (niet als vergeten punt), plus een harde eis dat vóór een bredere rollout (buiten de pilot) een virusscanstap (bijv. ClamAV als sidecar, of een S3-integratie met scanning) toegevoegd wordt vóórdat het aantal onbekende uploaders groeit.

```
Vraag:        extra
Bevinding:    Virusscanning is voor-productie, niet blokkerend voor een gecontroleerde
              pilot, mits de bestaande compenserende controles expliciet vastgelegd
              worden.
Ernst:        voor-productie
Onderbouwing: §8.3 zelf noemt drie compenserende factoren (nooit uitgevoerd,
              servergegenereerde opslagnaam via Bijlage A8, geen inline-serveerroute)
              maar plaatst het punt toch op ernst-niveau vlak onder de twee
              back-uppunten. Het faalscenario dat overblijft — een besmet bestand
              wordt door een bevoegde Transdev-medewerker gedownload en lokaal
              geopend — vereist twee dingen tegelijk: een kwaadwillende of
              gecompromitteerde leverancier én een medewerker die het bestand direct
              opent zonder eigen endpointbescherming. Voor een pilot met een klein,
              bekend aantal leveranciers is dit een acceptabel restrisico, mits
              gedocumenteerd.
Aanbeveling:  Leg de drie compenserende controles vast als expliciete, bewuste
              pilotbeslissing (bijv. in `docs/STATUS.md` of een ADR), met een
              expliciete voorwaarde: vóór opschaling naar een grotere leveranciers-
              populatie of een tweede tenant moet een virusscanstap toegevoegd
              worden.
Niets doen:   Als dit ongedocumenteerd blijft, wordt het bij een toekomstige audit of
              beveiligingsincident gelezen als "vergeten" in plaats van "bewust
              geaccepteerd met compenserende controles" — een reputatie- en
              verantwoordingsrisico dat losstaat van het technische risico zelf.
Zekerheid:    waarschijnlijk
```

**Het Postgres/RLS/constraints-ontwerp wordt in §7 vraag 3 als mogelijke "te ver doorgeschoten"-vergrendeling neergezet; dat is een onderschatting van de eigen waarde van de keuze.** Het document vraagt "is dat een aanvaardbare vergrendeling, of te ver doorgeschoten?" alsof het een open vraag is, maar het antwoord ligt al besloten in het eigen bewijs uit §7: MCM2 draaide zonder enige codewijziging op Neon, een andere Postgres-provider. Dat is precies het soort tegenproef dat het risico van lock-in weerlegt — de vergrendeling is naar PostgreSQL, niet naar één provider, en dat is een bewuste, aanvaardbare keuze zolang de garanties (RLS, constraints, triggers) een aantoonbare functionele meerwaarde leveren ten opzichte van applicatiecode, wat ze doen (Bijlage A1, A5, A7 tonen stuk voor stuk garanties die een servicelaagbug niet kan omzeilen). Dit is geen overengineering; het is een doelbewuste architecturale keuze met een gemeten tegenproef. Het enige aandachtspunt is dat toekomstige migraties (nieuwe kolommen, nieuwe constraints) even zorgvuldig tegen zowel de standaard-Postgres-provider als een alternatief geverifieerd blijven worden, zoals nu met Neon is gedaan.

**§7 vraag 2 (rollenmodel/CREATE ROLE) overschat het risico voor de meest waarschijnlijke AWS-route.** Het document formuleert "hoe reëel is dat risico?" in algemene termen, maar voor de meest voor de hand liggende AWS-doelomgeving — Amazon RDS for PostgreSQL — is CREATE ROLE geen blokkade: het rds_superuser-beheeraccount beschikt over CREATEROLE en kan rollen en privileges volledig beheren, ook al is het geen native superuser ([AWS RDS-documentatie](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html)). Het risico is wél reëel, maar dan specifiek bij bepaalde serverless Postgres-aanbieders die rolbeheer beperken — niet bij de RDS-route die het document zelf als beoogd doel noemt (§5: AWS App Runner, wat typisch met RDS gecombineerd wordt). Dit punt verdient dus een lagere plaats in de portabiliteitszorgen dan het nu impliciet krijgt door naast de bestandsopslag-vraag gesteld te worden — zie ook de rangorde in vraag 1 hierboven, waar (b) op plek drie van vier staat, niet plek één.

**SECURITY DEFINER wordt in §7 vraag 2 op één hoop gegooid met het rollenmodel, terwijl het een apart en kleiner risico is dat al grotendeels correct is afgehandeld.** Het document formuleert de vraag als "de hele tenant-isolatie hangt aan zes rollen én een SECURITY DEFINER-functie", maar behandelt beide even zwaar. SECURITY DEFINER is op zichzelf volledig draagbaar binnen elke PostgreSQL-omgeving; het risico zit vrijwel uitsluitend in governance rond de functie-eigenaar, de `search_path` en wie EXECUTE-rechten heeft — niet in het mechanisme zelf. Bijlage A3 toont dat de aangeleverde functie dit al correct doet: `SET search_path = clm, pg_temp` voorkomt search-path-manipulatie, en `REVOKE ALL ON FUNCTION ... FROM PUBLIC` gevolgd door gerichte `GRANT EXECUTE ... TO clm_api, clm_admin` voorkomt dat een willekeurige rol de functie kan aanroepen. Dit verdient in het document een positieve vermelding als correct toegepaste governance, niet een vraagteken naast het rollenmodel-risico.

**§7 vraag 4 (NEXT_PUBLIC_API_URL) suggereert twee gelijkwaardige opties ("runtime-configuratie via een endpoint, of per omgeving bouwen"); dat is verkeerd gerangschikt, want de twee opties zijn niet gelijkwaardig.** Een publiek runtime-configuratie-endpoint dat de browser bij het laden bevraagt voor de API-URL voegt een extra netwerklaag, een nieuw aanvalsoppervlak (een endpoint dat aangeeft waar de backend leeft) en een race-conditie bij het laden toe. De nettere oplossing, die het document niet als aparte optie noemt, is een server-side Next.js route of same-origin reverse proxy: Next.js ondersteunt bij self-hosting server-side runtime-omgevingsvariabelen, zodat één Docker-image over meerdere omgevingen gepromoveerd kan worden zonder dat de browser ooit een cross-origin publiek endpoint hoeft te bevragen ([Next.js self-hosting-documentatie](https://nextjs.org/docs/app/guides/self-hosting)). Dit is alleen geschikt als de browser niet noodzakelijk rechtstreeks cross-origin met de backend hoeft te praten — wat voor MCM2 het geval lijkt, aangezien frontend en backend samen uitgerold worden. Dit is een derde, betere optie dan de twee die het document tegenover elkaar zet, en zou de primaire aanbeveling moeten zijn (zie ook vraag 1 hierboven).

**§6 rangschikt de teststrategie-asymmetrie (155 e2e / 0 frontendtests) mogelijk correct qua ernst, maar de vraag "mis ik de snelheid en precisie van een unittestlaag" wordt te beperkt beantwoord door alleen "ja/nee" te verwachten.** Het juiste antwoord is genuanceerder dan het document suggereert: niet "voeg een unittestlaag toe" in algemene zin, en niet "nee, de verhouding is prima" — specifiek de pure, database-onafhankelijke functies (bestandsvalidatie, servicelaagregels) verdienen unittests, terwijl alles wat een databasegarantie toetst dat terecht via e2e blijft doen. Dit is uitgewerkt bij vraag 4 hierboven.

**Wat niet overschat, onderschat of verkeerd gerangschikt is: de kernarchitectuur van tenant-isolatie (§9), de schemaconformiteitstest, en de OTAP-doorloop als concept.** Deze zijn terecht in het "vertrouwen"-hoofdstuk geplaatst; er is in Bijlage A geen aanleiding om aan de RLS-opzet (A1, A2), de guard (A4) of de tegenproef-gewoonte (A10) te twijfelen. De enige aanvulling is dat de handmatige uitvoering van de OTAP-doorloop een lagere ernst verdient dan "blokkerend" maar een hogere prioriteit dan "later" — zie vraag 6 hierboven, waar dit als voor-productie met een concrete, goedkope tussenvorm is beantwoord.

---

*Einde review. Alle negen vragen uit §10 zijn beantwoord; de drie prioriteiten uit vraag 9 staan vooraan conform §11.*
