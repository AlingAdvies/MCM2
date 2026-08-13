# Pariteitscontract — wanneer zijn de omgevingen gelijk?

**Type:** N — norm
**Eigenaar:** Kees Maling
**Vastgesteld:** 2026-08-13
**Geldt voor:** acceptatie, staging, productie — en elke omgeving die erbij komt
**Onderbouwing:** onderzoek 2026-08-13, twintig bronnen (zie §7)

---

## 0. Waarom dit document bestaat

Op 13-08 constateerde de eigenaar na drie dagen werk: *"volgens mij gaat er
structureel iets mis."* De diagnose bleek niet technisch maar normatief.

**Er was geen definitie van "gelijk".** Daardoor was elke afwijking een
verrassing in plaats van een gedetecteerde overtreding, en kostte elke
bevinding een ronde: is dit een bug, een verkeerde omgeving, of oude code?

Wat er die dag misging, in volgorde:

| Waarneming | Wat het werkelijk was |
|---|---|
| `unknown` op het scherm van acceptatie | Issue #133 zat in `main` maar acceptatie draaide oudere code |
| Twee keer naar het verkeerde scherm gestuurd | Acceptatie en productie delen één hostnaam; alleen het sub-pad verschilt |
| "productie: 0 tenants" | RLS zonder tenantcontext — er waren er drie |
| "0 oordelen" | Actor niet gezet — er zijn er vier |

De eerste twee zijn pariteitsproblemen. De laatste twee zijn meetfouten, maar
van dezelfde familie: **nul betekende niet "er staat niets", maar "je kijkt
verkeerd".**

Het onderzoek noemt de oplossing een *pariteitscontract*: leg vast wat gelijk
moet zijn, wat mag verschillen, en waarom — vóór je gaat meten.

> **De grens, letterlijk uit het onderzoek:**
> *"Zodra een verschil ertoe leidt dat de applicatie in acceptatie andere
> dependencies gebruikt, andere migraties toepast of andere RLS-policies heeft
> dan in productie, zijn testresultaten niet meer generaliseerbaar naar
> productie; dan test u in wezen een andere systeemvariant dan u uitrolt."*

---

## 1. Het contract in één zin

> **Een wijziging mag pas naar productie als hij is beproefd in een omgeving
> waarvan de acht indicatoren in §2 aantoonbaar gelijk zijn aan productie,
> behoudens de bewuste uitzonderingen in §3.**

Niet "zo gelijk mogelijk". Aantoonbaar gelijk, op acht benoemde punten.

---

## 2. MOET GELIJK ZIJN — de acht indicatoren

Deze acht komen uit het onderzoek en zijn hier vertaald naar wat er in dit
project werkelijk bestaat.

| # | Indicator | Wat het is | Nu meetbaar? |
|---|---|---|---|
| 1 | `BackendImageDigest` | Welk backend-image draait er echt | ❌ **nee** |
| 2 | `FrontendImageDigest` | Welk frontend-image draait er echt | ❌ **nee** |
| 3 | `DBSchemaVersion` | Aantal toegepaste migraties | ✅ `verify:omgevingen` |
| 4 | `RLSPolicyVersion` | Tabellen met RLS, met FORCE, aantal policies | ⚠️ deels |
| 5 | `ConfigVersionHash` | Welke configuratiesleutels bestaan (namen, niet waarden) | ❌ nee |
| 6 | `PostgresVersion` | Major- en minorversie | ✅ |
| 7 | `IdentityConfig` | Entra-tenant, claimsstructuur, rolmapping | ❌ nee |
| 8 | `MailProvider` | Resend of het logkanaal | ❌ nee |

**`verify:omgevingen` dekt er vandaag twee van de acht volledig.** Dat is geen
verwijt aan dat script — het is gebouwd vóór deze norm bestond — maar het
verklaart wel waarom het groen kon staan terwijl de omgevingen niet gelijk
waren.

### 2.1 Waarom indicator 1 en 2 het zwaarst wegen

Het onderzoek is hier ondubbelzinnig: **de image-digest is doorslaggevend, niet
de git-commit.**

> *"Versiebeheer van code (Git-commit-hashes) is belangrijk, maar voor
> runtime-pariteit zijn de daadwerkelijke image-digests doorslaggevend."*

Precies dit ontbrak op 13-08. De fix voor Issue #133 zat in `main`, maar
acceptatie draaide een ouder image. Er was geen enkele controle die dat kon
zien — en dus werd het ontdekt doordat er toevallig `unknown` op een scherm
stond.

**Dit is het belangrijkste gat in de hele keten.**

### 2.2 Wat er vandaag werkelijk gemeten is

Gemeten op 2026-08-13 tegen de echte databases, niet aangenomen:

| indicator | staging | productie | oordeel |
|---|---|---|---|
| migraties | 27 | 27 | ✅ gelijk |
| markering | `wegwerp` | `beschermd` | ✅ **hoort te verschillen** (§3) |
| PostgreSQL | 17.6 | 17.6 | ✅ gelijk |
| tabellen in `clm` | 20 | 20 | ✅ gelijk |
| tabellen met RLS | 17 | 17 | ✅ gelijk |
| tabellen met FORCE | 12 | 12 | ✅ gelijk |
| policies | 19 | 19 | ✅ gelijk |
| SECURITY DEFINER-functies | 7 | 7 | ✅ gelijk |
| rollen `clm_*` | 6 | 6 | ✅ gelijk |
| rollen met BYPASSRLS | 0 | 0 | ✅ gelijk |

**Staging en productie zijn op databaseniveau volledig gelijk.**

**Acceptatie ontbreekt in deze meting** en dat is zelf een bevinding: die
database luistert alleen op `127.0.0.1:55460` op saxombp en is vanaf de laptop
niet te bevragen zonder SSH — en SSH weigert (`tailnet policy does not permit
you to SSH as user "kees"`). Een omgeving die je niet kunt meten, kun je niet
in pariteit houden.

---

## 3. MAG VERSCHILLEN — bewust en begrensd

Het onderzoek staat verschillen toe in "randlagen", mits ze niet tot andere
codepaden leiden. Voor dit project:

| Wat | Mag verschillen | Grens |
|---|---|---|
| **Markering** (`clm.omgeving`) | ja — dat is het doel ervan | productie is altijd `beschermd` |
| **Datavolume** | ja | alleen voor functionele tests; performancetests eisen productie-achtige volumes |
| **Configuratie-*waarden*** | ja — andere host, andere sleutel | de *namen* van de sleutels moeten gelijk zijn (indicator 5) |
| **Logdetail** | ja | zolang debug geen andere codepaden activeert |
| **Toegangsregels** | ja — strenger richting productie | niet zó streng dat een testpad anders loopt |
| **Capaciteit** | ja | zie datavolume |

### Wat NIET mag verschillen, met naam en toenaam

- **Mailkanaal.** Draait acceptatie op `LogMailKanaal` en productie op Resend,
  dan test je een andere mailstack. Dat is precies Issue #131 in een andere
  vorm. Het onderzoek: *"als acceptatie Resend gebruikt en productie SES, test
  u feitelijk een andere e-mailstack."*
- **Identity-provider.** Dezelfde Entra-tenant, dezelfde claimsstructuur,
  dezelfde rolmapping. Aparte app-registraties per omgeving mogen, met eigen
  redirect-URI's.
- **PostgreSQL-major.** Een verschil hier maakt migratietests waardeloos.
- **RLS-policies en FORCE.** De tenantgrens is functionaliteit, geen instelling.
- **Handmatige wijzigingen.** Het onderzoek noemt dit expliciet: *"Als u in
  acceptatie handmatig scripts uitvoert die niet via de pipeline in productie
  lopen, ontstaat een parallel change-pad dat pariteit ondergraaft."*

---

## 4. De uitzondering die dit project vandaag schendt

**Eén hostnaam voor drie omgevingen.**

`saxombp.tail4b29b.ts.net` draagt acceptatie (`/beheer`) én productie
(`/productie/beheer`). Gevolgen die al gemeten zijn:

1. **Je kunt niet zien waar je bent.** Op 13-08 tweemaal naar het verkeerde
   scherm gekeken; alleen de URL verraadt het.
2. **Sessiecookies botsen.** Eén cookienaam op `path=/` — inloggen op
   acceptatie wist de productiesessie.
3. **Het sub-pad haalt bestanden van de verkeerde omgeving.**

Dit is een **erkende, tijdelijke overtreding** van dit contract. Hij verdwijnt
bij de verhuizing naar AWS, waar elke omgeving een eigen hostnaam met eigen
certificaat krijgt. Tot die tijd geldt: **een bevinding op een scherm is pas
een bevinding als de omgeving is vastgesteld.**

---

## 5. Hoe dit gehandhaafd wordt

Het onderzoek is scherp over het verschil tussen constateren en afdwingen:

> *"Zulke controles zorgen ervoor dat pariteit niet iets is wat u pas achteraf
> constateert, maar een harde voorwaarde voor elke uitrol."*

| Moment | Wat er gebeurt | Bestaat het al? |
|---|---|---|
| Bij elke uitrol | De acht indicatoren teruglezen ná de deploy | ⚠️ deels — alleen migratiestand |
| Vóór productie | `productie:poort` blokkeert bij afwijking | ✅ voor de migratiestand |
| Periodiek | `verify:omgevingen` legt de drie naast elkaar | ✅ maar meet 2 van de 8 |
| Continu | Drift melden zodra hij ontstaat | ❌ nee |

### De volgorde waarin de gaten gedicht worden

**1. Image-digest zichtbaar maken** — het grootste gat. Zonder dit weet je
nooit welke code waar draait, en blijft elke bevinding onbetrouwbaar.

**2. Acceptatie meetbaar maken** — nu onbereikbaar vanaf de laptop. Een
omgeving die je niet kunt meten, valt buiten dit contract.

**3. `verify:omgevingen` uitbreiden** van twee naar acht indicatoren.

**4. De hostnaamscheiding** — komt gratis mee bij AWS, en is daar de
standaardvorm.

---

## 6. Wat dit contract NIET is

- **Geen AWS-plan.** De inrichting op AWS staat in
  `plan-robuuste-simulatie-zonder-aws.md` en de AWS-documenten. Dit contract
  geldt ongeacht waar de omgevingen draaien.
- **Geen belofte dat alles gelijk ís.** Het is de meetlat. §2.2 laat zien wat
  er vandaag onder valt en wat niet.
- **Geen vervanging van `verify:omgevingen`.** Dat script blijft het
  gereedschap; dit document zegt wat het zou moeten meten.

---

## 7. Bronnen

Onderzocht 2026-08-13 (Perplexity deep research, twintig bronnen). De
belangrijkste:

| Bron | Wat het bijdraagt |
|---|---|
| Twelve-Factor App, factor X | De definitie van dev/prod parity: tijds-, personeels- en toolskloof |
| AWS Well-Architected (Operations, Reliability) | Meerdere omgevingen met toenemende controls; IaC; driftdetectie |
| CNCF / Argo CD | Drift als continu gemeten verschil tussen gewenste en werkelijke staat |
| DORA 2024 | "Welke versie draait waar" als voorwaarde voor snelle recovery |
| ISO 27001:2022, controle 8.32 | Change management: testen in een representatieve omgeving is verplicht |
| ENISA NIS2-richtlijn | Configuratie- en change-beheer als weerbaarheidseis |
| Google SRE | Tests zijn alleen waardevol bij representatieve infrastructuur |

**Twee spanningen die het onderzoek benoemt en die hier gelden:**

- Twelve-Factor wil dat dezelfde persoon bouwt én uitrolt; ISO 27001 eist
  functiescheiding. Met één beheerder is dat niet op te lossen — het
  GitHub-akkoord op de Environment `productie` is hier de pragmatische
  invulling.
- AWS Well-Architected suggereert soms meerdere Organizations; de
  multi-account-guide raadt één Organization aan. Voor dit formaat is dat
  laatste leidend.

---

## 8. Onderhoud

Dit contract veroudert zodra de omgevingen veranderen. Werk het bij wanneer:

- een indicator meetbaar wordt die dat nu niet is
- een omgeving erbij komt of verdwijnt
- de verhuizing naar AWS de hostnaamovertreding uit §4 opheft
- een verschil dat nu in §3 staat toch blijkt te schuren

**Meet opnieuw voordat je iets aan §2.2 verandert.** Die tabel is een meting,
geen aanname — en dat onderscheid is precies waar dit document over gaat.
