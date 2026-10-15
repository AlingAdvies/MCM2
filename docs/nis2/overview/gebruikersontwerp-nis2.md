# Gebruikersontwerp NIS2-module — vanuit gebruiker en scherm

**Datum:** 14-10-2026
**Status:** voorstel ter bespreking. Geen besluit; nog niets gebouwd of gewijzigd in mcm2.
**Werkwijze:** eerst wie wat wil doen, dan de schermen, dan pas welke techniek dat vraagt. Past bij mcm2-afspraak §1a: backend en scherm samen, "klaar" betekent bruikbaar.
**Leeswijzer:** *Bestaat* = gezien in de mcm2-repo (14-10-2026, gelezen, niet getest). *Voorstel* = nieuw.

## 1. Actoren en wat ze willen

| Actor | Doel in één zin | Heeft account? |
|---|---|---|
| **NIS2-coördinator** (primair; vaak security/compliance erbij, geen specialist) | Weten welke leveranciers ertoe doen, ze laten invullen, en kunnen aantonen dat ik bezig ben | Ja |
| **Contractmanager / inkoper** (beheert de leverancier) | Mijn leveranciers classificeren en opvolgen zonder jargon | Ja |
| **Beoordelaar** (CISO/security) | Antwoorden en bewijs beoordelen over alle leveranciers heen | Ja |
| **Bestuurder** | In één blik zien hoe we ervoor staan; een rapport kunnen voorleggen | Ja, alleen lezen |
| **Leverancier** (extern) | In ~20 minuten klaar zijn, niet elke klant opnieuw hetzelfde invullen | Nee (link) |
| **Adviseur** (Kees / zorgadviseur) | Voor meerdere klanten werken | Ja, meerdere tenants |
| **Auditor** (extern, tijdelijk) | Dossier inzien | Ja, alleen lezen, vervalt |

## 2. Kernreizen

**A. Eerste 30 minuten (nieuwe klant).** Aanmelden → leveranciers laden (import of handmatig) → de 3 belangrijkste classificeren → voor één leverancier de lijst uitzetten. Succesmoment: *er staat een uitgezette lijst met verwachte datum* binnen het eerste half uur. Dit is de conversie in de 30-dagenproef (ADR 0002).

**B. Leverancier vult in.** Link in mail → korte uitleg (waarom, hoeveel tijd, wie vraagt het) → voortgang zichtbaar, tussentijds opslaan → optioneel bewijs uploaden → bevestiging met samenvatting. Doel: geen enkele schermstap die niet nodig is. Dit is de plek waar respons wordt gewonnen of verloren.

**C. Beoordelaar.** Werkvoorraad "wat wacht op mij" → per antwoord oordeel (goed/afgekeurd, met toelichting) → leverancier krijgt terugkoppeling. Elk oordeel met naam en datum, nooit overschreven (bestaat).

**D. Bestuurder.** Eén scherm: risicomatrix (belang × volwassenheid), aantal leveranciers per status, wat te laat is. Plus exporteerbaar rapport met auditspoor.

**E. Volgende ronde.** Herbeoordeling: vooraf ingevulde antwoorden van vorige keer, leverancier past alleen aan wat veranderde. Dit raakt direct de vragenlijstmoeheid (zie `marktsignalen-ncsc-2026-10.md` (intern document, buiten de publieke repo: OneDrive\MCM2-klantdata\_platform\nis2\), S1).

## 3. Schermen (inventaris, per scherm: wie · doel · kern · acties)

1. **Werkvoorraad "wat wacht op mij"** — alle interne rollen · eerste scherm · twee voorraden zoals ADR-013 (contractmanager: mijn leveranciers; beoordelaar: ingediende antwoorden) met schakelaar "van mij / hele organisatie" · *bestaat grotendeels* (`mijn-vendors`, `mijn-beoordelingen`).
2. **Leverancierslijst met NIS2-kolommen** — coördinator, contractmanager · overzicht · naam, niveau (SC10/20/30), status, laatste ronde, risicoscore · filter op status · dicht, volle breedte (mcm2 §1c). *Voorstel* op bestaand leveranciersscherm.
3. **Leveranciersdossier, tab NIS2** — coördinator, contractmanager · alles over één leverancier · classificatie, rondes, antwoorden, bewijs, notities · *bestaat deels* (vendor-dossiers, notities).
4. **Classificatie (stream A)** — contractmanager · bepaalt belang en niveau · 2 stappen: wat doet de leverancier voor ons, wat gebeurt er bij uitval; uitkomst = voorgesteld niveau, met eigen overrule · *voorstel*; ref-tabellen voor criticality/risk tier lijken te bestaan (niet gecontroleerd).
5. **Uitzetten** — coördinator/admin · kies lijst (voorgesteld uit niveau), contactpersoon, termijn · bevestigingsscherm toont wie wat krijgt · *bestaat* (rondes, deelnemers, heruitnodigen).
6. **Invulscherm leverancier** — leverancier · zie reis B · *bestaat* (token, concept opslaan, bijlagen); inhoud en toon zijn te herzien.
7. **Beoordelingsscherm** — beoordelaar · antwoord + bewijs naast elkaar, oordeel, notitie · *bestaat*.
8. **Dashboard / risicomatrix** — coördinator, bestuurder · reis D · *voorstel* (blok 7; kern "aha").
9. **Rapport en auditspoor** — coördinator, bestuurder, auditor · export · *voorstel* (blok 10).

Per nieuw datascherm de mini-intake uit mcm2 §1c doorlopen (aanmaken *én* bewerken, vervolgstap, voorinvulling).

## 4. Inloggen, gebruikers en rechten

### 4.1 Wat er al ligt (bestaat)
- **Intern:** inloggen via een externe identity provider (Entra External ID, OIDC), sessie via cookie, tenant komt uit het geverifieerde token. Rollen in `tenant_membership`: `admin`, `reviewer`, daarnaast `support` (aanvullend, zie ADR-015 voor platformbeheer-toegang tot klant-tenants).
- **Eigenaarschap:** contractmanager = `vendor.owner_user_id`; beoordelaar = koppeling template→gebruiker (`template_reviewer`). **De koppeling bepaalt wat je standaard ziet, niet wat je mag** (ADR-013, status daar nog "voorgesteld"; de tabel `template_reviewer` staat wel in het schema): elke reviewer mag elke inzending beoordelen, het oordeel staat met naam vast. Rondes starten en deelnemers toevoegen blijft `admin`.
- **Extern:** leverancier heeft geen account. Eén link per response, 30 dagen geldig, na indienen niet meer bruikbaar; de tenant wordt server-side uit een hash-lookup gehaald, nooit uit de aanvraag.

### 4.2 Voorstel: geen nieuw rechtenmodel, wel drie slimme uitbreidingen

**1. Hergebruik ADR-013 voor NIS2.** Stream A (classificatie) hoort bij de eigenaar van de leverancier, stream B-beoordeling bij de template-beoordelaar, uitzetten bij admin. Geen aparte NIS2-rollen nodig. Eén nieuwe template (SC10) krijgt gewoon zijn eigen beoordelaar(s).

**2. Alleen-lezen rol (`viewer`) met optionele einddatum.** Voor bestuurder en auditor. Eén rol, twee gebruiksvormen: permanent (bestuurder) of tijdelijk (auditor, vervalt automatisch). Voorkomt dat je een bestuurder `reviewer` maakt om iets te mogen zien. *Voorstel; vraagt een rolwaarde en een einddatum op het lidmaatschap.*

**3. Leverancier: standaard geen account, optionele bewaarstap.** Eerste keer altijd via link, zonder inlogdrempel (respons!). Na indienen een aanbod: "bewaar deze antwoorden en hergebruik ze bij andere klanten", via e-mailverificatie. Dat lost de vragenlijstmoeheid op, maar is een **cross-tenant object** (een leveranciersprofiel dat buiten de tenantgrens leeft) en botst met de strikte RLS-aanpak van mcm2. Eisen als dit ooit komt: leverancier deelt expliciet per klant, elk deel is intrekbaar, de klant ziet alleen wat gedeeld is. **Fase 2, niet nu.** Wel nu doen: antwoorden bewaren met stabiele `question_key` en templateversie, zodat hergebruik later kan zonder herstructurering.

### 4.3 Adviseur en proefaanmelding
- **Adviseur** (meerdere klanten): bestaande mogelijkheden (`support`, platformbeheer-toegang) lijken het te dekken; in de praktijk uit te zoeken hoe tenant-wisselen voor een adviseur voelt. *Open.*
- **Zelf aanmelden voor de proef:** tenant aanmaken gaat nu via een platform-route/script; automatisch aanmelden (tenant, eerste admin, proeflimiet op leveranciers) bestaat niet. *Fase D.*
- **Productie heeft geen mailkanaal** (mcm2 STATUS 25-09): uitnodigingen gaan nu via handmatig doorgegeven links of Excel-export. Zonder mail is een zelfstandige proefflow niet haalbaar. Dit is tegelijk de eerste echte TD/AA-divergentie (afzender).

### 4.4 Rechtenmatrix (voorstel)

| Handeling | Admin | Contractmanager (eigenaar) | Beoordelaar | Viewer | Leverancier |
|---|---|---|---|---|---|
| Leveranciers en contacten beheren | ✔ | eigen leveranciers | – | – | – |
| Classificeren (stream A) | ✔ | eigen leveranciers | – | – | – |
| Ronde starten / uitzetten | ✔ | – | – | – | – |
| Antwoorden beoordelen | ✔ | – | ✔ (alle; eigen voorraad voorop) | – | – |
| Dashboard en rapport zien | ✔ | ✔ | ✔ | ✔ | – |
| Eigen response invullen | – | – | – | – | ✔ (via link) |

De contractmanager-kolom volgt ADR-013 (beheren ≠ beoordelen); de matrix is een voorstel, niet de huidige stand van de code.

## 5. Wat dit vraagt van mcm2 (afhankelijkheden)

- Feature-key `nis2module` (één regel) + navigatie die erop reageert.
- Mailkanaal in productie, voor uitzetten en aanmelden.
- Rol `viewer` met einddatum (alleen als bestuurder/auditor in de eerste ronde nodig zijn).
- Scoring en risicomatrix (nieuw; zie ADR 0006 punt 5).

## 6. Open vragen voor Kees

1. Wie is de eerste echte pilotklant, en wie zijn de 3–5 leveranciers? (Respons is het risico.)
2. Moet een bestuurder in de eerste ronde al inloggen, of volstaat een geëxporteerd rapport?
3. Willen we leveranciershergebruik (4.2 punt 3) in de eerste communicatie al beloven, of pas later?
4. Mag de coördinator zonder specialistische kennis de niveau-indeling (SC10/20/30) overrulen?
5. Eerste scherm bouwen: invulscherm leverancier (reis B) of leverancierslijst met NIS2-kolommen?
