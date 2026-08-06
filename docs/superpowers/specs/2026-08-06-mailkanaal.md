# Ontwerp — het mailkanaal: verzenden namens de tenant, en ontvangen

**Datum:** 2026-08-06
**Status:** ONTWERP — niet gebouwd, geen migratie. Besluiten genomen, zie §1.
**Aanleiding:** fase D van het surveybeheerplan verstuurt uitnodigingen, en er is nog geen
mailkanaal. Ontvangen stond nergens beschreven.
**Raakt:** Issue #76 (SMTP per tenant), Issue #13 (afzender Transdev), fase D van
`docs/superpowers/plans/2026-08-03-surveybeheer.md`, Issue #52 (virusscan), Issue #48 (alerting)

---

## 0. Waar dit over gaat, in één alinea

Issue #76 en spec `2026-08-04-beheermenu-tenantinstellingen.md` §3b regelen **verzenden** per
tenant: SMTP-gegevens in de database, write-only wachtwoord, RLS met actor-eis. Degelijk
uitgewerkt. Wat daar niet in staat is **ontvangen** — en dat is geen vergeten paragraaf maar
een wezenlijk ander probleem. Bij verzenden bepaalt onze code wie wat krijgt; bij ontvangen
bepaalt de buitenwereld wat er binnenkomt. Dit document beschrijft het mailkanaal als geheel:
één platformverstuurder (Resend), met de klantnaam zichtbaar in de afzender en antwoorden die
bij de klant terechtkomen.

**Wat er van Issue #76 overblijft:** de infrastructuur voor eigen SMTP per tenant blijft
zinvol, maar wordt de **uitzondering** in plaats van de regel — te bouwen wanneer een klant er
expliciet om vraagt. Zie §8.

---

## 1. Besluiten van de eigenaar (2026-08-06)

| Onderwerp | Besluit |
|---|---|
| Afscherming | Per tenant een eigen, volstrekt afgeschermd mailkanaal |
| Verzender | **Platformverstuurder via Resend** — geen M365, geen SMTP per tenant |
| Afzender richting leverancier | **Display name + Reply-To** (variant 1+2 uit §3) |
| Leveranciers naspelen | Gmail plus-adressering (`naam+vendor1@gmail.com`) |
| Business logic | Hooguit de goede ideeën van JCM overnemen; de rest degelijk en robuust hier |

### Waarom niet M365 op `alingadvies.nl`

Overwogen en verworpen op 2026-08-06. Drie redenen, in volgorde van gewicht:

1. **Het is het bedrijfsdomein van de eigenaar.** Uitgaande testmail zou uit de echte
   zakelijke mailbox komen, in "Verzonden items" belanden, en de bezorgbaarheidsreputatie van
   `alingadvies.nl` delen. Een lus die tweehonderd mails naar niet-bestaande adressen stuurt,
   raakt dan de gewone klantcorrespondentie.
2. **Microsoft zet SMTP Basic Auth eind december 2026 standaard uit** (herziene tijdlijn van
   27 januari 2026; definitieve verwijdering aangekondigd in H2 2027). Bouwen op een
   mechanisme met een bekende einddatum van vier maanden is de verkeerde volgorde.
3. **Bij een DNS-controle bleken er twee SPF-records op `alingadvies.nl` te staan.** Dat is
   ongeldig volgens RFC 7208 en levert `permerror` bij ontvangers op. Los van MCM2 een
   probleem voor de eigenaar — maar het illustreert dat een gedeeld bedrijfsdomein
   afhankelijkheden meebrengt die niets met dit project te maken hebben.

Resend heeft geen van die drie. Bovendien draait het al in JCM (`resend@6.12.3`), dus het
mechanisme is beproefd binnen deze codebase-familie.

---

## 2. Wat er in JCM staat, en wat daarvan bruikbaar is

Onderzocht op 2026-08-06 in `C:\DEV\Work\jouwcontractmanager`, geverifieerd in de code en niet
alleen in de spec — die twee lopen daar uiteen.

**JCM heeft geen ontvangstkant.** Geen inbound-verwerking, geen `reply_to`, geen IMAP, geen
webhook. Uitsluitend verzenden via Resend, met één afzenderadres uit een omgevingsvariabele
(`RESEND_FROM_EMAIL`, fallback `uitvraag@jouwcontractmanager.nl`). Voor de ontvangstkant is
daar dus geen voorbeeld: dat is hier nieuw werk.

### Wat we overnemen

**Twee dingen.** De keuze voor **Resend** zelf — het draait daar aantoonbaar in productie, dus
het mechanisme is beproefd binnen deze codebase-familie. En de constructie waarbij **de
afzendernaam de klant draagt en het adres het platform**, uitgewerkt in §3.

JCM doet dat laatste met `${organisatieNaam} via JouwContractmanager`. Dat is precies de
oplossing voor Issue #13 zonder per klant het SPF-record van de klant nodig te hebben — het
enige echte ontwerpidee dat daar te halen viel.

JCM heeft géén `Reply-To`; dat is hier toegevoegd (§3), zodat vragen van leveranciers bij de
klant terechtkomen in plaats van bij ons.

### Wat we bewust anders doen

Paden hieronder zijn relatief aan `C:\DEV\Work\jouwcontractmanager`.

| JCM | Waarom hier anders |
|---|---|
| Antwoorden **hard verwijderd** bij afwijzen (`src/app/api/uitvragen/[id]/beoordelen/route.ts` r. 92–95) | Voor een compliance-dossier onverdedigbaar. Wat een leverancier eerder verklaarde is bewijs; dat gooi je niet weg. Hier: een nieuwe ronde-poging naast de oude, beide bewaard. |
| Mislukte upload gelogd, niet gemeld (`src/app/api/portal/uitvraag/[token]/route.ts` r. 44–45) | De leverancier krijgt `ok: true` terwijl zijn certificaat er niet in zit. Hier: mislukte upload is een mislukte inzending, met een zichtbare fout. |
| Vragenlijst hardcoded op drie plekken | MCM2 heeft `survey_template`/`survey_question` als echte tabellen. Niet overnemen. |
| Geen `reply_to` | Zie §4 — hier is de ontvangstkant het onderwerp. |

---

## 3. Hoe de afzender eruitziet

De klant moet herkenbaar zijn, anders klikt de leverancier niet (Issue #13). Maar het
afzenderadres moet van ons zijn, anders werkt het niet. Die twee zijn te verenigen.

### Wat een leverancier ziet

```
Van:      Transdev via MCM2 <uitvraag@[verzenddomein]>
Reply-To: contractmanagement@transdev.nl
```

In de lijstweergave van vrijwel elke mailclient staat alleen de display name: **"Transdev via
MCM2"**. Pas bij doorklikken verschijnt het adres. De herkenbaarheid is daarmee geregeld
zonder dat we iets beweren dat niet waar is — het adres zegt eerlijk wie er verstuurt.

**`Reply-To` is de tweede helft en minstens zo belangrijk.** Klikt de leverancier op
"Beantwoorden", dan gaat zijn bericht naar de klant zelf, niet naar ons. Dat lost een deel van
het ontvangstprobleem uit §4 op door het te vermijden: vragen als "wie zijn jullie?" of "ik heb
dat certificaat niet" komen terecht bij de enige partij die ze kan beantwoorden.

### Wat níét kan, en waarom dat goed is

`contractmanagement@transdev.nl` als **afzenderadres** vraagt dat Transdev ons opneemt in zijn
SPF, ons met zijn DKIM-sleutel laat ondertekenen, en dat zijn DMARC-beleid dat accepteert. Bij
een organisatie van die omvang staat DMARC vrijwel zeker op `reject`.

Dat is geen obstakel om te omzeilen — het is exact waar SPF en DKIM voor bestaan. Kon dit
zonder toestemming, dan kon iedereen namens `transdev.nl` mailen.

### De derde variant, voor later

| | Hoe het eruitziet | Wat de klant moet doen |
|---|---|---|
| **1. Display name** | `Transdev via MCM2 <uitvraag@…>` | Niets |
| **2. Reply-To** | Antwoorden gaan naar de klant | Niets |
| **3. Gedelegeerd subdomein** | `noreply@mcm2.transdev.nl` | DNS-records aanleveren |

**Besluit: 1+2 nu, 3 op verzoek.** Variant 3 gebruikt een subdomein dat de klant aan ons
delegeert — nooit het hoofddomein. Het vraagt een traject met hun IT-afdeling én een Resend
Pro-plan (10 domeinen in plaats van 1), dus het is een bewuste upgrade en geen startvoorwaarde.

**Wat dit betekent voor Issue #13.** Dat issue vraagt letterlijk dat de mail *van*
`contractmanagement@transdev.nl` komt. Met 1+2 is de herkenbaarheid ingevuld, het adres niet.
Dat verschil moet vooraf met Transdev besproken worden — niet nadat de eerste ronde de deur
uit is.

---

## 3b. Resend — wat het plan toestaat

Geverifieerd op 2026-08-06. Het gratis plan:

| | Gratis | Pro |
|---|---|---|
| Mails per maand | 3.000 | 50.000+ |
| **Mails per dag** | **100 (harde cap)** | geen daglimiet |
| Domeinen | 1 | 10 |
| Inbound ontvangen | ja | ja |
| Commercieel/multi-tenant | toegestaan | toegestaan |

Twee daarvan raken dit ontwerp rechtstreeks.

**De daglimiet van 100 tegenover bulkverzending.** Beheermenu-spec §3c beschrijft bulk-uitnodigingen op
leverancierscriteria en noemt zelf het scenario "vijf of vijfhonderd". Bij vijfhonderd worden
er honderd verstuurd en vierhonderd geweigerd — en Resend rekent niets bij, het stopt gewoon.

Dat is een **stille faalvorm van precies de soort die dit project elders bestrijdt**: de
beheerder ziet "verstuurd", vierhonderd leveranciers krijgen niets, en dat blijkt pas bij de
deadline. Consequentie voor de bouw: de verzendcode moet het weigeren van Resend als een
**expliciete fout op de ronde** vastleggen, niet als een logregel. Zie tegenproef 6 in §7.

**Eén domein.** Genoeg voor de platformafzender, en niet meer. Variant 3 uit §3 vraagt dus
sowieso Pro. JCM gebruikt het gratis plan al voor `jouwcontractmanager.nl`, dus MCM2 heeft een
eigen verzenddomein nodig — zie §6.

---

## 4. De ontvangstkant — waar "afgeschermd" iets anders betekent

Bij verzenden is afscherming een databasevraag: RLS, tenantgrens, actor-eis. Bestaande
mechaniek, niets nieuws.

Bij ontvangen is dat niet zo. **Iedereen kan naar dat adres mailen.** Er is geen token, geen
sessie, geen tenantcontext — alleen een bericht met een afzender die beweert iemand te zijn.
De afscherming moet dus in de verwerking zitten, en de kernvraag is: *bij welke uitvraag hoort
deze mail, en mag deze afzender daar iets mee?*

### Drie ambitieniveaus

| Niveau | Wat er binnenkomt | Complexiteit | Advies |
|---|---|---|---|
| **1. Bounces en autoreplies** | "Adres bestaat niet", out-of-office | Laag | **Nu bouwen** |
| **2. Leveranciers die antwoorden** | "Wie zijn jullie?", "ik heb geen ISO 27001" | Midden | **Doorsturen naar de tenant** (`Reply-To`) |
| **3. Antwoorden per mail inleveren** | Ingevulde vragenlijst + certificaat als bijlage | Hoog | **Niet doen** |

**Waarom niveau 3 niet.** De portal met token is de veilige weg: het token bewijst wie er
inlevert, de upload gaat door onze validatie, en de vragenlijst is gestructureerd. Mail als
tweede inleverkanaal verdubbelt het aanvalsoppervlak — spoofing, bijlagen uit onbetrouwbare
bron, virusscan (#52 staat daar al open) — voor gemak dat de portal al biedt. Als een
leverancier per se wil mailen, is het juiste antwoord een medewerker die de link opnieuw
stuurt, niet een tweede verwerkingsroute.

**Waarom niveau 1 wél.** Vandaag is een niet-aangekomen uitnodiging onzichtbaar. De ronde
toont "verstuurd", de leverancier heeft niets, en dat blijkt pas als de deadline verstrijkt.
Een bounce afvangen is de goedkoopste betrouwbaarheidswinst in de hele keten.

### Drie kanalen die elkaar niet raken

Voordat `Reply-To` ter sprake komt, moet één misverstand uit de weg: **de vragenlijst wordt
nooit per mail ingevuld.** Het token geeft toegang tot MCM2, en daar gebeurt het invullen en
uploaden. Mail is uitsluitend het vervoermiddel voor de link.

| Wat | Kanaal | Wie verwerkt het |
|---|---|---|
| Vragenlijst invullen, certificaat uploaden | **MCM2, via token** | het systeem |
| Bounce, afleverstatus | **Webhook van Resend** | het systeem |
| Verhelderingsvraag, opmerking, afmelding | **`Reply-To` naar de tenant** | een mens bij de klant |

Drie doelen, drie kanalen, geen overlap. Dat niveau 3 hierboven afvalt is precies om deze
scheiding intact te houden: antwoorden per mail zou kanaal 1 en 3 door elkaar halen.

**Wat `Reply-To` uit §3 precies doet — en wat niet.** Het lost niveau 2 niet op; het verplaatst
het naar de partij die het kan afhandelen. Vragen als "wie zijn jullie?", "geldt deze norm wel
voor ons?" of "mijn collega gaat hierover" kunnen wij niet beantwoorden — alleen de tenant weet
of die leverancier nog een contract heeft en wie de juiste contactpersoon is.

Die berichten worden dus nog steeds gestuurd. Ze komen alleen ergens terecht waar iemand
antwoord heeft, en niet bij ons waar niemand dat heeft. Voor MCM2 betekent het dat we ze niet
hoeven te koppelen, bewaren of tonen; voor de tenant betekent het extra mail in een gedeelde
postbus. Dat is de juiste verdeling, maar het is een verschuiving en geen oplossing.

### Het gat dat `Reply-To` achterlaat

Antwoordt een leverancier naar de tenant, dan **weet MCM2 daar niets van**. De ronde blijft
"uitnodiging verstuurd, nog niet ingevuld" tonen terwijl er in werkelijkheid een gesprek loopt.

Meestal onschuldig. Maar bij een leverancier die per mail meldt "wij vallen hier niet onder" of
"wij leveren niet meer aan u", staat er een openstaande deadline in het systeem terwijl de zaak
feitelijk is afgehandeld. Dan gaat er een herinnering uit naar iemand die al antwoord heeft
gegeven — precies het soort automatisering dat een leverancier leert de mail te negeren.

**Besluit eigenaar 2026-08-06: de deelnemer krijgt een handmatige status "afgehandeld buiten
het systeem", met een verplicht notitieveld.**

Drie eisen daaraan:

1. **Zet de deelnemer buiten de herinneringen.** Dat is het hele doel: geen rappel naar iemand
   die al gereageerd heeft.
2. **De notitie is verplicht, niet optioneel.** "Afgehandeld" zonder reden is over een half
   jaar onleesbaar, en dit is een compliancedossier — waaróm iemand buiten de ronde valt is
   precies wat een auditor vraagt.
3. **Vastleggen in `audit.audit_event`**: wie, wanneer, welke deelnemer. Dit is een handmatige
   ingreep in een geautomatiseerd proces; die hoort traceerbaar te zijn.

De status maakt de discrepantie **zichtbaar in plaats van onzichtbaar**. Dat is het punt: het
systeem weet niet wat er in de mailbox van de klant gebeurt, en die grens moet in het scherm te
zien zijn — niet weggepoetst.

Dit is een klein stuk UI en het hoort bij fase C (het rondescherm), niet bij het mailkanaal
zelf. Genoteerd in §9 stap 6.

**Wat overblijft voor niveau 1** is daarmee smal en scherp: bounces en afleverstatussen,
machineleesbaar, van één afzender die we vertrouwen (Resend).

### Bounces bij Resend: webhooks, geen postbus

Resend meldt afleverstatussen via **webhooks** (`email.delivered`, `email.bounced`,
`email.complained`) op een endpoint dat wij publiceren. Dat verandert de mechaniek van §4
gunstig ten opzichte van een IMAP-postbus uitlezen:

- **Ondertekend.** Resend tekent elke webhook (Svix); wij verifiëren de handtekening. Dat is
  een fundamenteel sterkere garantie dan "er kwam een mail binnen die eruitziet als een bounce".
- **Gestructureerd.** JSON met het `email_id` dat wij bij verzending al kregen — geen
  bounceberichten parsen, geen VERP nodig voor dit doel.
- **Geen postbus.** Niets om op in te loggen, geen wachtwoord te bewaren.

**Consequentie: het webhook-endpoint is een publiek toegankelijke route** en dus onderdeel van
het aanvalsoppervlak. Handtekeningverificatie is daarmee geen nette toevoeging maar de
beveiligingsmaatregel zelf — zonder dat kan iedereen ons vertellen dat een mail gebounced is.
Zie tegenproef 7 in §7.

### Hoe een binnenkomende mail bij een uitvraag komt

Drie mechanismen, in volgorde van betrouwbaarheid:

1. **Het `email_id` van Resend.** Bij verzending geeft Resend een id terug; dat leggen we vast
   bij de ronde-deelnemer. Elke webhook draagt datzelfde id. Geen giswerk, geen parsing.
   **Dit is het mechanisme** voor alles wat niveau 1 nodig heeft.

2. **`Message-ID` vastleggen bij verzending**, en `In-Reply-To`/`References` van een antwoord
   daartegen matchen. Alleen relevant als niveau 2 er ooit komt; met `Reply-To` naar de klant
   is dat grotendeels overbodig geworden.

3. **Afzenderadres matchen** tegen `vendor_contact`. Alleen als aanvulling — een
   afzenderadres is triviaal te vervalsen en mag nooit op zichzelf een koppeling maken.

**De regel:** een binnengekomen mail die niet via mechanisme 1 of 2 te koppelen is, wordt
**niet geraden**. Hij gaat naar een bak "niet toegewezen" die een medewerker kan bekijken.
Automatisch koppelen op afzender is precies hoe je mail van tenant A aan tenant B koppelt.

### De tenantgrens bij ontvangst

Dit is de kern van "volstrekt afgeschermd". De sleutel in het adres (`responseId`) hoort bij
één `survey_response`, die bij één ronde hoort, die bij één tenant hoort. De koppeling loopt
dus **via de data, niet via de mailbox**. Gevolg:

- Een mail die binnenkomt op de gedeelde infrastructuur maar hoort bij tenant A, wordt
  opgeslagen mét `tenant_id` en valt daarna onder dezelfde RLS als alles.
- Een sleutel die niet bestaat of niet bij de tenant hoort → niet toegewezen, geen koppeling.
- Er is geen route waarlangs een medewerker van tenant B de mail van tenant A ziet, want de
  tabel heeft dezelfde `FORCE ROW LEVEL SECURITY` en actor-policy als de rest.

**Wat dit expliciet níét is:** één IMAP-postbus per tenant waar de applicatie op inlogt. Dat
zou betekenen dat MCM2 de inloggegevens van de mailbox van elke klant bewaart en daar
permanent op verbonden is. Dat is een aanzienlijk grotere belofte dan wat hier nodig is — en
het is de belofte die je niet waar kunt maken zodra een klant zijn wachtwoord wijzigt.

---

## 5. Het ontwerp: één poort, twee implementaties

De les uit `scripts/backup-controle.js` (de portabiliteitsgrens rond `haalNieuwsteBackup()`)
past hier één op één. Definieer één smalle grens, en laat alles daarachter onveranderd bij een
wisseling van provider.

```
MailKanaal (interface)
  ├── verstuur(bericht) → messageId
  └── haalBinnengekomen() → Bericht[]

Implementaties:
  ├── ResendMailKanaal    — de platformverstuurder (demo én productie)
  ├── SmtpMailKanaal      — eigen SMTP per tenant (Issue #76, op verzoek)
  └── LogMailKanaal       — schrijft naar console (tests, CI)
```

**Waarom dit nu al, ook nu er maar één echte implementatie is.** Drie redenen:

1. **Issue #76 blijft bestaan.** Vraagt een klant om eigen SMTP, dan is dat een tweede
   implementatie achter dezelfde grens — niet een tweede verzendpad door de hele applicatie.
2. **Een verstuurder is niet voor altijd.** Deze spec is in één dag van M365 naar Resend
   gegaan. Dat de knip er staat, is precies waarom die wissel goedkoop was.
3. **Zonder de interface geen `LogMailKanaal`**, en dan draaien de tests tegen een echte
   mailserver of ze draaien niet.

Dezelfde afweging als bij `haalNieuwsteBackup()` in `scripts/backup-controle.js`: één smalle
grens, alles daarachter onveranderd bij een wisseling.

**`LogMailKanaal` is niet optioneel.** Zelfde gedachte als `Telegram niet geconfigureerd →
no-op met logregel` in `scripts/telegram.js`: het script blijft bruikbaar op een machine zonder
bot. Hier: de testsuite blijft bruikbaar zonder mailserver.

### Wat er in de database bij komt

```
clm.mail_bericht        — elke verstuurde mail en elke statusmelding, met tenant_id
  ├── richting          uitgaand | inkomend
  ├── response_id       de koppeling (nullable — niet toegewezen bestaat)
  ├── provider_id       het email_id van Resend — de sleutel uit §4
  ├── message_id        voor In-Reply-To-matching (niveau 2, later)
  ├── status            verstuurd | afgeleverd | gebounced | geweigerd | geklaagd
  └── ruwe_kop          voor diagnose; de body bewust NIET
```

**De body slaan we niet op.** Een binnengekomen mail kan van alles bevatten — persoonsgegevens
van derden, bijlagen, handtekeningen met privé-adressen. Wat we nodig hebben is *dat* er
geantwoord is en *of* het aankwam. De inhoud lezen doet een mens in de mailbox. Dit scheelt
een AVG-gesprek en een hoop opslag.

---

## 6. De opzet concreet

### Het verzenddomein

MCM2 heeft een **eigen domein** nodig: het gratis Resend-plan geeft er één, en JCM gebruikt die
al voor `jouwcontractmanager.nl`.

Overwogen:

| | Domein | Oordeel |
|---|---|---|
| A | Subdomein van `alingadvies.nl` | Gratis, maar hangt de reputatie alsnog onder het bedrijfsdomein — precies wat §1 wilde vermijden |
| **B** | **Nieuw domein, bijv. `mcm2mail.nl`** | **~€10/jaar, volledig gescheiden van bedrijf én JCM** |
| C | Tweede Resend-account | Gratis, maar twee accounts beheren en twee limieten die niet optellen |

**Advies: B.** Een eigen verzenddomein is vóór de pilot toch nodig; tien euro is geen argument
om het uit te stellen tot het onder tijdsdruk moet.

**Wat er in DNS moet** (Resend levert de exacte records na het toevoegen van het domein):
SPF, DKIM, en een `MAIL FROM`-subdomein. Eén SPF-record — dit domein is nieuw, dus het
probleem van `alingadvies.nl` (twee records, zie §1) kan hier niet ontstaan.

**DMARC:** begin op `p=none` en scherp aan zodra er verkeer is. Direct op `reject` beginnen
betekent dat een fout in de DNS-configuratie álle mail tegenhoudt vóór er één succesvolle
verzending is geweest.

### Verzendinstellingen

| Instelling | Waarde |
|---|---|
| Provider | Resend, gratis plan |
| Sleutel | `RESEND_API_KEY` in `.env` — **eigen sleutel, niet die van JCM** |
| Afzenderadres | `uitvraag@[verzenddomein]` |
| Afzendernaam | `[tenantnaam] via MCM2` |
| `Reply-To` | het contactadres van de tenant |

De afzendernaam en `Reply-To` komen **per tenant uit de database** — dat is wat er van Issue
#76 overblijft en het is de reden dat de tenantinstellingen-tabel er alsnog komt, alleen zonder
SMTP-wachtwoord erin.

**Vooraf te regelen — aanzienlijk korter dan bij M365:**

1. Domein registreren en aan Resend toevoegen.
2. De DNS-records van Resend overnemen bij de registrar.
3. Wachten op verificatie (5–30 minuten).
4. API-sleutel aanmaken en in `.env` zetten. **Niet committen** — `.gitignore` dekt `.env`,
   maar dit is een sleutel waarmee namens het platform gemaild kan worden.

### Leveranciers naspelen — Gmail plus-adressering

`jouwadres+demo-vendor1@gmail.com` t/m `+demo-vendor5@gmail.com`. Alles komt in één inbox,
elk adres is voor MCM2 een andere leverancier.

**Waar dit goed voor is:** de mailroute end-to-end aantonen — verstuurd, aangekomen,
link geklikt, ingevuld, teruggekomen.

**Waar dit níét geschikt voor is, en dat is belangrijk:** aantonen dat leverancier A niets van
leverancier B ziet. Die adressen komen in dezelfde inbox uit; de scheiding die je wilt bewijzen
zit in de tokens en de tenantgrens, niet in de mailbox. Bewijs die dus met de tegenproeven uit
`MCM2-CLAUDE.md` §15b, niet met een mailtest.

**Eén valkuil:** sommige validators weigeren `+` in een e-mailadres. Als onze eigen validatie
dat doet, blokkeert de testopzet zichzelf. Dat is een test waard vóór de rest.

### Bounces afvangen

Een webhook-endpoint in MCM2 dat Resend aanroept bij `email.delivered`, `email.bounced` en
`email.complained`. Geen postbus, geen catch-all, geen VERP-adressering.

Vier eisen aan dat endpoint:

1. **Handtekening verifiëren** (Svix) vóór er iets met de inhoud gebeurt — zie §4.
2. **Idempotent.** Resend probeert opnieuw bij een fout; dezelfde melding twee keer verwerken
   mag geen tweede statuswijziging opleveren.
3. **Onbekend `email_id` → niet toegewezen**, nooit raden.
4. **Publiek bereikbaar**, dus buiten de Clerk/Entra-authenticatie. Dat is precies waarom eis 1
   geen detail is.

Voor lokaal testen kan Resend niet bij `localhost`. Gebruik een tunnel (ngrok of vergelijkbaar)
of test het endpoint met een nagebootst, correct ondertekend verzoek — dat laatste heeft de
voorkeur, want dat draait ook in CI.

---

## 7. Wat de tegenproeven moeten zijn

Conform `MCM2-CLAUDE.md` §15b: deze horen te falen vóórdat de code bestaat.

1. **Een uitnodiging naar een niet-bestaand adres levert een zichtbare bounce-status op.**
   Stuur naar `+demo-vendor-bestaatniet@gmail.com` en controleer dat de ronde dat toont —
   niet dat het log het weet. Dit is de kern van niveau 1: onzichtbaar falen is de faalvorm
   die we wegnemen.

2. **Een webhook met een onbekend `email_id` wordt niet gekoppeld.** Verstuur een correct
   ondertekende melding met een verzonnen id en controleer dat hij als "niet toegewezen"
   eindigt en niet aan de dichtstbijzijnde uitvraag wordt geplakt.

3. **Een `email_id` van tenant A, aangeboden in de context van tenant B, koppelt niet.** Dit
   is de tenantgrens bij ontvangst. Slaagt de koppeling wel, dan ligt de grens in de gewoonte
   om de juiste query te schrijven en niet in de database.

4. **Geen enkele route geeft de API-sleutel of het SMTP-wachtwoord terug** — overgenomen uit
   beheermenu-spec §4e, geldt onverkort.

5. **De verzendcode werkt met `LogMailKanaal` zonder netwerkverbinding.** Anders is elke test
   afhankelijk van een externe dienst, en dan draaien ze uiteindelijk niet meer.

6. **Een verzending die Resend weigert, laat de ronde niet op "verstuurd" staan.** Boots een
   daglimiet-weigering na (§3b) en controleer dat de betrokken deelnemer een expliciete
   foutstatus krijgt. Dit is de stille faalvorm die 400 leveranciers zonder uitnodiging kan
   laten zitten.

7. **Een webhook met een ongeldige handtekening wordt geweigerd.** Stuur een correct gevormd
   verzoek met een verkeerde handtekening en controleer dat er niets in de database verandert.
   Slaagt hij, dan kan iedereen op internet ons vertellen dat een mail gebounced is.

8. **Een deelnemer op "afgehandeld buiten het systeem" krijgt geen herinnering meer.** Zet de
   status, laat de herinneringsronde lopen en controleer dat er niets naar die deelnemer gaat.
   Dit is het hele doel van die status (§4); werkt hij niet, dan krijgt iemand die al
   geantwoord heeft alsnog een rappel.

9. **Een `+`-adres wordt door onze eigen validatie geaccepteerd.** Anders blokkeert de
   testopzet uit §6 zichzelf. Klein, maar het is de eerste test die moet draaien.

---

## 8. Gevolgen voor Issue #76

Het besluit uit §1 (platformverstuurder) verandert wat Issue #76 nog moet opleveren.

**Blijft nodig:** een tabel met tenantinstellingen voor **afzendernaam** en **`Reply-To`**.
Zonder dat is er geen "Transdev via MCM2" en gaan antwoorden nergens heen. Inclusief de
RLS-behandeling en de actor-policy uit beheermenu-spec §4b — dat verandert niet.

**Vervalt voorlopig:** het SMTP-wachtwoord en alles wat daaraan hangt. Concreet betekent dat
dat de zwaarste onderdelen van beheermenu-spec §4 nu níét gebouwd hoeven worden:

- het write-only wachtwoordveld (beheermenu-spec §4c, maatregel 1)
- de datasleutel per rij en de hoofdsleutel (beheermenu-spec §4d)
- de afhankelijkheid van Issue #30, die beheermenu-spec §4d expliciet als blokkade noemde:
  *"dit gerust bouwen, maar niet in productie zetten vóór #30 is opgelost"*

Dat laatste is winst die het opmerken waard is. Er stond een versleutelingsconstructie op de
planning die een sleutel zou toevoegen aan het herstelplan van een database die nog geen
werkende backup-garantie heeft. Die hele knoop is weg zolang er geen klant om eigen SMTP
vraagt.

**Wat er in de plaats komt:** één API-sleutel voor het hele platform, in `.env`, niet in de
database. Dat is een gewone secret zoals `MIGRATION_DATABASE_URL` er al een is — geen nieuw
soort risico, geen nieuwe ADR.

**Testknop blijft.** Beheermenu-spec §3b eist een testverzending met zichtbare uitkomst. Dat is met een
platformverstuurder net zo nodig: een verkeerd `Reply-To` of een niet-geverifieerd domein faalt
even stil als een verkeerde SMTP-poort.

---

## 9. Volgorde

1. **`MailKanaal` + `LogMailKanaal`** — de knip uit §5, met tegenproeven 5 en 9. Geen provider
   nodig, dus dit kan meteen en los van alles.
2. **Domein registreren, aan Resend toevoegen, DNS verifiëren** (§6). Doorlooptijd, geen werk.
3. **`ResendMailKanaal`** + de afzenderconstructie uit §3. Vanaf hier gaat er echt mail uit.
4. **`clm.mail_bericht`** met tenant_id en RLS — tegenproef 3.
5. **Webhook-endpoint** met handtekeningverificatie — tegenproeven 1, 2 en 7. Hier zit de
   waarde van niveau 1.
6. **Tenantinstellingen** (afzendernaam, `Reply-To`) — het restant van Issue #76 uit §8.
   Hoort samen met de status **"afgehandeld buiten het systeem"** uit §4: die is nodig zodra
   `Reply-To` live is, want vanaf dat moment ontstaan er gesprekken die MCM2 niet ziet.
   De status zelf is UI en hoort bij fase C; de eis komt hiervandaan.
7. **Niveau 2 (echte antwoorden bij ons ontvangen)** — alleen als `Reply-To` plus de handmatige
   status in de praktijk onvoldoende blijken. Verwachting: dat gebeurt niet.

Stap 1 kan nu beginnen: geen domein, geen sleutel, geen besluit meer nodig. Stap 2 heeft
doorlooptijd en is de enige echte wachttijd in de reeks.

Stap 1 t/m 6 zijn samen kleiner dan fase C van het surveybeheerplan en raken andere bestanden,
dus ze kunnen ernaast lopen. Fase D leunt erop, dus vóór fase D moeten ze af zijn.

---

## 10. Wat dit document bewust niet oplost

- **De virusscan op bijlagen** (#52). Speelt pas bij niveau 3, dat we niet doen.
- **Wie kijkt naar de bak "niet toegewezen"** (#48). Dezelfde vraag als bij de
  backup-meldingen: een signaal dat je moet gaan halen, is geen signaal.
- **De daglimiet van 100 tegenover bulkverzending.** §3b legt het probleem vast en tegenproef 6
  zorgt dat het zichtbaar faalt. De oplossing — spreiden over dagen, een wachtrij, of Resend
  Pro — hoort bij de bulkfeature (beheermenu-spec §3c), niet hier.
- **Sjablonen voor de mailtekst.** Beheermenu-spec §3b heeft dat al buiten scope gezet; blijft zo.
- **De twee SPF-records op `alingadvies.nl`.** Gevonden bij de DNS-controle van 2026-08-06 en
  ongeldig volgens RFC 7208. Raakt MCM2 niet meer nu de keuze op Resend viel, maar wél de
  gewone zakelijke mail van de eigenaar. Los daarvan te repareren bij mijndomein.nl: de twee
  `v=spf1`-records vervangen door één gecombineerd record.
