# Keuze mailen of alleen tonen bij leverancier-uitnodiging — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De beheerder kan op het uitnodigen-scherm, vóór het versturen, bewust
kiezen: automatisch mailen via het platformkanaal, of uitsluitend de
tokenlinks tonen om zelf handmatig door te geven. Vervolg op de eerder
gebouwde mailstatus-weergave (`feat/vragenlijst-mailstatus-uitnodiging`) —
die toont wat er gebeurd is, dit plan geeft de beheerder controle over of het
gebeurt.

**Architecture:** Een nieuw, optioneel veld `verstuurMail: boolean` (default
`true`, om bestaand gedrag ongewijzigd te laten) reist mee van frontend →
`leesUitnodigingen()` → de route-handler. Wanneer `false`, roept de
controller `UitnodigingVerzender` helemaal niet aan — geen mailpoging, dus
geen Resend-aanroep, geen `LogMailKanaal`-logregel. Het antwoord krijgt dan
een apart signaal (`overgeslagen: true` naast de bestaande velden) zodat het
scherm "bewust niet verstuurd" kan tonen, te onderscheiden van "geprobeerd en
mislukt".

**Tech Stack:** NestJS (backend), Next.js/React (frontend), geen
datamodelwijziging — dit is een verzoekparameter, geen opgeslagen instelling.

---

## Achtergrond

Vandaag (21-09-2026) is de mailstatus-weergave getest in de lokale demo: na
het versturen toont het scherm correct of de mail is aangekomen. De eigenaar
wil daarnaast **vooraf** kunnen kiezen om helemaal geen mailpoging te doen —
bijvoorbeeld omdat hij de link liever zelf via een ander kanaal deelt, los
van of Resend toevallig wel of niet geconfigureerd is in de omgeving.

Dit is een bewuste, expliciete keuze per uitnodigmoment (niet een
vaste tenant-instelling — dat was overwogen en afgewezen: de eigenaar wil dit
per keer kunnen bepalen).

---

## Task 1: Backend — `verstuurMail` accepteren in de invoer

**Files:**
- Modify: `C:\DEV\Work\MCM2\src\survey\ronde-invoer.ts:78-81` (interface),
  `:186-220` (`leesUitnodigingen`)
- Test: `C:\DEV\Work\MCM2\test\ronde-invoer.spec.ts` (bestaat al —
  controleer met `Glob` of het pad klopt vóór je begint; zo niet, zoek het
  bestaande unit-testbestand voor `ronde-invoer.ts` via
  `grep -rl "leesUitnodigingen" test/ src/`)

- [ ] **Step 1: Schrijf de falende unit-tests**

Voeg toe aan het bestaande testbestand voor `ronde-invoer.ts` (zoek eerst het
exacte pad — dit project heeft `.spec.ts`-bestanden naast de broncode in
`src/`, niet noodzakelijk in `test/`; check met
`Glob({ pattern: "**/ronde-invoer*.spec.ts" })`):

```typescript
describe('leesUitnodigingen — verstuurMail', () => {
  it('is standaard true wanneer het veld ontbreekt', () => {
    const resultaat = leesUitnodigingen({
      vendorIds: ['a2371a1c-8af4-40db-b832-96540b97f941'],
    });

    expect(resultaat.verstuurMail).toBe(true);
  });

  it('accepteert expliciet false', () => {
    const resultaat = leesUitnodigingen({
      vendorIds: ['a2371a1c-8af4-40db-b832-96540b97f941'],
      verstuurMail: false,
    });

    expect(resultaat.verstuurMail).toBe(false);
  });

  it('weigert een niet-boolean waarde', () => {
    expect(() =>
      leesUitnodigingen({
        vendorIds: ['a2371a1c-8af4-40db-b832-96540b97f941'],
        verstuurMail: 'nee',
      }),
    ).toThrow(InvoerFout);
  });
});
```

- [ ] **Step 2: Run de tests, verwacht FAIL**

```bash
cd C:\DEV\Work\MCM2
npx jest ronde-invoer --testPathPattern=spec
```

Verwacht: FAIL — `resultaat.verstuurMail` is `undefined`, want het veld
bestaat nog niet op `Uitnodigingen`.

- [ ] **Step 3: Voeg het veld toe aan de interface**

In `src/survey/ronde-invoer.ts`, regel 78-81:

```typescript
export interface Uitnodigingen {
  vendorIds: string[];
  geldigheidDagen: number;
  /**
   * Of de backend automatisch mail moet proberen te versturen via het
   * platformkanaal. `false`: de beheerder kiest bewust om zelf de
   * tokenlinks door te geven, ongeacht of er een mailkanaal actief is.
   * Standaard `true` — bestaand gedrag blijft ongewijzigd wanneer dit veld
   * ontbreekt.
   */
  verstuurMail: boolean;
}
```

- [ ] **Step 4: Lees het veld in `leesUitnodigingen()`**

In dezelfde file, in de return van `leesUitnodigingen()` (rond regel
216-219), voeg toe:

```typescript
  return {
    vendorIds,
    geldigheidDagen: leesGeldigheid(invoer.geldigheidDagen),
    verstuurMail: leesVerstuurMail(invoer.verstuurMail),
  };
}

/**
 * Leest `verstuurMail`. Standaard `true` wanneer het ontbreekt — bestaand
 * gedrag (altijd een mailpoging) blijft zo het gedrag voor elke aanroeper
 * die dit veld nog niet meestuurt.
 */
function leesVerstuurMail(waarde: unknown): boolean {
  if (waarde === undefined || waarde === null) {
    return true;
  }

  if (typeof waarde !== 'boolean') {
    throw new InvoerFout('verstuurMail', 'verstuurMail moet true of false zijn.');
  }

  return waarde;
}
```

- [ ] **Step 5: Run de tests, verwacht PASS**

```bash
npx jest ronde-invoer --testPathPattern=spec
```

Verwacht: alle tests groen, inclusief de drie nieuwe.

- [ ] **Step 6: Commit**

```bash
git add src/survey/ronde-invoer.ts test/ronde-invoer.spec.ts
git commit -m "feat(vragenlijst): verstuurMail-veld op uitnodigingsinvoer"
```

(Pad van het testbestand aanpassen aan wat Step 1 daadwerkelijk vond.)

---

## Task 2: Backend — mailpoging overslaan wanneer `verstuurMail` false is

**Files:**
- Modify: `C:\DEV\Work\MCM2\src\survey\vragenlijst-beheer.controller.ts:693-765`
  (`uitnodigen()`-methode)
- Test: `C:\DEV\Work\MCM2\test\survey-routes.e2e-spec.ts` (bestaand
  e2e-bestand voor deze routes — bevestig het pad met
  `grep -rl "runs/:id/participants\|/participants" test/`)

- [ ] **Step 1: Bekijk de bestaande e2e-test-opzet**

Lees `test/survey-routes.e2e-spec.ts` (of het bestand dat Step 1's grep
vindt) om het patroon voor sessie-opzet, tenant-aanmaak en het aanroepen van
`POST /admin/survey/runs/:id/participants` over te nemen. Gebruik dezelfde
`withTenant`/sessie-helpers die daar al staan.

- [ ] **Step 2: Schrijf de falende e2e-test**

Voeg toe aan hetzelfde bestand, in het `describe`-blok van de
uitnodigen-route:

```typescript
it('slaat de mailpoging over wanneer verstuurMail false is', async () => {
  // Vervolg op de bestaande opzet in dit bestand: een ronde in draft met
  // minstens één leverancier met een e-mailadres bij de contactpersoon —
  // zonder een geldig adres zou de test niets bewijzen (de mailpoging zou
  // toch al niet plaatsvinden, om een andere reden).
  const response = await request(app.getHttpServer())
    .post(`/admin/survey/runs/${runId}/participants`)
    .set('Cookie', sessieCookie)
    .send({ vendorIds: [vendorMetEmailId], verstuurMail: false })
    .expect(201);

  expect(response.body.uitnodigingen[0].verstuurd).toBe(false);
  expect(response.body.overgeslagen).toBe(true);
  // geenMailkanaal blijft false: er is geen mailkanaal geraadpleegd, dus er
  // kan ook niet geconcludeerd worden dat er geen kanaal actief is.
  expect(response.body.geenMailkanaal).toBe(false);
});

it('verstuurt gewoon mail wanneer verstuurMail ontbreekt (bestaand gedrag)', async () => {
  const response = await request(app.getHttpServer())
    .post(`/admin/survey/runs/${runId2}/participants`)
    .set('Cookie', sessieCookie)
    .send({ vendorIds: [vendorMetEmailId2] })
    .expect(201);

  expect(response.body.overgeslagen).toBe(false);
});
```

(Vervang `runId`, `vendorMetEmailId`, `sessieCookie` etc. door de exacte
variabelen die de bestaande tests in dit bestand al gebruiken — niet
verzinnen, overnemen.)

- [ ] **Step 3: Run de nieuwe tests tegen een wegwerpdatabase, verwacht FAIL**

```bash
npm run test:db -- "verstuurMail-veld verifiëren"
# gebruik de MIGRATION_DATABASE_URL/DATABASE_URL die het script afdrukt
DATABASE_URL="<afgedrukte-url>" npx jest survey-routes --testPathPattern=e2e-spec
```

Verwacht: FAIL op de nieuwe tests — `overgeslagen` bestaat nog niet in het
antwoord.

- [ ] **Step 4: Werk de controller bij**

In `src/survey/vragenlijst-beheer.controller.ts`, vervang het blok van regel
711-765 (`uitnodigen()`-body vanaf `const { uitnodigingen, context } = ...`
tot en met de return) door:

```typescript
    const { uitnodigingen, context } = await this.rondes.uitnodigen(
      sessie.tenantId,
      id,
      invoer,
    );

    // Bewust géén mailpoging wanneer de beheerder dat vooraf heeft
    // uitgezet — dit is een andere situatie dan "geen mailkanaal
    // geconfigureerd": hier is er nooit een kanaal geraadpleegd, dus
    // `geenMailkanaal` (dat afgeleid wordt uit een reeks pogingen) moet
    // `false` blijven. Het scherm onderscheidt dit via `overgeslagen`.
    if (!invoer.verstuurMail) {
      return {
        uitnodigingen: uitnodigingen.map((u) => ({
          ...u,
          verstuurd: false,
          verzendFout: undefined,
        })),
        verzonden: 0,
        mislukt: 0,
        geenMailkanaal: false,
        overgeslagen: true,
      };
    }

    // Versturen gebeurt ná de transactie, nooit erin.
    //
    // Een verstuurde mail is niet terug te draaien. Zat de verzending in de
    // transactie en faalde de laatste invoeging, dan waren de tokens weg maar
    // de uitnodigingen verstuurd — leveranciers met een link naar niets. Eerst
    // vastleggen, dan versturen, is de enige volgorde die dat uitsluit.
    const verzending = await this.verzender.verstuurAllemaal(
      uitnodigingen.map((u) => ({
        responseId: u.responseId,
        vendorNaam: u.vendorNaam,
        ontvanger: u.contactEmail,
        link: this.portaalLink(u.token),
        verlooptOp: u.expiresAt,
      })),
      context,
    );

    const perResponse = new Map(verzending.map((v) => [v.responseId, v]));

    return {
      // De tokens blijven in het antwoord staan, óók als de mail geslaagd is.
      // Dit is het enige moment waarop ze bestaan; er is geen route die ze
      // opnieuw kan tonen. Gaat de mail alsnog verloren, dan is dit de laatste
      // kans om de link handmatig door te geven.
      uitnodigingen: uitnodigingen.map((u) => {
        const uitkomst = perResponse.get(u.responseId);
        return {
          ...u,
          // `echtVerstuurd` en niet `verstuurd` — zelfde reden als bij
          // `PlatformController` (Issue #131). Zonder mailkanaal ging er niets
          // uit, en dan mag hier geen vinkje staan dat zegt van wel.
          verstuurd: uitkomst?.echtVerstuurd ?? false,
          verzendFout: uitkomst?.fout,
        };
      }),
      verzonden: verzending.filter((v) => v.echtVerstuurd).length,
      mislukt: verzending.filter((v) => !v.verstuurd).length,
      // Staat dit op `true`, dan is `verzonden` nul zonder dat er iets fout is:
      // de tokens zijn geldig, maar de links moeten met de hand doorgegeven
      // worden. Het scherm kan dat dan zeggen in plaats van "0 verstuurd" te
      // tonen bij een ronde waar niets mis mee is.
      //
      // De toets is *geslaagd maar niet echt verstuurd*. Zou hier
      // `every(v => !v.echtVerstuurd)` staan, dan is dit ook `true` wanneer de
      // provider álles weigerde — en dan wijst het scherm naar een ontbrekend
      // mailkanaal terwijl er een heel ander probleem is.
      geenMailkanaal: verzending.some((v) => v.verstuurd && !v.echtVerstuurd),
      // Onderscheidt "we hebben het niet eens geprobeerd" (beheerder koos
      // dit vooraf) van elk ander scenario hierboven, waar wél een poging is
      // gedaan.
      overgeslagen: false,
    };
```

- [ ] **Step 5: Run de tests opnieuw, verwacht PASS**

```bash
DATABASE_URL="<zelfde-afgedrukte-url>" npx jest survey-routes --testPathPattern=e2e-spec
```

- [ ] **Step 6: Ruim de wegwerpdatabase op**

```bash
npm run test:db -- --afbreken
```

- [ ] **Step 7: Commit**

```bash
git add src/survey/vragenlijst-beheer.controller.ts test/survey-routes.e2e-spec.ts
git commit -m "feat(vragenlijst): mailpoging overslaan bij verstuurMail=false"
```

---

## Task 3: Frontend — model en service bijwerken

**Files:**
- Modify: `C:\DEV\Work\MCM2-frontend\src\core\models\vragenlijst.ts`
  (`Uitnodiging`, `UitnodigingResultaat` — al aangepast in de vorige feature)
- Modify: `C:\DEV\Work\MCM2-frontend\src\core\services\vragenlijstService.ts`
  (`nodigUit()`)

- [ ] **Step 1: Voeg `overgeslagen` toe aan `UitnodigingResultaat`**

In `src/core/models/vragenlijst.ts`, zoek de `UitnodigingResultaat`-interface
(toegevoegd in de vorige feature, rond regel 200-215 na de eerdere wijziging)
en voeg toe:

```typescript
export interface UitnodigingResultaat {
  readonly uitnodigingen: Uitnodiging[];
  readonly verzonden: number;
  readonly mislukt: number;
  readonly geenMailkanaal: boolean;
  /**
   * `true` wanneer de beheerder vooraf koos om geen mail te laten versturen
   * (`verstuurMail: false` in het verzoek) — te onderscheiden van
   * `geenMailkanaal`, waar wél een poging is gedaan maar geen kanaal actief
   * bleek.
   */
  readonly overgeslagen: boolean;
}
```

- [ ] **Step 2: Voeg `verstuurMail` toe aan `nodigUit()`**

In `src/core/services/vragenlijstService.ts`, werk de signatuur van
`nodigUit()` bij:

```typescript
export async function nodigUit(
  runId: string,
  vendorIds: string[],
  geldigheidDagen?: number,
  verstuurMail = true,
): Promise<UitnodigingResultaat> {
  if (gebruiktMockData) {
    throw new Error(
      'Uitnodigen kan niet zonder verbinding met de backend: er zou een token ontstaan dat nergens op slaat.',
    );
  }

  return verstuur<UitnodigingResultaat>(
    `/admin/survey/runs/${runId}/participants`,
    { vendorIds, geldigheidDagen, verstuurMail },
  );
}
```

- [ ] **Step 3: TypeScript-check**

```bash
cd C:\DEV\Work\MCM2-frontend
npx tsc --noEmit
```

Verwacht: geen fouten.

- [ ] **Step 4: Commit**

```bash
git add src/core/models/vragenlijst.ts src/core/services/vragenlijstService.ts
git commit -m "feat(vragenlijst): verstuurMail-keuze doorgeven aan de backend"
```

---

## Task 4: Frontend — schakelaar op het uitnodigen-scherm

**Files:**
- Modify: `C:\DEV\Work\MCM2-frontend\src\app\beheer\vragenlijsten\uitnodigen\page.tsx`

- [ ] **Step 1: Voeg state toe voor de schakelaar**

Bij de overige `useState`-declaraties (rond de bestaande `geldigheid`- en
`sluitdatum`-state):

```typescript
  const [verstuurMail, setVerstuurMail] = useState(true);
```

- [ ] **Step 2: Geef de keuze door in `start()`**

Pas de aanroep van `nodigUit()` in `start()` aan:

```typescript
      const resultaat = await nodigUit(
        ronde.runId,
        gekozenIds,
        geldigheid,
        verstuurMail,
      );
```

- [ ] **Step 3: Voeg de schakelaar toe aan het formulier**

Plaats deze net vóór het "Voordat u verstuurt"-waarschuwingsblok (dat al
bestaat, met `data-testid="voor-u-begint"`), zodat de keuze zichtbaar is
vóórdat de beheerder op de knop drukt:

```typescript
          <section className="mb-6">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={verstuurMail}
                onChange={(e) => setVerstuurMail(e.target.checked)}
                data-testid="verstuur-mail-schakelaar"
                className="h-4 w-4 rounded border-line"
              />
              Verstuur automatisch een mail naar elke leverancier
            </label>
            <p className="mt-1 text-xs text-ink-muted">
              {verstuurMail
                ? 'Elke leverancier met een bekend e-mailadres krijgt automatisch een uitnodiging.'
                : 'Er wordt geen mail verstuurd. U ziet hierna alle links om zelf handmatig door te geven.'}
            </p>
          </section>
```

- [ ] **Step 4: Titel/melding laten reageren op `overgeslagen`**

In het `stap === 'klaar'`-blok, waar `samenvatting` wordt uitgelezen (van de
vorige feature), voeg het `overgeslagen`-veld toe aan de lokale
`samenvatting`-state en de titellogica:

```typescript
      setSamenvatting({
        verzonden: resultaat.verzonden,
        mislukt: resultaat.mislukt,
        geenMailkanaal: resultaat.geenMailkanaal,
        overgeslagen: resultaat.overgeslagen,
      });
```

(Werk ook de `useState`-typing van `samenvatting` bij met `overgeslagen:
boolean`.)

Pas de titellogica aan:

```typescript
    const titel = samenvatting.overgeslagen
      ? 'Links klaar om handmatig te versturen'
      : samenvatting.geenMailkanaal
        ? 'Geen mail verstuurd — links klaar om handmatig door te geven'
        : samenvatting.mislukt > 0
          ? 'Uitnodigingen deels verstuurd'
          : 'Uitnodigingen verstuurd';
```

En voeg, naast de bestaande `geen-mailkanaal-waarschuwing`, een apart, neutraal
(niet-rood) blok toe voor het bewust-overgeslagen-geval:

```typescript
        {samenvatting.overgeslagen && (
          <div
            data-testid="mail-overgeslagen-melding"
            className="mb-6 flex gap-3 rounded-lg border border-line bg-surface p-4"
          >
            <ShieldAlert
              size={20}
              className="mt-0.5 flex-shrink-0 text-ink-muted"
            />
            <div className="text-sm text-ink-muted">
              <p className="font-medium text-ink">
                Er is bewust geen mail verstuurd.
              </p>
              <p className="mt-1">
                U koos ervoor de links zelf door te geven. Kopieer ze
                hieronder.
              </p>
            </div>
          </div>
        )}
```

Zorg dat de bestaande `geen-mailkanaal-waarschuwing` en
`deels-mislukt-waarschuwing` blokken uitsluitend tonen wanneer
`!samenvatting.overgeslagen` (anders zouden ze naast elkaar verschijnen voor
hetzelfde scenario). Voeg die voorwaarde toe aan hun bestaande
`{condition && (...)}`-checks.

- [ ] **Step 5: Per-leverancier-statustekst aanpassen**

In de lijst-rendering (waar `uitnodiging-mailstatus` staat, uit de vorige
feature), maak de tekst afhankelijk van `samenvatting.overgeslagen`:

```typescript
              <p
                data-testid="uitnodiging-mailstatus"
                className={`mb-2 text-xs ${
                  uitnodiging.verstuurd
                    ? 'text-green-700'
                    : samenvatting?.overgeslagen
                      ? 'text-ink-muted'
                      : 'text-red-700'
                }`}
              >
                {uitnodiging.verstuurd
                  ? '✓ Mail verstuurd'
                  : samenvatting?.overgeslagen
                    ? '— Niet verstuurd (bewust overgeslagen)'
                    : `✗ Niet verstuurd${uitnodiging.verzendFout ? ` — ${uitnodiging.verzendFout}` : ' — geef de link handmatig door'}`}
              </p>
```

- [ ] **Step 6: TypeScript-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/app/beheer/vragenlijsten/uitnodigen/page.tsx
git commit -m "feat(vragenlijst): schakelaar om mailen bewust over te slaan"
```

---

## Task 5: E2e-test voor de schakelaar

**Files:**
- Modify: `C:\DEV\Work\MCM2-frontend\e2e\uitnodigen.spec.ts`

- [ ] **Step 1: Schrijf de test**

Voeg toe, na de bestaande "toont expliciet dat er geen mail is verstuurd
wanneer er geen mailkanaal actief is"-test (gebruik hetzelfde patroon: eigen
vendor met contactpersoon, `mailTerm`-stijl unieke naam):

```typescript
test('laat de beheerder bewust kiezen om geen mail te versturen', async ({
  page,
  request,
}) => {
  const term = `MAILUIT${stempel}`;

  const aanmaakAntwoord = await request.post(`${API}/vendors`, {
    headers: { Cookie: COOKIE! },
    data: {
      name: `Uitproef ${term} B.V.`,
      kvkNumber: String(stempel + 3).slice(-8),
      city: 'Zwolle',
      contact: {
        fullName: 'Test Contactpersoon',
        email: 'uitproef@voorbeeld.nl',
      },
    },
  });

  if (aanmaakAntwoord.ok()) {
    const body = (await aanmaakAntwoord.json()) as { vendorId?: string };
    if (body.vendorId) {
      aangemaakt.push(body.vendorId);
    }
  }

  const vooraf = await rondeIds(request);

  await page.goto(LIJST);
  await expect(page.getByTestId('vendor-tabel')).toBeVisible();

  await page.getByTestId('zoekveld').fill(term);
  await page.getByTestId('selecteer-alles').check();
  await page.getByTestId('uitnodigen-knop').click();
  await expect(page.getByTestId('gekozen-lijst')).toBeVisible();

  const keuze = page.getByTestId('vragenlijst-keuze');
  if ((await keuze.inputValue()) === '') {
    await keuze.selectOption({ index: 1 });
  }

  // De kern: schakelaar uitzetten vóór het versturen.
  await page.getByTestId('verstuur-mail-schakelaar').uncheck();

  await page.getByTestId('verstuur-knop').click();

  await expect(page.getByTestId('mail-overgeslagen-melding')).toBeVisible();
  await expect(
    page.getByTestId('geen-mailkanaal-waarschuwing'),
  ).toHaveCount(0);

  const eersteRij = page.getByTestId('uitnodiging-rij').first();
  await expect(
    eersteRij.getByTestId('uitnodiging-mailstatus'),
  ).toContainText('bewust overgeslagen');

  for (const id of await rondeIds(request)) {
    if (!vooraf.includes(id)) {
      gestarteRondes.push(id);
    }
  }
});
```

- [ ] **Step 2: Draai de volledige verify-keten**

```bash
cd C:\DEV\Work\MCM2
npm run verify:volledig
```

Verwacht: groen. Draai de volledige keten, niet alleen dit testbestand — alle
suites delen één database (CLAUDE.md §5).

- [ ] **Step 3: Commit**

```bash
cd C:\DEV\Work\MCM2-frontend
git add e2e/uitnodigen.spec.ts
git commit -m "test(vragenlijst): e2e-dekking voor bewust overslaan van mailversturen"
```

---

## Self-review — gedaan

**Spec-dekking:** "een keuze kunnen maken: mailen of alleen token te zien
krijgen" → Task 4, Step 3 (schakelaar) + Step 4-5 (scherm reageert op de
keuze). "Op het uitnodigen-scherm zelf, per keer" (niet per tenant) →
bevestigd met de gebruiker, geen instellingenscherm gebouwd.

**Geen placeholders:** alle stappen bevatten volledige code. Task 1/2 vragen
om eerst het exacte bestaande testbestand-pad te vinden via `Glob`/`grep` in
plaats van een pad te verzinnen — dat is een instructie om op te zoeken, geen
onduidelijke placeholder.

**Type-consistentie:** `verstuurMail: boolean` op `Uitnodigingen` (Task 1) →
gelezen in de controller als `invoer.verstuurMail` (Task 2) →
`UitnodigingResultaat.overgeslagen` als nieuw responsveld (Task 2) →
`UitnodigingResultaat`-model in de frontend krijgt exact dat veld (Task 3) →
`nodigUit()` geeft `verstuurMail` door en resultaat terug (Task 3) → scherm
leest `resultaat.overgeslagen` in dezelfde vorm (Task 4).

**Samenhang met de vorige feature:** dit plan bouwt voort op
`UitnodigingResultaat`/`geenMailkanaal` uit
`docs/superpowers/plans/2026-09-21-mailstatus-leverancier-uitnodiging.md` —
voer dat plan eerst uit (het is al gedaan, branch
`feat/vragenlijst-mailstatus-uitnodiging`, PR MCM2-frontend#25) vóórdat dit
plan gestart wordt. Dit plan gaat uit van die branch als basis of van `main`
nadat die PR gemerged is.
