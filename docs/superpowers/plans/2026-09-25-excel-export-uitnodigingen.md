# Excel-export leveranciersuitnodigingen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voeg een downloadknop toe aan het uitnodigingsresultaatscherm die, wanneer er geen mailkanaal actief is, de al-aangemaakte tokens/links client-side omzet naar een `.xlsx`-bestand voor handmatig mailen via Outlook/Power Automate.

**Architecture:** Backend: kleine uitbreiding van de bestaande `RondeBeheerService.uitnodigen()`-query zodat ook de naam van de primaire contactpersoon wordt meegegeven (naast het al-bestaande e-mailadres) — geen nieuwe route, geen migratie. Frontend: een nieuwe, kleine exportservice die met SheetJS (`xlsx`) een werkboek bouwt uit de al in de browser aanwezige `uitnodigingen`-lijst en een downloadknop op het resultaatscherm.

**Tech Stack:** NestJS, Drizzle/raw SQL, Postgres, Next.js/React, SheetJS (`xlsx`), Jest, Playwright.

**Referentie:** `docs/superpowers/specs/2026-09-25-excel-export-uitnodigingen-design.md` (design), issue #222.

**Branch:** nieuwe feature branch `feat/excel-export-uitnodigingen` in beide repo's (MCM2 en MCM2-frontend) — volgens de git-ritueel-regel op een schone `main` (al bevestigd: geen andere open branch behalve het bewust geparkeerde `docs/bizaline-sso-handoff`, dat blijft ongemoeid).

---

### Task 1: Backend — branch aanmaken

**Files:** geen wijzigingen, alleen git.

- [ ] **Step 1: Bevestig dat main schoon en actueel is**

Run: `git -C "C:/DEV/Work/MCM2" status --short` en `git -C "C:/DEV/Work/MCM2" log -1 --oneline`
Expected: geen ongecommitte wijzigingen op `main` (de design-spec-commit `0efd377` is de laatste).

- [ ] **Step 2: Maak de branch aan**

```bash
git -C "C:/DEV/Work/MCM2" checkout -b feat/excel-export-uitnodigingen
```

---

### Task 2: Backend — contactpersoon-naam in de uitnodigen-query

**Files:**
- Modify: `src/survey/ronde-beheer.service.ts`

- [ ] **Step 1: Breid `VendorRij` uit**

Wijzig de interface (rond regel 122):

```typescript
interface VendorRij extends Record<string, unknown> {
  vendor_id: string;
  name: string;
  /** `null` als de leverancier geen contactpersoon met e-mailadres heeft. */
  contact_email: string | null;
  /** `null` als de leverancier geen contactpersoon met e-mailadres heeft. */
  contact_naam: string | null;
}
```

- [ ] **Step 2: Breid `Uitnodiging` uit**

Wijzig de interface (rond regel 53):

```typescript
export interface Uitnodiging {
  responseId: string;
  vendorId: string;
  vendorNaam: string;
  token: string;
  expiresAt: string;
  contactEmail?: string;
  /**
   * De naam van de primaire contactpersoon, als die er is. Zelfde
   * optionaliteit als `contactEmail` — niet elke leverancier heeft een
   * contactpersoon. Toegevoegd voor de Excel-export (issue #222): een
   * leverancier zonder naam is in Outlook lastig te herkennen.
   */
  contactNaam?: string;
}
```

- [ ] **Step 3: Breid de query uit**

Wijzig de query (rond regel 547-561):

```typescript
        const gevonden = await tx.execute<VendorRij>(
          sql`SELECT v.vendor_id, v.name, c.email AS contact_email,
                     c.full_name AS contact_naam
                FROM clm.vendor v
                LEFT JOIN LATERAL (
                       SELECT email, full_name
                         FROM clm.vendor_contact
                        WHERE vendor_id = v.vendor_id
                          AND deleted_at IS NULL
                          AND email IS NOT NULL
                        ORDER BY is_primary DESC, created_at ASC
                        LIMIT 1
                     ) c ON true
               WHERE v.vendor_id = ANY(${sql.param(invoer.vendorIds)}::uuid[])
                 AND v.deleted_at IS NULL`,
        );
```

- [ ] **Step 4: Geef `contactNaam` mee in het resultaat**

Wijzig de push (rond regel 631-638):

```typescript
          uitnodigingen.push({
            responseId: rij.rows[0].response_id,
            vendorId,
            vendorNaam: vendor.name,
            token,
            expiresAt: verloopt.toISOString(),
            contactEmail: vendor.contact_email ?? undefined,
            contactNaam: vendor.contact_naam ?? undefined,
          });
```

- [ ] **Step 5: Compileer**

Run: `npx tsc --noEmit`
Expected: geen fouten (de controller geeft `...u` door, dus `contactNaam` stroomt automatisch mee — geen wijziging nodig in `vragenlijst-beheer.controller.ts`, controleer dat na dit compileren wel klopt door de route zelf te lezen op regel 693-770).

- [ ] **Step 6: Commit**

```bash
git add src/survey/ronde-beheer.service.ts
git commit -m "feat(uitnodigingen): contactpersoon-naam meegeven bij uitnodigen (issue #222)"
```

---

### Task 3: Backend — e2e-test voor contactNaam

**Files:**
- Modify: `test/ronde-beheer-routes.e2e-spec.ts`

- [ ] **Step 1: Breid de lokale `Uitnodiging`-interface uit**

Wijzig (rond regel 62-70):

```typescript
interface Uitnodiging {
  responseId: string;
  vendorId: string;
  vendorNaam: string;
  token: string;
  expiresAt: string;
  verstuurd: boolean;
  verzendFout?: string;
  contactEmail?: string;
  contactNaam?: string;
}
```

- [ ] **Step 2: Voeg een assertie toe aan de bestaande test**

Zoek de test rond regel 460-506 (`VENDOR_1 heeft een contactpersoon, VENDOR_2 niet...`) en voeg toe, direct na de bestaande `expect(eerste?.verstuurd).toBe(false);`/`expect(eerste?.verzendFout).toBeUndefined();`-regels:

```typescript
    // Issue #222: de contactpersoon-naam moet meekomen voor de Excel-export.
    expect(eerste?.contactNaam).toBe('Contact Eerste');
    expect(tweede?.contactNaam).toBeUndefined();
```

- [ ] **Step 3: Zet een wegwerpdatabase op en draai de suite**

Run: `npm run test:db -- "excel-export contactnaam" --hergebruik` (of zonder `--hergebruik` als er nog geen container is — volg de foutmelding).

Zet de getoonde `MIGRATION_DATABASE_URL`/`DATABASE_URL` als env-var, run dan:

`npx jest --config ./test/jest-e2e.json ronde-beheer-routes`

Expected: alle tests in dit bestand slagen, inclusief de nieuwe assertie.

- [ ] **Step 4: Draai `npx jest test-ids` en de volledige e2e-run**

Run: `npx jest test-ids` → PASS.
Run: `npx jest --config ./test/jest-e2e.json` (volledige suite) → alle suites slagen.

- [ ] **Step 5: Commit**

```bash
git add test/ronde-beheer-routes.e2e-spec.ts
git commit -m "test(e2e): contactpersoon-naam in het uitnodigen-antwoord (issue #222)"
```

---

### Task 4: Frontend — branch aanmaken

**Files:** geen wijzigingen, alleen git.

- [ ] **Step 1: Maak de branch aan met dezelfde naam als de backend**

```bash
git -C "C:/DEV/Work/MCM2-frontend" status --short
git -C "C:/DEV/Work/MCM2-frontend" checkout -b feat/excel-export-uitnodigingen
```

Expected: schone status vóór het branchen (geen ongecommitte wijzigingen).

---

### Task 5: Frontend — `xlsx`-dependency en modeluitbreiding

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm install)
- Modify: `src/core/models/vragenlijst.ts`

- [ ] **Step 1: Installeer SheetJS**

```bash
npm install xlsx
```

Expected: `xlsx` verschijnt in `dependencies` van `package.json`.

- [ ] **Step 2: Breid `Uitnodiging` uit**

Wijzig `src/core/models/vragenlijst.ts` (rond regel 183-200):

```typescript
export interface Uitnodiging {
  readonly responseId: string;
  readonly vendorId: string;
  readonly vendorNaam: string;
  /** Het ruwe token. Bestaat uitsluitend in dit antwoord. */
  readonly token: string;
  readonly expiresAt: string;
  readonly verstuurd: boolean;
  readonly verzendFout?: string;
  /** Het adres van de primaire contactpersoon, als die er is. */
  readonly contactEmail?: string;
  /** De naam van de primaire contactpersoon, als die er is. */
  readonly contactNaam?: string;
}
```

- [ ] **Step 3: Compileer**

Run: `npx tsc --noEmit`
Expected: geen fouten (de backend geeft deze velden al mee via de bestaande spread, dus alleen het type ontbrak).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/core/models/vragenlijst.ts
git commit -m "feat(uitnodigingen): xlsx-dependency + contactpersoon-velden in het model (issue #222)"
```

---

### Task 6: Frontend — exportservice

**Files:**
- Create: `src/core/services/uitnodigingExportService.ts`
- Test: `src/core/services/uitnodigingExportService.spec.ts` (indien het project een unit-testrunner voor de frontend heeft — controleer eerst `package.json` scripts; is er geen `test`-script, sla dit testbestand over en dek het gedrag alleen via de e2e-test in Task 8)

- [ ] **Step 1: Controleer of er een frontend-unit-testrunner is**

Run: `node -e "console.log(JSON.stringify(require('./package.json').scripts))"` in `MCM2-frontend`.

Als er geen `test`-script staat (bevestigd in eerdere sessies: dit project heeft geen Jest/Vitest-opzet voor de frontend, alleen Playwright-e2e): sla Step 2 (los unit-testbestand) over en ga direct naar Step 3. Verzin geen testrunner die er niet is.

- [ ] **Step 2 (alleen als er een unit-testrunner is): schrijf een test**

Niet van toepassing in dit project — zie Step 1.

- [ ] **Step 3: Schrijf de exportservice**

Create `src/core/services/uitnodigingExportService.ts`:

```typescript
import * as XLSX from 'xlsx';

import type { Uitnodiging } from '@/core/models/vragenlijst';

/**
 * Zet het al-aangemaakte uitnodigingsresultaat om naar een downloadbaar
 * .xlsx-bestand — voor handmatig mailen via Outlook/Power Automate zolang
 * MCM2 zelf niet mailt. Zie issue #222.
 *
 * Bewust GEEN nieuwe backend-aanroep: deze functie werkt uitsluitend met de
 * tokens/links die al op het scherm staan. Een tweede aanroep naar de
 * uitnodigen-route zou een nieuwe, parallelle set tokens aanmaken naast de
 * al-getoonde — verwarrend en fout.
 */

interface ExportRij {
  Bedrijfsnaam: string;
  Contactpersoon: string;
  'E-mailadres': string;
  Link: string;
  'Ronde-datum': string;
  Vragenlijstnaam: string;
  'Verloopt op': string;
}

export function bouwUitnodigingenWerkboek(
  uitnodigingen: readonly Uitnodiging[],
  linkVoor: (token: string) => string,
  vragenlijstNaam: string,
  rondeDatum: Date,
): XLSX.WorkBook {
  const rijen: ExportRij[] = uitnodigingen.map((u) => ({
    Bedrijfsnaam: u.vendorNaam,
    Contactpersoon: u.contactNaam ?? '',
    'E-mailadres': u.contactEmail ?? '',
    Link: linkVoor(u.token),
    'Ronde-datum': rondeDatum.toLocaleDateString('nl-NL'),
    Vragenlijstnaam: vragenlijstNaam,
    'Verloopt op': new Date(u.expiresAt).toLocaleDateString('nl-NL'),
  }));

  const blad = XLSX.utils.json_to_sheet(rijen);
  const werkboek = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(werkboek, blad, 'Uitnodigingen');

  return werkboek;
}

/** Bouwt een bestandsnaam die meerdere exports niet laat overschrijven. */
export function uitnodigingenBestandsnaam(
  vragenlijstNaam: string,
  rondeDatum: Date,
): string {
  const veiligeName = vragenlijstNaam
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const datumDeel = rondeDatum.toISOString().slice(0, 10);

  return `uitnodigingen-${veiligeName}-${datumDeel}.xlsx`;
}

/** Bouwt het werkboek en triggert direct een browserdownload. */
export function downloadUitnodigingenAlsExcel(
  uitnodigingen: readonly Uitnodiging[],
  linkVoor: (token: string) => string,
  vragenlijstNaam: string,
  rondeDatum: Date,
): void {
  const werkboek = bouwUitnodigingenWerkboek(
    uitnodigingen,
    linkVoor,
    vragenlijstNaam,
    rondeDatum,
  );

  XLSX.writeFile(
    werkboek,
    uitnodigingenBestandsnaam(vragenlijstNaam, rondeDatum),
  );
}
```

- [ ] **Step 4: Compileer en lint**

Run: `npx tsc --noEmit` en `npm run lint`
Expected: geen fouten. Als `xlsx` geen ingebouwde types heeft (controleer `node_modules/xlsx/types/index.d.ts` — SheetJS levert eigen `.d.ts`-bestanden mee, dus dit zou zonder extra `@types`-package moeten compileren): als er tochtype-fouten zijn, meld dit als blokkade in plaats van `any` te gebruiken om de fout te verbergen.

- [ ] **Step 5: Commit**

```bash
git add src/core/services/uitnodigingExportService.ts
git commit -m "feat(uitnodigingen): exportservice - .xlsx bouwen uit het al-getoonde resultaat (issue #222)"
```

---

### Task 7: Frontend — downloadknop op het resultaatscherm

**Files:**
- Modify: `src/app/beheer/vragenlijsten/uitnodigen/page.tsx`

- [ ] **Step 1: Importeer de exportservice en `Download`-icoon**

Wijzig de imports bovenaan (rond regel 1-34):

```typescript
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Download,
  Send,
  ShieldAlert,
} from 'lucide-react';
```

En voeg toe, na de import van `vragenlijstService`:

```typescript
import { downloadUitnodigingenAlsExcel } from '@/core/services/uitnodigingExportService';
```

- [ ] **Step 2: Leg het moment van aanmaken vast**

Voeg een nieuwe state-variabele toe, naast de andere `useState`-declaraties (rond regel 86-94):

```typescript
  const [rondeDatum, setRondeDatum] = useState<Date | null>(null);
```

Wijzig de `start()`-functie (rond regel 162-194) om dit moment vast te leggen vóór de aanroep naar `nodigUit`:

```typescript
  async function start() {
    setStap('bezig');
    setFout(null);

    try {
      const ronde = await maakRonde({
        templateId,
        closesAt: sluitdatum ? new Date(sluitdatum).toISOString() : null,
        contractId,
      });

      const aangemaaktOp = new Date();
      const resultaat = await nodigUit(ronde.runId, gekozenIds, geldigheid);

      await wijzigRondeStatus(ronde.runId, 'active');

      setUitnodigingen(resultaat.uitnodigingen);
      setRondeDatum(aangemaaktOp);
      setSamenvatting({
        verzonden: resultaat.verzonden,
        mislukt: resultaat.mislukt,
        geenMailkanaal: resultaat.geenMailkanaal,
      });
      setStap('klaar');
    } catch (err) {
      setFout(
        err instanceof ApiFout
          ? err.melding
          : 'Het uitnodigen is niet gelukt. Probeer het opnieuw.',
      );
      setStap('kiezen');
    }
  }
```

- [ ] **Step 3: Voeg de downloadknop toe in het "geen mailkanaal"-waarschuwingsblok**

Wijzig het blok rond regel 239-259: voeg de knop toe direct na de bestaande twee `<p>`-tags, vóór de sluitende `</div></div>`:

```tsx
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
                Geen van de leveranciers heeft automatisch een mail ontvangen.
                Kopieer elke link hieronder en verstuur hem zelf.
              </p>
              <button
                type="button"
                data-testid="download-excel"
                onClick={() =>
                  downloadUitnodigingenAlsExcel(
                    uitnodigingen,
                    linkVoor,
                    gekozenLijst?.name ?? 'vragenlijst',
                    rondeDatum ?? new Date(),
                  )
                }
                className="mt-3 inline-flex items-center gap-2 rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900 transition hover:bg-red-100"
              >
                <Download size={15} />
                Download als Excel-bestand
              </button>
              <p className="mt-1 text-xs text-red-800">
                Gebruik dit bestand om de mails zelf te versturen via
                Outlook.
              </p>
            </div>
          </div>
        )}
```

- [ ] **Step 4: Compileer en lint**

Run: `npx tsc --noEmit` en `npm run lint`
Expected: geen fouten.

- [ ] **Step 5: Commit**

```bash
git add src/app/beheer/vragenlijsten/uitnodigen/page.tsx
git commit -m "feat(uitnodigingen): downloadknop voor Excel-export op het resultaatscherm (issue #222)"
```

---

### Task 8: Frontend — e2e-test

**Files:**
- Modify: `e2e/` — zoek eerst het bestaande testbestand voor dit scherm

- [ ] **Step 1: Zoek het bestaande e2e-bestand voor dit scherm**

Run: `grep -rl "uitnodigen" e2e/*.spec.ts` in `MCM2-frontend`.

Voeg de nieuwe test toe aan het gevonden bestand (naar verwachting iets als `e2e/uitnodigen.spec.ts` of vergelijkbaar — **niet aannemen, opzoeken**), volgens hetzelfde patroon als de bestaande tests in dat bestand (cookie-opzet, `unieke()`-helper, `afterEach`-opruiming).

- [ ] **Step 2: Schrijf de test**

Voeg toe, volgens het patroon van het gevonden bestand:

```typescript
  test('toont de Excel-downloadknop alleen zonder mailkanaal, en het bestand downloadt', async ({
    page,
  }) => {
    // Ga naar het uitnodigen-scherm met minstens één gekozen leverancier,
    // kies een vragenlijst, en klik op versturen — volg het bestaande
    // patroon in dit bestand voor hoe een ronde hier wordt aangemaakt.

    await expect(page.getByTestId('geen-mailkanaal-waarschuwing')).toBeVisible();
    await expect(page.getByTestId('download-excel')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-excel').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^uitnodigingen-.*\.xlsx$/);
  });
```

Pas de opzet (hoe een ronde wordt aangemaakt, welke fixtures nodig zijn) aan op wat het gevonden bestand al doet — dit is een sjabloon, geen letterlijke, op zichzelf staande test.

- [ ] **Step 3: Compileer en lint**

Run: `npx tsc --noEmit` en `npm run lint`
Expected: geen fouten.

- [ ] **Step 4: Draai de suite (met de bekende beperking)**

Vanwege het pre-existing, gedocumenteerde `context.addCookies()`-probleem (zie eerdere commits in dit project) draait een standalone e2e-run mogelijk niet volledig — dat is bekend en niet iets om hier opnieuw op te lossen. Laat deze test meelopen in `verify:volledig` op de backend-repo (Task 9), waar de orchestratie dit probleem niet heeft.

- [ ] **Step 5: Commit**

```bash
git add <het gevonden e2e-bestand>
git commit -m "test(e2e): Excel-downloadknop op het uitnodigen-resultaatscherm (issue #222)"
```

---

### Task 9: Volledige verificatie

**Files:** geen wijzigingen — alleen verificatie.

- [ ] **Step 1: Draai `verify:volledig` in de backend-repo**

Run: `npm run verify:volledig` (in `MCM2`)
Expected: groen. Als er een rode stap is: onderzoeken vóór verder te gaan, niet aannemen dat het een bekende uitzondering is — er is dit keer geen reden om een blokkade te verwachten (geen migratie, geen backup-verwachting-mismatch).

- [ ] **Step 2: Handmatige browserverificatie**

Start backend + frontend tegen een wegwerpdatabase (zelfde aanpak als bij de vorige feature: `npm run test:db`, `SESSIE_COOKIE_INSECURE=true` bij de backend voor een lokale sessie zonder `__Host-`-cookie-probleem).

Controleer in de browser:
- Een ronde starten met een leverancier die wél een contactpersoon heeft en een leverancier die dat niet heeft, zonder mailkanaal geconfigureerd.
- De downloadknop verschijnt in het rode waarschuwingsblok, met de juiste tekst.
- Het gedownloade `.xlsx`-bestand bevat de juiste kolommen in de juiste volgorde (bedrijfsnaam, contactpersoon, e-mailadres, link, ronde-datum, vragenlijstnaam, verloopt op), met de juiste waarden — inclusief een lege cel voor de leverancier zonder contactpersoon.
- De knop verschijnt NIET wanneer er wél een mailkanaal actief is (kan gecontroleerd worden door `samenvatting.geenMailkanaal` in de devtools te inspecteren, of door een omgeving met mailkanaal te gebruiken als die beschikbaar is).

- [ ] **Step 3: Opruimen**

Sluit de handmatige stack af, verwijder eventuele tijdelijke testbestanden (gedownloade `.xlsx`-bestanden uit de Downloads-map van de testbrowser), en controleer `git status --short` op beide repo's vóór verder te gaan.

---

### Self-Review (uitgevoerd door de planschrijver)

1. **Spec coverage**: .xlsx-formaat (Task 5-6), datum+naam als rondekenmerk zonder backend-wijziging (Task 7, client-side `rondeDatum`), contactpersoon-naam toegevoegd aan de bestaande query (Task 2), geen nieuwe backend-route/client-side export (Task 6), kolomvolgorde uit het UI-ontwerp-comment (Task 6, `ExportRij`), knop alleen zichtbaar bij `geenMailkanaal` naast "Alles kopiëren" (Task 7), geen jargon in de UI-tekst (Task 7, "Download als Excel-bestand") — alle punten uit de spec zijn gedekt.
2. **Placeholder-scan**: Task 8 bevat bewust een sjabloon-test in plaats van volledige code, met een expliciete instructie om eerst het echte bestaande testbestand op te zoeken — dat is geen placeholder maar een noodzakelijke stap omdat het exacte bestaande e2e-patroon voor dit scherm nog niet is geverifieerd op het moment van schrijven van dit plan. Task 6 Step 1-2 legt expliciet uit waarom er geen los unit-testbestand komt (geen testrunner voor de frontend in dit project) in plaats van een nep-stap te laten staan.
3. **Type-consistentie**: `contactEmail`/`contactNaam` heten identiek in backend (`Uitnodiging` in `ronde-beheer.service.ts`), backend-e2e-test, frontend-model (`vragenlijst.ts`) en de exportservice — gecontroleerd tussen Task 2, 3, 5 en 6.
4. **Scope**: dit plan raakt alleen de Excel-export-functionaliteit, geen andere subsystemen — geen decompositie nodig.
