# Runbook — het mailkanaal inrichten (Resend)

**Type:** C — toegang en credentials
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-06
**Vereiste toegang:** Resend-account, DNS-beheer van het verzenddomein

> **Status: ingericht en werkend op 2026-08-06.** Domein `send.myvendormanager.nl` is
> geverifieerd, een testbericht is aantoonbaar verstuurd. De stappen hieronder zijn de
> herhaalbare procedure — voor een nieuw domein, een nieuwe omgeving, of om te controleren
> of het nog klopt.

> Ontwerp en onderbouwing: `docs/superpowers/specs/2026-08-06-mailkanaal.md`

---

## Wat hier staat en waarom

MCM2 verstuurt uitnodigingen namens de tenant, via één platformverstuurder. De klant is
herkenbaar aan de afzendernaam; het adres blijft van het platform:

```
Van:      "Transdev via MCM2" <uitvraag@send.myvendormanager.nl>
Reply-To: contractmanagement@transdev.nl
```

Waarom niet het adres van de klant zelf: dat vraagt dat de klant ons in zijn SPF opneemt en
met zijn DKIM laat ondertekenen — een traject met hun IT-afdeling per klant, voordat er ook
maar één mail uit kan. Zie ontwerp §3.

---

## Stap 1 — Een verzenddomein kiezen

**Gebruik een subdomein, niet het hoofddomein.** Ingericht op 2026-08-06 als
`send.myvendormanager.nl`.

Twee redenen:

1. **Reputatie blijft gescheiden.** Gaat er iets mis met een bulkronde — veel bounces op
   verouderde adressen — dan raakt dat het subdomein en niet de gewone mail op het
   hoofddomein.
2. **Bestaande records blijven ongemoeid.** Er staat al een MX en een SPF op het hoofddomein.
   Bij een subdomein hoeft daar niets aan te veranderen; de nieuwe records staan in een
   andere tak.

Dat tweede punt is niet theoretisch: op `alingadvies.nl` staan **twee** SPF-records, wat
ongeldig is volgens RFC 7208. Met een subdomein kan die situatie per constructie niet
ontstaan.

**Regio:** Ireland (`eu-west-1`) — EU, past bij de AVG-uitgangspunten van het project.

---

## Stap 2 — Domein toevoegen in Resend

1. resend.com → **Domains** → **Add domain**
2. Naam: het subdomein, bijv. `send.myvendormanager.nl`
3. Regio: **Ireland (eu-west-1)**
4. **Add domain**

**"Enable Receiving" laten uitstaan.** Bounces komen via webhooks binnen, niet via een
postbus (ontwerp §4). Aanzetten voegt een MX-record toe dat niet gebruikt wordt.

Het veld "Your Name" rechts in beeld is een voorbeeldweergave, geen invoerveld. De
afzendernaam wordt per bericht meegegeven vanuit MCM2 en komt per tenant uit de database —
daarom staat hij niet bij Resend ingesteld.

---

## Stap 3 — DNS-records plaatsen

Resend toont drie records. Voor `send.myvendormanager.nl` waren dat:

| Type | Naam (zoals Resend toont) | Inhoud |
|---|---|---|
| TXT | `resend._domainkey.send` | `p=MIGfMA0GCSq…IDAQAB` (DKIM, ±216 tekens) |
| TXT | `send.send` | `v=spf1 include:amazonses.com ~all` |
| MX | `send.send` | `feedback-smtp.eu-west-1.amazonses.com`, prioriteit 10 |

### De valkuil: relatief of volledig?

Resend toont **relatieve** namen (`send.send`). Veel DNS-panelen willen de **volledige**
hostnaam. Bij mijndomein.nl is dat het geval — daar staat `soverin1._domainkey.jouwdomein.nl`
voluit in de zone.

Voor mijndomein wordt het dus:

```
resend._domainkey.send.myvendormanager.nl
send.send.myvendormanager.nl
send.send.myvendormanager.nl
```

**Die dubbele `send` is correct**: één keer voor het subdomein, één keer voor het label dat
Resend eronder hangt.

**Hoe je weet welke vorm jouw paneel wil:** kijk naar een bestaand record. Staat er `@`, dan
is het relatief. Staat het domein er voluit, dan volledige namen.

Zet je het fout, dan ontstaat `…myvendormanager.nl.myvendormanager.nl` en verifieert Resend
nooit — zonder duidelijke foutmelding. Dat is de meest gemaakte fout in deze stap.

### Verder

- **Punt aan het eind** bij MX en CNAME, zoals de bestaande records in de zone. Bij TXT niet.
- **De DKIM-waarde in één stuk**, zonder regeleindes. Eén ontbrekend teken maakt de
  handtekening ongeldig.
- **Niets verwijderen.** Alle drie de records zijn toevoegingen.

---

## Stap 4 — Controleren vóór je op verifiëren drukt

```bash
nslookup -type=TXT resend._domainkey.send.myvendormanager.nl 8.8.8.8
nslookup -type=TXT send.send.myvendormanager.nl 8.8.8.8
nslookup -type=MX  send.send.myvendormanager.nl 8.8.8.8
```

**Gebruik expliciet een publieke resolver (`8.8.8.8`).** Op 2026-08-06 gaf de lokale
router-resolver een leeg antwoord voor het SPF-record terwijl het record correct stond — een
cache die nog niet ververst was. Dat leest als een fout die er niet is.

**Verwacht:** alle drie de records met de waarden uit stap 3.

Daarna in Resend: **"I've added the records"**. Verificatie duurt 5–30 minuten.

---

## Stap 5 — API-sleutel en configuratie

1. Resend → **API Keys** → **Create API Key**
2. Naam: `MCM2`. **Een eigen sleutel** — niet die van JouwContractmanager hergebruiken.
3. Permissie: **Sending access** volstaat.
4. Kopieer meteen; hij wordt één keer getoond.

In `.env`:

```
RESEND_API_KEY=re_...
MAIL_AFZENDER_ADRES=uitvraag@send.myvendormanager.nl
```

**Beide invullen of beide leeg laten.** Half ingesteld weigert de applicatie op te starten —
stil terugvallen op het logkanaal zou betekenen dat je denkt dat er mail uitgaat terwijl er
niets gebeurt.

**Het afzenderadres moet op het geverifieerde domein staan.** Een adres op het hoofddomein
weigert Resend met `invalid_from_address`.

`.env` staat in `.gitignore` en hoort daar te blijven.

---

## Stap 6 — De verzending testen

**Dit is geen optionele stap.** Zonder deze test weet je pas of het mailkanaal werkt op het
moment dat je het het hardst nodig hebt — dezelfde redenering als bij
`npm run backup:controle:test`.

```bash
npm run build
npm run mail:test -- jouwadres@example.com
```

**Verwacht:**

```
Verstuurt via Resend vanaf uitvraag@send.myvendormanager.nl.

Geslaagd — bericht-id f47455a6-...
```

Controleer in het ontvangen bericht:

- de afzender toont de display name, niet alleen het adres
- beantwoorden gaat naar het `Reply-To`-adres
- het bericht staat niet in de spammap

**Belandt het in spam:** bij een nieuw verzenddomein zonder opgebouwde reputatie is dat niet
ongewoon, zeker bij Hotmail en Outlook. Het betekent niet dat de records fout staan. De
reputatie bouwt op naarmate er meer legitieme mail uitgaat.

### De tegenproef

```bash
npm run mail:test -- geen-geldig-adres
```

**Verwacht:** `MISLUKT: Ongeldig ontvangeradres`, exitcode 1, en er gaat geen netwerkaanroep
uit. Slaagt dit wél, dan is de validatie stuk.

---

## Wat dit nog niet afdekt

**Een niet-bestaand maar geldig gevormd adres levert "Geslaagd" op.** Getest op 2026-08-06
met `bestaat-echt-niet-mcm2test@gmail.com`: Resend accepteert het bericht, de bounce komt
pas later, en zonder webhook horen we die nooit.

Dat is geen fout maar precies het gat dat ontwerp §4 beschrijft: vandaag is een
niet-aangekomen uitnodiging onzichtbaar. Het webhook-endpoint (stap 5 uit ontwerp §9) sluit
dat.

**Tot die tijd:** een uitnodiging die niet aankomt, blijkt pas als de deadline verstrijkt.
Wie wil weten of iets is aangekomen, kijkt in Resend onder **Emails** — daar staat de status
per bericht.

---

## Limieten van het gratis plan

| | Gratis | Pro |
|---|---|---|
| Per maand | 3.000 | 50.000+ |
| **Per dag** | **100 (harde cap)** | geen daglimiet |
| Domeinen | 1 | 10 |

**De daglimiet is de belangrijkste.** Bij een bulkronde van vijfhonderd worden er honderd
verstuurd en vierhonderd geweigerd — Resend rekent niets bij, het stopt gewoon. De
verzendcode legt dat vast als een fout op de ronde (`daily_quota_exceeded`), maar de
uitnodigingen zijn die dag niet verstuurd.

**Eén domein** betekent ook: JouwContractmanager gebruikt zijn eigen gratis plan voor
`jouwcontractmanager.nl`. Die twee delen niets.

---

## Bij problemen

**"Domain not verified" blijft staan:** controleer met stap 4 of de records er wereldwijd
staan. Meestal is de hostnaam dubbel aangevuld — zie de valkuil in stap 3.

**`invalid_from_address`:** het adres in `MAIL_AFZENDER_ADRES` staat niet op het geverifieerde
domein.

**`daily_quota_exceeded`:** de 100 van vandaag zijn op. Morgen weer, of upgraden.

**Applicatie start niet op met een melding over `MAIL_AFZENDER_ADRES` of `RESEND_API_KEY`:**
één van beide is ingevuld en de andere niet. Vul beide in, of laat beide leeg.

**Niets komt aan maar Resend meldt "Delivered":** kijk in de spammap van de ontvanger. Bij een
nieuw domein is dat de waarschijnlijkste verklaring.
