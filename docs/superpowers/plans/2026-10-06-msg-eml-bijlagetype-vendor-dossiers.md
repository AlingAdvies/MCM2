# Outlook-mail (.msg/.eml) als bijlagetype bij vendor-dossiers — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een beheerder kan een geëxporteerde Outlook-mail (`.msg`) of een standaard-mailbestand (`.eml`) als bijlage toevoegen aan een vendor-dossier (`vendor_engagement`), naast de al bestaande PDF/PNG/DOCX/XLSX-typen.

**Architecture:** `.msg` is een binair OLE/CFBF-compound-document met een vaste, betrouwbare byte-signature (`D0 CF 11 E0 A1 B1 1A E1`) — net als PDF/PNG wordt dit dus puur op bestandsinhoud herkend, zonder afhankelijk te zijn van het door de browser meegegeven (vaak onbetrouwbare, bijv. `application/octet-stream`) content-type. `.eml` is platte RFC822-tekst zonder vaste magic bytes; dit wordt herkend aan een vereist RFC822-headerpatroon aan het begin van het bestand (regel die begint met `Return-Path:`, `Received:`, `From:`, `Date:` of `Message-ID:`, gevolgd door een header-block). Beide typen krijgen een eigen vaste content-type-string (`application/vnd.ms-outlook` voor `.msg`, `message/rfc822` voor `.eml`) die, net als bij PDF/PNG, niet afhankelijk is van het beweerde type — een mismatch tussen signature en beweerd type wordt gemeld, maar het beweerde type is nooit doorslaggevend voor deze twee nieuwe typen (in tegenstelling tot de bestaande OOXML-aanpak voor DOCX/XLSX, die wél op het beweerde type moet vertrouwen omdat de ZIP-signature zelf niet onderscheidt).

**Tech Stack:** NestJS, Drizzle (handgeschreven SQL-migraties), Postgres met RLS, Jest.

---

## Overzicht van de wijziging

| Onderdeel | Bestand | Wat |
|---|---|---|
| Migratie | `drizzle/0045_vendor_engagement_attachment_msg_eml.sql` | CHECK-constraint uitbreiden met twee nieuwe content-types |
| Validatielogica | `src/vendor/vendor-engagement-bestand-validatie.ts` | Nieuwe signature voor `.msg`, nieuwe headerpatroon-detectie voor `.eml` |
| Unit-tests | `src/vendor/vendor-engagement-bestand-validatie.spec.ts` | Testgevallen voor beide nieuwe typen, inclusief het onbetrouwbare-beweerde-type-scenario |
| Frontend (optioneel, losse taak) | `MCM2-frontend` | UI-tekst bijwerken over geaccepteerde typen — geen `accept=`-attribuut aanwezig, dus geen verplichte wijziging |

---

## Task 1: Migratie — CHECK-constraint uitbreiden

**Files:**
- Create: `drizzle/0045_vendor_engagement_attachment_msg_eml.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================================
-- clm.vendor_engagement_attachment — .msg en .eml toegestaan als bijlagetype.
--
-- Aanleiding: Transdev-gebruikers werken vrijwel uitsluitend in Outlook voor
-- leveranciers-communicatie. Relevante mailwisseling moet als bewijsstuk in
-- het dossier te bewaren zijn, niet alleen als PDF-afdruk. Zie
-- docs/superpowers/plans/2026-10-06-msg-eml-bijlagetype-vendor-dossiers.md.
--
-- .msg (Outlook-berichtformaat, binair OLE/CFBF-compound-document) en .eml
-- (standaard RFC822-mailformaat, platte tekst) krijgen elk een eigen vaste
-- content-type-string, op dezelfde manier als de bestaande PDF/PNG-typen:
-- de CHECK-constraint staat ze toe, de applicatiecode
-- (vendor-engagement-bestand-validatie.ts) stelt het type vast op basis van
-- de bestandsinhoud zelf, niet op het door de browser beweerde type.
--
-- CHECK-constraints kunnen niet met ALTER worden gewijzigd — de oude wordt
-- gedropt en een nieuwe met dezelfde naam, uitgebreide lijst, aangemaakt.
-- =============================================================================

ALTER TABLE "clm"."vendor_engagement_attachment"
    DROP CONSTRAINT "vendor_engagement_attachment_content_type_check";--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement_attachment"
    ADD CONSTRAINT "vendor_engagement_attachment_content_type_check"
    CHECK (content_type IN (
        'application/pdf',
        'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-outlook',
        'message/rfc822'
    ));--> statement-breakpoint

COMMENT ON TABLE clm.vendor_engagement_attachment IS
    'Bijlagen bij een vendor-dossier (max. 3 per engagement, PDF/PNG/DOCX/XLSX/MSG/EML, max. 10MB). Append-only, intrekken via deleted_at.';
```

**Let op:** dit is een `ALTER TABLE` op een bestaande tabel (geen nieuwe tabel), dus er is geen nieuwe `GRANT` nodig — de bestaande rechten uit migratie 0042 blijven gelden.

- [ ] **Step 2: Voeg de migratie toe aan het journal**

Open `drizzle/meta/_journal.json` en voeg toe als laatste entry vóór de sluitende `]`:

```json
    {
      "idx": 45,
      "version": "7",
      "when": 1787068800019,
      "tag": "0045_vendor_engagement_attachment_msg_eml",
      "breakpoints": true
    }
```

- [ ] **Step 3: Draai de migratie tegen een wegwerpdatabase**

Volg `npm run test:db -- "msg eml bijlagetype"` (zet een wegwerpcontainer op, draait alle migraties, drukt `MIGRATION_DATABASE_URL`/`DATABASE_URL` af — zie `docs/runbooks/commandos-en-omgeving.md`). Exporteer die twee variabelen zoals het script aangeeft.

Run: `npm run migrate:deploy`
Expected: eindigt met alle migraties toegepast, inclusief `0045_vendor_engagement_attachment_msg_eml`, geen fout.

- [ ] **Step 4: Verifieer de constraint met een echte query**

```powershell
docker exec <container-naam> psql -U clm_migrator -d postgres -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'vendor_engagement_attachment_content_type_check';"
```

Expected: de output bevat zowel `'application/vnd.ms-outlook'` als `'message/rfc822'` in de lijst.

- [ ] **Step 5: Commit**

```powershell
git add drizzle/0045_vendor_engagement_attachment_msg_eml.sql drizzle/meta/_journal.json
git commit -m "feat(vendor): .msg/.eml toegestaan als vendor-dossier-bijlage (schema)"
```

---

## Task 2: Validatielogica — `.msg` herkennen op signature

**Files:**
- Modify: `src/vendor/vendor-engagement-bestand-validatie.ts`
- Test: `src/vendor/vendor-engagement-bestand-validatie.spec.ts`

`.msg` is een OLE/CFBF-compound-document. De vaste header-signature (eerste 8 bytes van elk CFBF-bestand, ongeacht inhoud) is `D0 CF 11 E0 A1 B1 1A E1`. Dit is exact hetzelfde soort byte-exacte signature als PDF/PNG al gebruiken — geen afhankelijkheid van het beweerde type nodig.

- [ ] **Step 1: Schrijf de falende tests eerst**

Voeg toe aan `src/vendor/vendor-engagement-bestand-validatie.spec.ts`, na de bestaande `PNG_HEADER`-constante (regel 8-10):

```typescript
// .msg is een OLE/CFBF-compound-document; vaste header, ongeacht inhoud.
const MSG_HEADER = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);
```

Voeg toe binnen de `describe('valideerEngagementBestand', ...)`-blok, na de bestaande XLSX-test (na regel 45, vóór de "weigert een ZIP-signature"-test):

```typescript
  it('accepteert een .msg-bestand op basis van de signature, ongeacht beweerd type', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.concat([MSG_HEADER, Buffer.from('rest')]),
      'application/octet-stream',
    );
    expect(resultaat).toEqual({
      geldig: true,
      contentType: 'application/vnd.ms-outlook',
      sha256: expect.any(String),
    });
  });

  it('accepteert een .msg-bestand zonder enig beweerd type', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.concat([MSG_HEADER, Buffer.from('rest')]),
    );
    expect(resultaat.geldig).toBe(true);
  });

  it('weigert een .msg-signature met een expliciet verkeerd beweerd type', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.concat([MSG_HEADER, Buffer.from('rest')]),
      'application/pdf',
    );
    expect(resultaat).toEqual({
      geldig: false,
      reden: 'type-komt-niet-overeen',
    });
  });
```

- [ ] **Step 2: Run de tests, verwacht een falen**

Run: `npx jest src/vendor/vendor-engagement-bestand-validatie.spec.ts -t "msg"`
Expected: FAIL — `.msg`-signature wordt nog niet herkend, valt terug op `onbekend-type`.

- [ ] **Step 3: Werk de validatielogica bij**

In `src/vendor/vendor-engagement-bestand-validatie.ts`, voeg de `.msg`-signature toe aan `HANDTEKENINGEN` (regel 29-38):

```typescript
const HANDTEKENINGEN = [
  {
    contentType: 'application/pdf',
    bytes: [0x25, 0x50, 0x44, 0x46, 0x2d],
  },
  {
    contentType: 'image/png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  {
    // .msg (Outlook-bericht): OLE/CFBF-compound-document, vaste header
    // ongeacht inhoud — zelfde soort byte-exacte herkenning als PDF/PNG.
    contentType: 'application/vnd.ms-outlook',
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  },
] as const satisfies readonly BestandHandtekening<string>[];
```

De bestaande `detecteerContentType()`-aanroep (regel 105) handelt dit automatisch af — geen verdere wijziging nodig in de functie zelf voor `.msg`, want het volgt exact het bestaande PDF/PNG-pad (signature-detectie, met een optionele mismatch-check tegen het beweerde type).

- [ ] **Step 4: Run de tests opnieuw**

Run: `npx jest src/vendor/vendor-engagement-bestand-validatie.spec.ts -t "msg"`
Expected: PASS, alle 3 nieuwe `.msg`-tests groen.

- [ ] **Step 5: Run de volledige testfile ter controle op regressie**

Run: `npx jest src/vendor/vendor-engagement-bestand-validatie.spec.ts`
Expected: alle tests slagen, inclusief de bestaande PDF/PNG/DOCX/XLSX-gevallen.

- [ ] **Step 6: Commit**

```powershell
git add src/vendor/vendor-engagement-bestand-validatie.ts src/vendor/vendor-engagement-bestand-validatie.spec.ts
git commit -m "feat(vendor): .msg-bijlage herkennen op CFBF-signature"
```

---

## Task 3: Validatielogica — `.eml` herkennen op RFC822-headerpatroon

**Files:**
- Modify: `src/vendor/vendor-engagement-bestand-validatie.ts`
- Test: `src/vendor/vendor-engagement-bestand-validatie.spec.ts`

`.eml` heeft geen vaste byte-signature (het is platte tekst). De bestaande `detecteerContentType()`-mechaniek (in `src/survey/bestand-validatie.ts`) werkt uitsluitend met vaste byte-reeksen op offset 0 en is niet geschikt voor een patroonmatige tekst-detectie. `.eml` krijgt daarom een eigen, kleine detectiefunctie binnen dit bestand, apart van de gedeelde signature-mechaniek — net zoals de ZIP/OOXML-aanpak al een eigen stuk logica is naast de gedeelde `detecteerContentType()`.

- [ ] **Step 1: Schrijf de falende tests eerst**

Voeg toe aan `src/vendor/vendor-engagement-bestand-validatie.spec.ts`, na de `MSG_HEADER`-constante toegevoegd in Task 2:

```typescript
// .eml heeft geen vaste byte-signature — herkenning via een RFC822-
// headerregel aan het begin van het bestand.
const EML_VOORBEELD = Buffer.from(
  'From: afzender@voorbeeld.nl\r\n' +
    'To: ontvanger@voorbeeld.nl\r\n' +
    'Subject: Testmail\r\n' +
    'Date: Tue, 6 Oct 2026 10:00:00 +0200\r\n' +
    '\r\n' +
    'Inhoud van de mail.',
  'utf-8',
);
```

Voeg toe binnen de `describe`-blok, na de in Task 2 toegevoegde `.msg`-tests:

```typescript
  it('accepteert een .eml-bestand op basis van het RFC822-headerpatroon', () => {
    const resultaat = valideerEngagementBestand(
      EML_VOORBEELD,
      'message/rfc822',
    );
    expect(resultaat).toEqual({
      geldig: true,
      contentType: 'message/rfc822',
      sha256: expect.any(String),
    });
  });

  it('accepteert een .eml-bestand zonder beweerd type', () => {
    const resultaat = valideerEngagementBestand(EML_VOORBEELD);
    expect(resultaat.geldig).toBe(true);
  });

  it('accepteert een .eml-bestand dat begint met Return-Path', () => {
    const metReturnPath = Buffer.from(
      'Return-Path: <afzender@voorbeeld.nl>\r\n' +
        'From: afzender@voorbeeld.nl\r\n' +
        'Subject: Testmail\r\n\r\nInhoud.',
      'utf-8',
    );
    const resultaat = valideerEngagementBestand(metReturnPath);
    expect(resultaat.geldig).toBe(true);
  });

  it('weigert platte tekst die niet op een RFC822-header lijkt', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.from('Dit is gewoon een tekstbestand, geen mail.'),
    );
    expect(resultaat).toEqual({ geldig: false, reden: 'onbekend-type' });
  });
```

- [ ] **Step 2: Run de tests, verwacht een falen**

Run: `npx jest src/vendor/vendor-engagement-bestand-validatie.spec.ts -t "eml"`
Expected: FAIL — `.eml`-herkenning bestaat nog niet.

- [ ] **Step 3: Werk de validatielogica bij**

In `src/vendor/vendor-engagement-bestand-validatie.ts`, voeg een eigen detectiefunctie toe na de `OOXML_TYPES`-constante (na regel 43):

```typescript
/**
 * .eml heeft geen vaste byte-signature (platte RFC822-tekst), dus geen
 * entry in HANDTEKENINGEN — dat mechanisme werkt alleen met vaste bytes op
 * offset 0. In plaats daarvan: de eerste regel moet een herkenbare
 * RFC822-headernaam zijn. Bewust een kleine, vaste lijst — een losse
 * "staat er een dubbele punt in de eerste regel"-check zou te veel
 * gewone tekstbestanden ten onrechte doorlaten.
 */
const EML_HEADER_PREFIXEN = [
  'Return-Path:',
  'Received:',
  'From:',
  'Date:',
  'Message-ID:',
  'Message-Id:',
] as const;

function lijktOpEml(inhoud: Buffer): boolean {
  // Alleen de eerste regel bekijken (tot de eerste \n, of de eerste 200
  // bytes als er geen regeleinde is) — een mailbestand begint met een
  // header, niet ergens middenin.
  const eersteRegelEind = inhoud.indexOf(0x0a);
  const grens = eersteRegelEind === -1 ? Math.min(inhoud.length, 200) : eersteRegelEind;
  const eersteRegel = inhoud.subarray(0, grens).toString('utf-8');

  return EML_HEADER_PREFIXEN.some((prefix) => eersteRegel.startsWith(prefix));
}
```

Werk `ToegestaanEngagementContentType` bij (regel 45-46) zodat `message/rfc822` een geldige waarde is:

```typescript
export type ToegestaanEngagementContentType =
  | (typeof HANDTEKENINGEN)[number]['contentType']
  | (typeof OOXML_TYPES)[number]
  | 'message/rfc822';
```

Werk `valideerEngagementBestand()` bij: voeg de `.eml`-check toe vóór de `isZip`-check (vlak na de grootte-check, vóór regel 83 `const isZip = ...`):

```typescript
  if (lijktOpEml(inhoud)) {
    if (beweerdType !== undefined && beweerdType !== 'message/rfc822') {
      return { geldig: false, reden: 'type-komt-niet-overeen' };
    }

    return {
      geldig: true,
      contentType: 'message/rfc822',
      sha256: createHash('sha256').update(inhoud).digest('hex'),
    };
  }

  const isZip =
```

**Let op:** deze check moet vóór de ZIP-check staan, niet erna — een `.eml`-bestand heeft geen ZIP-signature, dus de volgorde zelf voorkomt interferentie, maar expliciet vooraan houdt de functie leesbaar in dezelfde volgorde als de typen in de tabel staan (PDF/PNG/MSG via signature, dan EML via headerpatroon, dan ZIP/OOXML via signature+beweerd-type).

- [ ] **Step 4: Run de tests opnieuw**

Run: `npx jest src/vendor/vendor-engagement-bestand-validatie.spec.ts -t "eml"`
Expected: PASS, alle 4 nieuwe `.eml`-tests groen.

- [ ] **Step 5: Run de volledige testfile**

Run: `npx jest src/vendor/vendor-engagement-bestand-validatie.spec.ts`
Expected: alle tests slagen — bestaand gedrag (PDF/PNG/DOCX/XLSX) ongewijzigd, nieuwe `.msg`/`.eml`-gevallen groen.

- [ ] **Step 6: Commit**

```powershell
git add src/vendor/vendor-engagement-bestand-validatie.ts src/vendor/vendor-engagement-bestand-validatie.spec.ts
git commit -m "feat(vendor): .eml-bijlage herkennen op RFC822-headerpatroon"
```

---

## Task 4: Volledige verificatie

**Files:** geen wijzigingen, alleen verificatie.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: geen fouten.

- [ ] **Step 2: Volledige verify**

Run: `npm run verify:volledig`
Expected: alles groen (format, lint, typecheck, unit- en e2e-tests, schema-conformiteit).

- [ ] **Step 3: Bij een falende stap**

Volg `docs/runbooks/commandos-en-omgeving.md` §"Bij een falende test of onverwacht resultaat" vóór een nieuwe diagnose-aanpak.

---

## Wat dit plan bewust niet doet

- **Geen frontend-wijziging.** Er is geen `accept=`-attribuut op de bestaande upload-input (geverifieerd: geen match in `MCM2-frontend/src/app/beheer/leveranciers/[id]/`), dus `.msg`/`.eml` kunnen zonder frontend-wijziging al geselecteerd en geüpload worden zodra de backend ze accepteert. Een UI-tekstupdate ("welke bestandstypen worden ondersteund") is een optionele, latere losse taak in de MCM2-frontend-repo, niet onderdeel van dit plan.
- **Geen inline preview van `.msg`/`.eml`-bijlagen.** Consistent met de bestaande, bewuste keuze voor alle bijlagetypen (design-spec `2026-09-24-vendor-dossiers-design.md`, regel 199-203: downloadlink, geen viewer).
- **Geen wijziging aan de survey-bijlage-validatie** (`src/survey/bestand-validatie.ts`). Dat is een bewust gescheiden beleidsmodule voor een ander doel (leveranciersportaal-uploads), zie het bestaande commentaar in `vendor-engagement-bestand-validatie.ts:11-18`.
- **Geen synopsis/toelichting-veld.** Dat deel van issue #230 is een werkafspraak (titelveld als synopsis gebruiken), geen codewijziging — niet onderdeel van dit plan.
