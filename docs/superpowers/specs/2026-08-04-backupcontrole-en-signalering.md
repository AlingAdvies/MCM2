# Ontwerp — backupcontrole en signalering

**Datum:** 2026-08-04
**Status:** ONTWERP — niet gebouwd, wacht op akkoord
**Aanleiding:** bij het controleren van de backup op 2026-08-04 bleek de dagelijkse dump
**de helft van de database te missen**, en bleek dat vier dagen uitval niemand had bereikt.
**Raakt:** Issue #30, #58, #19, #25, ADR-011, `docs/runbooks/supabase-verificatie-en-restoretest.md`

---

## 0. De aanleiding, en waarom die de opdracht verandert

De vraag was: zorg dat de backuproutine werkt en gecontroleerd wordt. Bij het uitvoeren van
die controle kwamen twee bevindingen naar boven die de opdracht scherper maken.

### Bevinding 1 — de dump mist negen van de achttien tabellen

Gemeten op 2026-08-04 tegen `mcm2-2026-08-04_05-38-43.dump`:

```
pg_restore --list | grep -c "TABLE DATA"   →  9
```

Aanwezig zijn de negen tabellen uit migratie 0000: `tenant`, `user`, `vendor`,
`vendor_contact`, `vendor_tag`, `audit_event` en de drie `ref`-tabellen.

**Ontbreekt volledig:**

| Ontbrekend | Uit migratie | Wat erin hoort |
|---|---|---|
| `survey_template`, `survey_run`, `survey_response` | 0003 | de vragenlijsten en de uitgezette rondes |
| `survey_answer`, `survey_attachment`, `survey_category`, `survey_question` | 0005 | **de antwoorden en de geüploade certificaten** |
| `tenant_membership` | 0009 | wie bij welke tenant hoort, met welke rol |
| `sessie` | 0010 | actieve sessies |

Dat is het bewijsmateriaal waar het product om draait, plus het complete rechtenmodel.

De dumps van 30 juli, 31 juli en 4 augustus bevatten alle drie exact dezelfde negen tabellen
en zijn alle drie exact 21.683 bytes groot. **Dit is niet vandaag ontstaan — het is er altijd
zo geweest.** De identieke bestandsgrootte was het zichtbare symptoom; niemand had er een
betekenis aan gehecht.

**Oorzaak.** Niet de schemaselectie: `--schema=clm --schema=ref --schema=audit` is correct en
zou alle achttien tabellen omvatten. De oorzaak is dat `clm-enterprise` de migraties 0003 en
later nooit heeft gekregen — dat is **Issue #25**, dat al open staat ("Drizzle-migratiestand
initialiseren op de bestaande Supabase-database"). De dump is een correcte weergave van een
database die achterloopt.

Dat betekent ook: dit is geen backupfout in strikte zin. De backup doet wat hij moet doen.
Maar het resultaat is wel dat er geen herstelbare kopie bestaat van wat er werkelijk toe doet,
en dat is precies wat een backup hoort te leveren.

### Bevinding 2 — de hersteltest bewees het verkeerde

De hersteltest van 30 juli was: dump → restore → rechten → defaults → **20 van 20 e2e-tests
groen**. Dat is echt gebeurd en het resultaat klopt.

Maar hij draaide tegen een database met negen tabellen, en de tests die groen werden waren de
tests die bij die negen tabellen horen. **De test bewees dat het herstelpád werkt, niet dat de
backup compleet is.**

Dat is het faalpatroon uit MCM2-CLAUDE.md §15b, tegenproef 6: de afwezigheid van een fout is
niet de aanwezigheid van een grens. Een hersteltest die niet controleert wát er hersteld is,
meet zichzelf.

### Bevinding 3 — het signaal werkte, en bereikte niemand

Het log toont dat het script correct waarschuwde:

```
===== ma 03-08-2026  8:54:54 - start
WAARSCHUWING: de vorige dump is 3 dag(en) oud (mcm2-2026-07-31_05-12-50.dump).
...
Backup MISLUKT.
failed to connect to the docker API ...
===== ma 03-08-2026  8:54:55 - MISLUKT, code 1
```

Op 1, 2 en 3 augustus faalde de taak, telkens omdat Docker Desktop niet draaide. Op 4 augustus
slaagde hij weer. De waarschuwing was correct, duidelijk en op tijd — **en stond in een
logbestand dat pas geopend werd toen er expliciet naar gezocht werd.**

Een waarschuwing die je moet gaan halen, is geen waarschuwing.

**Terzijde:** STATUS.md meldt drie dagen uitval met een handmatige inhaalactie op 3 augustus.
Het log laat zien dat die inhaalactie óók mislukte. De werkelijke reeks in OneDrive is
31 juli → 4 augustus: **vier dagen**.

---

## 1. Uitgangspunten van de eigenaar (2026-08-04)

| Vraag | Antwoord | Gevolg voor dit ontwerp |
|---|---|---|
| Waar draait het | Deze PC, nu | Windows, Taakplanner, bestaande `.cmd`-aanroep |
| Waar gaat het heen | **Uiteindelijk een managed service** | Bouw niets dat die service straks zelf doet |
| Hoeveel controle | "Niet te veel poespas" — passend bij die verwachting | Zie §2: drie lagen, waarvan twee tijdelijk |
| Signaal | **Telegram**, zoals in de Saxo-app | Patroon overnemen, niet opnieuw bedenken |

Het tweede punt is het sturende. Een managed service (Neon PITR, Supabase Pro, RDS) levert
zelf: het maken van de backup, de retentie, het opruimen, en meestal ook een statuspagina.
Wat zo'n dienst **niet** levert, is het antwoord op de vraag die vandaag misging: *is wat er
in die backup zit ook werkelijk het product?*

Dat bepaalt de knip in §2.

---

## 2. Wat wél en niet gebouwd wordt

Drie lagen, met per laag de vraag: overleeft dit de overstap naar een managed service?

| Laag | Vraag die het beantwoordt | Overleeft de overstap? |
|---|---|---|
| **A. Draait hij?** | Is er een dump van vandaag? | ❌ vervalt — de dienst bewaakt zichzelf |
| **B. Is hij compleet?** | Zit alles erin wat erin hoort? | ✅ **blijft — dit is de kern** |
| **C. Is hij herstelbaar?** | Komt het er ook weer uit? | ✅ blijft, maar minder vaak nodig |

**Laag B is de enige die permanent is**, en het is precies de laag die vandaag ontbrak. Daarom
krijgt die het meeste gewicht, ondanks "niet te veel poespas".

Concreet gebouwd wordt:

1. **Eén controlescript** dat alle drie de lagen afloopt en bij afwijking een Telegram-bericht
   stuurt. Draait dagelijks, ná de backup.
2. **Een verwachtingsbestand**: welke tabellen horen erin te zitten. Zonder dat is "compleet"
   niet toetsbaar.
3. **Telegram-melding** volgens het Saxo-patroon, inclusief demping en levensteken.

**Uitdrukkelijk niet gebouwd:**

- Geen eigen retentiebeheer, rotatieschema of opruimlogica — dat zit al in `backup-dump.js`
  en verdwijnt bij de managed service.
- Geen dashboard, geen webinterface, geen historie-database. Een Telegram-bericht is het
  dashboard.
- Geen automatische reparatie. Als er iets mis is, wil je het weten, niet dat een script het
  stilletjes rechtzet — dat is hoe je vier dagen niets merkt.
- Geen tweede backupbestemming naast OneDrive. Dat is een keuze die bij de managed service
  hoort, niet ervoor.

---

## 3. Laag A — draait hij?

De goedkoopste controle, en de eerste die vervalt.

**Wat het controleert:** bestaat er een dump die jonger is dan 36 uur?

Die drempel staat al in `backup-dump.js` en wordt hier hergebruikt — 36 uur laat één
overgeslagen dag toe zonder vals alarm, en slaat aan bij twee.

**Waarom dit toch nodig is naast wat er al is:** `backup-dump.js` waarschuwt alleen wanneer hij
zélf draait. Draait de taak helemaal niet — laptop uit, taak uitgeschakeld, Docker weg — dan
waarschuwt niemand. Dat is exact wat er op 1 en 2 augustus gebeurde.

**Daarom draait de controle als aparte taak**, los van de backup. Dezelfde gedachte als in de
Saxo-app: *"Draait los van de app: als de app crasht moet de melding juist nog werken."*

---

## 4. Laag B — is hij compleet? (de kern)

Dit is wat vandaag ontbrak, en de enige laag die de managed service níét voor je doet.

### Het verwachtingsbestand

Een lijst van tabellen die in de dump horen te zitten, met per tabel of hij data mag hebben.
Bijvoorbeeld `docs/runbooks/backup-verwachting.json`:

```json
{
  "toelichting": "Wat er in een complete dump hoort te zitten. Bijwerken bij elke migratie die een tabel toevoegt.",
  "tabellen": [
    "clm.tenant", "clm.user", "clm.vendor", "clm.vendor_contact", "clm.vendor_tag",
    "clm.survey_template", "clm.survey_category", "clm.survey_question",
    "clm.survey_run", "clm.survey_response", "clm.survey_answer", "clm.survey_attachment",
    "clm.tenant_membership", "clm.sessie",
    "ref.vendor_category", "ref.compliance_status", "ref.business_criticality",
    "audit.audit_event"
  ]
}
```

**Waarom een bestand en niet afleiden uit de migraties.** Afleiden zou eleganter zijn, maar
dan verifieert het script zichzelf: als de migratiestand fout is (wat hier het geval was),
verwacht het script precies de verkeerde dingen en meldt niets. Een handgeschreven lijst is
een **onafhankelijke** bewering over wat er hoort te zijn — en dat is wat een controle moet
zijn.

De prijs: de lijst moet bijgewerkt worden bij elke migratie die een tabel toevoegt. Dat is
één regel, en het hoort in de definition of done.

### De controle

```
pg_restore --list <nieuwste dump>
```

Vergelijk de gevonden `TABLE DATA`-regels met het verwachtingsbestand. Meld:

- **ontbrekende tabellen** — het geval van vandaag;
- **onbekende tabellen** — een tabel in de dump die niet in de lijst staat. Dat betekent dat
  iemand een migratie heeft gedraaid zonder de lijst bij te werken. Geen fout, wel een signaal
  dat de lijst achterloopt.

**Waarom geen rijaantallen.** Overwogen en bewust niet gedaan: een lege tabel is soms
volkomen normaal (`sessie` na een herstart, `survey_attachment` voordat iemand iets uploadt).
Een drempel per tabel bedenken is precies de poespas die hier niet hoort. De aanwezigheid van
de tabel in de dump is het signaal dat telt; de bevinding van vandaag was er één van
afwezigheid, niet van leegte.

### Wat dit vandaag zou hebben gedaan

Het zou vanaf 30 juli elke dag gemeld hebben: **negen tabellen ontbreken**, met de namen erbij.
Dat is het bericht dat vijf dagen eerder had moeten komen.

---

## 5. Laag C — is hij herstelbaar?

De duurste controle, dus de minst frequente.

**Wat het doet:** de nieuwste dump terugzetten in een wegwerpcontainer en vaststellen dat de
tabellen er daadwerkelijk staan. Niet de e2e-suite draaien — dat is het onderdeel dat bij de
managed service verdwijnt en dat bovendien traag is.

**Frequentie: wekelijks, niet dagelijks.** Een restore kost minuten en Docker-capaciteit; het
risico dat een dump die vandaag geldig is morgen onherstelbaar wordt, is klein. Wekelijks
vangt een structureel probleem ruim op tijd.

**Waarom dit toch niet mag ontbreken:** `pg_restore --list` leest alleen de inhoudsopgave. Een
dump kan een correcte inhoudsopgave hebben en toch afgebroken zijn. Alleen een echte restore
bewijst dat er iets uitkomt.

**Bij de managed service** wordt dit zeldzamer maar verdwijnt het niet — "de provider zegt dat
er backups zijn" is geen bewijs dat je ze kunt terugzetten. Dat is Issue #19, en dat blijft
gelden ongeacht de leverancier.

---

## 6. Het signaal — Telegram, volgens het Saxo-patroon

Overgenomen uit `C:\DEV\prive\Saxo\scripts\server-health-check.sh` en
`src/core/telegram-notifier.js`, omdat dat patroon zich daar bewezen heeft.

### Wat wordt overgenomen

**Demping — maximaal twee berichten per incident.** Eén bij het eerste optreden, één als het
na een ingestelde periode nog aanhoudt, daarna stilte tot het is opgelost. De reden staat in
de Saxo-code zelf: *"geen constante stroom van meldingen bij een aanhoudende structurele
fout."* Een probleem dat vijf dagen duurt moet vijf dagen niet vijf keer melden, want dan leer
je het bericht negeren — en dan is de melding net zo stil als het logbestand.

**Statusbestanden per probleemsoort**, met het tijdstip van eerste optreden en of er al
geëscaleerd is. Geen database nodig.

**Een herstelbericht.** *"✅ Hersteld na 4d 2u"* — zodat stilte niet dubbelzinnig is.

**Het maandelijkse levensteken.** Dit is het belangrijkste dat overgenomen wordt en het minst
voor de hand liggende: als er nooit een bericht komt, weet je niet of alles goed gaat of dat
de melder zelf stuk is. Eén keer per maand een statusbericht maakt stilte betekenisvol.

Voor MCM2 stel ik **wekelijks** voor in plaats van maandelijks: de backup is hier het enige
vangnet onder een productiedatabase, en een maand blind is te lang.

**Een `--test`-schakelaar** die een testbericht stuurt. Zonder dat weet je pas of de melding
werkt op het moment dat je hem het hardst nodig hebt.

**Credentials uit `.env`, met no-op bij afwezigheid.** `TELEGRAM_BOT_TOKEN` en
`TELEGRAM_CHAT_ID`, dezelfde namen als in Saxo. Ontbreken ze, dan logt het script dat en gaat
door — geen crash. Zo blijft het script bruikbaar in CI en op een machine zonder bot.

### Wat er anders is dan bij Saxo

- **Geen `source .env`.** Saxo lost dit al netjes op met `sed`: de hele `.env` inlezen zou
  ook de databasecredentials in de shell zetten. Dat geldt hier sterker — in `.env` staat
  `MIGRATION_DATABASE_URL` met het productiewachtwoord erin.
- **Node in plaats van bash.** Het bestaande `backup-dump.js` is Node, de Taakplanner-aanroep
  gaat al via `backup-taak.cmd`, en Node is op deze machine gegarandeerd aanwezig. Bash op
  Windows hangt aan Git Bash — precies de laag die tijdens deze controle twee keer een
  padvertaling veroorzaakte.

### Berichtvorm

```
🔴 MCM2 backup — 04-08 07:45

Dump is compleet? NEE — 9 tabellen ontbreken:
  clm.survey_template, clm.survey_run, clm.survey_response,
  clm.survey_answer, clm.survey_attachment, clm.survey_category,
  clm.survey_question, clm.tenant_membership, clm.sessie

Laatste dump: 04-08 07:38 (21,2 kB)
Zie Issue #25 — migratiestand van clm-enterprise.
```

Het bericht moet zonder terminal te begrijpen zijn. Wie het op zijn telefoon leest, moet weten
of hij nu iets moet doen.

---

## 7. Portabiliteit — wat er overblijft na de overstap

De eis was: eenvoudig portabel naar een andere backupoplossing. Concreet betekent dat hier
**één grens**, en die loopt om laag A heen.

```
┌─ vervalt bij een managed service ──────────────┐
│  backup-dump.js      (maken van de dump)       │
│  backup-taak.cmd     (Windows Taakplanner)     │
│  laag A              (draait hij?)             │
└────────────────────────────────────────────────┘
┌─ blijft, ongeacht de leverancier ──────────────┐
│  backup-verwachting.json  (wat hoort erin)     │
│  laag B                   (is het compleet?)   │
│  laag C                   (is het herstelbaar) │
│  telegram-melding         (hoe hoor ik het)    │
└────────────────────────────────────────────────┘
```

**Wat er bij de overstap verandert:** waar het controlescript zijn "nieuwste backup" vandaan
haalt. Nu is dat een bestand in een map. Straks is dat een API-aanroep bij de provider, of een
restore naar een tijdelijke database.

**Hoe dat portabel blijft:** het script kent precies één functie die "geef mij de nieuwste
backup als iets waar `pg_restore --list` op werkt" beantwoordt. Bij de overstap wordt alleen
die functie vervangen. De verwachtingslijst, de vergelijking, de demping en het bericht blijven
ongewijzigd.

Dat is de enige abstractie die dit ontwerp aanbrengt, en hij is er omdat de eigenaar expliciet
om portabiliteit vroeg. Verder geen lagen — de rest is één script dat leest, vergelijkt en
meldt.

---

## 8. Wat er ook nog moet gebeuren (niet dit ontwerp)

Deze bevindingen leveren werk op dat buiten de controle valt:

1. **Issue #25 — de migratiestand van `clm-enterprise`.** Dit is de oorzaak van bevinding 1.
   De controle zal het elke dag melden tot dit is opgelost, en dat is de bedoeling.
2. **De hersteltest uit Issue #19 moet opnieuw**, nu tegen een complete dump, met een
   controle op wát er hersteld is.
3. **`backup-dump.js` regel over "dezelfde machine" klopt niet meer.** Het script waarschuwt
   dat de dump op dezelfde machine staat; sinds 30 juli gaat hij naar OneDrive en synct weg.
   Die regel zet mensen op het verkeerde been.
4. **STATUS.md corrigeren:** vier dagen uitval, niet drie, en de inhaalactie van 3 augustus
   mislukte. Verder meldt STATUS.md op regel 443 nog "ZWAARSTE BLOKKADE — geen backups"
   terwijl regel 99 zegt dat #30 dat niet langer is. Eén van beide moet weg.
5. **De definition of done uitbreiden:** een migratie die een tabel toevoegt, werkt
   `backup-verwachting.json` bij. Anders veroudert de lijst en meldt de controle onzin.

---

## 9. Risico's van dit ontwerp

**De verwachtingslijst veroudert.** Dat is de prijs van onafhankelijkheid (§4). Gemitigeerd
door de "onbekende tabel"-melding: voegt iemand een tabel toe zonder de lijst bij te werken,
dan meldt de controle dat — vervelend maar zichtbaar, en dat is beter dan stil.

**Telegram is een externe afhankelijkheid.** Valt Telegram uit, dan valt het signaal weg. Het
wekelijkse levensteken vangt dat: blijft dat uit, dan is er iets mis met de melder zelf. Dit
is bewust geaccepteerd — een tweede kanaal is meer poespas dan het risico rechtvaardigt.

**De controle draait op dezelfde machine als de backup.** Staat de laptop uit, dan draait geen
van beide en komt er geen melding. Dat is een echt gat, en het is hetzelfde gat als Issue #58.
**Het wekelijkse levensteken is de enige afdekking**: blijft dat uit, dan weet je dat de
machine niet draait. Volledig oplossen vraagt een controle búiten deze machine, en dat is werk
dat bij de managed service hoort — niet ervoor.

**Vals gevoel van dekking.** Het grootste risico van dit hele ontwerp: dat de aanwezigheid van
een controle het gevoel geeft dat het geregeld is. De controle bewijst dat er een complete,
herstelbare dump van gisteren is. Hij bewijst niet dat OneDrive de bestanden werkelijk
gesynchroniseerd heeft, en niet dat de laptop morgen nog bestaat.

---

## 10. Voorstel voor de bouw

Drie stappen, elk apart bruikbaar:

1. **Laag A + B + Telegram** — het controlescript, het verwachtingsbestand, de melding met
   demping en levensteken. Dit dekt de bevinding van vandaag.
2. **Laag C** — de wekelijkse restore-controle.
3. **De losse punten uit §8** — met #25 als eerste, want zolang dat open staat blijft de
   controle terecht klagen.

**Advies voor de volgorde:** stap 1 eerst en snel. Er is nu geen enkel signaal dat werkt, en
dat is het dringendste. Stap 2 kan een week later.

---

## 11. Openstaande vragen voor de eigenaar

1. **Wekelijks levensteken, of maandelijks zoals bij Saxo?** Voorstel: wekelijks, omdat deze
   backup het enige vangnet is onder een productiedatabase.
2. **Na hoeveel tijd escaleert een aanhoudend probleem naar het tweede bericht?** Saxo gebruikt
   6 uur. Voor een dagelijkse backup ligt 48 uur meer voor de hand — dan is het tweede bericht
   "dit is nu twee dagen mis" en niet een herhaling van vanochtend.
3. **Dezelfde Telegram-bot als Saxo, of een aparte voor MCM2?** Een aparte bot scheidt privé
   van werk, en een klantomgeving hoort niet in hetzelfde kanaal als een privéproject. Kost
   vijf minuten om aan te maken. Voorstel: apart.
4. **Wanneer valt het besluit over de managed service?** Dit ontwerp is bewust klein gehouden
   omdat die overstap komt. Duurt het nog maanden, dan is laag C vaker draaien te
   rechtvaardigen; is het weken, dan niet.
