# Ontwerp — contact-/afzenderinfo tonen aan de leverancier

**Datum:** 2026-08-25
**Status:** ONTWERP — goedgekeurd door de eigenaar, klaar voor implementatieplan
**Aanleiding:** Issue #153 — de leverancier ziet nergens in de vragenlijst zelf naar wie hij
met vragen toe kan. Onderdeel van Groep A (pilot-scope, issue #180): raakt de leverancier
direct.
**Raakt:** `src/survey/survey-response.controller.ts`, `src/survey/vragenlijst-lezen.service.ts`,
`src/tenant/tenant.service.ts` (alleen lezen), `src/db/schema.ts` (`vendor.ownerUserId`,
`contract.ownerUserId`, `survey_run.contractId` — alle drie bestaan al, geen migratie nodig).

---

## 0. Waar dit over gaat, in één alinea

Een leverancier vult een vragenlijst in via een tokenlink, zonder account. Hij ziet nergens
wie de afzender is of waar hij met een vraag terecht kan. Dit ontwerp voegt een vaste
contactregel toe onderaan de vragenlijst, gevuld uit een prioriteitsketen van bestaande
databronnen — geen nieuw veld, geen migratie.

## 1. Het beveiligingsprincipe, en waarom dit een bewuste uitzondering is

`SurveyResponseController` (het leverancierspad) geeft vandaag **bewust geen** tenant-,
vendor- of responsgegevens terug — expliciet vastgelegd in de bestaande class-comment: "wie
een geldig token bemachtigt hoort daar niet extra informatie uit te halen." Dat principe is
niet gebaseerd op "is dit specifieke veld geheim", maar op een generieke discipline: een
tokenlink is de enige sleutel (geen 2FA), dus elke uitbreiding van wat de route teruggeeft is
een individuele, bewuste beslissing — nooit een gewoonte.

**Besluit van de eigenaar (25-08), expliciet vastgelegd:** voor dít veld (contactgegevens van
de afzendende partij) is een uitzondering akkoord, om drie redenen:

1. De leverancier kent de afzender al uit de uitnodigingsmail — dit voegt geen nieuwe
   informatie toe die niet al bij hem terecht is gekomen.
2. Dit is een bestaande zakelijke contractrelatie; een zakelijk e-mailadres is geen bijzonder
   persoonsgegeven (AVG-zin: functioneel B2B-adres, geen privé-gegeven).
3. Er komt geen andere tenant-, vendor- of responsdata bij — alleen naam + e-mail van één
   contactpersoon.

**Dit is geen precedent voor verdere velden.** Elke volgende toevoeging aan dit pad vraagt
een eigen, aparte afweging — dit besluit dekt uitsluitend contactinfo.

Deze afweging wordt in de code vastgelegd als expliciete comment op de nieuwe functie (zie
§4), niet alleen in dit document — een toekomstige ontwikkelaar die de code leest zonder dit
document gezien te hebben, moet de reden meteen kunnen vinden.

## 2. Prioriteitsketen

`Contactinfo | null`, eerste match wint:

1. **`tenant.antwoordEmail`** — geen naam (generiek tenant-adres): *"Neem contact op via
   [email]."*
2. **`contract.ownerUserId`** (naam + e-mail van die gebruiker) — alleen als
   `survey_run.contractId` niet leeg is én die contract een `ownerUserId` heeft.
3. **`vendor.ownerUserId`** (naam + e-mail van die gebruiker) — de vendor waar de respons bij
   hoort.
4. Geen van de drie aanwezig → `contactinfo: null`. Geen contactregel getoond, geen
   placeholder-tekst.

**Waarom deze volgorde:** het tenant-antwoordadres is de meest generieke, meest stabiele bron
(een organisatie-breed adres, ontworpen om leveranciersvragen te ontvangen — zie
`tenant.service.ts`). Ontbreekt die, dan is de specifiekste persoon relevanter dan de meest
algemene: wie het huidige contract beheert weet meer over déze vragenlijst dan wie in het
algemeen de leveranciersrelatie beheert.

**Wat er getoond wordt bij een medewerker-fallback (contract- of vendor-eigenaar):** naam +
e-mailadres — dezelfde volledigheid als bij het tenant-antwoordadres. Besluit eigenaar 25-08:
consistent gedrag ongeacht welke bron gebruikt wordt, geen extra terughoudendheid bij een
individuele medewerker t.o.v. een generiek tenant-adres — de onderliggende afweging uit §1
(bestaande contractrelatie, zakelijk adres) geldt voor beide even sterk.

## 3. Waar dit landt: `GET /survey/respond/questions`

Niet op `GET /survey/respond` (de status-route) — die blijft minimaal, zoals hij nu is. De
vragenlijst wordt toch al per response opgehaald via `questions`; een aparte contactroute zou
een tweede aanroep zijn voor iets dat één keer per paginabezoek nodig is, en zou de
"uitsluitend op response_id filteren"-discipline (zie de bestaande class-comment op
`VragenlijstLeesService`) nodeloos moeten herhalen in een tweede service.

`Vragenlijst` (interface in `vragenlijst-lezen.service.ts`) krijgt een nieuw veld:

```typescript
export interface Contactinfo {
  naam: string | null;
  email: string;
}

export interface Vragenlijst {
  name: string;
  categories: Categorie[];
  questions: Vraag[];
  closesAt: string | null;
  contactinfo: Contactinfo | null;
}
```

## 4. Backend-implementatie

Nieuwe private methode op `VragenlijstLeesService`, naast `haalOpgeslagenAntwoorden`/
`haalOpgeslagenBijlagen` (zelfde patroon: aparte query, niet meegejoind in de hoofdset, om
dezelfde reden — een JOIN op meerdere onafhankelijke bronnen zou de vragenrijen
vermenigvuldigen).

```typescript
/**
 * Contactinfo voor de leverancier: wie te benaderen bij vragen over deze
 * vragenlijst.
 *
 * ── Bewuste uitzondering op de regel dat dit pad geen tenant-info teruggeeft ──
 *
 * Zie de class-comment van VragenlijstLeesService en van
 * SurveyResponseController: dit pad geeft standaard geen tenant-, vendor- of
 * responsdata terug. Dit veld is een bewuste, individuele uitzondering
 * (besluit eigenaar 25-08, docs/superpowers/specs/2026-08-25-contactinfo-
 * vragenlijst-design.md), niet een precedent voor meer. Drie redenen: de
 * leverancier kent de afzender al uit de uitnodigingsmail, dit is een
 * zakelijk adres binnen een bestaande contractrelatie (geen bijzonder
 * persoonsgegeven), en er komt verder geen tenant-/vendor-/responsdata bij.
 * Elke volgende toevoeging aan dit pad vraagt een eigen afweging — dit dekt
 * alleen contactinfo.
 *
 * Prioriteit: tenant-antwoordadres → contract-eigenaar (als de ronde aan een
 * contract hangt) → vendor-eigenaar → null.
 */
private async haalContactinfo(
  tx: TenantTransaction,
  responseId: string,
): Promise<Contactinfo | null> {
  // 1. tenant.antwoordEmail
  // 2. contract.ownerUserId (via survey_run.contractId), als aanwezig
  // 3. vendor.ownerUserId (via survey_response.vendorId)
  // 4. null
}
```

De query volgt uitsluitend de keten vanaf `response_id` (zelfde discipline als de rest van
deze service — nooit vanaf een vendor-ID die de client zou kunnen meesturen).

## 5. Tegenproef

Conform MCM2-CLAUDE.md §15b: een test die het volledige antwoord van
`GET /survey/respond/questions` doorzoekt en bevestigt dat het **wel** `contactinfo` bevat,
maar **geen** van de volgende sleutels/waarden: `tenantId`, `vendorId`, `vendorNaam`,
`responseId`, `runId`. Dit is de tegenproef die een toekomstige uitbreiding die per ongeluk
meer tenant-data meestuurt, laat falen in plaats van ongemerkt binnen te sluipen — precies
het patroon uit testpunt 39 (VragenlijstLeesService's bestaande class-comment).

Daarnaast: drie scenario's die de prioriteitsketen zelf bewijzen (tenant-adres aanwezig wint
van contract-eigenaar; contract-eigenaar wint van vendor-eigenaar; niets aanwezig geeft
`null`).

## 6. Frontend

`MCM2-frontend/src/core/models/survey.ts`: `Vragenlijst`-type krijgt `contactinfo: Contactinfo
| null` erbij, zelfde vorm als de backend.

`MCM2-frontend/src/app/portal/survey/[token]/page.tsx`: een vaste regel, onderaan de
vragenlijst (na de laatste vraag, vóór de indienknop — exacte plek bepaalt de implementatie,
aansluitend bij de bestaande paginastructuur):

- `contactinfo` is `null` → geen regel getoond. Geen "geen contactpersoon bekend"-melding.
- `contactinfo.naam` is `null` (tenant-adres-geval) → *"Vragen over deze vragenlijst? Neem
  contact op via [email]."*
- Anders → *"Vragen over deze vragenlijst? Neem contact op met [naam] ([email])."*

Puur presentatie: geen nieuwe interactie, geen nieuwe state.

## 7. Wat dit ontwerp bewust niet doet

- **Geen nieuw databaseveld of migratie.** Alle drie bronnen (`tenant.antwoordEmail`,
  `contract.ownerUserId`, `vendor.ownerUserId`) bestaan al.
- **Geen wijziging aan `GET /survey/respond` (de status-route).** Die blijft minimaal.
- **Geen precedent voor andere velden** op het leverancierspad — zie §1.
- **Geen telefoonnummer of andere contactkanalen.** Alleen naam + e-mail, zoals het issue
  vraagt.
