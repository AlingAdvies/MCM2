# Vendor-dossier notities — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voeg een verplicht, bewerkbaar notitieveld toe aan vendor-dossiers (engagements), zodat de kern/status van een dossier in één oogopslag zichtbaar is zonder een bijlage te moeten openen.

**Architecture:** Nieuwe append-only tabel `clm.vendor_engagement_note` (zelfde patroon als `clm.response_note`/`clm.survey_review`), met een verplichte notitie bij het aanmaken van een dossier en een route om later een nieuwe notitie toe te voegen of een notitie in te trekken (soft-delete). De service geeft per dossier alleen de meest recente, niet-ingetrokken notitie mee als `laatsteNotitie`. Frontend: notitieveld in het aanmaakformulier (verplicht, max. 500 tekens) en een "notitie toevoegen"-actie + weergave van de laatste notitie per dossier-rij.

**Tech Stack:** NestJS, Drizzle (handgeschreven SQL-migraties), Postgres/RLS, Next.js/React, Playwright, Jest.

**Referentie:** `docs/superpowers/specs/2026-09-25-vendor-dossier-notities-design.md` (design), `docs/superpowers/specs/2026-09-24-vendor-dossiers-design.md` (oorspronkelijke feature), `docs/superpowers/plans/2026-09-24-vendor-dossiers.md` (oorspronkelijk plan — zelfde patronen).

**Branch:** werk door op `feat/vendor-engagement-dossiers` (beide repo's) — deze aanvulling hoort bij dezelfde, nog niet gemergede feature.

---

### Task 1: Migratie `clm.vendor_engagement_note`

**Files:**
- Create: `drizzle/0043_vendor_engagement_note.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================================
-- clm.vendor_engagement_note — notities bij een vendor-dossier.
--
-- Append-only, zelfde patroon als clm.survey_review: elke notitie is een
-- eigen rij, nooit een UPDATE van bestaande tekst. Een notitie-kolom
-- rechtstreeks op vendor_engagement zou bij wijzigen de vorige tekst
-- onherroepelijk overschrijven -- juist bij "wat was de status vorige week"
-- is dat de vraag die later komt. Zie
-- docs/superpowers/specs/2026-09-25-vendor-dossier-notities-design.md.
--
-- De service geeft nu alleen de meest recente, niet-ingetrokken notitie mee
-- (laatsteNotitie) -- oudere notities liggen al klaar in de tabel voor een
-- latere geschiedenis-UI, zonder nieuwe migratie.
-- =============================================================================

CREATE TABLE "clm"."vendor_engagement_note" (
	"note_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tekst" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement_note"
    ADD CONSTRAINT "vendor_engagement_note_engagement_id_fk"
    FOREIGN KEY ("engagement_id") REFERENCES "clm"."vendor_engagement"("engagement_id")
    ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement_note"
    ADD CONSTRAINT "vendor_engagement_note_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement_note"
    ADD CONSTRAINT "vendor_engagement_note_created_by_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "clm"."user"("user_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Zelfde grens als InvoerFout-validatie in vendor-engagement-invoer.ts.
ALTER TABLE "clm"."vendor_engagement_note"
    ADD CONSTRAINT "vendor_engagement_note_tekst_check"
    CHECK (char_length(tekst) > 0 AND char_length(tekst) <= 500);--> statement-breakpoint

CREATE INDEX "vendor_engagement_note_tenant_id_idx"
    ON "clm"."vendor_engagement_note" USING btree ("tenant_id");--> statement-breakpoint

CREATE INDEX "vendor_engagement_note_engagement_id_idx"
    ON "clm"."vendor_engagement_note" USING btree ("engagement_id");--> statement-breakpoint

ALTER TABLE clm.vendor_engagement_note ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.vendor_engagement_note FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY vendor_engagement_note_isolation ON clm.vendor_engagement_note
    USING (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    )
    WITH CHECK (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    );--> statement-breakpoint

COMMENT ON TABLE clm.vendor_engagement_note IS
    'Notities bij een vendor-dossier. Append-only, intrekken via deleted_at. De service toont alleen de meest recente, niet-ingetrokken notitie.';--> statement-breakpoint

-- REVOKE ALL vóór de GRANT: zelfde reden als migratie 0040/0041/0042 — de
-- default-ACL (migratie 0001) geeft anders ook DELETE mee op een verse
-- database, in weerspraak met "een notitie verdwijnt niet, wordt zacht
-- verwijderd".
REVOKE ALL ON clm.vendor_engagement_note FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON clm.vendor_engagement_note TO clm_api, clm_admin;
```

- [ ] **Step 2: Voeg de migratie toe aan `drizzle/meta/_journal.json`**

Voeg na de entry met `"idx": 42` (tag `0042_vendor_engagement_attachment`, `"when": 1787068800016`) toe:

```json
    {
      "idx": 43,
      "version": "7",
      "when": 1787068800017,
      "tag": "0043_vendor_engagement_note",
      "breakpoints": true
    }
```

Let op: dit moet vóór de afsluitende `]` en `}` van het bestand komen, met een komma na de vorige entry.

- [ ] **Step 3: Zet een wegwerpdatabase op en verifieer de migratie**

Run: `npm run test:db -- "vendor-dossier-notities migratie"`

Exporteer de getoonde `MIGRATION_DATABASE_URL`/`DATABASE_URL` en controleer:

```sql
SELECT grantee, privilege_type FROM information_schema.role_table_grants
 WHERE table_schema='clm' AND table_name='vendor_engagement_note';
```

Expected: `clm_api` en `clm_admin` hebben SELECT/INSERT/UPDATE, geen DELETE. Geen `clm_readonly`-rij.

- [ ] **Step 4: Commit**

```bash
git add drizzle/0043_vendor_engagement_note.sql drizzle/meta/_journal.json
git commit -m "feat(vendor-dossiers): migratie clm.vendor_engagement_note"
```

---

### Task 2: Schema, rechten-contract, opruimen, test-ids

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/rechten-contract.ts`
- Modify: `test/opruimen.ts`
- Modify: `test/test-ids.ts`

- [ ] **Step 1: Voeg `vendorEngagementNote` toe aan `src/db/schema.ts`**

Plaats na het `vendorEngagementAttachment`-blok (na de sluitende `);` van dat table-blok, vóór de `export const vendorEngagementRelations`-sectie als die er is, of anders direct na de tabel-definitie):

```typescript
// clm.vendor_engagement_note (0043): append-only notities bij een dossier —
// nooit een UPDATE van bestaande tekst, alleen nieuwe rijen + deleted_at.
export const vendorEngagementNote = clm.table(
  'vendor_engagement_note',
  {
    noteId: uuid('note_id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => vendorEngagement.engagementId, {
        onDelete: 'cascade',
      }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    tekst: text('tekst').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => user.userId, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('vendor_engagement_note_tenant_id_idx').on(t.tenantId),
    index('vendor_engagement_note_engagement_id_idx').on(t.engagementId),
  ],
);
```

Voeg de bijbehorende relations toe, direct na `vendorEngagementAttachmentRelations`:

```typescript
export const vendorEngagementNoteRelations = relations(
  vendorEngagementNote,
  ({ one }) => ({
    engagement: one(vendorEngagement, {
      fields: [vendorEngagementNote.engagementId],
      references: [vendorEngagement.engagementId],
    }),
  }),
);
```

- [ ] **Step 2: `src/db/rechten-contract.ts`**

Voeg toe, direct na de `'clm.vendor_engagement_attachment': NIET_VERWIJDEREN,`-regel:

```typescript
  // clm.vendor_engagement_note (0043): append-only, zelfde patroon als
  // vendor_engagement_attachment.
  'clm.vendor_engagement_note': NIET_VERWIJDEREN,
```

- [ ] **Step 3: `test/opruimen.ts`**

Voeg `'clm.vendor_engagement_note',` toe aan `TABELLEN_IN_VOLGORDE`, vóór `'clm.vendor_engagement_attachment',` (child-tabellen eerst, en `vendor_engagement_note` heeft geen eigen children).

- [ ] **Step 4: `test/test-ids.ts`**

Voeg na het bestaande `vendorEngagementBijlagen`-blok (dat eindigt op tail `5e`) een nieuw blok toe met tails `5f`/`60`/`61` (geverifieerd vrij):

```typescript
  vendorEngagementNotities: {
    tenantA: '00000000-0000-0000-0000-00000000005f',
    adminA: '00000000-0000-0000-0000-000000000060',
    vendorA: '00000000-0000-0000-0000-000000000061',
  },
```

- [ ] **Step 5: Verifieer geen dubbele tails en de rechten-contract-test**

Run: `npx jest test-ids`
Expected: PASS, geen dubbele tail gemeld.

Run (met de wegwerpdatabase uit Task 1, `--hergebruik`): `npm run test:db -- "rechten-contract" --hergebruik` en daarna de rechten-contract-e2e-suite (zie `npm run` scripts voor de exacte testcommando-naam, bijv. `npx jest rechten-contract --config ...` — check `package.json` voor het exacte commando in deze repo vóór je het uitvoert).

Expected: PASS — `clm.vendor_engagement_note` is bekend in zowel `schema-inventory.ts` (afgeleid van `schema.ts`) als `rechten-contract.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/rechten-contract.ts test/opruimen.ts test/test-ids.ts
git commit -m "feat(vendor-dossiers): schema/rechten/opruimen/test-ids voor vendor_engagement_note"
```

---

### Task 3: Invoervalidatie voor de notitietekst

**Files:**
- Modify: `src/vendor/vendor-engagement-invoer.ts`
- Test: geen apart unit-testbestand — gedekt door de e2e-suite in Task 5 (consistent met hoe `leesNieuwEngagement` nu ook alleen e2e-gedekt is).

- [ ] **Step 1: Voeg een `MAX_NOTITIE`-constante en notitie-validatie toe**

Wijzig de top van `src/vendor/vendor-engagement-invoer.ts`:

```typescript
import type { LinkType } from './vendor-engagement.service';

const MAX_TITEL = 300;
const MAX_NOTITIE = 500;
```

Voeg een helper toe, na `isUuid`:

```typescript
function leesNotitieTekst(waarde: unknown): string {
  if (
    typeof waarde !== 'string' ||
    waarde.trim() === '' ||
    waarde.length > MAX_NOTITIE
  ) {
    throw new InvoerFout(
      'notitieTekst',
      `notitieTekst is verplicht en mag maximaal ${MAX_NOTITIE} tekens zijn.`,
    );
  }
  return waarde.trim();
}
```

- [ ] **Step 2: Breid `NieuwEngagementInvoer` en `leesNieuwEngagement` uit**

Wijzig de interface:

```typescript
export interface NieuwEngagementInvoer {
  titel: string;
  notitieTekst: string;
  links: ReadonlyArray<{ linkType: LinkType; linkedId: string }>;
}
```

Wijzig `leesNieuwEngagement` — voeg vóór de `return`-statement toe:

```typescript
  const notitieTekst = leesNotitieTekst(obj.notitieTekst);
```

En wijzig de return:

```typescript
  return { titel: obj.titel.trim(), notitieTekst, links };
```

- [ ] **Step 3: Voeg een `leesNieuweNotitie`-functie toe voor de nieuwe route**

Voeg toe aan het einde van het bestand:

```typescript
export function leesNieuweNotitie(body: unknown): { tekst: string } {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Ongeldige invoer.');
  }

  const obj = body as Record<string, unknown>;
  return { tekst: leesNotitieTekst(obj.tekst) };
}
```

- [ ] **Step 4: Compileer**

Run: `npx tsc --noEmit`
Expected: geen fouten (de aanroepende service/controller worden pas in Task 4 aangepast — dit compileert al standalone omdat het bestand geen andere afhankelijkheden heeft die nu breken; als `tsc` hier al klaagt over `vendor-engagement.service.ts`/`vendor-engagement.controller.ts` die nog de oude 2-argumenten-vorm van `aanmaken` gebruiken, is dat verwacht en lost Task 4 dat op — noteer het en ga door).

- [ ] **Step 5: Commit**

```bash
git add src/vendor/vendor-engagement-invoer.ts
git commit -m "feat(vendor-dossiers): notitietekst-validatie in invoerlaag"
```

---

### Task 4: Service — notitie bij aanmaken, toevoegen, intrekken, meegeven in lijst

**Files:**
- Modify: `src/vendor/vendor-engagement.service.ts`

- [ ] **Step 1: Breid de types uit**

Wijzig de `Engagement`-interface:

```typescript
export interface EngagementNote {
  noteId: string;
  tekst: string;
  createdByUserId: string;
  createdByNaam: string | null;
  createdAt: string;
}

export interface Engagement {
  engagementId: string;
  vendorId: string;
  titel: string;
  createdByUserId: string;
  createdByNaam: string | null;
  createdAt: string;
  laatsteNotitie: EngagementNote | null;
  links: EngagementLink[];
  attachments: EngagementAttachment[];
}
```

Voeg een rij-interface toe, na `AttachmentRij`:

```typescript
interface NoteRij extends Record<string, unknown> {
  note_id: string;
  engagement_id: string;
  tekst: string;
  created_by_user_id: string;
  created_by_naam: string | null;
  created_at: Date | string;
}
```

- [ ] **Step 2: Wijzig `lijstVoorVendor` om de laatste notitie mee te geven**

Voeg, na het ophalen van `attachments` en vóór de `return engagements.rows.map(...)`, een query toe:

```typescript
        const notes = await tx.execute<NoteRij>(
          sql`SELECT n.note_id,
                     n.engagement_id,
                     n.tekst,
                     n.created_by_user_id,
                     u.full_name AS created_by_naam,
                     n.created_at
                FROM clm.vendor_engagement_note n
                LEFT JOIN clm."user" u ON u.user_id = n.created_by_user_id
               WHERE n.engagement_id = ANY(${sql.param(ids)}::uuid[])
                 AND n.deleted_at IS NULL
               ORDER BY n.created_at DESC`,
        );
```

Wijzig de return-regel:

```typescript
        return engagements.rows.map((r) =>
          this.naarEngagement(r, links.rows, attachments.rows, notes.rows),
        );
```

- [ ] **Step 3: Wijzig `naarEngagement` om de laatste notitie te selecteren**

```typescript
  private naarEngagement(
    r: EngagementRij,
    alleLinks: LinkRij[],
    alleAttachments: AttachmentRij[],
    alleNotes: NoteRij[],
  ): Engagement {
    const notesVanDitEngagement = alleNotes.filter(
      (n) => n.engagement_id === r.engagement_id,
    );
    const laatste = notesVanDitEngagement[0] ?? null;

    return {
      engagementId: r.engagement_id,
      vendorId: r.vendor_id,
      titel: r.titel,
      createdByUserId: r.created_by_user_id,
      createdByNaam: r.created_by_naam,
      createdAt: iso(r.created_at),
      laatsteNotitie: laatste
        ? {
            noteId: laatste.note_id,
            tekst: laatste.tekst,
            createdByUserId: laatste.created_by_user_id,
            createdByNaam: laatste.created_by_naam,
            createdAt: iso(laatste.created_at),
          }
        : null,
      links: alleLinks
        .filter((l) => l.engagement_id === r.engagement_id)
        .map((l) => ({
          linkId: l.link_id,
          linkType: l.link_type as LinkType,
          linkedId: l.linked_id,
        })),
      attachments: alleAttachments
        .filter((a) => a.engagement_id === r.engagement_id)
        .map((a) => this.naarAttachment(a)),
    };
  }
```

Let op: `notesVanDitEngagement[0]` is de nieuwste omdat de query in Step 2 al op `created_at DESC` sorteert — dit is per-engagement geldig omdat de query niet per engagement maar over alle `ids` in één keer sorteert; het `.filter(...)` behoudt de relatieve volgorde uit het brongebied, dus `[0]` na filteren is nog steeds de nieuwste van dát engagement.

- [ ] **Step 4: Wijzig `aanmaken` om een verplichte notitie te schrijven**

Wijzig de signatuur en body:

```typescript
  async aanmaken(
    tenantId: string,
    vendorId: string,
    createdByUserId: string,
    titel: string,
    notitieTekst: string,
    initieleLinks: ReadonlyArray<{ linkType: LinkType; linkedId: string }>,
  ): Promise<Engagement> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandeVendor(tx, vendorId);

        for (const link of initieleLinks) {
          await this.eisBestaandLinkDoel(tx, link.linkType, link.linkedId);
        }

        const resultaat = await tx.execute<EngagementRij>(
          sql`WITH nieuw AS (
                INSERT INTO clm.vendor_engagement
                       (tenant_id, vendor_id, titel, created_by_user_id)
                VALUES (${tenantId}, ${vendorId}, ${titel}, ${createdByUserId})
                RETURNING engagement_id, vendor_id, titel, created_by_user_id, created_at
              )
              SELECT n.engagement_id,
                     n.vendor_id,
                     n.titel,
                     n.created_by_user_id,
                     u.full_name AS created_by_naam,
                     n.created_at
                FROM nieuw n
                LEFT JOIN clm."user" u ON u.user_id = n.created_by_user_id`,
        );

        const rij = resultaat.rows[0];
        if (!rij) {
          throw new BadRequestException(
            'Het dossier kon niet worden aangemaakt.',
          );
        }

        const noteResultaat = await tx.execute<NoteRij>(
          sql`WITH nieuw AS (
                INSERT INTO clm.vendor_engagement_note
                       (engagement_id, tenant_id, tekst, created_by_user_id)
                VALUES (${rij.engagement_id}, ${tenantId}, ${notitieTekst}, ${createdByUserId})
                RETURNING note_id, engagement_id, tekst, created_by_user_id, created_at
              )
              SELECT n.note_id,
                     n.engagement_id,
                     n.tekst,
                     n.created_by_user_id,
                     u.full_name AS created_by_naam,
                     n.created_at
                FROM nieuw n
                LEFT JOIN clm."user" u ON u.user_id = n.created_by_user_id`,
        );

        for (const link of initieleLinks) {
          await tx.execute(
            sql`INSERT INTO clm.vendor_engagement_link
                       (engagement_id, tenant_id, link_type, linked_id)
                VALUES (${rij.engagement_id}, ${tenantId}, ${link.linkType}, ${link.linkedId})`,
          );
        }

        const links = await tx.execute<LinkRij>(
          sql`SELECT link_id, engagement_id, link_type, linked_id
                FROM clm.vendor_engagement_link
               WHERE engagement_id = ${rij.engagement_id}`,
        );

        return this.naarEngagement(rij, links.rows, [], noteResultaat.rows);
      },
      'medewerker',
    );
  }
```

- [ ] **Step 5: Voeg `notitieToevoegen` en `notitieIntrekken` toe**

Voeg toe, direct na `linkToevoegen`:

```typescript
  /** Voegt een nieuwe notitie toe aan een bestaand engagement — nooit een UPDATE van een bestaande. */
  async notitieToevoegen(
    tenantId: string,
    engagementId: string,
    createdByUserId: string,
    tekst: string,
  ): Promise<EngagementNote> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandEngagement(tx, engagementId);

        const resultaat = await tx.execute<NoteRij>(
          sql`WITH nieuw AS (
                INSERT INTO clm.vendor_engagement_note
                       (engagement_id, tenant_id, tekst, created_by_user_id)
                VALUES (${engagementId}, ${tenantId}, ${tekst}, ${createdByUserId})
                RETURNING note_id, engagement_id, tekst, created_by_user_id, created_at
              )
              SELECT n.note_id,
                     n.engagement_id,
                     n.tekst,
                     n.created_by_user_id,
                     u.full_name AS created_by_naam,
                     n.created_at
                FROM nieuw n
                LEFT JOIN clm."user" u ON u.user_id = n.created_by_user_id`,
        );

        const rij = resultaat.rows[0];
        if (!rij) {
          throw new BadRequestException(
            'De notitie kon niet worden opgeslagen.',
          );
        }

        return {
          noteId: rij.note_id,
          tekst: rij.tekst,
          createdByUserId: rij.created_by_user_id,
          createdByNaam: rij.created_by_naam,
          createdAt: iso(rij.created_at),
        };
      },
      'medewerker',
    );
  }

  async notitieIntrekken(
    tenantId: string,
    engagementId: string,
    noteId: string,
  ): Promise<void> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const geraakt = await tx.execute(
          sql`UPDATE clm.vendor_engagement_note
                 SET deleted_at = now()
               WHERE note_id = ${noteId}
                 AND engagement_id = ${engagementId}
                 AND deleted_at IS NULL`,
        );

        if (geraakt.rowCount === 0) {
          throw new NotFoundException(
            'Deze notitie bestaat niet, of is al ingetrokken.',
          );
        }
      },
      'medewerker',
    );
  }
```

- [ ] **Step 6: Compileer**

Run: `npx tsc --noEmit`
Expected: fouten in `vendor-engagement.controller.ts` (nog oude signatuur `aanmaken(...)`-aanroep zonder `notitieTekst`) — dat is verwacht, Task 5 lost dat op.

- [ ] **Step 7: Commit**

```bash
git add src/vendor/vendor-engagement.service.ts
git commit -m "feat(vendor-dossiers): notitie bij aanmaken, toevoegen en intrekken in VendorEngagementService"
```

---

### Task 5: Controller — routes voor notitie toevoegen/intrekken, aanmaken bijwerken

**Files:**
- Modify: `src/vendor/vendor-engagement.controller.ts`

- [ ] **Step 1: Werk de import bij**

```typescript
import {
  InvoerFout,
  leesNieuwEngagement,
  leesNieuweLink,
  leesNieuweNotitie,
} from './vendor-engagement-invoer';
```

- [ ] **Step 2: Werk `aanmaken` bij om de notitietekst door te geven**

```typescript
  @Post('vendors/:vendorId/engagements')
  @VereistRol('admin', 'user')
  @HttpCode(201)
  async aanmaken(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: ReturnType<typeof leesNieuwEngagement>;
    try {
      invoer = leesNieuwEngagement(body);
    } catch (err) {
      throw this.naarHttpFout(err);
    }

    const engagement = await this.engagements.aanmaken(
      sessie.tenantId,
      vendorId,
      sessie.userId,
      invoer.titel,
      invoer.notitieTekst,
      invoer.links,
    );

    return { engagement };
  }
```

- [ ] **Step 3: Voeg de twee nieuwe routes toe**

Voeg toe, direct na de `linkToevoegen`-route:

```typescript
  @Post('engagements/:id/notes')
  @VereistRol('admin', 'user')
  @HttpCode(201)
  async notitieToevoegen(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: ReturnType<typeof leesNieuweNotitie>;
    try {
      invoer = leesNieuweNotitie(body);
    } catch (err) {
      throw this.naarHttpFout(err);
    }

    const note = await this.engagements.notitieToevoegen(
      sessie.tenantId,
      id,
      sessie.userId,
      invoer.tekst,
    );

    return { note };
  }

  @Delete('engagements/:id/notes/:noteId')
  @VereistRol('admin', 'user')
  @HttpCode(204)
  async notitieIntrekken(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Param('noteId') noteId: string,
  ) {
    const sessie = request.sessie!;
    await this.engagements.notitieIntrekken(sessie.tenantId, id, noteId);
  }
```

- [ ] **Step 4: Compileer**

Run: `npx tsc --noEmit`
Expected: geen fouten.

- [ ] **Step 5: Commit**

```bash
git add src/vendor/vendor-engagement.controller.ts
git commit -m "feat(vendor-dossiers): routes voor notitie toevoegen/intrekken, aanmaken vereist notitie"
```

---

### Task 6: Backend e2e — notities

**Files:**
- Modify: `test/vendor-engagements.e2e-spec.ts` (bestaande `aanmaken`-aanroepen in de body moeten `notitieTekst` meesturen, anders falen ze nu op de nieuwe verplichting)
- Create: `test/vendor-engagement-notities.e2e-spec.ts`

- [ ] **Step 1: Repareer de bestaande suite**

Zoek in `test/vendor-engagements.e2e-spec.ts` elke `.post(...)`-aanroep naar `/vendors/${VENDOR_A}/engagements` (of gelijkwaardig) die een body met `{ titel: ... }` stuurt, en voeg `notitieTekst: 'Testnotitie bij aanmaken.'` toe aan elke van die bodies. Doe dit voor **elke** aanmaak-aanroep in het bestand — zoek met:

```bash
grep -n "titel:" test/vendor-engagements.e2e-spec.ts
```

en werk elke gevonden regel bij zodat de omvattende object-literal ook `notitieTekst` heeft. Voeg geen nieuwe test toe in dit bestand — dat komt in het nieuwe bestand.

- [ ] **Step 2: Draai de bestaande suite om de reparatie te bevestigen**

Run (met wegwerpdatabase uit Task 1/2 actief): `npx jest vendor-engagements.e2e-spec --config test/jest-e2e.json` (of het exacte e2e-testcommando uit `package.json` — controleer eerst met `(Get-Content package.json | ConvertFrom-Json).scripts` welk commando de e2e-suites echt draait, verzin het niet).

Expected: alle 14 bestaande tests slagen weer.

- [ ] **Step 3: Schrijf de nieuwe suite**

Create `test/vendor-engagement-notities.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { cookieInstellingen } from '../src/auth/sessie';
import { SessieService } from '../src/auth/sessie.service';
import { TEST_IDS } from './test-ids';
import { verwijderTestdata } from './opruimen';

/**
 * Vendor-dossier-notities — migratie 0043.
 *
 * Wat hier kan stuk gaan zonder dat het opvalt:
 *   1. Weigert aanmaken zonder notitie (nieuw verplicht veld)?
 *   2. Verschijnt een later toegevoegde notitie als laatsteNotitie?
 *   3. Valt na intrekken van de laatste notitie terug op de voorlaatste?
 *   4. Blijft de auteur uit de sessie, nooit uit de body?
 */

const {
  tenantA,
  adminA: ADMIN_A,
  vendorA: VENDOR_A,
} = TEST_IDS.vendorEngagementNotities;

const SUBJECT_ADMIN = `oid-ven-a-${Date.now()}`;

interface EngagementBody {
  engagement: {
    engagementId: string;
    laatsteNotitie: {
      noteId: string;
      tekst: string;
      createdByUserId: string;
      createdByNaam: string | null;
      createdAt: string;
    } | null;
  };
}

interface NoteBody {
  note: {
    noteId: string;
    tekst: string;
  };
}

describe('Vendor-dossier-notities (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdminA: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(tenantA);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);

    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantA, 'Tenant A (engagement-notities)'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, email, full_name, external_subject)
       VALUES ($1, $2, $3, 'Admin van A', $4)`,
      [ADMIN_A, tenantA, `${SUBJECT_ADMIN}@voorbeeld.nl`, SUBJECT_ADMIN],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [ADMIN_A, tenantA],
    );
    await client.query(
      `INSERT INTO clm.vendor (vendor_id, tenant_id, name) VALUES ($1, $2, $3)`,
      [VENDOR_A, tenantA, 'Leverancier van A (notities)'],
    );
    await client.query('COMMIT');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    const sessies = app.get(SessieService);
    const sessieAdminA = await sessies.maak({
      userId: ADMIN_A,
      tenantId: tenantA,
    });
    cookieAdminA = `${cookieInstellingen.naam}=${sessieAdminA.token}`;
  });

  afterAll(async () => {
    await verwijderTestdata(tenantA);
    await client.end();
    await app.close();
  });

  test('weigert aanmaken zonder notitieTekst', async () => {
    const response = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({ titel: 'Dossier zonder notitie' });

    expect(response.status).toBe(400);
  });

  test('maakt een dossier aan met notitie, en toont die als laatsteNotitie', async () => {
    const response = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({
        titel: 'Dossier met notitie',
        notitieTekst: 'Wacht op reactie leverancier.',
      });

    expect(response.status).toBe(201);
    const body = response.body as EngagementBody;
    expect(body.engagement.laatsteNotitie?.tekst).toBe(
      'Wacht op reactie leverancier.',
    );
    expect(body.engagement.laatsteNotitie?.createdByUserId).toBe(ADMIN_A);
  });

  test('voegt een nieuwe notitie toe aan een bestaand dossier, en die wordt de laatste', async () => {
    const aanmaakResponse = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({
        titel: 'Dossier voor notitie-update',
        notitieTekst: 'Eerste status.',
      });

    const engagementId = (aanmaakResponse.body as EngagementBody).engagement
      .engagementId;

    const notitieResponse = await request(server)
      .post(`/engagements/${engagementId}/notes`)
      .set('Cookie', cookieAdminA)
      .send({ tekst: 'Tweede, bijgewerkte status.' });

    expect(notitieResponse.status).toBe(201);

    const lijstResponse = await request(server)
      .get(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA);

    const gevonden = (
      lijstResponse.body as { engagements: EngagementBody['engagement'][] }
    ).engagements.find((e) => e.engagementId === engagementId);

    expect(gevonden?.laatsteNotitie?.tekst).toBe('Tweede, bijgewerkte status.');
  });

  test('valt na intrekken van de laatste notitie terug op de voorlaatste', async () => {
    const aanmaakResponse = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({
        titel: 'Dossier voor terugval-test',
        notitieTekst: 'Status A.',
      });

    const engagementId = (aanmaakResponse.body as EngagementBody).engagement
      .engagementId;

    const tweedeNotitieResponse = await request(server)
      .post(`/engagements/${engagementId}/notes`)
      .set('Cookie', cookieAdminA)
      .send({ tekst: 'Status B.' });

    const tweedeNoteId = (tweedeNotitieResponse.body as NoteBody).note.noteId;

    const intrekResponse = await request(server)
      .delete(`/engagements/${engagementId}/notes/${tweedeNoteId}`)
      .set('Cookie', cookieAdminA);

    expect(intrekResponse.status).toBe(204);

    const lijstResponse = await request(server)
      .get(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA);

    const gevonden = (
      lijstResponse.body as { engagements: EngagementBody['engagement'][] }
    ).engagements.find((e) => e.engagementId === engagementId);

    expect(gevonden?.laatsteNotitie?.tekst).toBe('Status A.');
  });

  test('404 bij intrekken van een al-ingetrokken notitie', async () => {
    const aanmaakResponse = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({
        titel: 'Dossier voor dubbel-intrek-test',
        notitieTekst: 'Status.',
      });

    const engagementId = (aanmaakResponse.body as EngagementBody).engagement
      .engagementId;
    const noteId = (aanmaakResponse.body as EngagementBody).engagement
      .laatsteNotitie!.noteId;

    const eersteIntrek = await request(server)
      .delete(`/engagements/${engagementId}/notes/${noteId}`)
      .set('Cookie', cookieAdminA);
    expect(eersteIntrek.status).toBe(204);

    const tweedeIntrek = await request(server)
      .delete(`/engagements/${engagementId}/notes/${noteId}`)
      .set('Cookie', cookieAdminA);
    expect(tweedeIntrek.status).toBe(404);
  });

  test('weigert een te lange notitietekst (>500 tekens)', async () => {
    const response = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({ titel: 'Dossier met te lange notitie', notitieTekst: 'x'.repeat(501) });

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 4: Draai de nieuwe suite alleen**

Run: hetzelfde e2e-testcommando als Step 2, nu gericht op `vendor-engagement-notities.e2e-spec`.

Expected: alle 6 tests slagen. Als de terugval-test faalt met een verkeerde volgorde: controleer of de `ORDER BY n.created_at DESC`-query in de service (Task 4, Step 2) daadwerkelijk op `created_at` sorteert en niet op insertievolgorde die bij gelijke timestamps kan wisselen — voeg zo nodig een secundaire sortering op `note_id` toe pas als dit zich voordoet, niet preventief.

- [ ] **Step 5: Draai `npx jest test-ids` en de volledige e2e-run**

Run: `npx jest test-ids`
Expected: PASS.

Run: het volledige e2e-testcommando (alle suites, niet los) — zie `package.json`.
Expected: alle suites slagen, inclusief de twee vendor-engagement-suites.

- [ ] **Step 6: Commit**

```bash
git add test/vendor-engagements.e2e-spec.ts test/vendor-engagement-notities.e2e-spec.ts
git commit -m "test(e2e): vendor-dossier-notities - verplicht bij aanmaken, toevoegen, terugval bij intrekken"
```

---

### Task 7: `verify:volledig`

**Files:** geen wijzigingen — alleen verificatie.

- [ ] **Step 1: Draai de volledige verify**

Run: `npm run verify:volledig`

Expected: groen, met dezelfde, al bekende uitzondering als de vorige keer (maintenance-check op `docs/runbooks/backup-verwachting.json`, migratiestand 0039 vs. lokaal nu 0043 — dit blijft bewust ongewijzigd tot na productie-uitrol, zie eerdere afspraak met de eigenaar). Als er een ándere rode stap is: stoppen en de oorzaak onderzoeken vóór verder te gaan — niet aannemen dat het dezelfde bekende uitzondering is.

- [ ] **Step 2: Meld het resultaat**

Geen commit in deze stap — puur verificatie.

---

### Task 8: Frontend — model en service

**Files:**
- Modify: `MCM2-frontend/src/core/models/vendorEngagement.ts`
- Modify: `MCM2-frontend/src/core/services/vendorEngagementService.ts`

- [ ] **Step 1: Breid het model uit**

Wijzig `src/core/models/vendorEngagement.ts`:

```typescript
export interface EngagementNote {
  readonly noteId: string;
  readonly tekst: string;
  readonly createdByUserId: string;
  readonly createdByNaam: string | null;
  readonly createdAt: string;
}

export interface VendorEngagement {
  readonly engagementId: string;
  readonly vendorId: string;
  readonly titel: string;
  readonly createdByUserId: string;
  readonly createdByNaam: string | null;
  readonly createdAt: string;
  readonly laatsteNotitie: EngagementNote | null;
  readonly links: EngagementLink[];
  readonly attachments: EngagementAttachment[];
}

/** Zelfde grens als de CHECK-constraint in migratie 0043. */
export const MAX_NOTITIE_TEKENS = 500;
```

(De bestaande `MAX_BIJLAGEN_PER_ENGAGEMENT`/`MAX_BESTANDSGROOTTE_BYTES`-constanten en `EngagementLink`/`EngagementAttachment`-interfaces blijven ongewijzigd staan.)

- [ ] **Step 2: Breid de service uit**

Voeg toe aan `src/core/services/vendorEngagementService.ts`:

```typescript
export async function maakEngagement(
  vendorId: string,
  titel: string,
  notitieTekst: string,
  links: ReadonlyArray<{ linkType: EngagementLinkType; linkedId: string }>,
): Promise<VendorEngagement> {
  const antwoord = await verstuur<{ engagement: VendorEngagement }>(
    `/vendors/${vendorId}/engagements`,
    { titel, notitieTekst, links },
  );

  return antwoord.engagement;
}
```

(Dit vervangt de bestaande `maakEngagement`-functie — voeg `notitieTekst` toe als derde parameter, vóór `links`.)

Voeg nieuwe functies toe, na `voegLinkToe`:

```typescript
export async function voegNotitieToe(
  engagementId: string,
  tekst: string,
): Promise<void> {
  await verstuur(`/engagements/${engagementId}/notes`, { tekst });
}

export async function trekNotitieIn(
  engagementId: string,
  noteId: string,
): Promise<void> {
  await verwijder(`/engagements/${engagementId}/notes/${noteId}`);
}
```

- [ ] **Step 3: Compileer**

Run: `npx tsc --noEmit`
Expected: fouten in `EngagementPanel.tsx` (nog oude 3-argumenten-aanroep van `maakEngagement`) — verwacht, Task 9 lost dat op.

- [ ] **Step 4: Commit**

```bash
git add src/core/models/vendorEngagement.ts src/core/services/vendorEngagementService.ts
git commit -m "feat(vendor-dossiers): notitie in model en service"
```

---

### Task 9: Frontend — `EngagementPanel` uitbreiden

**Files:**
- Modify: `MCM2-frontend/src/shared/components/EngagementPanel.tsx`

- [ ] **Step 1: Werk de imports bij**

```typescript
import {
  MAX_BESTANDSGROOTTE_BYTES,
  MAX_BIJLAGEN_PER_ENGAGEMENT,
  MAX_NOTITIE_TEKENS,
} from '@/core/models/vendorEngagement';
import {
  bijlageDownloadUrl,
  haalEngagements,
  maakEngagement,
  trekBijlageIn,
  trekEngagementIn,
  trekNotitieIn,
  uploadBijlage,
  voegNotitieToe,
} from '@/core/services/vendorEngagementService';
```

- [ ] **Step 2: Voeg state toe voor het notitieveld in het aanmaakformulier**

Voeg toe, naast de bestaande `titel`-state:

```typescript
  const [notitieTekst, setNotitieTekst] = useState('');
```

En voeg toe, naast de andere per-rij-state voor het "notitie toevoegen"-formulier (nieuw blok state, na `koppelSurvey`):

```typescript
  const [notitieInvoerVoor, setNotitieInvoerVoor] = useState<string | null>(
    null,
  );
  const [nieuweNotitieTekst, setNieuweNotitieTekst] = useState('');
```

- [ ] **Step 3: Wijzig `aanmaken()` om de notitie mee te sturen en te resetten**

```typescript
  async function aanmaken() {
    if (!titel.trim() || !notitieTekst.trim()) return;

    setBezig(true);
    setFout(null);

    try {
      const links: Array<{ linkType: EngagementLinkType; linkedId: string }> =
        [];
      if (koppelContract && contractId) {
        links.push({ linkType: 'contract', linkedId: contractId });
      }
      if (koppelSurvey && responseId) {
        links.push({ linkType: 'survey_response', linkedId: responseId });
      }

      const engagement = await maakEngagement(
        vendorId,
        titel.trim(),
        notitieTekst.trim(),
        links,
      );

      for (const bestand of bestanden) {
        await uploadBijlage(engagement.engagementId, bestand);
      }

      setTitel('');
      setNotitieTekst('');
      setBestanden([]);
      setToonFormulier(false);
      await laad();
    } catch (err) {
      setFout(
        err instanceof ApiFout
          ? err.melding
          : 'Het dossier kon niet worden aangemaakt.',
      );
    } finally {
      setBezig(false);
    }
  }
```

- [ ] **Step 4: Voeg handlers toe voor notitie toevoegen/intrekken op een bestaand dossier**

Voeg toe, na `bijlageIntrekken`:

```typescript
  async function notitieToevoegen(engagementId: string) {
    if (!nieuweNotitieTekst.trim()) return;

    try {
      await voegNotitieToe(engagementId, nieuweNotitieTekst.trim());
      setNieuweNotitieTekst('');
      setNotitieInvoerVoor(null);
      await laad();
    } catch {
      setFout('De notitie kon niet worden opgeslagen.');
    }
  }

  async function notitieIntrekken(engagementId: string, noteId: string) {
    try {
      await trekNotitieIn(engagementId, noteId);
      await laad();
    } catch {
      setFout('De notitie kon niet worden ingetrokken.');
    }
  }
```

- [ ] **Step 5: Voeg het notitieveld toe aan het aanmaakformulier**

Voeg toe, direct na het titelveld-blok (vóór het "Bijlagen"-blok):

```tsx
            <div>
              <label
                htmlFor="engagement-notitie"
                className="mb-1 block text-xs font-medium text-ink"
              >
                Notitie — kern en status in het kort
              </label>
              <textarea
                id="engagement-notitie"
                value={notitieTekst}
                onChange={(e) => setNotitieTekst(e.target.value)}
                maxLength={MAX_NOTITIE_TEKENS}
                rows={2}
                placeholder="bijv. Wacht op reactie leverancier over aangepaste voorwaarden."
                data-testid="engagement-notitie-veld"
                className="w-full rounded border border-line bg-card px-3 py-2 text-xs text-ink"
              />
              <p className="mt-0.5 text-right text-[10px] text-ink-muted">
                {notitieTekst.length}/{MAX_NOTITIE_TEKENS}
              </p>
            </div>
```

- [ ] **Step 6: Wijzig de opslaan-knop om ook notitie te vereisen**

Wijzig:

```tsx
              <button
                type="button"
                onClick={() => void aanmaken()}
                disabled={bezig || !titel.trim() || !notitieTekst.trim()}
                data-testid="engagement-opslaan"
                className="rounded bg-brand-primary px-4 py-1.5 text-xs font-medium text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {bezig ? 'Bezig…' : 'Dossier opslaan'}
              </button>
```

- [ ] **Step 7: Toon de laatste notitie in elke dossier-rij, met een toevoeg-actie**

Wijzig het rij-blok: voeg toe direct na het `<p>`-blok met titel/datum (vóór het `links.length > 0`-blok):

```tsx
                {engagement.laatsteNotitie && (
                  <p
                    data-testid="engagement-laatste-notitie"
                    className="mt-1.5 text-xs text-ink"
                  >
                    {engagement.laatsteNotitie.tekst}
                  </p>
                )}

                {notitieInvoerVoor === engagement.engagementId ? (
                  <div className="mt-2 space-y-1.5">
                    <textarea
                      value={nieuweNotitieTekst}
                      onChange={(e) => setNieuweNotitieTekst(e.target.value)}
                      maxLength={MAX_NOTITIE_TEKENS}
                      rows={2}
                      data-testid="engagement-nieuwe-notitie-veld"
                      className="w-full rounded border border-line bg-card px-2 py-1.5 text-xs text-ink"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void notitieToevoegen(engagement.engagementId)
                        }
                        disabled={!nieuweNotitieTekst.trim()}
                        data-testid="engagement-notitie-opslaan"
                        className="rounded bg-brand-primary px-2.5 py-1 text-[11px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Notitie opslaan
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNotitieInvoerVoor(null);
                          setNieuweNotitieTekst('');
                        }}
                        className="rounded border border-line px-2.5 py-1 text-[11px] text-ink-muted"
                      >
                        Annuleren
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setNotitieInvoerVoor(engagement.engagementId)}
                    data-testid="engagement-notitie-toevoegen"
                    className="mt-1.5 text-[11px] text-brand-primary hover:underline"
                  >
                    Notitie toevoegen
                  </button>
                )}

                {engagement.laatsteNotitie && (
                  <button
                    type="button"
                    onClick={() =>
                      void notitieIntrekken(
                        engagement.engagementId,
                        engagement.laatsteNotitie!.noteId,
                      )
                    }
                    aria-label="Notitie intrekken"
                    title="Notitie intrekken"
                    className="ml-2 text-[11px] text-ink-muted hover:underline"
                  >
                    intrekken
                  </button>
                )}
```

- [ ] **Step 8: Draai lint/typecheck**

Run: `npm run lint:check` en `npx tsc --noEmit` (in de `MCM2-frontend`-repo).
Expected: geen fouten.

- [ ] **Step 9: Commit**

```bash
git add src/shared/components/EngagementPanel.tsx
git commit -m "feat(vendor-dossiers): notitieveld in aanmaakformulier, laatste notitie + toevoegen/intrekken per dossier"
```

---

### Task 10: Frontend e2e

**Files:**
- Modify: `MCM2-frontend/e2e/vendor-engagements.spec.ts`

- [ ] **Step 1: Repareer bestaande tests die een dossier aanmaken**

Elke plek in `e2e/vendor-engagements.spec.ts` die `engagement-titel-veld` invult en daarna op `engagement-opslaan` klikt, moet ook `engagement-notitie-veld` invullen — anders blijft de opslaan-knop uitgeschakeld (Task 9, Step 6) en falen deze tests nu.

Zoek elke aanroep:

```bash
grep -n "engagement-titel-veld" e2e/vendor-engagements.spec.ts
```

en voeg direct na elke `.fill(...)`-aanroep op `engagement-titel-veld` toe:

```typescript
    await page
      .getByTestId('engagement-notitie-veld')
      .fill('Testnotitie bij aanmaken.');
```

- [ ] **Step 2: Voeg een nieuwe test toe voor het notitiegedrag**

Voeg toe aan het einde van het `test.describe`-blok, vóór de afsluitende `});`:

```typescript
  test('toont de laatste notitie en kan een nieuwe notitie toevoegen', async ({
    page,
  }) => {
    await maakEnOpen(page);

    await page.getByTestId('engagement-nieuw').click();
    await page
      .getByTestId('engagement-titel-veld')
      .fill('Dossier met notitiegeschiedenis');
    await page
      .getByTestId('engagement-notitie-veld')
      .fill('Eerste status: wacht op leverancier.');
    await page.getByTestId('engagement-opslaan').click();

    await expect(page.getByTestId('engagement-rij')).toHaveCount(1);
    await expect(
      page.getByTestId('engagement-laatste-notitie'),
    ).toContainText('Eerste status: wacht op leverancier.');

    await page.getByTestId('engagement-notitie-toevoegen').click();
    await page
      .getByTestId('engagement-nieuwe-notitie-veld')
      .fill('Tweede status: akkoord ontvangen.');
    await page.getByTestId('engagement-notitie-opslaan').click();

    await expect(
      page.getByTestId('engagement-laatste-notitie'),
    ).toContainText('Tweede status: akkoord ontvangen.');
  });
```

- [ ] **Step 3: Draai de suite**

Vanwege het pre-existing, gedocumenteerde `context.addCookies()`-probleem (zie de commit-boodschap van de vorige `vendor-engagements.spec.ts`-commit) draait deze suite standalone mogelijk niet — dat is bekend en niet iets om hier opnieuw te proberen op te lossen. Draai in plaats daarvan de manuele browserverificatie in Task 11, en laat deze suite meelopen in `verify:volledig` op de backend-repo (die orchestratie werkte al eerder wél).

- [ ] **Step 4: Commit**

```bash
git add e2e/vendor-engagements.spec.ts
git commit -m "test(e2e): vendor-dossier-notities - notitie verplicht bij aanmaken, later toevoegen"
```

---

### Task 11: Handmatige browserverificatie

**Files:** geen wijzigingen — alleen verificatie via de draaiende demo-stack/dev-stack.

- [ ] **Step 1: Start backend + frontend tegen een wegwerpdatabase**

Gebruik dezelfde aanpak als bij de oorspronkelijke feature: backend op `npm run start:dev` met een `test:db`-wegwerpcontainer, frontend op `npm run dev` met `API_BASE_URL="http://localhost:5001"`.

- [ ] **Step 2: Verifieer via de browser (Playwright MCP of handmatig)**

Controleer, op het vendorscherm:
- Een nieuw dossier aanmaken zonder notitie: opslaan-knop blijft uitgeschakeld.
- Met titel + notitie: dossier verschijnt, met de notitietekst direct zichtbaar in de rij (geen bestand nodig om te lezen).
- "Notitie toevoegen" op een bestaand dossier: nieuwe tekst wordt de zichtbare, laatste notitie.
- "intrekken" op de laatste notitie: de rij toont daarna de voorlaatste notitie (niet leeg, tenzij er geen eerdere is).

- [ ] **Step 3: Ruim op**

Sluit de handmatige stack af (`npm run demo:af` of het equivalent van de gebruikte opzet), verwijder eventuele tijdelijke testbestanden, en controleer `git status --short` op beide repo's vóór verder te gaan.

---

### Self-Review (uitgevoerd door de planschrijver, niet opnieuw nodig door de uitvoerder)

1. **Spec coverage**: verplicht bij aanmaken (Task 4/5/9), bewerkbaar/later toevoegen (Task 4/5/9), terugval bij intrekken (Task 4, `ORDER BY ... DESC` + filter-op-engagement, getest in Task 6), max. 500 tekens (migratie CHECK + invoer-validatie + frontend `maxLength`), append-only/geen UPDATE van bestaande tekst (Task 4 gebruikt overal `INSERT`, nooit `UPDATE` op `tekst`) — alle punten uit de spec zijn gedekt.
2. **Placeholder-scan**: geen "TBD"/"later invullen" — elke stap heeft volledige code.
3. **Type-consistentie**: `EngagementNote`/`laatsteNotitie` heten overal identiek (backend service, backend controller-respons, frontend model, frontend component) — gecontroleerd tussen Task 4, 8 en 9.
4. **Scope**: dit plan raakt alleen de vendor-dossier-notitie-aanvulling, geen andere subsystemen — geen decompositie nodig.
