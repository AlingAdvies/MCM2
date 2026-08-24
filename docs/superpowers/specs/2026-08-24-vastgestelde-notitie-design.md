# Ontwerp — vastgestelde notitie (overeengekomen wijziging na overleg)

**Datum:** 2026-08-24
**Status:** ONTWERP — goedgekeurd door de eigenaar, klaar voor implementatieplan
**Aanleiding:** tijdens de brainstorm over issue #16 (herinneringen) bracht de eigenaar een
ander scenario naar voren: een ingediende respons wordt tussen Transdev en de leverancier
besproken, en de uitkomst van dat overleg — een gewijzigd of aangevuld antwoord — moet
vastgelegd worden zonder het oorspronkelijke, ingediende antwoord aan te tasten.
**Raakt:** `docs/superpowers/plans/2026-08-03-surveybeheer.md` §2a (waarom `nadere_vragen`
niet heropent), `src/survey/notitie.service.ts` (migratie 0018)

---

## 0. Waar dit over gaat, in één alinea

Een leverancier dient een vragenlijst in; die respons bevriest en is daarna alleen nog
leesbaar (§2a van het surveybeheerplan, met opzet). Soms volgt er contact tussen Transdev en
de leverancier, en wordt in overleg een correctie of aanvulling afgesproken. Dat moet
vastgelegd kunnen worden — niet door het originele antwoord te overschrijven (dat zou het
dossier juist zijn bewijswaarde ontnemen), maar als een aparte, herkenbare aantekening naast
het origineel.

## 1. Waarom dit geen nieuwe tabel wordt

Er bestaan al twee soorten vastlegging bij een respons:

| | `survey_review` | `response_note` |
|---|---|---|
| Wat | een oordeel (`goed`/`nadere_vragen`/`niet_goed`) + toelichting | vrije tekst, "gebeld, komt volgende week" |
| Overschreven? | nooit — elke regel blijft staan | nooit — `deleted_at`, geen `DELETE` |
| Wie/wanneer | altijd vastgelegd | altijd vastgelegd |

Een "vastgestelde wijziging" is inhoudelijk het dichtst bij een notitie: vrije tekst, geen
statusovergang, geschreven door wie het overleg voerde. Het enige verschil is betekenis —
een werkaantekening versus een formeel vastgestelde uitkomst. Dat verschil hoort in een
kolom, niet in een parallelle tabel die dezelfde velden (wie, wanneer, ingetrokken-niet-
verwijderd) zou dupliceren.

## 2. Besluiten van de eigenaar (24-08-2026)

| Vraag | Antwoord |
|---|---|
| Use case voor herinneringen (#16-aanleiding) | alleen individueel, geen bulk |
| Oud token bij nieuwe link | wordt ongeldig (apart, niet dit ontwerp — zie §6) |
| Vorm van de vastlegging | één samenvattende tekst per overleg-uitkomst, niet per vraag |
| Relatie tot bestaand oordeel | eigen variant van de bestaande notitie, geen nieuw type los ervan |
| Wie mag het plaatsen | iedereen die nu ook een notitie mag plaatsen — geen aparte rol-eis |

## 3. Wat dit ontwerp bewust niet doet

- **Wijzigt het oorspronkelijke antwoord niet.** `survey_answer` blijft bevroren en
  ongemoeid — exact de reden waarom dit dossier bewijswaarde behoudt. Dit ontwerp voegt een
  aantekening ernaast toe, het overschrijft niets.
- **Vervangt geen oordeel.** Een `vastgesteld`-notitie kan naast een `nadere_vragen`-oordeel
  staan als de opvolging ervan, maar is geen vervanging van `survey_review`.
- **Geen per-vraag koppeling.** Eén tekstveld per overleg-uitkomst; geen structuur die
  aangeeft welke specifieke vraag gewijzigd is. Kan later alsnog als de behoefte blijkt,
  zonder dat dit ontwerp in de weg zit.
- **Geen aparte rol-eis.** Zelfde toegang als een gewone notitie.
- **Geen apart filter/aparte lijst.** Bij een klein aantal notities per respons voegt een
  aparte weergave niets toe.

## 4. Datamodel

Nieuwe migratie, in de stijl van de bestaande CHECK-constraints:

```sql
ALTER TABLE clm.response_note
  ADD COLUMN soort text NOT NULL DEFAULT 'werk'
  CHECK (soort IN ('werk', 'vastgesteld'));
```

- Bestaande rijen krijgen automatisch `'werk'` — geen gedragswijziging voor wat er al staat.
- Geen wijziging aan RLS: de bestaande policy op `response_note` (tenant + `medewerker`-actor,
  migratie 0018) dekt dit al, `soort` is gewoon een extra kolom binnen dezelfde rij.

## 5. Backend

- `NotitieService.voegToe()` krijgt `soort` als extra parameter, standaard `'werk'`.
- `leesNotitie()` (invoervalidatie in `ronde-invoer.ts` of waar de bestaande functie staat)
  krijgt een optioneel `soort`-veld in de body, met dezelfde foutafhandelingsstijl
  (`InvoerFout` bij een onbekende waarde).
- Route-vorm ongewijzigd: `GET/POST/DELETE responses/:id/notes[/:noteId]`. Geen nieuw
  endpoint — alleen de POST-body en het GET-antwoord krijgen het `soort`-veld erbij.

## 6. Wat hier expliciet buiten valt

**Herinneringen (#16-aanleiding: nieuw token uitgeven voor een leverancier die nog niet
heeft gereageerd)** is een apart onderwerp — een nieuw token/nieuwe verzending, niets met
notities te maken. Dat scenario is tijdens deze brainstorm bewust losgekoppeld zodra bleek
dat de eigenlijke behoefte van de eigenaar dit vastleggingsscenario was. Blijft een open,
niet-gebouwd issue.

## 7. Frontend (kort, want klein)

Op het bestaande responsdetail-scherm, bij het notitieveld:

- Een toggle/checkbox "Vastgesteld na overleg met de leverancier" naast het tekstveld.
  Standaard uit.
- In de notitielijst krijgt een `vastgesteld`-notitie een visuele markering (bijv. een
  badge/ander kader) zodat hij niet wegvalt tussen werkaantekeningen.
- Geen apart scherm, geen apart filter.

## 8. Tegenproef

Conform MCM2-CLAUDE.md §15b: een notitie met `soort = 'vastgesteld'` mag nooit via het
leverancierspad (token-guard, `app.current_actor = 'leverancier'`) leesbaar zijn — dezelfde
RLS-grens als een gewone notitie nu al heeft. Eén test die dat aantoont volstaat; er komt
geen nieuwe policy bij, dus geen nieuw soort lek te verwachten, maar de bestaande grens moet
wel blijven gelden nu de tabel een extra kolom heeft.
