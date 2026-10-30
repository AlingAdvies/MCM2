# ADR-019 — Functies en rolbezetting: wie vervult welke rol op welk contract

- **Status:** voorgesteld — nog niets van gebouwd. Stap 1 en 2 van drie; stap 3 (regels) alleen
  per aanwijsbare behoefte.
- **Datum:** 2026-10-30
- **Aanleiding:** de concessiemodule vraagt per concessie wie erbij hoort en in welke rol
  (ADR-018). Contractmanagement vraagt hetzelfde per contract: het standscherm moet "wie bel ik"
  en "mag ik dit zelf" beantwoorden (ontwerpprincipe 26-10). Eén rolmodel voor beide, in plaats
  van twee.
- **Relatie:** ADR-013 (beheerder aan de leverancier, beoordelaar aan de vragenlijst), ADR-015
  (toegang als gebeurtenis), ADR-018 (afscherming tussen concessies),
  `docs/architectuur/ccm-opzet-en-besluiten.md`, en als bron MVM_V2 B-024
  (`BACKLOG.md`, `src/tenant/transdev/config/job-titles.ts`).

---

## Context

**Wat MCM2 nu kent.** Rechten komen uit `clm.tenant_membership.role`: `admin`, `user`
(contractbeheerder, mag bijna alles wat admin mag), `reviewer`, `support`. Daarnaast hangt één
persoon aan een leverancier (`clm.vendor.owner_user_id`, ADR-013) en één aan een contract
(`clm.contract.owner_user_id`, in het scherm "Contractbeheerder"). Beoordelaars hangen aan een
vragenlijst (`clm.template_reviewer`). Meer dan één interne betrokkene per contract, of een rol
die geen beheerder is (eigenaar, beslisser), is niet vast te leggen.

**Wat MVM_V2 uitwerkte (B-024, op mock data).** Twee lagen: een platformrol die via één
`canDo`-tabel de rechten bepaalt, en per tenant functietitels gekoppeld aan een CATS-rol. In het
scherm staat de functietitel; CATS staat alleen in een tooltip. De Transdev-functies kwamen uit
een bestaande rollenlijst en zijn herkend door Transdev-medewerkers.

Wat daar goed aan is en wordt overgenomen:

- de functietitel van de klant is wat de gebruiker ziet; CATS is het stille denkkader erachter;
- functies zijn per tenant instelbaar.

Wat niet werkte en niet wordt overgenomen:

- de CATS-rol hing aan de **persoon**, niet aan het contract. In CATS ben je contractmanager van
  contract A en niet van B, en kan één persoon rollen combineren;
- de koppeling "CATS-rol → rechten" stond in documentatie maar is nooit gebouwd, en bevatte een
  fout: Contractbeheerder → alleen lezen, terwijl de contractbeheerder juist het dossier bijhoudt.
  Rechten afleiden uit CATS-rollen is daarmee niet triviaal en hoort niet vooraf in één keer.

## Besluit

### 1. Rechten blijven waar ze zijn

`clm.tenant_membership.role` blijft de enige bron voor wat iemand mag. Functies en rolbezetting
geven in stap 1 en 2 geen rechten — met één uitzondering: in de concessiemodule bepaalt de
rolbezetting wie een concessie ziet (ADR-018).

### 2. Functies per tenant (stap 1)

Een tabel `clm.functie` met per tenant de functies zoals de klant ze noemt:

| Kolom | Betekenis |
| --- | --- |
| `functie_id`, `tenant_id` | Zoals elke tenanttabel: RLS met FORCE, regel in het rechtencontract, expliciete `GRANT` |
| `naam` | De functietitel van de klant, bijvoorbeeld "Contract coordinator" |
| `cats_rol` | Code van de CATS-rol, of leeg voor een functie zonder tegenhanger. Vaste lijst in de code, met een `CHECK` in de database |
| `centraal` | Ziet alle concessies (ADR-018). Heeft in contractmanagement geen effect |
| `deleted_at` | Een functie die nog in gebruik is, wordt niet verwijderd maar beëindigd |

In het scherm staat altijd `naam`. De CATS-rol staat alleen in het beheerscherm van functies.
Voor Transdev is de MVM_V2-lijst de eerste vulling, na bevestiging door Transdev (zie open
punten). Functies worden ingericht via het beheerscherm, niet via een seed met klantgegevens.

**Wie functies inricht (besluit eigenaar 30-10):** technisch de tenantrol `admin`. In de praktijk
hoort het bij de onboarding: de implementatieconsultant richt de functies samen met de klant in,
en een klant-admin past ze daarna pas aan na training. Dat is een afspraak in het
onboardingproces, geen technische blokkade.

**Hoe de consultant inricht (besluit eigenaar 30-10).** Platformbeheer kijkt volgens ADR-015
alleen lezend mee in een klanttenant; dat blijft zo. De implementatieconsultant krijgt voor het
inrichten een eigen `admin`-lidmaatschap in de klanttenant, met een tweede identiteit: één
gebruiker heeft één actief lidmaatschap. Er wordt niets voor gebouwd. Na de onboarding wordt dat
lidmaatschap ingetrokken of bewust aangehouden; die keuze hoort in de onboardingafspraken met de
klant.

### 3. Rolbezetting per object (stap 2)

Een tabel `clm.rolbezetting`: wie vervult welke functie op welk object, en sinds wanneer.

| Kolom | Betekenis |
| --- | --- |
| `rolbezetting_id`, `tenant_id` | Zoals elke tenanttabel |
| `user_id` | Een interne gebruiker. Externe contactpersonen blijven `vendor_contact` |
| `functie_id` | Welke functie die gebruiker hier vervult |
| `contract_id` / `vendor_id` / later `concessie_id` | Precies één gevuld (`CHECK`), elk met een echte vreemde sleutel |
| `geldig_vanaf`, `geldig_tot` | Intrekken is `geldig_tot` zetten, niet verwijderen: de historie blijft |
| `created_by`, `created_at` | Wie het vastlegde; wijzigingen gaan ook naar de audit trail |

Bewuste keuzes:

- **Eén kolom per objectsoort, geen generiek "object_id".** Een generieke verwijzing heeft geen
  vreemde sleutel, en dan kan een rolbezetting blijven wijzen naar een verwijderd contract zonder
  dat iets het merkt. `concessie_id` komt erbij in de eerste migratie van de concessiemodule.
- **Meerdere personen per functie en meerdere functies per persoon** op hetzelfde object zijn
  toegestaan, zoals CATS het combineren van rollen toestaat.
- **Wie mag vastleggen:** `admin` en `user`, zoals bij het bewerken van een contract nu.

### 4. Gebruik in de schermen

- Het standscherm van een contract (en straks van een concessie) toont onder "Wie bel ik" de
  interne bezetting: functienaam en persoon, naast de externe contactpersoon.
- "Mag ik dit zelf" toont de bezetting: welke functie door wie wordt vervuld. Het systeem
  bepaalt niet welke rol "beslist"; de gebruiker maakt die afweging zelf (besluit eigenaar
  30-10). Een markering "beslissend" komt pas als gebruikers erom vragen.
- Een lege bezetting is informatie: de kaart toont "niet vastgelegd", zoals de andere kaarten.

### 5. Verhouding tot ADR-013 en ADR-018

- **`template_reviewer` blijft.** Beoordelen is expertise en hangt aan de vragenlijst, niet aan
  een object. Dat onderscheid uit ADR-013 blijft juist.
- **`vendor.owner_user_id` en `contract.owner_user_id` blijven voorlopig de plek waar de
  beheerder wordt ingevoerd.** Rolbezetting komt daarnaast voor de overige rollen. Om dubbele
  vastlegging te voorkomen, wordt de beheerder niet ook als rolbezetting ingevoerd; het scherm
  toont hem in dezelfde kaart. Of die kolommen later opgaan in de rolbezetting, is een apart
  besluit met een eigen migratie (open punt).
- **ADR-018's toewijzing per concessie ís de rolbezetting met `concessie_id`.** Er komt geen
  aparte toewijzingstabel. De centrale controle uit ADR-018 vraagt: heeft deze gebruiker nu een
  geldige rolbezetting op deze concessie, of een functie met `centraal`?

### 6. Stap 3: regels, één voor één

Een regel die rechten afleidt uit functie of rolbezetting komt er alleen als iemand een concrete
situatie kan aanwijzen. Voorbeelden die al genoemd zijn: "een DOP-rol ziet het contract-pdf niet"
(MVM_V2 B-025) en "alleen de contracteigenaar rondt een kwestie af". Elke regel:

- staat in één centrale controle, zoals `canDo` in MVM_V2, nooit verspreid in routes;
- krijgt een test, en een regel in dit ADR of een vervolg-ADR met de aanleiding;
- wordt getoetst tegen de CATS-betekenis van de rol, zodat een fout als
  "contractbeheerder = alleen lezen" niet terugkomt.

Pas als zulke regels zich opstapelen, is een algemener mechanisme het overwegen waard.

## Wat dit niet doet

- Geen wijziging aan `tenant_membership.role`, aan inloggen of aan de sessie.
- Geen rechten uit CATS-rollen in stap 1 en 2, behalve zichtbaarheid van concessies.
- Geen DOP/AOC-scope; die komt pas met de eerste regel die hem nodig heeft.
- Geen CATS-termen in de schermen voor gewone gebruikers.

## Gevolgen

- Twee nieuwe tabellen in `clm`, elk met RLS en FORCE, een regel in `src/db/rechten-contract.ts`,
  expliciete `GRANT`s in de migratie en een bijgewerkte `docs/runbooks/backup-verwachting.json`.
- Een beheerscherm voor functies (admin) en een kaart met rolbezetting op het contractscherm.
- Werkt voor elke tenant, niet alleen Transdev: functies zijn per tenant instelbaar. Dit is
  daarmee `product:kern`.
- De concessiemodule krijgt haar toegang via dit model in plaats van via een eigen tabel.

## Open punten

- **Transdev's functielijst bevestigen.** De MVM_V2-lijst komt uit een rollenlijst van
  begin 2026. Klopt hij nog, en welke functies horen bij concessiemanagement (accountmanager,
  concessiedirecteur, concessiecontroller)? Antwoord van Transdev verwacht in de week van
  2 november 2026.
- **De beheerderskolommen** (`owner_user_id` op leverancier en contract): laten staan, of
  migreren naar rolbezetting zodra die zich bewezen heeft.

## Wanneer dit heropend wordt

- Er is een tweede regel uit stap 3 nodig die niet in de centrale controle past.
- Een klant wil functies die niet op een CATS-rol te leggen zijn en toch rechten moeten geven.
- De rolbezetting en de beheerderskolommen gaan uit elkaar lopen in het gebruik.
