# Mailstatus tonen bij leverancier-uitnodiging — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Het uitnodigingsscherm (`/beheer/vragenlijsten/uitnodigen`) laat na
het versturen expliciet zien of er per leverancier echt mail is uitgegaan via
Resend, of dat er geen mailkanaal actief is en de link handmatig moet worden
doorgegeven — in plaats van altijd dezelfde neutrale melding te tonen.

**Architecture:** De backend berekent en geeft dit al door in het antwoord op
`POST /admin/survey/runs/:id/participants` (`verstuurd`, `verzendFout`,
`verzonden`, `mislukt`, `geenMailkanaal` — zie
`src/survey/vragenlijst-beheer.controller.ts:736-764`). Er is geen
backend-wijziging nodig. Het gat zit uitsluitend in de frontend: het
`Uitnodiging`-model en `nodigUit()` negeren deze velden, en het scherm toont
daardoor altijd dezelfde tekst. Dit plan sluit dat gat: model uitbreiden,
service-functie het volledige antwoord laten teruggeven, scherm de status per
leverancier en een samenvatting tonen.

**Tech Stack:** Next.js App Router, TypeScript, Playwright (e2e), geen
backend-wijziging.

---

## Achtergrond — waarom dit zo aangetroffen is

Getest in productie (AlingAdvies-tenant, 21-09-2026): een leverancier
uitnodigen toonde de melding "Uitnodigingen verstuurd" met de eenmalige-link-
waarschuwing, terwijl er feitelijk geen mail is aangekomen. De reden is dat
`RESEND_API_KEY`/`MAIL_AFZENDER_ADRES` niet zijn ingesteld in die omgeving —
de backend valt dan terug op `LogMailKanaal` (zie `src/mail/mail.module.ts`)
en zet `echtVerstuurd: false` op elke uitnodiging. Dat is zichtbaar in het
API-antwoord, maar het scherm gebruikt dat antwoord niet.

Dit plan verandert niets aan of en hoe er mail verstuurd wordt — het maakt
alleen zichtbaar wat de backend al weet.

---

## Task 1: Model uitbreiden met de mailstatusvelden

**Files:**
- Modify: `C:\DEV\Work\MCM2-frontend\src\core\models\vragenlijst.ts:183-190`

- [ ] **Step 1: Voeg de velden toe aan `Uitnodiging`**

Vervang het bestaande `Uitnodiging`-interface (regel 183-190) door:

```typescript
export interface Uitnodiging {
  readonly responseId: string;
  readonly vendorId: string;
  readonly vendorNaam: string;
  /** Het ruwe token. Bestaat uitsluitend in dit antwoord. */
  readonly token: string;
  readonly expiresAt: string;
  /**
   * Of er voor déze leverancier echt mail is uitgegaan (backend-veld
   * `verstuurd` op de route, gebaseerd op `echtVerstuurd` — zie
   * `vragenlijst-beheer.controller.ts`). `false` betekent: geen mailkanaal
   * actief, of de verzending is voor deze leverancier specifiek mislukt.
   * De link in `token` blijft in beide gevallen geldig.
   */
  readonly verstuurd: boolean;
  /** Alleen gevuld wanneer `verstuurd` false is: de reden, leesbaar voor een mens. */
  readonly verzendFout?: string;
}

/** Het volledige antwoord op het uitnodigen, inclusief de samenvatting over de hele ronde. */
export interface UitnodigingResultaat {
  readonly uitnodigingen: Uitnodiging[];
  /** Hoeveel leveranciers daadwerkelijk mail hebben ontvangen. */
  readonly verzonden: number;
  /** Hoeveel er niet zijn aangekomen (inclusief het geval "geen mailkanaal"). */
  readonly mislukt: number;
  /**
   * `true` wanneer er geen mailkanaal actief is (Resend niet geconfigureerd
   * in deze omgeving) — dus alle links moeten handmatig doorgegeven worden.
   * `false` betekent niet per se "alles gelukt": zie `mislukt` voor
   * individuele fouten bij een wél actief mailkanaal.
   */
  readonly geenMailkanaal: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add "C:\DEV\Work\MCM2-frontend\src\core\models\vragenlijst.ts"
git commit -m "feat(vragenlijst): mailstatusvelden op Uitnodiging-model"
```

---

## Task 2: `nodigUit()` het volledige antwoord laten teruggeven

**Files:**
- Modify: `C:\DEV\Work\MCM2-frontend\src\core\services\vragenlijstService.ts:229-252`

- [ ] **Step 1: Vervang de functie**

Vervang de bestaande `nodigUit()`-functie (regel 235-252) door:

```typescript
/**
 * Nodigt leveranciers uit en geeft de tokenlinks terug, samen met of er
 * daadwerkelijk mail is verstuurd.
 *
 * **Dit antwoord is eenmalig.** De aanroeper moet de tokens tonen of
 * doorgeven; ze zijn daarna nergens meer op te vragen.
 */
export async function nodigUit(
  runId: string,
  vendorIds: string[],
  geldigheidDagen?: number,
): Promise<UitnodigingResultaat> {
  if (gebruiktMockData) {
    throw new Error(
      'Uitnodigen kan niet zonder verbinding met de backend: er zou een token ontstaan dat nergens op slaat.',
    );
  }

  return verstuur<UitnodigingResultaat>(
    `/admin/survey/runs/${runId}/participants`,
    { vendorIds, geldigheidDagen },
  );
}
```

- [ ] **Step 2: Werk de import bovenaan het bestand bij**

In de `import type { ... } from '@/core/models/vragenlijst';`-blok (regel
2-14), voeg `UitnodigingResultaat` toe aan de lijst, alfabetisch op zijn
plek na `StatusItem`:

```typescript
import type {
  BeoordelingsItem,
  RondeGestart,
  StatusItem,
  Uitnodiging,
  UitnodigingResultaat,
  RondeDetail,
  RondeSamenvatting,
  VendorUitvraag,
  VragenlijstDetail,
  VragenlijstSamenvatting,
  WachtlijstLeverancier,
  Werkvoorraadbereik,
} from '@/core/models/vragenlijst';
```

- [ ] **Step 3: Commit**

```bash
git add "C:\DEV\Work\MCM2-frontend\src\core\services\vragenlijstService.ts"
git commit -m "feat(vragenlijst): nodigUit geeft mailstatus door in plaats van alleen tokens"
```

---

## Task 3: Uitnodigingsscherm — status per leverancier en samenvatting tonen

**Files:**
- Modify: `C:\DEV\Work\MCM2-frontend\src\app\beheer\vragenlijsten\uitnodigen\page.tsx`

- [ ] **Step 1: Werk de state bij naar het nieuwe returntype**

Regel 88 (`const [uitnodigingen, setUitnodigingen] = useState<Uitnodiging[]>([]);`)
wordt vervangen door:

```typescript
  const [uitnodigingen, setUitnodigingen] = useState<Uitnodiging[]>([]);
  const [samenvatting, setSamenvatting] = useState<{
    verzonden: number;
    mislukt: number;
    geenMailkanaal: boolean;
  } | null>(null);
```

- [ ] **Step 2: Werk `start()` bij om de samenvatting op te slaan**

In `start()` (rond regel 157-184), vervang:

```typescript
      const uitgegeven = await nodigUit(ronde.runId, gekozenIds, geldigheid);

      await wijzigRondeStatus(ronde.runId, 'active');

      setUitnodigingen(uitgegeven);
      setStap('klaar');
```

door:

```typescript
      const resultaat = await nodigUit(ronde.runId, gekozenIds, geldigheid);

      await wijzigRondeStatus(ronde.runId, 'active');

      setUitnodigingen(resultaat.uitnodigingen);
      setSamenvatting({
        verzonden: resultaat.verzonden,
        mislukt: resultaat.mislukt,
        geenMailkanaal: resultaat.geenMailkanaal,
      });
      setStap('klaar');
```

- [ ] **Step 3: Titel en waarschuwingsblok laten reageren op `geenMailkanaal`**

Vervang het blok van regel 213-239 (van `if (stap === 'klaar') {` tot en met
de sluitende `</div>` van de eenmalig-waarschuwing) door:

```typescript
  if (stap === 'klaar' && samenvatting) {
    const titel = samenvatting.geenMailkanaal
      ? 'Geen mail verstuurd — links klaar om handmatig door te geven'
      : samenvatting.mislukt > 0
        ? 'Uitnodigingen deels verstuurd'
        : 'Uitnodigingen verstuurd';

    return (
      <AppLayout
        titel={titel}
        ondertitel={
          samenvatting.geenMailkanaal
            ? `${uitnodigingen.length} ${uitnodigingen.length === 1 ? 'link is' : 'links zijn'} aangemaakt. Er is geen mailkanaal ingesteld in deze omgeving: kopieer en verstuur de links zelf.`
            : `${samenvatting.verzonden} van de ${uitnodigingen.length} ${uitnodigingen.length === 1 ? 'leverancier heeft' : 'leveranciers hebben'} een mail ontvangen.`
        }
      >
        {samenvatting.geenMailkanaal && (
          <div
            role="alert"
            data-testid="geen-mailkanaal-waarschuwing"
            className="mb-6 flex gap-3 rounded-lg border border-red-300 bg-red-50 p-4"
          >
            <ShieldAlert
              size={20}
              className="mt-0.5 flex-shrink-0 text-red-700"
            />
            <div className="text-sm text-red-900">
              <p className="font-semibold">
                Er is geen mailkanaal ingesteld in deze omgeving.
              </p>
              <p className="mt-1">
                Geen van de leveranciers heeft automatisch een mail
                ontvangen. Kopieer elke link hieronder en verstuur hem zelf.
              </p>
            </div>
          </div>
        )}

        {!samenvatting.geenMailkanaal && samenvatting.mislukt > 0 && (
          <div
            role="alert"
            data-testid="deels-mislukt-waarschuwing"
            className="mb-6 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4"
          >
            <ShieldAlert
              size={20}
              className="mt-0.5 flex-shrink-0 text-amber-700"
            />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">
                {samenvatting.mislukt}{' '}
                {samenvatting.mislukt === 1 ? 'mail is' : "mail's zijn"} niet
                aangekomen.
              </p>
              <p className="mt-1">
                Kijk hieronder welke leverancier(s) dit betreft en geef die
                link(s) zelf door.
              </p>
            </div>
          </div>
        )}

        <div
          role="alert"
          data-testid="eenmalig-waarschuwing"
          className="mb-6 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4"
        >
          <ShieldAlert
            size={20}
            className="mt-0.5 flex-shrink-0 text-amber-700"
          />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">
              Deze links zijn nu eenmalig zichtbaar.
            </p>
            <p className="mt-1">
              Sla ze op of verstuur ze voordat u deze pagina verlaat. Ze zijn
              daarna niet meer op te vragen — ook niet door een beheerder. Dat
              is met opzet: wie de database in handen krijgt, kan er geen
              vragenlijst mee openen.
            </p>
          </div>
        </div>
```

- [ ] **Step 4: Per leverancier de status tonen in de lijst**

In de `<ul>` met `data-testid="uitnodigingen-lijst"` (rond regel 260-300),
voeg een statusregel toe per leverancier. Vervang het blok binnen `<li>` (van
`<div className="mb-2 flex items-center justify-between gap-3">` tot en met
de sluitende `</div>` ervan, regel 267-288) door:

```typescript
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-medium text-ink">
                  {uitnodiging.vendorNaam}
                </span>
                <button
                  type="button"
                  data-testid="kopieer-link"
                  onClick={() =>
                    kopieer(linkVoor(uitnodiging.token), uitnodiging.responseId)
                  }
                  className="inline-flex flex-shrink-0 items-center gap-1.5 rounded border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-surface"
                >
                  {gekopieerd === uitnodiging.responseId ? (
                    <Check size={13} />
                  ) : (
                    <Copy size={13} />
                  )}
                  {gekopieerd === uitnodiging.responseId
                    ? 'Gekopieerd'
                    : 'Kopieer'}
                </button>
              </div>

              <p
                data-testid="uitnodiging-mailstatus"
                className={`mb-2 text-xs ${uitnodiging.verstuurd ? 'text-green-700' : 'text-red-700'}`}
              >
                {uitnodiging.verstuurd
                  ? '✓ Mail verstuurd'
                  : `✗ Niet verstuurd${uitnodiging.verzendFout ? ` — ${uitnodiging.verzendFout}` : ' — geef de link handmatig door'}`}
              </p>
```

- [ ] **Step 5: Reset `samenvatting` in `opnieuw()`-pad**

Er is geen aparte `opnieuw()`-functie in dit scherm (in tegenstelling tot het
platformbeheer-scherm) — de gebruiker navigeert via de "Naar de rondes"-link
weg. Geen wijziging nodig hier.

- [ ] **Step 6: Commit**

```bash
git add "C:\DEV\Work\MCM2-frontend\src\app\beheer\vragenlijsten\uitnodigen\page.tsx"
git commit -m "feat(vragenlijst): toon mailstatus per leverancier na uitnodigen"
```

---

## Task 4: Playwright e2e-test — geen mailkanaal toont de juiste melding

**Files:**
- Test: `C:\DEV\Work\MCM2-frontend\e2e\vragenlijsten.spec.ts`

Deze test draait tegen de bestaande backend-testomgeving, die zonder
`RESEND_API_KEY` draait (zie `docs/superpowers/specs/2026-08-06-mailkanaal.md`
— CI en lokale wegwerpdatabases draaien standaard met `LogMailKanaal`). Dat
betekent dat `geenMailkanaal: true` het gedrag is dat je in deze omgeving al
zonder extra opzet krijgt.

- [ ] **Step 1: Bekijk de bestaande testopzet voor dit scherm**

Lees eerst `C:\DEV\Work\MCM2-frontend\e2e\vragenlijsten.spec.ts` om het
bestaande patroon voor inloggen, naar het uitnodigen-scherm navigeren, en een
leverancier selecteren over te nemen (test-id's: `verstuur-knop`,
`uitnodigingen-lijst`, `uitnodiging-rij`). Gebruik dezelfde
inlog-/navigatiehelpers die daar al staan — dit plan schrijft geen nieuwe
helper, om niet te dupliceren wat er al is.

- [ ] **Step 2: Schrijf de test**

Voeg toe aan `e2e/vragenlijsten.spec.ts`, in hetzelfde `describe`-blok als de
bestaande uitnodig-tests:

```typescript
test('toont expliciet dat er geen mail is verstuurd wanneer er geen mailkanaal actief is', async ({
  page,
}) => {
  // Vervolg op de bestaande flow: ronde starten en leveranciers selecteren
  // zoals de andere tests in dit bestand dat al doen.
  await page.getByTestId('verstuur-knop').click();

  await expect(page.getByTestId('geen-mailkanaal-waarschuwing')).toBeVisible();

  const eersteRij = page.getByTestId('uitnodiging-rij').first();
  await expect(eersteRij.getByTestId('uitnodiging-mailstatus')).toContainText(
    'Niet verstuurd',
  );
});
```

- [ ] **Step 3: Draai de volledige e2e-run**

```bash
npx jest test-ids
npm run verify:volledig
```

Verwacht: groen. Zie CLAUDE.md §5 — altijd de volledige e2e-run draaien, niet
alleen het nieuwe testbestand, want alle suites delen één database.

- [ ] **Step 4: Commit**

```bash
git add "C:\DEV\Work\MCM2-frontend\e2e\vragenlijsten.spec.ts"
git commit -m "test(vragenlijst): e2e-dekking voor mailstatus-melding bij uitnodigen"
```

---

## Self-review — gedaan

**Spec-dekking:** "duidelijke aanduiding dat er GEEN mail gestuurd is, maar
dat het handmatig moet" → Task 3, Step 3-4 (rode waarschuwing +
per-leverancier-status). Geen keuze-schakelaar toegevoegd (dat was optie B
uit het eerdere, ingetrokken voorstel) — deze scope is uitsluitend
zichtbaarheid van bestaand backend-gedrag, geen nieuw verzendpad.

**Geen placeholders:** alle stappen bevatten volledige, plakbare code.

**Type-consistentie:** `UitnodigingResultaat.uitnodigingen` gebruikt hetzelfde
`Uitnodiging`-type als Task 1 definieert; `nodigUit()` in Task 2 retourneert
exact dat type; het scherm in Task 3 destructureert dezelfde veldnamen
(`verzonden`, `mislukt`, `geenMailkanaal`) als de backend al teruggeeft
(`vragenlijst-beheer.controller.ts:752-763`).
