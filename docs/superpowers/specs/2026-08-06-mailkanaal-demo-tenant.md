# Ontwerp — het mailkanaal per tenant, uitgewerkt op de demo-tenant

**Datum:** 2026-08-06
**Status:** ONTWERP — niet gebouwd, geen migratie. Eén besluit gevraagd (§8).
**Aanleiding:** de eigenaar heeft een M365-account op `alingadvies.nl` beschikbaar als
demo-tenant, en wil het mailkanaal daarop zo echt mogelijk uitwerken — inclusief ontvangen.
**Raakt:** Issue #76 (SMTP per tenant), Issue #13 (afzender Transdev), fase D van
`docs/superpowers/plans/2026-08-03-surveybeheer.md`, Issue #52 (virusscan), Issue #48 (alerting)

---

## 0. Waar dit over gaat, in één alinea

Issue #76 en spec `2026-08-04-beheermenu-tenantinstellingen.md` §3b regelen **verzenden** per
tenant: SMTP-gegevens in de database, write-only wachtwoord, RLS met actor-eis. Degelijk
uitgewerkt en niet ter discussie. Wat daar niet in staat is **ontvangen** — en dat is geen
vergeten paragraaf maar een wezenlijk ander probleem. Bij verzenden bepaalt onze code wie wat
krijgt; bij ontvangen bepaalt de buitenwereld wat er binnenkomt. Dit document beschrijft het
mailkanaal als geheel, met de demo-tenant op `alingadvies.nl` als eerste echte invulling.

---

## 1. Uitgangspunten van de eigenaar (2026-08-06)

| Vraag | Antwoord |
|---|---|
| Afscherming | Per tenant een eigen, volstrekt afgeschermd mailkanaal |
| Demo-tenant | M365 Business op `alingadvies.nl` — hetzelfde account als voor Entra ID |
| Leveranciers naspelen | Gmail plus-adressering (`naam+vendor1@gmail.com`) |
| Business logic | Hooguit de goede ideeën van JCM overnemen; de rest degelijk en robuust hier |

Dat laatste is sturend voor §6: er is één idee uit JCM dat het overnemen waard is, en er zijn
drie dingen die we daar bewust anders doen.

---

## 2. Wat er in JCM staat, en wat daarvan bruikbaar is

Onderzocht op 2026-08-06 in `C:\DEV\Work\jouwcontractmanager`, geverifieerd in de code en niet
alleen in de spec — die twee lopen daar uiteen.

**JCM heeft geen ontvangstkant.** Geen inbound-verwerking, geen `reply_to`, geen IMAP, geen
webhook. Uitsluitend verzenden via Resend, met één afzenderadres uit een omgevingsvariabele
(`RESEND_FROM_EMAIL`, fallback `uitvraag@jouwcontractmanager.nl`). Voor de ontvangstkant is
daar dus geen voorbeeld: dat is hier nieuw werk.

### Het ene idee dat we overnemen

**De afzendernaam draagt de klant, het adres draagt het platform:**

```
Transdev via MCM2 <uitvraag@mcm2.nl>
```

Dat lost een echt probleem op. Issue #13 wil dat de uitnodiging van Transdev lijkt te komen —
anders klikt de leverancier niet, of meldt hij de mail als phishing. Maar een afzenderadres
`@transdev.nl` gebruiken vraagt dat Transdev ons in zijn SPF-record opneemt en ons DKIM laat
ondertekenen. Dat is een traject met de IT-afdeling van de klant, per klant, voordat er ook
maar één mail uit kan.

Met de display-name-constructie is de klant herkenbaar zonder dat je zijn domein nodig hebt.
Dat is geen omweg maar de nette oplossing: het adres zegt de waarheid over wie verstuurt.

### Wat we bewust anders doen

Paden hieronder zijn relatief aan `C:\DEV\Work\jouwcontractmanager`.

| JCM | Waarom hier anders |
|---|---|
| Antwoorden **hard verwijderd** bij afwijzen (`src/app/api/uitvragen/[id]/beoordelen/route.ts` r. 92–95) | Voor een compliance-dossier onverdedigbaar. Wat een leverancier eerder verklaarde is bewijs; dat gooi je niet weg. Hier: een nieuwe ronde-poging naast de oude, beide bewaard. |
| Mislukte upload gelogd, niet gemeld (`src/app/api/portal/uitvraag/[token]/route.ts` r. 44–45) | De leverancier krijgt `ok: true` terwijl zijn certificaat er niet in zit. Hier: mislukte upload is een mislukte inzending, met een zichtbare fout. |
| Vragenlijst hardcoded op drie plekken | MCM2 heeft `survey_template`/`survey_question` als echte tabellen. Niet overnemen. |
| Geen `reply_to` | Zie §4 — hier is de ontvangstkant het onderwerp. |

---

## 3. De verzendkant op M365 — één harde beperking

**Microsoft faseert SMTP Basic Auth uit.** Stand van zaken op 2026-08-06, geverifieerd tegen
Microsoft's herziene tijdlijn van 27 januari 2026:

| Wanneer | Wat |
|---|---|
| **Nu (aug 2026)** | Basic Auth op `smtp.office365.com` **werkt gewoon**, mits aan in de tenant |
| **Eind december 2026** | Standaard **uit** voor bestaande tenants; admin kan heraanzetten |
| **Na dec 2026** | Nieuwe tenants: niet beschikbaar, OAuth verplicht |
| **H2 2027** | Microsoft kondigt de definitieve verwijderdatum aan |

**Wat dit voor de demo betekent:** je opzet werkt vandaag. Een app-wachtwoord op het
`alingadvies.nl`-account volstaat, mits *Authenticated SMTP* op de mailbox aanstaat
(`Set-CASMailbox -SmtpClientAuthenticationDisabled $false`).

**Wat dit voor het ontwerp betekent:** we bouwen geen productieafhankelijkheid op iets dat
over vier maanden standaard uitgaat. Zie §5 — daar staat de knip die dat afvangt.

**Let op de faalvorm.** Als Basic Auth wegvalt is het antwoord `550 5.7.30`, een permanente
weigering. De mail wordt **niet** in de wachtrij gezet en niet opnieuw geprobeerd — hij is weg.
Precies het stille falen waar spec §3b de testknop voor eist.

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
| **2. Leveranciers die antwoorden** | "Wie zijn jullie?", "ik heb geen ISO 27001" | Midden | **Voorzien, later bouwen** |
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

### Hoe een binnenkomende mail bij een uitvraag komt

Drie mechanismen, in volgorde van betrouwbaarheid:

1. **VERP — het adres draagt de sleutel.** Verstuur met een envelope-afzender die de
   ronde-deelnemer identificeert: `bounce+<responseId>@mcm2.nl`. Een bounce komt terug op
   precies dat adres. Geen giswerk, geen parsing van berichtinhoud. Dit is het mechanisme.

2. **`Message-ID` vastleggen bij verzending**, en `In-Reply-To`/`References` van het
   antwoord daartegen matchen. Werkt voor echte antwoorden (niveau 2), niet voor alle
   bounces.

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
  ├── SmtpMailKanaal      — M365 Basic Auth (demo, nu)
  ├── GraphMailKanaal     — M365 OAuth (productie, ná dec 2026)
  └── LogMailKanaal       — schrijft naar console (tests, CI)
```

**Waarom dit nu al.** §3 zegt dat Basic Auth in december standaard uitgaat. Als de
verzendcode dan overal in de applicatie verspreid zit, is dat een verbouwing onder tijdsdruk.
Met deze knip is het één nieuwe klasse. Dat is een half uur werk nu, tegenover een
migratietraject straks — dezelfde afweging als bij de datasleutel in spec §4d.

**`LogMailKanaal` is niet optioneel.** Zonder dat draaien de tests tegen een echte mailserver,
of ze draaien niet. Zelfde gedachte als `Telegram niet geconfigureerd → no-op met logregel` in
`scripts/telegram.js`: het script blijft bruikbaar op een machine zonder bot.

### Wat er in de database bij komt

Naast de SMTP-tabel uit Issue #76:

```
clm.mail_bericht        — elke verstuurde en ontvangen mail, met tenant_id
  ├── richting          uitgaand | inkomend
  ├── response_id       de koppeling (nullable — niet toegewezen bestaat)
  ├── message_id        voor In-Reply-To-matching
  ├── status            verstuurd | afgeleverd | gebounced | geweigerd
  └── ruwe_kop          voor diagnose; de body bewust NIET
```

**De body slaan we niet op.** Een binnengekomen mail kan van alles bevatten — persoonsgegevens
van derden, bijlagen, handtekeningen met privé-adressen. Wat we nodig hebben is *dat* er
geantwoord is en *of* het aankwam. De inhoud lezen doet een mens in de mailbox. Dit scheelt
een AVG-gesprek en een hoop opslag.

---

## 6. De demo-opzet concreet

### Verzenden — `alingadvies.nl`

| Instelling | Waarde |
|---|---|
| Host | `smtp.office365.com` |
| Poort | 587, STARTTLS |
| Gebruiker | het M365-account op `alingadvies.nl` |
| Wachtwoord | **app-wachtwoord**, niet het accountwachtwoord |
| Afzenderadres | hetzelfde account (M365 weigert een afwijkende afzender) |
| Afzendernaam | `Demo-organisatie via MCM2` |

**Vooraf te controleren, anders faalt het meteen:**

1. *Authenticated SMTP* aan op de mailbox — staat bij veel tenants standaard uit.
2. MFA aan op het account (nodig om überhaupt een app-wachtwoord te kunnen maken).
3. SPF van `alingadvies.nl` moet Microsoft toestaan. Bestaat waarschijnlijk al door het
   Entra-gebruik, maar controleer het: zonder SPF landt alles in spam en denk je dat je code
   stuk is.

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

Envelope-afzender `bounce+<responseId>@alingadvies.nl`, met een catch-all of een regel die
alles op `bounce+*` naar één postbus stuurt. De demo leest die postbus niet automatisch uit —
dat is niveau 2. Voor nu is het genoeg dat de bounce *ergens aankomt waar hij te vinden is*,
zodat we kunnen aantonen dat de sleutel klopt.

---

## 7. Wat de tegenproeven moeten zijn

Conform `MCM2-CLAUDE.md` §15b: deze horen te falen vóórdat de code bestaat.

1. **Een uitnodiging naar een niet-bestaand adres levert een zichtbare bounce-status op.**
   Stuur naar `+demo-vendor-bestaatniet@gmail.com` en controleer dat de ronde dat toont —
   niet dat het log het weet. Dit is de kern van niveau 1: onzichtbaar falen is de faalvorm
   die we wegnemen.

2. **Een binnengekomen mail met een onbekende sleutel wordt niet gekoppeld.** Stuur een mail
   naar `bounce+00000000-0000-0000-0000-000000000000@...` en controleer dat hij als "niet
   toegewezen" eindigt en niet aan de dichtstbijzijnde uitvraag wordt geplakt.

3. **Een sleutel van tenant A, aangeboden in de context van tenant B, koppelt niet.** Dit is
   de tenantgrens bij ontvangst. Slaagt de koppeling wel, dan ligt de grens in de gewoonte om
   de juiste query te schrijven en niet in de database.

4. **Geen enkele route geeft het SMTP-wachtwoord terug** — overgenomen uit spec §4e, geldt
   onverkort.

5. **De verzendcode werkt met `LogMailKanaal` zonder netwerkverbinding.** Anders is elke test
   afhankelijk van een externe dienst, en dan draaien ze uiteindelijk niet meer.

---

## 8. Het besluit dat ik nodig heb

**Alles hierboven is uitgewerkt. Eén ding kan ik niet voor je beslissen:**

> **Wordt het mailkanaal in productie een eigen SMTP per tenant (klant levert gegevens), of
> één platformafzender met de klantnaam in de display name?**

| | Eigen SMTP per tenant | Platformafzender + display name |
|---|---|---|
| Afzender | `contractmanagement@transdev.nl` | `Transdev via MCM2 <uitvraag@mcm2.nl>` |
| Wat Issue #13 letterlijk vraagt | ✅ | ➖ herkenbaar, ander adres |
| Werk per nieuwe klant | IT-afdeling: SMTP-account, app-wachtwoord/OAuth | Geen |
| Bezorgbaarheid | Klant beheert eigen reputatie | Wij beheren één reputatie |
| Als het misgaat | Klantspecifiek, zij moeten het oplossen | Eén plek, wij lossen het op |
| Basic-Auth-deadline dec 2026 | Elke klant afzonderlijk naar OAuth | Eén keer regelen |

**Mijn advies: platformafzender met display name, en eigen SMTP als optie voor wie erom
vraagt.** Reden: het is precies wat JCM's ene goede idee oplost, het schaalt zonder gesprek
met de IT-afdeling van elke klant, en het maakt de Basic-Auth-overgang van december één klus
in plaats van één per klant. De infrastructuur uit Issue #76 blijft nodig — alleen wordt hij
dan de uitzondering en niet de regel.

Dit besluit raakt Issue #76 rechtstreeks: bij de platformvariant verschuift de SMTP-tabel van
"eerst bouwen" naar "bouwen wanneer een klant erom vraagt".

---

## 9. Volgorde, als het besluit er is

1. **`MailKanaal` + `LogMailKanaal`** — de knip uit §5, met tegenproef 5. Geen mailserver nodig.
2. **`SmtpMailKanaal`** en de demo-instellingen uit §6. Vanaf hier gaat er echt mail de deur uit.
3. **`clm.mail_bericht`** met tenant_id en RLS — tegenproef 3.
4. **VERP-afzender en bouncekoppeling** — tegenproeven 1 en 2. Hier zit de waarde van niveau 1.
5. **Niveau 2 (echte antwoorden)** — pas als de vorige vier staan en er vraag naar is.

Stap 1 t/m 4 zijn samen kleiner dan fase C van het surveybeheerplan. Ze kunnen ernaast, want
ze raken andere bestanden — maar fase D leunt erop, dus vóór fase D moeten ze af zijn.

---

## 10. Wat dit document bewust niet oplost

- **De virusscan op bijlagen** (#52). Speelt pas bij niveau 3, dat we niet doen.
- **Wie kijkt naar de bak "niet toegewezen"** (#48). Dezelfde vraag als bij de
  backup-meldingen: een signaal dat je moet gaan halen, is geen signaal.
- **Rate limiting op uitgaande mail.** Bij bulk-uitnodigingen (spec §3c) is vijfhonderd mail
  in één keer een reële mogelijkheid, en M365 kent verzendlimieten. Aparte vraag, hoort bij
  de bulkfeature.
- **Sjablonen voor de mailtekst.** Spec §3b heeft dat al buiten scope gezet; blijft zo.
