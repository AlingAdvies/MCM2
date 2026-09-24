# Vendor-dossiers (engagements) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een contractbeheerder kan bij een leverancier een "dossier"
(engagement) vastleggen met een titel, optioneel gekoppeld aan één of meer
contracten en/of survey-rondes, met maximaal 3 bijlagen (PDF/PNG/DOCX/XLSX,
max. 10MB elk) — bedoeld om geëxporteerde mailcorrespondentie rond een
intensiever traject (bijv. contractonderhandeling) vast te leggen.

**Architecture:** Drie nieuwe tabellen (`vendor_engagement`,
`vendor_engagement_link`, `vendor_engagement_attachment`) in schema `clm`,
volgens het bestaande `response_note`-patroon (soft-delete, RLS met
`current_actor() = 'medewerker'`, expliciete GRANT in dezelfde migratie). Een
nieuwe `VendorEngagementModule` (service + controller), en een herbruikbaar
`EngagementPanel`-React-component dat op het vendor-, contract- en
surveyresponsscherm wordt ingeplugd.

**Tech Stack:** NestJS, Drizzle (handgeschreven SQL-migraties), Postgres met
RLS, Next.js App Router / TypeScript (frontend-repo `MCM2-frontend`).

**Spec:** `docs/superpowers/specs/2026-09-24-vendor-dossiers-design.md`

---

## Belangrijke context vóór je begint

- Lees `C:\DEV\Work\MCM2\CLAUDE.md` punt 3 ("handgeschreven migratie moet in
  `drizzle/meta/_journal.json`") en punt 8 (GRANT-valkuil) — beide worden
  hieronder toegepast, maar de reden staat daar volledig uitgelegd.
- Werk tegen een wegwerpdatabase, opgezet met `npm run test:db -- "vendor
  dossiers"`. Nooit handmatig rollen/wachtwoorden raden — zie
  `docs/runbooks/commandos-en-omgeving.md`.
- Elke migratie hierin volgt het patroon van `drizzle/0018_response_note.sql`
  en de correctie-les van `drizzle/0039_tenant_feature_rechten_herstel.sql`:
  de GRANT staat **in dezelfde migratie**, nooit "later toevoegen".

---

## Fase A — Backend: datamodel

### Task 1: Migratie — `vendor_engagement`

**Files:**
- Create: `drizzle/0040_vendor_engagement.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Bepaal het volgende journal-entry**

Open `drizzle/meta/_journal.json`, zoek de laatste entry (idx hoogste getal,
momenteel migratie 0039). Noteer het `idx`-getal + 1 en gebruik een `when`
die groter is dan de laatste (huidige unix-tijd in ms is prima).

- [ ] **Step 2: Schrijf de migratie**

```sql
-- =============================================================================
-- clm.vendor_engagement — een "dossier" bij een leverancier voor intensiever,
-- meervoudig mailcontact (bijv. een contractonderhandeling).
--
-- Aanleiding: docs/superpowers/specs/2026-09-24-vendor-dossiers-design.md.
-- Klantoverleg Transdev: rondom een survey en/of contract ontstaat soms een
-- traject dat verder gaat dan de bestaande notitiefunctie (response_note) --
-- niet gebonden aan één survey-response, en met voorkeur voor bijlagen
-- (geëxporteerde mailcorrespondentie) in plaats van getypte samenvattingen.
--
-- ── Waarom een eigen tabel en geen uitbreiding van response_note ────────────
--
-- response_note is altijd gekoppeld aan precies één survey_response. Een
-- engagement moet breder kunnen: aan een leverancier, optioneel aan één of
-- meer contracten en/of survey-responses (zie vendor_engagement_link), of aan
-- geen van beide (een los verzoek aan de leverancier, nog geen contract of
-- survey). De twee concepten door elkaar zetten zou van response_note een
-- generieke tabel maken die twee verschillende doelen dient -- precies de
-- "stille fout"-valkuil die response_note zelf al vermijdt ten opzichte van
-- survey_review.
--
-- ── Geen status/workflow-veld ────────────────────────────────────────────────
--
-- Besluit eigenaar 2026-09-24: MVP zonder open/afgehandeld-status.
-- Zichtbaarheid "er speelt iets" komt uit het enkele bestaan van een
-- niet-verwijderd engagement.
--
-- ── Geen limiet op aantal engagements per leverancier ────────────────────────
--
-- Een leverancier kan meerdere, onafhankelijke, gelijktijdig lopende
-- dossiers hebben. Geen unique constraint op vendor_id.
-- =============================================================================

CREATE TABLE "clm"."vendor_engagement" (
	"engagement_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"titel" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement"
    ADD CONSTRAINT "vendor_engagement_tenant_id_tenant_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement"
    ADD CONSTRAINT "vendor_engagement_vendor_id_vendor_vendor_id_fk"
    FOREIGN KEY ("vendor_id") REFERENCES "clm"."vendor"("vendor_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Een dossier zonder auteur is niet te herleiden -- zelfde redenering als
-- response_note.author_user_id.
ALTER TABLE "clm"."vendor_engagement"
    ADD CONSTRAINT "vendor_engagement_created_by_user_id_user_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "clm"."user"("user_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement"
    ADD CONSTRAINT "vendor_engagement_titel_niet_leeg_check"
    CHECK (length(btrim(titel)) > 0);--> statement-breakpoint

CREATE INDEX "vendor_engagement_tenant_id_idx"
    ON "clm"."vendor_engagement" USING btree ("tenant_id");--> statement-breakpoint

-- Op vendor_id: engagements worden altijd per leverancier opgehaald (badge +
-- panel op het vendorscherm).
CREATE INDEX "vendor_engagement_vendor_id_idx"
    ON "clm"."vendor_engagement" USING btree ("vendor_id");--> statement-breakpoint

-- ── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE clm.vendor_engagement ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.vendor_engagement FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Zelfde vorm als response_note: tenant én actor, in USING én WITH CHECK.
-- Een leverancier heeft geen eigen inlogpad naar deze tabel (er is geen
-- controller-route achter SurveyTokenGuard die hem aanraakt), maar de
-- actor-eis is hier bewust hetzelfde consequente patroon als bij
-- response_note -- geen uitzondering zonder reden.
CREATE POLICY vendor_engagement_isolation ON clm.vendor_engagement
    USING (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    )
    WITH CHECK (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    );--> statement-breakpoint

COMMENT ON TABLE clm.vendor_engagement IS
    'Een dossier bij een leverancier voor intensiever, meervoudig mailcontact (bijv. een contractonderhandeling). Geen status/workflow in de MVP. Append-only, intrekken via deleted_at.';--> statement-breakpoint

-- Geen DELETE: intrekken gaat via een UPDATE op deleted_at. GRANT hier
-- expliciet, in dezelfde migratie als de CREATE TABLE -- niet vertrouwen op
-- ALTER DEFAULT PRIVILEGES (zie migratie 0039, CLAUDE.md punt 8).
GRANT SELECT, INSERT, UPDATE ON clm.vendor_engagement TO clm_api, clm_admin;
```

- [ ] **Step 3: Voeg de journal-entry toe**

In `drizzle/meta/_journal.json`, voeg toe aan het einde van de `entries`-array
(vergelijk het formaat met de entry voor migratie 0039):

```json
{
  "idx": <vorige idx + 1>,
  "version": "7",
  "when": <huidige unix-tijd in ms>,
  "tag": "0040_vendor_engagement",
  "breakpoints": true
}
```

- [ ] **Step 4: Zet een wegwerpdatabase op en draai de migratie**

Run: `npm run test:db -- "vendor engagement migratie 1"`

Expected: de container start, alle migraties t/m 0040 draaien zonder fout, en
het script drukt `MIGRATION_DATABASE_URL`/`DATABASE_URL` af.

- [ ] **Step 5: Verifieer de tabel handmatig**

Exporteer de door stap 4 afgedrukte `DATABASE_URL`, en:

```sql
SELECT grantee, privilege_type FROM information_schema.role_table_grants
 WHERE table_schema='clm' AND table_name='vendor_engagement';
```

Expected: rijen voor `clm_api` en `clm_admin` met `SELECT`, `INSERT`,
`UPDATE` (geen `DELETE`).

- [ ] **Step 6: Commit**

```bash
git add drizzle/0040_vendor_engagement.sql drizzle/meta/_journal.json
git commit -m "feat(db): migratie 0040 - clm.vendor_engagement"
```

---

### Task 2: Migratie — `vendor_engagement_link`

**Files:**
- Create: `drizzle/0041_vendor_engagement_link.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================================
-- clm.vendor_engagement_link — koppelt een engagement aan 0..N contracten
-- en/of survey-responses.
--
-- ── Waarom een koppeltabel en niet twee nullable kolommen op
--    vendor_engagement ───────────────────────────────────────────────────────
--
-- Een eerdere ontwerpversie had contract_id/response_id als losse nullable
-- kolommen direct op vendor_engagement. Dat staat maar één contract én één
-- survey tegelijk toe. Een langer lopend dossier raakt in de praktijk vaak
-- meer dan één survey-ronde (jaar 1, jaar 2) of meer dan één contract (oud +
-- vernieuwd) -- zie spec §Datamodel/vendor_engagement_link voor de volledige
-- herleiding. Deze koppeltabel staat 0..N links van elk type toe.
--
-- Geen eigen levenscyclus (geen deleted_at): een koppeling die niet meer
-- geldt wordt verwijderd, niet zacht gemarkeerd -- zelfde redenering als
-- clm.contract_survey_template (migratie 0027).
-- =============================================================================

CREATE TABLE "clm"."vendor_engagement_link" (
	"link_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"link_type" text NOT NULL,
	"linked_id" uuid NOT NULL
);
--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement_link"
    ADD CONSTRAINT "vendor_engagement_link_engagement_id_fk"
    FOREIGN KEY ("engagement_id") REFERENCES "clm"."vendor_engagement"("engagement_id")
    ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement_link"
    ADD CONSTRAINT "vendor_engagement_link_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Geen FK naar contract of survey_response: linked_id wijst naar een van
-- beide, afhankelijk van link_type. Eén kolom met twee mogelijke doeltabellen
-- kan geen FK-constraint dragen -- de service controleert het bestaan van het
-- doel zelf bij het aanmaken van een link (Task 4).
ALTER TABLE "clm"."vendor_engagement_link"
    ADD CONSTRAINT "vendor_engagement_link_type_check"
    CHECK (link_type IN ('contract', 'survey_response'));--> statement-breakpoint

-- Voorkomt een dubbele koppeling van hetzelfde engagement aan hetzelfde
-- contract/survey.
ALTER TABLE "clm"."vendor_engagement_link"
    ADD CONSTRAINT "vendor_engagement_link_uniek"
    UNIQUE ("engagement_id", "link_type", "linked_id");--> statement-breakpoint

CREATE INDEX "vendor_engagement_link_tenant_id_idx"
    ON "clm"."vendor_engagement_link" USING btree ("tenant_id");--> statement-breakpoint

CREATE INDEX "vendor_engagement_link_engagement_id_idx"
    ON "clm"."vendor_engagement_link" USING btree ("engagement_id");--> statement-breakpoint

-- Voor het contract- en surveyscherm: "welke engagements horen bij dit
-- contract/deze response" moet snel kunnen zonder alle engagements te lezen.
CREATE INDEX "vendor_engagement_link_linked_id_idx"
    ON "clm"."vendor_engagement_link" USING btree ("link_type", "linked_id");--> statement-breakpoint

ALTER TABLE clm.vendor_engagement_link ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.vendor_engagement_link FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY vendor_engagement_link_isolation ON clm.vendor_engagement_link
    USING (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    )
    WITH CHECK (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    );--> statement-breakpoint

COMMENT ON TABLE clm.vendor_engagement_link IS
    'Koppelt een vendor_engagement aan 0..N contracten en/of survey-responses. Geen eigen levenscyclus: een koppeling die niet meer geldt wordt verwijderd.';--> statement-breakpoint

-- Wél DELETE hier, anders dan vendor_engagement zelf: een koppeling heeft
-- geen levenscyclus om zacht te bewaren (zie toelichting hierboven).
GRANT SELECT, INSERT, DELETE ON clm.vendor_engagement_link TO clm_api, clm_admin;
```

- [ ] **Step 2: Voeg de journal-entry toe**

Zelfde aanpak als Task 1 Step 3, met `"tag": "0041_vendor_engagement_link"`.

- [ ] **Step 3: Draai de migratie op een verse wegwerpdatabase**

Run: `npm run test:db -- "vendor engagement migratie 2"`

Expected: migraties t/m 0041 draaien zonder fout.

- [ ] **Step 4: Commit**

```bash
git add drizzle/0041_vendor_engagement_link.sql drizzle/meta/_journal.json
git commit -m "feat(db): migratie 0041 - clm.vendor_engagement_link"
```

---

### Task 3: Migratie — `vendor_engagement_attachment`

**Files:**
- Create: `drizzle/0042_vendor_engagement_attachment.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Schrijf de migratie**

```sql
-- =============================================================================
-- clm.vendor_engagement_attachment — bijlagen bij een vendor-dossier.
--
-- Eigen tabel, los van clm.survey_attachment: dat is gebouwd rond één
-- specifieke vraag binnen één survey-response, geüpload door de leverancier
-- (of beheerder namens leverancier), met een eigen, strakkere
-- typen/grootte-beleid (PDF/PNG, 5MB). Deze tabel dient een ander doel: een
-- beheerder legt hier gëexporteerde mailcorrespondentie vast, met een ruimer
-- beleid (ook DOCX/XLSX, 10MB) -- zie
-- docs/superpowers/specs/2026-09-24-vendor-dossiers-design.md
-- §Bestandsvalidatie voor de volledige vergelijking.
--
-- Max. 3 bijlagen per engagement wordt server-side afgedwongen in de service
-- (Task 6), niet met een CHECK-constraint -- een CHECK kan niet over meerdere
-- rijen tellen.
-- =============================================================================

CREATE TABLE "clm"."vendor_engagement_attachment" (
	"attachment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement_attachment"
    ADD CONSTRAINT "vendor_engagement_attachment_engagement_id_fk"
    FOREIGN KEY ("engagement_id") REFERENCES "clm"."vendor_engagement"("engagement_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement_attachment"
    ADD CONSTRAINT "vendor_engagement_attachment_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement_attachment"
    ADD CONSTRAINT "vendor_engagement_attachment_uploaded_by_user_id_fk"
    FOREIGN KEY ("uploaded_by_user_id") REFERENCES "clm"."user"("user_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement_attachment"
    ADD CONSTRAINT "vendor_engagement_attachment_content_type_check"
    CHECK (content_type IN (
        'application/pdf',
        'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ));--> statement-breakpoint

-- 10 MB. Gelijk aan MAX_BESTANDSGROOTTE in
-- src/vendor/vendor-engagement-bestand-validatie.ts (Task 5).
ALTER TABLE "clm"."vendor_engagement_attachment"
    ADD CONSTRAINT "vendor_engagement_attachment_grootte_check"
    CHECK (size_bytes > 0 AND size_bytes <= 10485760);--> statement-breakpoint

CREATE UNIQUE INDEX "vendor_engagement_attachment_storage_key_key"
    ON "clm"."vendor_engagement_attachment" USING btree ("storage_key");--> statement-breakpoint

CREATE INDEX "vendor_engagement_attachment_tenant_id_idx"
    ON "clm"."vendor_engagement_attachment" USING btree ("tenant_id");--> statement-breakpoint

CREATE INDEX "vendor_engagement_attachment_engagement_id_idx"
    ON "clm"."vendor_engagement_attachment" USING btree ("engagement_id");--> statement-breakpoint

ALTER TABLE clm.vendor_engagement_attachment ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.vendor_engagement_attachment FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY vendor_engagement_attachment_isolation ON clm.vendor_engagement_attachment
    USING (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    )
    WITH CHECK (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    );--> statement-breakpoint

COMMENT ON TABLE clm.vendor_engagement_attachment IS
    'Bijlagen bij een vendor-dossier (max. 3 per engagement, PDF/PNG/DOCX/XLSX, max. 10MB). Append-only, intrekken via deleted_at.';--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON clm.vendor_engagement_attachment TO clm_api, clm_admin;
```

- [ ] **Step 2: Voeg de journal-entry toe**

Zelfde aanpak, `"tag": "0042_vendor_engagement_attachment"`.

- [ ] **Step 3: Draai de migratie op een verse wegwerpdatabase**

Run: `npm run test:db -- "vendor engagement migratie 3"`

Expected: migraties t/m 0042 draaien zonder fout.

- [ ] **Step 4: Commit**

```bash
git add drizzle/0042_vendor_engagement_attachment.sql drizzle/meta/_journal.json
git commit -m "feat(db): migratie 0042 - clm.vendor_engagement_attachment"
```

---

### Task 4: `rechten-contract.ts` bijwerken + opruimen.ts uitbreiden

**Files:**
- Modify: `src/db/rechten-contract.ts`
- Modify: `test/opruimen.ts`

Zonder deze stap faalt `rechten-contract.e2e` rood zodra de drie nieuwe
tabellen bestaan (zie het docblok bovenaan `rechten-contract.ts`: "Een
nieuwe tabel of functie zonder regel hier maakt de test rood — dat is de
bedoeling").

- [ ] **Step 1: Voeg de drie tabellen toe aan `TABELRECHTEN`**

In `src/db/rechten-contract.ts`, in de sectie "Van nature append-only" (rond
regel 133-137), voeg toe na `'clm.response_note': NIET_VERWIJDEREN,`:

```typescript
  // clm.vendor_engagement (0040): een dossier verdwijnt niet, wordt zacht
  // verwijderd via deleted_at -- zelfde patroon als response_note.
  'clm.vendor_engagement': NIET_VERWIJDEREN,
  // clm.vendor_engagement_attachment (0042): zelfde patroon.
  'clm.vendor_engagement_attachment': NIET_VERWIJDEREN,
```

In de sectie waar `contract_survey_template`/`vendor_compliance_thema` staan
(many-to-many-koppelingen zonder eigen levenscyclus), voeg toe:

```typescript
  // clm.vendor_engagement_link (0041): many-to-many-koppeling zonder eigen
  // levenscyclus, zelfde redenering als contract_survey_template.
  'clm.vendor_engagement_link': ['SELECT', 'INSERT', 'DELETE'],
```

- [ ] **Step 2: Voeg de tabellen toe aan `opruimen.ts`**

In `test/opruimen.ts`, in `TABELLEN_IN_VOLGORDE` (regel 44-61): de bladtabellen
moeten vóór hun wortels staan. Voeg toe direct na `'clm.response_note',`:

```typescript
  'clm.vendor_engagement_attachment',
  'clm.vendor_engagement_link',
  'clm.vendor_engagement',
```

(Deze drie moeten vóór `'clm.vendor',` staan, wat al het geval is omdat ze na
`response_note` worden ingevoegd.)

- [ ] **Step 3: Draai de rechten-contract e2e-test**

Run: `npm run test:e2e -- rechten-contract`

Expected: PASS — de test controleert dat elke tabel uit `schema-inventory.ts`
een regel heeft in `TABELRECHTEN` én dat de daadwerkelijke GRANTs in de
database overeenkomen.

- [ ] **Step 4: Commit**

```bash
git add src/db/rechten-contract.ts test/opruimen.ts
git commit -m "chore(db): rechten-contract en opruimen bijwerken voor vendor_engagement"
```

---

### Task 5: Drizzle-schema (`schema.ts`)

**Files:**
- Modify: `src/db/schema.ts`

Dit maakt de drie tabellen zichtbaar voor `schema-inventory.ts` (dat
`rechten-contract.e2e` gebruikt om te controleren dat elke tabel een
rechten-regel heeft) en voor eventuele Drizzle-query-builder-code later. De
service in Task 6 gebruikt overigens rechtstreekse SQL via `tx.execute()`,
net als `NotitieService` — dat blijft zo, dit schema-object is puur voor de
inventarisatie en voor `relations()`.

- [ ] **Step 1: Voeg de drie tabeldefinities toe**

Zoek de plek na `contractSurveyTemplate` (rond regel 605-629) in
`src/db/schema.ts` en voeg toe:

```typescript
export const vendorEngagement = clm.table(
  'vendor_engagement',
  {
    engagementId: uuid('engagement_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendor.vendorId, { onDelete: 'restrict' }),
    titel: text('titel').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => user.userId, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('vendor_engagement_tenant_id_idx').on(t.tenantId),
    index('vendor_engagement_vendor_id_idx').on(t.vendorId),
  ],
);

export const vendorEngagementLink = clm.table(
  'vendor_engagement_link',
  {
    linkId: uuid('link_id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => vendorEngagement.engagementId, {
        onDelete: 'cascade',
      }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    // 'contract' of 'survey_response'. linked_id wijst naar een van beide,
    // geen FK mogelijk over twee doeltabellen — zie migratie 0041.
    linkType: text('link_type').notNull(),
    linkedId: uuid('linked_id').notNull(),
  },
  (t) => [
    uniqueIndex('vendor_engagement_link_uniek').on(
      t.engagementId,
      t.linkType,
      t.linkedId,
    ),
    index('vendor_engagement_link_tenant_id_idx').on(t.tenantId),
    index('vendor_engagement_link_engagement_id_idx').on(t.engagementId),
    index('vendor_engagement_link_linked_id_idx').on(
      t.linkType,
      t.linkedId,
    ),
  ],
);

export const vendorEngagementAttachment = clm.table(
  'vendor_engagement_attachment',
  {
    attachmentId: uuid('attachment_id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => vendorEngagement.engagementId, {
        onDelete: 'restrict',
      }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    storageKey: text('storage_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => user.userId, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('vendor_engagement_attachment_storage_key_key').on(
      t.storageKey,
    ),
    index('vendor_engagement_attachment_tenant_id_idx').on(t.tenantId),
    index('vendor_engagement_attachment_engagement_id_idx').on(
      t.engagementId,
    ),
  ],
);
```

Controleer dat `integer` en `uniqueIndex` al geïmporteerd zijn bovenaan
`schema.ts` (ze worden elders in het bestand gebruikt — bijv.
`import_extra_contact.volgnummer` gebruikt `integer`, en
`contract_survey_template_pkey` gebruikt `uniqueIndex`). Zo niet, voeg toe
aan de bestaande drizzle-orm-import.

- [ ] **Step 2: Voeg relations toe**

Na de bestaande `relations()`-blokken (zoek `surveyAttachmentRelations` rond
regel 1344 als referentiepunt), voeg toe:

```typescript
export const vendorEngagementRelations = relations(
  vendorEngagement,
  ({ one, many }) => ({
    tenant: one(tenant, {
      fields: [vendorEngagement.tenantId],
      references: [tenant.tenantId],
    }),
    vendor: one(vendor, {
      fields: [vendorEngagement.vendorId],
      references: [vendor.vendorId],
    }),
    links: many(vendorEngagementLink),
    attachments: many(vendorEngagementAttachment),
  }),
);

export const vendorEngagementLinkRelations = relations(
  vendorEngagementLink,
  ({ one }) => ({
    engagement: one(vendorEngagement, {
      fields: [vendorEngagementLink.engagementId],
      references: [vendorEngagement.engagementId],
    }),
  }),
);

export const vendorEngagementAttachmentRelations = relations(
  vendorEngagementAttachment,
  ({ one }) => ({
    engagement: one(vendorEngagement, {
      fields: [vendorEngagementAttachment.engagementId],
      references: [vendorEngagement.engagementId],
    }),
  }),
);
```

- [ ] **Step 3: Compileer**

Run: `npm run build`

Expected: geen TypeScript-fouten.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(db): schema.ts - vendor_engagement, -link, -attachment"
```

---

## Fase B — Backend: bestandsvalidatie

### Task 6: Eigen validatiemodule met gedeelde signature-detectie

**Files:**
- Modify: `src/survey/bestand-validatie.ts` (signature-detectie generiek maken)
- Create: `src/vendor/vendor-engagement-bestand-validatie.ts`
- Test: `src/vendor/vendor-engagement-bestand-validatie.spec.ts`

**Waarom `bestand-validatie.ts` wijzigen in plaats van dupliceren:** de
signature-detectiemechaniek (bytes-aan-het-begin-vergelijking) is puur
mechaniek, geen beleid. Het beleid (welke typen, welke grootte) blijft
gescheiden per module — zie spec §Bestandsvalidatie.

- [ ] **Step 1: Maak `bepaalContentType` generiek in `bestand-validatie.ts`**

In `src/survey/bestand-validatie.ts`, de functie `bepaalContentType` (regel
54-68) itereert al over een array `HANDTEKENINGEN`. Maak hem generiek
herbruikbaar door een nieuwe geëxporteerde functie toe te voegen die een
handtekeningen-array als parameter neemt, en laat de bestaande
`bepaalContentType()` die aanroepen met de eigen (PDF/PNG) lijst — zodat de
publieke API van deze module ongewijzigd blijft voor bestaande aanroepers:

```typescript
/** Eén herkenbaar bestandstype: het content-type en de bytes waarmee het begint. */
export interface BestandHandtekening<T extends string> {
  readonly contentType: T;
  readonly bytes: readonly number[];
}

/**
 * Stelt het content-type vast uit de eerste bytes, tegen een gegeven lijst
 * handtekeningen. Gedeeld mechaniek — het beleid (welke typen zijn
 * toegestaan) hoort bij de aanroeper, niet hier.
 */
export function detecteerContentType<T extends string>(
  inhoud: Buffer,
  handtekeningen: readonly BestandHandtekening<T>[],
): T | null {
  for (const handtekening of handtekeningen) {
    if (inhoud.length < handtekening.bytes.length) continue;

    const komtOvereen = handtekening.bytes.every(
      (byte, i) => inhoud[i] === byte,
    );

    if (komtOvereen) return handtekening.contentType;
  }

  return null;
}
```

Wijzig de bestaande `bepaalContentType` zodat hij deze nieuwe functie
aanroept:

```typescript
export function bepaalContentType(
  inhoud: Buffer,
): ToegestaanContentType | null {
  return detecteerContentType(inhoud, HANDTEKENINGEN);
}
```

- [ ] **Step 2: Draai de bestaande tests voor `bestand-validatie.ts`**

Run: `npx jest src/survey/bestand-validatie --no-coverage`

Expected: PASS, ongewijzigd gedrag (dit was een refactor, geen
gedragswijziging).

- [ ] **Step 3: Schrijf de failing test voor de nieuwe module**

Create `src/vendor/vendor-engagement-bestand-validatie.spec.ts`:

```typescript
import {
  MAX_BESTANDSGROOTTE,
  MAX_BIJLAGEN_PER_ENGAGEMENT,
  valideerEngagementBestand,
} from './vendor-engagement-bestand-validatie';

const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
// DOCX/XLSX zijn beide ZIP-containers: 'PK\x03\x04'.
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

describe('valideerEngagementBestand', () => {
  it('accepteert een PDF', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.concat([PDF_HEADER, Buffer.from('rest')]),
      'application/pdf',
    );
    expect(resultaat.geldig).toBe(true);
  });

  it('accepteert een PNG', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.concat([PNG_HEADER, Buffer.from('rest')]),
      'image/png',
    );
    expect(resultaat.geldig).toBe(true);
  });

  it('accepteert een DOCX (ZIP-signature + juist beweerd type)', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.concat([ZIP_HEADER, Buffer.from('rest')]),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(resultaat.geldig).toBe(true);
  });

  it('weigert een bestand groter dan 10 MB', () => {
    const groot = Buffer.concat([
      PDF_HEADER,
      Buffer.alloc(MAX_BESTANDSGROOTTE),
    ]);
    const resultaat = valideerEngagementBestand(groot, 'application/pdf');
    expect(resultaat).toEqual({ geldig: false, reden: 'te-groot' });
  });

  it('weigert een onbekend bestandstype', () => {
    const resultaat = valideerEngagementBestand(
      Buffer.from('gewoon tekst, geen bekende signature'),
      'text/plain',
    );
    expect(resultaat).toEqual({ geldig: false, reden: 'onbekend-type' });
  });

  it('weigert een leeg bestand', () => {
    const resultaat = valideerEngagementBestand(Buffer.alloc(0));
    expect(resultaat).toEqual({ geldig: false, reden: 'leeg' });
  });

  it('exporteert het maximum van 3 bijlagen per engagement', () => {
    expect(MAX_BIJLAGEN_PER_ENGAGEMENT).toBe(3);
  });

  it('exporteert een maximum van 10 MB', () => {
    expect(MAX_BESTANDSGROOTTE).toBe(10 * 1024 * 1024);
  });
});
```

- [ ] **Step 4: Run de test, verwacht een failure**

Run: `npx jest src/vendor/vendor-engagement-bestand-validatie --no-coverage`

Expected: FAIL — `Cannot find module './vendor-engagement-bestand-validatie'`

- [ ] **Step 5: Schrijf de module**

Create `src/vendor/vendor-engagement-bestand-validatie.ts`:

```typescript
import { createHash, randomUUID } from 'node:crypto';

import {
  detecteerContentType,
  type BestandHandtekening,
} from '../survey/bestand-validatie';

/**
 * Bestandsvalidatie voor bijlagen bij een vendor-dossier (engagement).
 *
 * Eigen beleidsmodule, los van src/survey/bestand-validatie.ts: die blijft
 * ongewijzigd voor het leveranciersportaal (PDF/PNG, 5MB). Hier gelden andere
 * regels omdat het doel anders is — een beheerder legt hier geëxporteerde
 * mailcorrespondentie vast, vaak een Word- of Excel-bijlage, en de eigenaar
 * wilde bewust ruimte voor een representatief compliance-document (~4,4 MB
 * gemeten voorbeeld). Zie
 * docs/superpowers/specs/2026-09-24-vendor-dossiers-design.md
 * §Bestandsvalidatie.
 *
 * De signature-detectiemechaniek zelf komt uit bestand-validatie.ts —
 * gedeeld mechaniek, gescheiden beleid.
 */

export const MAX_BESTANDSGROOTTE = 10 * 1024 * 1024;

/** Nudge tegen een "circus van screenshots" (eis eigenaar, 24-09-2026). */
export const MAX_BIJLAGEN_PER_ENGAGEMENT = 3;

const HANDTEKENINGEN = [
  {
    contentType: 'application/pdf',
    bytes: [0x25, 0x50, 0x44, 0x46, 0x2d],
  },
  {
    contentType: 'image/png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  // DOCX en XLSX zijn beide OOXML/ZIP-containers: identieke signature
  // ('PK\x03\x04'). Het onderscheid zit in de interne mappenstructuur, niet
  // in de eerste bytes — daarom wordt hier, anders dan bij PDF/PNG, het door
  // de client beweerde type leidend zodra de ZIP-signature herkend is. Dat
  // is geen verzwakking van de controle: de signature bevestigt nog steeds
  // "dit is een ZIP-container", en het content_type-CHECK in migratie 0042
  // laat toch alleen deze twee specifieke waarden door.
  {
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: [0x50, 0x4b, 0x03, 0x04],
  },
  {
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: [0x50, 0x4b, 0x03, 0x04],
  },
] as const satisfies readonly BestandHandtekening<string>[];

export type ToegestaanEngagementContentType =
  (typeof HANDTEKENINGEN)[number]['contentType'];

export type BestandAfkeurReden =
  | 'leeg'
  | 'te-groot'
  | 'onbekend-type'
  | 'type-komt-niet-overeen';

export type EngagementBestandUitkomst =
  | { geldig: true; contentType: ToegestaanEngagementContentType; sha256: string }
  | { geldig: false; reden: BestandAfkeurReden };

/**
 * Toetst een geüploade bijlage.
 *
 * Voor DOCX/XLSX (identieke ZIP-signature) is `beweerdType` niet optioneel
 * te negeren zoals bij PDF/PNG: de eerste match in HANDTEKENINGEN met een
 * ZIP-signature is altijd de DOCX-variant, dus zonder een geldig beweerd
 * type dat overeenkomt met XLSX zou een Excel-bestand als DOCX geregistreerd
 * worden. Vandaar: bij een ZIP-signature is `beweerdType` verplicht en moet
 * hij één van de twee toegestane OOXML-waarden zijn.
 */
export function valideerEngagementBestand(
  inhoud: Buffer,
  beweerdType?: string,
): EngagementBestandUitkomst {
  if (inhoud.length === 0) {
    return { geldig: false, reden: 'leeg' };
  }

  if (inhoud.length > MAX_BESTANDSGROOTTE) {
    return { geldig: false, reden: 'te-groot' };
  }

  const isZip =
    inhoud.length >= 4 &&
    inhoud[0] === 0x50 &&
    inhoud[1] === 0x4b &&
    inhoud[2] === 0x03 &&
    inhoud[3] === 0x04;

  if (isZip) {
    const OOXML_TYPES: readonly string[] = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (
      beweerdType === undefined ||
      !OOXML_TYPES.includes(beweerdType)
    ) {
      return { geldig: false, reden: 'onbekend-type' };
    }

    return {
      geldig: true,
      contentType: beweerdType as ToegestaanEngagementContentType,
      sha256: createHash('sha256').update(inhoud).digest('hex'),
    };
  }

  const vastgesteld = detecteerContentType(inhoud, HANDTEKENINGEN);

  if (vastgesteld === null) {
    return { geldig: false, reden: 'onbekend-type' };
  }

  if (beweerdType !== undefined && beweerdType !== vastgesteld) {
    return { geldig: false, reden: 'type-komt-niet-overeen' };
  }

  return {
    geldig: true,
    contentType: vastgesteld,
    sha256: createHash('sha256').update(inhoud).digest('hex'),
  };
}

/** Bouwt de opslagsleutel: `<tenant>/<engagement>/<uuid>`. */
export function maakEngagementOpslagsleutel(
  tenantId: string,
  engagementId: string,
): string {
  return `${tenantId}/${engagementId}/${randomUUID()}`;
}
```

- [ ] **Step 6: Run de test opnieuw**

Run: `npx jest src/vendor/vendor-engagement-bestand-validatie --no-coverage`

Expected: PASS, alle 8 tests groen.

- [ ] **Step 7: Commit**

```bash
git add src/survey/bestand-validatie.ts src/vendor/vendor-engagement-bestand-validatie.ts src/vendor/vendor-engagement-bestand-validatie.spec.ts
git commit -m "feat(vendor): bestandsvalidatie voor engagement-bijlagen (PDF/PNG/DOCX/XLSX, 10MB)"
```

---

## Fase C — Backend: service

### Task 7: `VendorEngagementService` — aanmaken en lijst

**Files:**
- Create: `src/vendor/vendor-engagement.service.ts`
- Test: (e2e in Task 10 — deze service wordt niet los unit-getest, net als
  `NotitieService`, omdat de logica leunt op `withTenant`/RLS die alleen
  tegen een echte database zinvol te toetsen is)

- [ ] **Step 1: Schrijf de service**

Create `src/vendor/vendor-engagement.service.ts`:

```typescript
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import {
  MAX_BIJLAGEN_PER_ENGAGEMENT,
  maakEngagementOpslagsleutel,
  valideerEngagementBestand,
} from './vendor-engagement-bestand-validatie';
import { BestandOpslagService } from '../survey/bestand-opslag.service';

/**
 * Vendor-dossiers (engagements): intensiever, meervoudig mailcontact met een
 * leverancier, vastgelegd als titel + optionele koppeling(en) naar
 * contract(en)/survey-response(s) + bijlagen.
 *
 * Zie docs/superpowers/specs/2026-09-24-vendor-dossiers-design.md.
 *
 * Rechtstreekse SQL via tx.execute(), net als NotitieService — de Drizzle
 * query-builder wordt in deze codebase niet voor de admin-kant gebruikt.
 */

export type LinkType = 'contract' | 'survey_response';

export interface EngagementLink {
  linkId: string;
  linkType: LinkType;
  linkedId: string;
}

export interface EngagementAttachment {
  attachmentId: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  createdAt: string;
}

export interface Engagement {
  engagementId: string;
  vendorId: string;
  titel: string;
  createdByUserId: string;
  createdByNaam: string | null;
  createdAt: string;
  links: EngagementLink[];
  attachments: EngagementAttachment[];
}

interface EngagementRij extends Record<string, unknown> {
  engagement_id: string;
  vendor_id: string;
  titel: string;
  created_by_user_id: string;
  created_by_naam: string | null;
  created_at: Date | string;
}

interface LinkRij extends Record<string, unknown> {
  link_id: string;
  engagement_id: string;
  link_type: string;
  linked_id: string;
}

interface AttachmentRij extends Record<string, unknown> {
  attachment_id: string;
  engagement_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_by_user_id: string;
  created_at: Date | string;
}

function iso(waarde: Date | string): string {
  return waarde instanceof Date ? waarde.toISOString() : String(waarde);
}

@Injectable()
export class VendorEngagementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly opslag: BestandOpslagService,
  ) {}

  /**
   * Alle engagements van één leverancier, met links en bijlagen, nieuwste
   * eerst. Gebruikt door het vendorscherm (ongefilterd) en door het contract-
   * en surveyscherm (die filteren client-side op link_type/linked_id — zie
   * spec §API: geen aparte endpoints per contract/survey).
   */
  async lijstVoorVendor(
    tenantId: string,
    vendorId: string,
  ): Promise<Engagement[]> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandeVendor(tx, vendorId);

        const engagements = await tx.execute<EngagementRij>(
          sql`SELECT e.engagement_id,
                     e.vendor_id,
                     e.titel,
                     e.created_by_user_id,
                     u.full_name AS created_by_naam,
                     e.created_at
                FROM clm.vendor_engagement e
                LEFT JOIN clm."user" u ON u.user_id = e.created_by_user_id
               WHERE e.vendor_id = ${vendorId}
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC`,
        );

        if (engagements.rows.length === 0) return [];

        const ids = engagements.rows.map((r) => r.engagement_id);

        const links = await tx.execute<LinkRij>(
          sql`SELECT link_id, engagement_id, link_type, linked_id
                FROM clm.vendor_engagement_link
               WHERE engagement_id = ANY(${ids})`,
        );

        const attachments = await tx.execute<AttachmentRij>(
          sql`SELECT attachment_id, engagement_id, original_filename,
                     content_type, size_bytes, uploaded_by_user_id, created_at
                FROM clm.vendor_engagement_attachment
               WHERE engagement_id = ANY(${ids})
                 AND deleted_at IS NULL`,
        );

        return engagements.rows.map((r) =>
          this.naarEngagement(r, links.rows, attachments.rows),
        );
      },
      'medewerker',
    );
  }

  /**
   * Maakt een nieuw engagement aan, met optionele initiële links.
   *
   * De auteur komt uit de sessie, nooit uit de invoer (MCM2-CLAUDE.md §6) —
   * zelfde regel als bij NotitieService.voegToe.
   */
  async aanmaken(
    tenantId: string,
    vendorId: string,
    createdByUserId: string,
    titel: string,
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

        return this.naarEngagement(rij, links.rows, []);
      },
      'medewerker',
    );
  }

  /** Voegt een extra koppeling toe aan een bestaand engagement. */
  async linkToevoegen(
    tenantId: string,
    engagementId: string,
    linkType: LinkType,
    linkedId: string,
  ): Promise<EngagementLink> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        await this.eisBestaandEngagement(tx, engagementId);
        await this.eisBestaandLinkDoel(tx, linkType, linkedId);

        const resultaat = await tx.execute<LinkRij>(
          sql`INSERT INTO clm.vendor_engagement_link
                     (engagement_id, tenant_id, link_type, linked_id)
              VALUES (${engagementId}, ${tenantId}, ${linkType}, ${linkedId})
              ON CONFLICT (engagement_id, link_type, linked_id) DO NOTHING
              RETURNING link_id, engagement_id, link_type, linked_id`,
        );

        const rij = resultaat.rows[0];
        if (!rij) {
          throw new BadRequestException(
            'Deze koppeling bestaat al, of kon niet worden toegevoegd.',
          );
        }

        return {
          linkId: rij.link_id,
          linkType: rij.link_type as LinkType,
          linkedId: rij.linked_id,
        };
      },
      'medewerker',
    );
  }

  /**
   * Voegt een bijlage toe. Server-side maximum van 3 per engagement,
   * afgedwongen met FOR UPDATE op de engagement-rij — zelfde aanpak als
   * BijlageService.voegToe voor max_files, om te voorkomen dat twee
   * gelijktijdige uploads samen over de grens gaan.
   */
  async bijlageToevoegen(
    tenantId: string,
    engagementId: string,
    uploadedByUserId: string,
    bestand: { originalname: string; mimetype?: string; buffer: Buffer },
  ): Promise<
    | { status: 'opgeslagen'; attachment: EngagementAttachment }
    | { status: 'afgekeurd'; reden: string }
    | { status: 'te-veel-bijlagen' }
  > {
    const gecontroleerd = valideerEngagementBestand(
      bestand.buffer,
      bestand.mimetype,
    );

    if (!gecontroleerd.geldig) {
      return { status: 'afgekeurd', reden: gecontroleerd.reden };
    }

    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const vergrendeld = await tx.execute(
          sql`SELECT engagement_id FROM clm.vendor_engagement
               WHERE engagement_id = ${engagementId}
                 AND deleted_at IS NULL
               FOR UPDATE`,
        );

        if (vergrendeld.rows.length === 0) {
          throw new NotFoundException('Dit dossier bestaat niet.');
        }

        const aantal = await tx.execute<{ aantal: string }>(
          sql`SELECT count(*)::text AS aantal
                FROM clm.vendor_engagement_attachment
               WHERE engagement_id = ${engagementId}
                 AND deleted_at IS NULL`,
        );

        if (Number(aantal.rows[0]?.aantal ?? '0') >= MAX_BIJLAGEN_PER_ENGAGEMENT) {
          return { status: 'te-veel-bijlagen' as const };
        }

        const storageKey = maakEngagementOpslagsleutel(
          tenantId,
          engagementId,
        );

        await this.opslag.bewaar(storageKey, bestand.buffer);

        const resultaat = await tx.execute<AttachmentRij>(
          sql`INSERT INTO clm.vendor_engagement_attachment
                     (engagement_id, tenant_id, storage_key, original_filename,
                      content_type, size_bytes, uploaded_by_user_id)
              VALUES (${engagementId}, ${tenantId}, ${storageKey},
                      ${bestand.originalname}, ${gecontroleerd.contentType},
                      ${bestand.buffer.length}, ${uploadedByUserId})
              RETURNING attachment_id, engagement_id, original_filename,
                        content_type, size_bytes, uploaded_by_user_id, created_at`,
        );

        const rij = resultaat.rows[0];
        if (!rij) {
          await this.opslag.verwijder(storageKey);
          throw new BadRequestException(
            'De bijlage kon niet worden opgeslagen.',
          );
        }

        return {
          status: 'opgeslagen' as const,
          attachment: this.naarAttachment(rij),
        };
      },
      'medewerker',
    );
  }

  async engagementIntrekken(
    tenantId: string,
    engagementId: string,
  ): Promise<void> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const geraakt = await tx.execute(
          sql`UPDATE clm.vendor_engagement
                 SET deleted_at = now()
               WHERE engagement_id = ${engagementId}
                 AND deleted_at IS NULL`,
        );

        if (geraakt.rowCount === 0) {
          throw new NotFoundException(
            'Dit dossier bestaat niet, of is al ingetrokken.',
          );
        }
      },
      'medewerker',
    );
  }

  async bijlageIntrekken(
    tenantId: string,
    engagementId: string,
    attachmentId: string,
  ): Promise<void> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const geraakt = await tx.execute(
          sql`UPDATE clm.vendor_engagement_attachment
                 SET deleted_at = now()
               WHERE attachment_id = ${attachmentId}
                 AND engagement_id = ${engagementId}
                 AND deleted_at IS NULL`,
        );

        if (geraakt.rowCount === 0) {
          throw new NotFoundException(
            'Deze bijlage bestaat niet, of is al ingetrokken.',
          );
        }
      },
      'medewerker',
    );
  }

  /**
   * Leest de opslagsleutel voor een download, met tenant- en
   * engagement-controle. Geeft null als de bijlage niet (meer) bestaat.
   */
  async bijlageOpslagsleutel(
    tenantId: string,
    attachmentId: string,
  ): Promise<{ storageKey: string; originalFilename: string; contentType: string } | null> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const resultaat = await tx.execute<{
          storage_key: string;
          original_filename: string;
          content_type: string;
        }>(
          sql`SELECT storage_key, original_filename, content_type
                FROM clm.vendor_engagement_attachment
               WHERE attachment_id = ${attachmentId}
                 AND deleted_at IS NULL`,
        );

        const rij = resultaat.rows[0];
        if (!rij) return null;

        return {
          storageKey: rij.storage_key,
          originalFilename: rij.original_filename,
          contentType: rij.content_type,
        };
      },
      'medewerker',
    );
  }

  private async eisBestaandeVendor(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    vendorId: string,
  ): Promise<void> {
    const gevonden = await tx.execute(
      sql`SELECT 1 FROM clm.vendor WHERE vendor_id = ${vendorId}`,
    );

    if (gevonden.rows.length === 0) {
      throw new NotFoundException('Deze leverancier bestaat niet.');
    }
  }

  private async eisBestaandEngagement(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    engagementId: string,
  ): Promise<void> {
    const gevonden = await tx.execute(
      sql`SELECT 1 FROM clm.vendor_engagement
           WHERE engagement_id = ${engagementId} AND deleted_at IS NULL`,
    );

    if (gevonden.rows.length === 0) {
      throw new NotFoundException('Dit dossier bestaat niet.');
    }
  }

  /**
   * Controleert dat het koppeldoel (contract of survey-response) echt
   * bestaat binnen deze tenant, vóórdat er een link naar wordt aangemaakt.
   * linked_id kan geen FK dragen (twee mogelijke doeltabellen — zie migratie
   * 0041), dus dit is de enige plek die dat bestaan afdwingt.
   */
  private async eisBestaandLinkDoel(
    tx: Parameters<Parameters<DatabaseService['withTenant']>[1]>[0],
    linkType: LinkType,
    linkedId: string,
  ): Promise<void> {
    const tabel = linkType === 'contract' ? 'clm.contract' : 'clm.survey_response';
    const kolom = linkType === 'contract' ? 'contract_id' : 'response_id';

    const gevonden = await tx.execute(
      sql`SELECT 1 FROM ${sql.raw(tabel)} WHERE ${sql.raw(kolom)} = ${linkedId}`,
    );

    if (gevonden.rows.length === 0) {
      throw new BadRequestException(
        linkType === 'contract'
          ? 'Dit contract bestaat niet.'
          : 'Deze vragenlijst-inzending bestaat niet.',
      );
    }
  }

  private naarEngagement(
    r: EngagementRij,
    alleLinks: LinkRij[],
    alleAttachments: AttachmentRij[],
  ): Engagement {
    return {
      engagementId: r.engagement_id,
      vendorId: r.vendor_id,
      titel: r.titel,
      createdByUserId: r.created_by_user_id,
      createdByNaam: r.created_by_naam,
      createdAt: iso(r.created_at),
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

  private naarAttachment(r: AttachmentRij): EngagementAttachment {
    return {
      attachmentId: r.attachment_id,
      originalFilename: r.original_filename,
      contentType: r.content_type,
      sizeBytes: r.size_bytes,
      uploadedByUserId: r.uploaded_by_user_id,
      createdAt: iso(r.created_at),
    };
  }
}
```

**Let op — `sql.raw()` in `eisBestaandLinkDoel`:** `tabel` en `kolom` komen
uit een interne switch op `linkType` (`'contract' | 'survey_response'`), niet
rechtstreeks uit gebruikersinvoer — `linkType` zelf wordt al eerder
gevalideerd door de controller (Task 8) tegen exact deze twee waarden vóór
de service ooit wordt aangeroepen. `sql.raw()` is hier dus veilig, maar
alleen omdat de waarde nooit direct van de client komt.

- [ ] **Step 2: Compileer**

Run: `npm run build`

Expected: geen TypeScript-fouten.

- [ ] **Step 3: Commit**

```bash
git add src/vendor/vendor-engagement.service.ts
git commit -m "feat(vendor): VendorEngagementService - aanmaken, links, bijlagen, intrekken"
```

---

### Task 8: Invoervalidatie en controller

**Files:**
- Create: `src/vendor/vendor-engagement-invoer.ts`
- Create: `src/vendor/vendor-engagement.controller.ts`
- Test: (e2e in Task 10)

- [ ] **Step 1: Schrijf de invoervalidatie**

Create `src/vendor/vendor-engagement-invoer.ts`, volgens het patroon van
`src/vendor/vendor-invoer.ts` (handmatige validatie op `unknown`, geen
class-validator):

```typescript
import type { LinkType } from './vendor-engagement.service';

const MAX_TITEL = 300;

export class InvoerFout extends Error {
  constructor(
    readonly veld: string,
    melding: string,
  ) {
    super(melding);
    this.name = 'InvoerFout';
  }
}

export interface NieuwEngagementInvoer {
  titel: string;
  links: ReadonlyArray<{ linkType: LinkType; linkedId: string }>;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(waarde: unknown): waarde is string {
  return typeof waarde === 'string' && UUID_REGEX.test(waarde);
}

function leesLink(waarde: unknown): { linkType: LinkType; linkedId: string } {
  if (typeof waarde !== 'object' || waarde === null) {
    throw new InvoerFout('links', 'Elke link moet een object zijn.');
  }

  const obj = waarde as Record<string, unknown>;

  if (obj.linkType !== 'contract' && obj.linkType !== 'survey_response') {
    throw new InvoerFout(
      'links',
      "linkType moet 'contract' of 'survey_response' zijn.",
    );
  }

  if (!isUuid(obj.linkedId)) {
    throw new InvoerFout('links', 'linkedId moet een geldige uuid zijn.');
  }

  return { linkType: obj.linkType, linkedId: obj.linkedId };
}

export function leesNieuwEngagement(body: unknown): NieuwEngagementInvoer {
  if (typeof body !== 'object' || body === null) {
    throw new InvoerFout('body', 'Ongeldige invoer.');
  }

  const obj = body as Record<string, unknown>;

  if (
    typeof obj.titel !== 'string' ||
    obj.titel.trim() === '' ||
    obj.titel.length > MAX_TITEL
  ) {
    throw new InvoerFout(
      'titel',
      `titel is verplicht en mag maximaal ${MAX_TITEL} tekens zijn.`,
    );
  }

  const linksRaw = obj.links;
  const links =
    linksRaw === undefined
      ? []
      : Array.isArray(linksRaw)
        ? linksRaw.map(leesLink)
        : (() => {
            throw new InvoerFout('links', 'links moet een lijst zijn.');
          })();

  return { titel: obj.titel.trim(), links };
}

export function leesNieuweLink(
  body: unknown,
): { linkType: LinkType; linkedId: string } {
  return leesLink(body);
}
```

- [ ] **Step 2: Schrijf de controller**

Create `src/vendor/vendor-engagement.controller.ts`, volgens het patroon van
`VendorController` (`TenantContextGuard` + `RolGuard` op klasseniveau) en de
notitie-routes in `VragenlijstBeheerController` (multer voor
file-uploads — zoek hoe `BijlageBeheerService`/de route voor beheerder-
uploads dat al doet in `vragenlijst-beheer.controller.ts` als exact
voorbeeld voor de `@UseInterceptors(FileInterceptor(...))`-syntax vóór je dit
schrijft):

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { RolGuard, VereistRol } from '../auth/rol.guard';
import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../auth/tenant-context.guard';
import { BestandOpslagService } from '../survey/bestand-opslag.service';
import { veiligeWeergavenaam } from '../survey/bestand-validatie';
import { MAX_BESTANDSGROOTTE } from './vendor-engagement-bestand-validatie';
import {
  InvoerFout,
  leesNieuwEngagement,
  leesNieuweLink,
} from './vendor-engagement-invoer';
import { VendorEngagementService } from './vendor-engagement.service';

/**
 * Vendor-dossiers (engagements): zie
 * docs/superpowers/specs/2026-09-24-vendor-dossiers-design.md.
 *
 * Rol 'medewerker' nu — elke gebruiker in de tenant mag aanmaken/inzien.
 * @VereistRol('medewerker') hier is bewust zo gekozen dat een latere
 * beperking tot alleen contractbeheerder/admin één parameter-wijziging is.
 */
@Controller()
@UseGuards(TenantContextGuard, RolGuard)
export class VendorEngagementController {
  constructor(
    private readonly engagements: VendorEngagementService,
    private readonly opslag: BestandOpslagService,
  ) {}

  @Get('vendors/:vendorId/engagements')
  @VereistRol('medewerker')
  async lijst(
    @Req() request: RequestMetSessie,
    @Param('vendorId') vendorId: string,
  ) {
    const sessie = request.sessie!;
    const engagements = await this.engagements.lijstVoorVendor(
      sessie.tenantId,
      vendorId,
    );
    return { engagements };
  }

  @Post('vendors/:vendorId/engagements')
  @VereistRol('medewerker')
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
      invoer.links,
    );

    return { engagement };
  }

  @Post('engagements/:id/links')
  @VereistRol('medewerker')
  @HttpCode(201)
  async linkToevoegen(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const sessie = request.sessie!;

    let invoer: ReturnType<typeof leesNieuweLink>;
    try {
      invoer = leesNieuweLink(body);
    } catch (err) {
      throw this.naarHttpFout(err);
    }

    const link = await this.engagements.linkToevoegen(
      sessie.tenantId,
      id,
      invoer.linkType,
      invoer.linkedId,
    );

    return { link };
  }

  @Post('engagements/:id/attachments')
  @VereistRol('medewerker')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('bestand', { limits: { fileSize: MAX_BESTANDSGROOTTE } }),
  )
  async bijlageToevoegen(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @UploadedFile() bestand?: Express.Multer.File,
  ) {
    const sessie = request.sessie!;

    if (!bestand) {
      throw new BadRequestException('Geen bestand ontvangen.');
    }

    const uitkomst = await this.engagements.bijlageToevoegen(
      sessie.tenantId,
      id,
      sessie.userId,
      {
        originalname: bestand.originalname,
        mimetype: bestand.mimetype,
        buffer: bestand.buffer,
      },
    );

    if (uitkomst.status === 'afgekeurd') {
      throw new BadRequestException(
        `Bestand afgekeurd: ${uitkomst.reden}.`,
      );
    }

    if (uitkomst.status === 'te-veel-bijlagen') {
      throw new BadRequestException(
        'Dit dossier heeft al het maximum van 3 bijlagen.',
      );
    }

    return { attachment: uitkomst.attachment };
  }

  @Get('engagements/attachments/:attachmentId')
  @VereistRol('medewerker')
  async downloaden(
    @Req() request: RequestMetSessie,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const sessie = request.sessie!;

    const gegevens = await this.engagements.bijlageOpslagsleutel(
      sessie.tenantId,
      attachmentId,
    );

    if (!gegevens) {
      res.status(404).json({ melding: 'Deze bijlage bestaat niet.' });
      return;
    }

    const inhoud = await this.opslag.lees(gegevens.storageKey);
    const naam = veiligeWeergavenaam(gegevens.originalFilename);

    res.setHeader('Content-Type', gegevens.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${naam}"`);
    res.send(inhoud);
  }

  @Delete('engagements/:id')
  @VereistRol('medewerker')
  @HttpCode(204)
  async intrekken(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
  ) {
    const sessie = request.sessie!;
    await this.engagements.engagementIntrekken(sessie.tenantId, id);
  }

  @Delete('engagements/:id/attachments/:attachmentId')
  @VereistRol('medewerker')
  @HttpCode(204)
  async bijlageIntrekken(
    @Req() request: RequestMetSessie,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    const sessie = request.sessie!;
    await this.engagements.bijlageIntrekken(sessie.tenantId, id, attachmentId);
  }

  private naarHttpFout(err: unknown): Error {
    if (err instanceof InvoerFout) {
      return new BadRequestException(err.message);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
```

**Vóór je dit schrijft:** controleer in
`src/survey/vragenlijst-beheer.controller.ts` hoe de bestaande
`BijlageUploadveld`/beheer-upload-route `FileInterceptor` exact configureert
(veldnaam, of er nog een `fileFilter` bij zit) en houd de veldnaam
(`'bestand'` hierboven) consistent met wat de frontend straks daadwerkelijk
verstuurt in Task 13 — pas anders deze naam aan in beide.

- [ ] **Step 3: Compileer**

Run: `npm run build`

Expected: geen TypeScript-fouten. Als `@nestjs/platform-express` of het
`Express.Multer.File`-type niet gevonden wordt, controleer hoe
`vragenlijst-beheer.controller.ts` dat importeert en kopieer die aanpak.

- [ ] **Step 4: Commit**

```bash
git add src/vendor/vendor-engagement-invoer.ts src/vendor/vendor-engagement.controller.ts
git commit -m "feat(vendor): VendorEngagementController - routes voor dossiers"
```

---

### Task 9: Module registreren

**Files:**
- Modify: `src/vendor/vendor.module.ts`
- Modify: `src/app.module.ts` (indien `VendorModule` daar niet al alles
  exporteert wat nodig is — controleer eerst)

- [ ] **Step 1: Bekijk hoe `VendorModule` en `app.module.ts` samenhangen**

Run: `grep -n "VendorModule" src/app.module.ts`

- [ ] **Step 2: Breid `VendorModule` uit**

In `src/vendor/vendor.module.ts`, voeg de nieuwe controller/service toe en
importeer `BestandOpslagService` (uit `SurveyModule`, of registreer hem hier
opnieuw als provider — controleer of `SurveyModule` hem exporteert; zo ja,
importeer `SurveyModule`, zo nee, voeg `BestandOpslagService` hier als eigen
provider toe omdat de klasse geen module-eigen state heeft):

```typescript
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BestandOpslagService } from '../survey/bestand-opslag.service';
import { VendorController } from './vendor.controller';
import { VendorEngagementController } from './vendor-engagement.controller';
import { VendorEngagementService } from './vendor-engagement.service';
import { VendorService } from './vendor.service';

@Module({
  imports: [AuthModule],
  controllers: [VendorController, VendorEngagementController],
  providers: [VendorService, VendorEngagementService, BestandOpslagService],
  exports: [VendorService, VendorEngagementService],
})
export class VendorModule {}
```

- [ ] **Step 3: Zet een wegwerpdatabase op en start de applicatie**

Run: `npm run test:db -- "vendor engagement module"` en daarna
`npm run build && npm run start` (met de door `test:db` afgedrukte
`DATABASE_URL` geëxporteerd).

Expected: de applicatie start zonder "Nest can't resolve dependencies"-fout.
Stop de server na verificatie (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
git add src/vendor/vendor.module.ts
git commit -m "feat(vendor): VendorEngagementController/-Service registreren in VendorModule"
```

---

## Fase D — Backend: e2e-tests

### Task 10: Test-ids en opzet

**Files:**
- Modify: `test/test-ids.ts`

- [ ] **Step 1: Voeg een `vendorEngagements`-blok toe**

In `test/test-ids.ts`, volg het patroon van het bestaande `notities`-blok
(regel 262+). Voeg een nieuw blok toe met een niet eerder gebruikt
uuid-bereik (controleer het hoogste bestaande nummer in het bestand en tel
door, bijv. als `notities` tot `...099` gaat, begin dan bij `...100`):

```typescript
  vendorEngagements: {
    tenantA: '00000000-0000-0000-0000-000000000100',
    tenantB: '00000000-0000-0000-0000-000000000101',
    adminA: '00000000-0000-0000-0000-000000000102',
    adminB: '00000000-0000-0000-0000-000000000103',
    vendorA: '00000000-0000-0000-0000-000000000104',
    templateA: '00000000-0000-0000-0000-000000000105',
    runA: '00000000-0000-0000-0000-000000000106',
    responseA: '00000000-0000-0000-0000-000000000107',
    contractA: '00000000-0000-0000-0000-000000000108',
    engagementBestaatNiet: '00000000-0000-0000-0000-000000000109',
  },
```

Controleer vóór je dit toevoegt met `grep -n "000000001" test/test-ids.ts`
of dit bereik al ergens anders in gebruik is, en pas de nummers aan indien
nodig.

- [ ] **Step 2: Commit**

```bash
git add test/test-ids.ts
git commit -m "test: vendorEngagements test-ids toevoegen"
```

---

### Task 11: E2e-suite — aanmaken, links, tenantgrens

**Files:**
- Create: `test/vendor-engagements.e2e-spec.ts`

Volg het patroon van `test/notities.e2e-spec.ts` exact: `verwijderTestdata`
in `beforeAll`/`afterAll`, sessies via `SessieService`, fixtures met
`SET LOCAL app.current_actor = 'medewerker'`.

- [ ] **Step 1: Schrijf de test-opzet en de eerste failing tests**

Create `test/vendor-engagements.e2e-spec.ts`:

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
 * Vendor-dossiers (engagements) — migratie 0040/0041/0042.
 *
 * Wat hier kan stuk gaan zonder dat het opvalt:
 *   1. Kan tenant B een engagement van tenant A zien/aanmaken/koppelen?
 *   2. Wordt de auteur uit de sessie genomen, nooit uit de body?
 *   3. Werkt intrekken via deleted_at (rij blijft bestaan)?
 *   4. Kan een engagement zonder links aangemaakt worden (los verzoek)?
 *   5. Weigert een link naar een niet-bestaand contract/response?
 */

const {
  tenantA,
  tenantB,
  adminA: ADMIN_A,
  adminB: ADMIN_B,
  vendorA: VENDOR_A,
  templateA: TEMPLATE_A,
  runA: RUN_A,
  responseA: RESPONSE_A,
  contractA: CONTRACT_A,
  engagementBestaatNiet: ENGAGEMENT_BESTAAT_NIET,
} = TEST_IDS.vendorEngagements;

const SUBJECT_ADMIN = `oid-ve-a-${Date.now()}`;
const SUBJECT_B = `oid-ve-b-${Date.now()}`;
const TOKEN_HASH = `${'7'.repeat(48)}eeeeeeeeeeeeeeee`;

interface EngagementBody {
  engagement: {
    engagementId: string;
    vendorId: string;
    titel: string;
    createdByUserId: string;
    createdByNaam: string | null;
    createdAt: string;
    links: Array<{ linkId: string; linkType: string; linkedId: string }>;
    attachments: unknown[];
  };
}

interface LijstBody {
  engagements: EngagementBody['engagement'][];
}

describe('Vendor-dossiers (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdminA: string;
  let cookieB: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(tenantA, tenantB);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);

    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantA, 'Tenant A (engagements)'],
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
      [VENDOR_A, tenantA, 'Leverancier van A'],
    );
    await client.query(
      `INSERT INTO clm.survey_template (template_id, tenant_id, name, version)
       VALUES ($1, $2, 'engagement-test-lijst', 1)`,
      [TEMPLATE_A, tenantA],
    );
    await client.query(
      `INSERT INTO clm.survey_run
         (run_id, tenant_id, template_id, status, survey_kind, is_test, started_at)
       VALUES ($1, $2, $3, 'active', 'vendor_compliance', true, now())`,
      [RUN_A, tenantA, TEMPLATE_A],
    );
    await client.query(
      `INSERT INTO clm.survey_response
         (response_id, tenant_id, run_id, vendor_id, subject_vendor_id,
          token_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, $4, $5, 'pending', now() + interval '30 days')`,
      [RESPONSE_A, tenantA, RUN_A, VENDOR_A, TOKEN_HASH],
    );
    await client.query(
      `INSERT INTO clm.contract (contract_id, tenant_id, vendor_id, title)
       VALUES ($1, $2, $3, 'Testcontract A')`,
      [CONTRACT_A, tenantA, VENDOR_A],
    );
    await client.query('COMMIT');

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantB}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantB, 'Tenant B (engagements)'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, email, full_name, external_subject)
       VALUES ($1, $2, $3, 'Admin van B', $4)`,
      [ADMIN_B, tenantB, `${SUBJECT_B}@voorbeeld.nl`, SUBJECT_B],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [ADMIN_B, tenantB],
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
    const naam = cookieInstellingen().naam;
    for (const [subject, doel] of [
      [SUBJECT_ADMIN, 'a'],
      [SUBJECT_B, 'b'],
    ] as const) {
      const sessie = await sessies.aanmaken(subject);
      expect(sessie).not.toBeNull();

      const cookie = `${naam}=${sessie!.token}`;
      if (doel === 'a') cookieAdminA = cookie;
      else cookieB = cookie;
    }
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(tenantA, tenantB);
    await client.end();
  }, 30000);

  describe('een dossier aanmaken', () => {
    it('mag zonder enige koppeling (los verzoek aan de leverancier)', async () => {
      const antwoord = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({ titel: 'Los verzoek cyberveiligheid' })
        .expect(201);

      const { engagement } = antwoord.body as EngagementBody;
      expect(engagement.titel).toBe('Los verzoek cyberveiligheid');
      expect(engagement.createdByUserId).toBe(ADMIN_A);
      expect(engagement.createdByNaam).toBe('Admin van A');
      expect(engagement.links).toEqual([]);
    });

    it('mag met een initiële link naar een contract', async () => {
      const antwoord = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Cyberveiligheidscontract heronderhandelen',
          links: [{ linkType: 'contract', linkedId: CONTRACT_A }],
        })
        .expect(201);

      const { engagement } = antwoord.body as EngagementBody;
      expect(engagement.links).toHaveLength(1);
      expect(engagement.links[0]).toMatchObject({
        linkType: 'contract',
        linkedId: CONTRACT_A,
      });
    });

    it('mag met een initiële link naar een survey-response', async () => {
      const antwoord = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Vervolg op survey-antwoord',
          links: [{ linkType: 'survey_response', linkedId: RESPONSE_A }],
        })
        .expect(201);

      const { engagement } = antwoord.body as EngagementBody;
      expect(engagement.links[0]).toMatchObject({
        linkType: 'survey_response',
        linkedId: RESPONSE_A,
      });
    });

    it('weigert een lege titel', async () => {
      await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({ titel: '   ' })
        .expect(400);
    });

    it('weigert een link naar een niet-bestaand contract', async () => {
      await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Foute koppeling',
          links: [{ linkType: 'contract', linkedId: ENGAGEMENT_BESTAAT_NIET }],
        })
        .expect(400);
    });

    it('negeert createdByUserId uit de body en gebruikt de sessie', async () => {
      const antwoord = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({ titel: 'Op naam van een ander?', createdByUserId: ADMIN_B })
        .expect(201);

      expect((antwoord.body as EngagementBody).engagement.createdByUserId).toBe(
        ADMIN_A,
      );
    });
  });

  describe('een link achteraf toevoegen', () => {
    it('koppelt een tweede survey-ronde aan een bestaand dossier', async () => {
      const aanmaak = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({ titel: 'Meerjarig dossier' })
        .expect(201);

      const engagementId = (aanmaak.body as EngagementBody).engagement
        .engagementId;

      await request(server)
        .post(`/engagements/${engagementId}/links`)
        .set('Cookie', cookieAdminA)
        .send({ linkType: 'contract', linkedId: CONTRACT_A })
        .expect(201);

      const lijst = await request(server)
        .get(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      const gevonden = (lijst.body as LijstBody).engagements.find(
        (e) => e.engagementId === engagementId,
      );
      expect(gevonden?.links).toHaveLength(1);
    });

    it('weigert een dubbele link naar hetzelfde contract', async () => {
      const aanmaak = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({
          titel: 'Dubbele koppeling',
          links: [{ linkType: 'contract', linkedId: CONTRACT_A }],
        })
        .expect(201);

      const engagementId = (aanmaak.body as EngagementBody).engagement
        .engagementId;

      await request(server)
        .post(`/engagements/${engagementId}/links`)
        .set('Cookie', cookieAdminA)
        .send({ linkType: 'contract', linkedId: CONTRACT_A })
        .expect(400);
    });
  });

  describe('meerdere, onafhankelijke dossiers per leverancier', () => {
    it('staat geen limiet toe op het aantal engagements per vendor', async () => {
      for (let i = 0; i < 4; i++) {
        await request(server)
          .post(`/vendors/${VENDOR_A}/engagements`)
          .set('Cookie', cookieAdminA)
          .send({ titel: `Dossier nummer ${i}` })
          .expect(201);
      }

      const lijst = await request(server)
        .get(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      expect(
        (lijst.body as LijstBody).engagements.length,
      ).toBeGreaterThanOrEqual(4);
    });
  });

  describe('een dossier intrekken', () => {
    it('haalt hem uit de lijst maar bewaart de rij (deleted_at)', async () => {
      const aanmaak = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({ titel: 'Deze gaat weg' })
        .expect(201);

      const engagementId = (aanmaak.body as EngagementBody).engagement
        .engagementId;

      await request(server)
        .delete(`/engagements/${engagementId}`)
        .set('Cookie', cookieAdminA)
        .expect(204);

      const lijst = await request(server)
        .get(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      const ids = (lijst.body as LijstBody).engagements.map(
        (e) => e.engagementId,
      );
      expect(ids).not.toContain(engagementId);

      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
      await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
      const rij = await client.query<{ deleted_at: Date | null }>(
        'SELECT deleted_at FROM clm.vendor_engagement WHERE engagement_id = $1',
        [engagementId],
      );
      await client.query('COMMIT');

      expect(rij.rows).toHaveLength(1);
      expect(rij.rows[0].deleted_at).not.toBeNull();
    });

    it('geeft 404 bij een tweede intrekpoging', async () => {
      const aanmaak = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({ titel: 'Eenmalig' })
        .expect(201);

      const engagementId = (aanmaak.body as EngagementBody).engagement
        .engagementId;
      const pad = `/engagements/${engagementId}`;

      await request(server).delete(pad).set('Cookie', cookieAdminA).expect(204);
      await request(server).delete(pad).set('Cookie', cookieAdminA).expect(404);
    });
  });

  describe('de tenantgrens', () => {
    it('laat tenant B geen dossier aanmaken bij een vendor van tenant A', async () => {
      await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieB)
        .send({ titel: 'Meekijken?' })
        .expect(404);
    });

    it('laat tenant B de dossiers van tenant A niet lezen', async () => {
      await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({ titel: 'Vertrouwelijk voor A' })
        .expect(201);

      await request(server)
        .get(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieB)
        .expect(404);
    });

    it('laat tenant B een dossier van tenant A niet intrekken', async () => {
      const aanmaak = await request(server)
        .post(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .send({ titel: 'Blijft staan' })
        .expect(201);

      const engagementId = (aanmaak.body as EngagementBody).engagement
        .engagementId;

      await request(server)
        .delete(`/engagements/${engagementId}`)
        .set('Cookie', cookieB)
        .expect(404);

      const lijst = await request(server)
        .get(`/vendors/${VENDOR_A}/engagements`)
        .set('Cookie', cookieAdminA)
        .expect(200);

      const ids = (lijst.body as LijstBody).engagements.map(
        (e) => e.engagementId,
      );
      expect(ids).toContain(engagementId);
    });
  });
});
```

- [ ] **Step 2: Draai de suite, verwacht failures**

Run: `npm run build && npx jest --config ./test/jest-e2e.json vendor-engagements`

Expected: FAIL bij aanvang (routes/service bestaan al uit voorgaande taken,
dus dit zou nu grotendeels moeten slagen — als er failures zijn, diagnosticeer
ze via de foutmelding, niet door aannames; zie CLAUDE.md punt 6 over
diagnosemethode).

- [ ] **Step 3: Los eventuele failures op en herhaal tot alles groen is**

Run: `npx jest --config ./test/jest-e2e.json vendor-engagements`

Expected: alle tests PASS.

- [ ] **Step 4: Draai de volledige e2e-suite**

Run: `npx jest --config ./test/jest-e2e.json test-ids` en daarna de volledige
suite: `npm run test:e2e`

Expected: alles groen. Zie CLAUDE.md punt 5 ("Alle suites delen één
database... draai altijd `npx jest test-ids` én de volledige e2e-run").

- [ ] **Step 5: Commit**

```bash
git add test/vendor-engagements.e2e-spec.ts
git commit -m "test(e2e): vendor-dossiers - aanmaken, links, intrekken, tenantgrens"
```

---

### Task 12: E2e-suite — bijlagen (upload, maximum, download)

**Files:**
- Create: `test/vendor-engagement-bijlagen.e2e-spec.ts`

- [ ] **Step 1: Schrijf de test**

Create `test/vendor-engagement-bijlagen.e2e-spec.ts`. Gebruik dezelfde
`beforeAll`/`afterAll`-opzet als Task 11 (kopieer die fixture-opzet exact,
met een eigen tenant-paar uit `TEST_IDS.vendorEngagements` — voeg zo nodig
een `tenantC`/`vendorC`-paar toe aan `test-ids.ts` om overlap met Task 11 te
vermijden, of hergebruik dezelfde tenants als deze suite na Task 11 draait;
kies voor een eigen tenant-paar, want suites kunnen in willekeurige volgorde
draaien — zie CLAUDE.md punt 5):

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
 * Bijlagen bij een vendor-dossier — max. 3 per engagement, PDF/PNG/DOCX/XLSX,
 * max. 10MB. Zie migratie 0042 en
 * src/vendor/vendor-engagement-bestand-validatie.ts.
 */

const {
  tenantA,
  tenantB,
  adminA: ADMIN_A,
  vendorA: VENDOR_A,
} = TEST_IDS.vendorEngagements;

const SUBJECT_ADMIN = `oid-veb-a-${Date.now()}`;
const PDF_INHOUD = Buffer.concat([
  Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
  Buffer.from('testinhoud'),
]);

interface EngagementBody {
  engagement: { engagementId: string };
}

interface AttachmentBody {
  attachment: {
    attachmentId: string;
    originalFilename: string;
    contentType: string;
    sizeBytes: number;
  };
}

describe('Bijlagen bij een vendor-dossier (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let cookieAdminA: string;
  let engagementId: string;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(tenantA, tenantB);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenantA, 'Tenant A (engagement-bijlagen)'],
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
      [VENDOR_A, tenantA, 'Leverancier van A'],
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
    const naam = cookieInstellingen().naam;
    const sessie = await sessies.aanmaken(SUBJECT_ADMIN);
    expect(sessie).not.toBeNull();
    cookieAdminA = `${naam}=${sessie!.token}`;

    const aanmaak = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({ titel: 'Dossier met bijlagen' })
      .expect(201);

    engagementId = (aanmaak.body as EngagementBody).engagement.engagementId;
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(tenantA, tenantB);
    await client.end();
  }, 30000);

  it('accepteert een PDF-bijlage', async () => {
    const antwoord = await request(server)
      .post(`/engagements/${engagementId}/attachments`)
      .set('Cookie', cookieAdminA)
      .attach('bestand', PDF_INHOUD, {
        filename: 'compliance-bewijs.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const { attachment } = antwoord.body as AttachmentBody;
    expect(attachment.originalFilename).toBe('compliance-bewijs.pdf');
    expect(attachment.contentType).toBe('application/pdf');
  });

  it('weigert een onbekend bestandstype', async () => {
    await request(server)
      .post(`/engagements/${engagementId}/attachments`)
      .set('Cookie', cookieAdminA)
      .attach('bestand', Buffer.from('gewoon tekst'), {
        filename: 'notitie.txt',
        contentType: 'text/plain',
      })
      .expect(400);
  });

  it('weigert de vierde bijlage bij een dossier dat er al 3 heeft', async () => {
    const aanmaak = await request(server)
      .post(`/vendors/${VENDOR_A}/engagements`)
      .set('Cookie', cookieAdminA)
      .send({ titel: 'Dossier tot aan het maximum' })
      .expect(201);

    const eigenEngagementId = (aanmaak.body as EngagementBody).engagement
      .engagementId;

    for (let i = 0; i < 3; i++) {
      await request(server)
        .post(`/engagements/${eigenEngagementId}/attachments`)
        .set('Cookie', cookieAdminA)
        .attach('bestand', PDF_INHOUD, {
          filename: `bewijs-${i}.pdf`,
          contentType: 'application/pdf',
        })
        .expect(201);
    }

    await request(server)
      .post(`/engagements/${eigenEngagementId}/attachments`)
      .set('Cookie', cookieAdminA)
      .attach('bestand', PDF_INHOUD, {
        filename: 'bewijs-4.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
  });

  it('geeft de bijlage terug bij downloaden', async () => {
    const upload = await request(server)
      .post(`/engagements/${engagementId}/attachments`)
      .set('Cookie', cookieAdminA)
      .attach('bestand', PDF_INHOUD, {
        filename: 'download-test.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const attachmentId = (upload.body as AttachmentBody).attachment
      .attachmentId;

    const download = await request(server)
      .get(`/engagements/attachments/${attachmentId}`)
      .set('Cookie', cookieAdminA)
      .expect(200);

    expect(download.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(download.body as Buffer)).toEqual(PDF_INHOUD);
  });

  it('trekt een bijlage in via deleted_at, rij blijft bestaan', async () => {
    const upload = await request(server)
      .post(`/engagements/${engagementId}/attachments`)
      .set('Cookie', cookieAdminA)
      .attach('bestand', PDF_INHOUD, {
        filename: 'wordt-ingetrokken.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const attachmentId = (upload.body as AttachmentBody).attachment
      .attachmentId;

    await request(server)
      .delete(`/engagements/${engagementId}/attachments/${attachmentId}`)
      .set('Cookie', cookieAdminA)
      .expect(204);

    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantA}'`);
    await client.query(`SET LOCAL app.current_actor = 'medewerker'`);
    const rij = await client.query<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM clm.vendor_engagement_attachment WHERE attachment_id = $1',
      [attachmentId],
    );
    await client.query('COMMIT');

    expect(rij.rows).toHaveLength(1);
    expect(rij.rows[0].deleted_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Draai de suite**

Run: `npx jest --config ./test/jest-e2e.json vendor-engagement-bijlagen`

Expected: alle tests PASS. Als de upload-route een andere multer-veldnaam
verwacht dan `'bestand'`, stem Task 8's controller en deze test op elkaar af
(zie de opmerking in Task 8 Step 2).

- [ ] **Step 3: Draai de volledige e2e-suite nogmaals**

Run: `npm run test:e2e`

Expected: alles groen.

- [ ] **Step 4: Commit**

```bash
git add test/vendor-engagement-bijlagen.e2e-spec.ts
git commit -m "test(e2e): vendor-dossier-bijlagen - upload, maximum, download, intrekken"
```

---

### Task 13: `npm run verify:volledig`

**Files:** (geen wijzigingen — verificatiestap)

- [ ] **Step 1: Draai de volledige verificatie**

Run: `npm run verify:volledig`

Expected: alles groen. Los eventuele issues op vóórdat je verdergaat naar de
frontend — zie CLAUDE.md: "Groen is alleen groen via verify."

- [ ] **Step 2: Commit (indien er nog opruimwijzigingen nodig waren)**

Alleen als Step 1 nog wijzigingen vereiste.

---

## Fase E — Frontend: types en service

> Werkdirectory voor deze fase: `C:\DEV\Work\MCM2-frontend`. Dit is een
> aparte git-repo (`AlingAdvies/MCM2-frontend`) — commits horen daar, niet in
> de backend-repo. Zie `CLAUDE.md` (MCM2, hoofdrepo) §"Tweede repo, 1-op-1
> gekoppeld".

### Task 14: Types en service-aanroepen

**Files:**
- Create: `src/core/models/vendorEngagement.ts`
- Create: `src/core/services/vendorEngagementService.ts`

- [ ] **Step 1: Bekijk het bestaande patroon**

Run (in `MCM2-frontend`): open `src/core/models/vragenlijst.ts` en
`src/core/services/vragenlijstService.ts` om de exacte stijl van
type-definities en `apiClient`-aanroepen over te nemen (fetch-wrapper, hoe
`ApiFout` gebruikt wordt).

- [ ] **Step 2: Schrijf de types**

Create `src/core/models/vendorEngagement.ts`:

```typescript
export type EngagementLinkType = 'contract' | 'survey_response';

export interface EngagementLink {
  linkId: string;
  linkType: EngagementLinkType;
  linkedId: string;
}

export interface EngagementAttachment {
  attachmentId: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  createdAt: string;
}

export interface VendorEngagement {
  engagementId: string;
  vendorId: string;
  titel: string;
  createdByUserId: string;
  createdByNaam: string | null;
  createdAt: string;
  links: EngagementLink[];
  attachments: EngagementAttachment[];
}

/** Nudge tegen een "circus van screenshots" — zie backend-spec. */
export const MAX_BIJLAGEN_PER_ENGAGEMENT = 3;
export const MAX_BESTANDSGROOTTE_BYTES = 10 * 1024 * 1024;
```

- [ ] **Step 3: Schrijf de service-functies**

Create `src/core/services/vendorEngagementService.ts`. Neem de exacte
fetch/foutafhandelingsstijl over uit `vragenlijstService.ts` (open dat
bestand ernaast en kopieer het patroon voor `apiClient`-gebruik, inclusief
hoe een multipart file-upload al elders gebeurt — zoek in
`vragenlijstService.ts` of een ander service-bestand naar `FormData` als
referentie voor de upload-functie hieronder):

```typescript
import { apiClient } from '@/core/api/client';
import type {
  EngagementLinkType,
  VendorEngagement,
} from '@/core/models/vendorEngagement';

export async function haalEngagements(
  vendorId: string,
): Promise<VendorEngagement[]> {
  const antwoord = await apiClient<{ engagements: VendorEngagement[] }>(
    `/vendors/${vendorId}/engagements`,
  );
  return antwoord.engagements;
}

export async function maakEngagement(
  vendorId: string,
  titel: string,
  links: ReadonlyArray<{ linkType: EngagementLinkType; linkedId: string }>,
): Promise<VendorEngagement> {
  const antwoord = await apiClient<{ engagement: VendorEngagement }>(
    `/vendors/${vendorId}/engagements`,
    { method: 'POST', body: JSON.stringify({ titel, links }) },
  );
  return antwoord.engagement;
}

export async function voegLinkToe(
  engagementId: string,
  linkType: EngagementLinkType,
  linkedId: string,
): Promise<void> {
  await apiClient(`/engagements/${engagementId}/links`, {
    method: 'POST',
    body: JSON.stringify({ linkType, linkedId }),
  });
}

export async function uploadBijlage(
  engagementId: string,
  bestand: File,
): Promise<void> {
  const formData = new FormData();
  formData.append('bestand', bestand);

  await apiClient(`/engagements/${engagementId}/attachments`, {
    method: 'POST',
    body: formData,
  });
}

export async function trekEngagementIn(engagementId: string): Promise<void> {
  await apiClient(`/engagements/${engagementId}`, { method: 'DELETE' });
}

export async function trekBijlageIn(
  engagementId: string,
  attachmentId: string,
): Promise<void> {
  await apiClient(
    `/engagements/${engagementId}/attachments/${attachmentId}`,
    { method: 'DELETE' },
  );
}

export function bijlageDownloadUrl(attachmentId: string): string {
  return `/engagements/attachments/${attachmentId}`;
}
```

**Let op:** pas de exacte signature van `apiClient` (headers, hoe
`FormData` vs. JSON-body onderscheiden wordt, base-URL-prefix) aan op wat
`src/core/api/client.ts` daadwerkelijk verwacht — lees dat bestand eerst.
Als `apiClient` automatisch een `Content-Type: application/json`-header
zet, moet de upload-functie die voor `FormData` juist *niet* meesturen
(de browser zet zelf de juiste multipart-boundary) — controleer of
`apiClient` die uitzondering al ondersteunt of dat er een aangepaste
`fetch`-aanroep nodig is voor uploads specifiek.

- [ ] **Step 4: Compileer**

Run: `npm run build`

Expected: geen TypeScript-fouten.

- [ ] **Step 5: Commit**

```bash
git add src/core/models/vendorEngagement.ts src/core/services/vendorEngagementService.ts
git commit -m "feat(vendor): types en service-aanroepen voor vendor-dossiers"
```

---

### Task 15: `EngagementPanel`-component

**Files:**
- Create: `src/shared/components/EngagementPanel.tsx`

- [ ] **Step 1: Bekijk `Contracten.tsx` en het bestaande uitnodigen-scherm**

Open `src/app/beheer/leveranciers/[id]/Contracten.tsx` voor het patroon van
een sectie-component op het vendorscherm (props, laadstatus, lege-staat), en
`src/app/beheer/vragenlijsten/uitnodigen/page.tsx` (regel 196-219) voor het
kopieer-feedback-patroon (niet nodig hier, maar wel de stijlconventies:
`data-testid`, kleurtokens `text-ink`/`bg-card`/`border-line`).

- [ ] **Step 2: Schrijf het component**

Create `src/shared/components/EngagementPanel.tsx`:

```typescript
'use client';

import { AlertTriangle, Download, FileText, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ApiFout } from '@/core/api/client';
import type {
  EngagementLinkType,
  VendorEngagement,
} from '@/core/models/vendorEngagement';
import {
  MAX_BESTANDSGROOTTE_BYTES,
  MAX_BIJLAGEN_PER_ENGAGEMENT,
} from '@/core/models/vendorEngagement';
import {
  bijlageDownloadUrl,
  haalEngagements,
  maakEngagement,
  trekBijlageIn,
  trekEngagementIn,
  uploadBijlage,
} from '@/core/services/vendorEngagementService';

/**
 * Herbruikbaar dossierpanel voor een leverancier — patroon overgenomen van
 * MeetingPanel (MVM_V2): één component, ingeplugd op meerdere schermen met
 * een optionele contextprop die het aanmaakformulier voorinvult.
 *
 * Zie docs/superpowers/specs/2026-09-24-vendor-dossiers-design.md.
 */

interface Props {
  vendorId: string;
  vendorName: string;
  /** Vooringevuld als dit panel vanuit een contractscherm wordt getoond. */
  contractId?: string;
  /** Vooringevuld als dit panel vanuit een surveyresponsscherm wordt getoond. */
  responseId?: string;
}

function formatteerBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EngagementPanel({
  vendorId,
  vendorName,
  contractId,
  responseId,
}: Props) {
  const [engagements, setEngagements] = useState<VendorEngagement[]>([]);
  const [laden, setLaden] = useState(true);
  const [fout, setFout] = useState<string | null>(null);
  const [toonFormulier, setToonFormulier] = useState(false);

  const [titel, setTitel] = useState('');
  const [bestanden, setBestanden] = useState<File[]>([]);
  const [koppelContract, setKoppelContract] = useState(Boolean(contractId));
  const [koppelSurvey, setKoppelSurvey] = useState(Boolean(responseId));
  const [bezig, setBezig] = useState(false);

  const laad = useCallback(async () => {
    setLaden(true);
    try {
      const lijst = await haalEngagements(vendorId);
      setEngagements(lijst);
    } catch {
      setFout('De dossiers konden niet worden opgehaald.');
    } finally {
      setLaden(false);
    }
  }, [vendorId]);

  useEffect(() => {
    void laad();
  }, [laad]);

  // Alleen relevant wanneer dit panel binnen een contract- of
  // surveycontext getoond wordt — filtert de volledige lijst naar wat bij
  // die context hoort. Zonder contractId/responseId (vendorscherm zelf):
  // ongefilterd, de volledige lijst.
  const zichtbareEngagements =
    contractId || responseId
      ? engagements.filter((e) =>
          e.links.some(
            (l) =>
              (contractId &&
                l.linkType === 'contract' &&
                l.linkedId === contractId) ||
              (responseId &&
                l.linkType === 'survey_response' &&
                l.linkedId === responseId),
          ),
        )
      : engagements;

  function bestandGekozen(nieuw: FileList | null) {
    if (!nieuw) return;

    const lijst = Array.from(nieuw).slice(
      0,
      MAX_BIJLAGEN_PER_ENGAGEMENT - bestanden.length,
    );
    setBestanden((prev) => [...prev, ...lijst]);
  }

  function verwijderBestand(index: number) {
    setBestanden((prev) => prev.filter((_, i) => i !== index));
  }

  async function aanmaken() {
    if (!titel.trim()) return;

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

      const engagement = await maakEngagement(vendorId, titel.trim(), links);

      for (const bestand of bestanden) {
        await uploadBijlage(engagement.engagementId, bestand);
      }

      setTitel('');
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

  async function intrekken(engagementId: string) {
    try {
      await trekEngagementIn(engagementId);
      await laad();
    } catch {
      setFout('Het dossier kon niet worden ingetrokken.');
    }
  }

  async function bijlageIntrekken(engagementId: string, attachmentId: string) {
    try {
      await trekBijlageIn(engagementId, attachmentId);
      await laad();
    } catch {
      setFout('De bijlage kon niet worden ingetrokken.');
    }
  }

  const geenKoppelingGekozen =
    (contractId ? !koppelContract : true) &&
    (responseId ? !koppelSurvey : true);

  return (
    <section
      className="rounded-lg border border-line bg-card p-4"
      data-testid="engagement-panel"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Dossiers ({zichtbareEngagements.length})
        </h2>
        <button
          type="button"
          data-testid="engagement-nieuw"
          onClick={() => setToonFormulier((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-surface"
        >
          <Plus size={13} />
          Nieuw dossier
        </button>
      </div>

      {fout && (
        <p
          role="alert"
          data-testid="engagement-fout"
          className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {fout}
        </p>
      )}

      {toonFormulier && (
        <div className="mb-4 space-y-3 rounded border border-line bg-surface p-3">
          <div>
            <label
              htmlFor="engagement-titel"
              className="mb-1 block text-xs font-medium text-ink"
            >
              Titel
            </label>
            <input
              id="engagement-titel"
              type="text"
              value={titel}
              onChange={(e) => setTitel(e.target.value)}
              placeholder={`bijv. Cyberveiligheidscontract ${vendorName} — heronderhandeling`}
              data-testid="engagement-titel-veld"
              className="w-full rounded border border-line bg-card px-3 py-2 text-sm text-ink"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-ink">
              Bijlagen ({bestanden.length}/{MAX_BIJLAGEN_PER_ENGAGEMENT})
            </label>
            <p className="mb-1.5 text-xs text-ink-muted">
              Voeg het relevante deel toe, niet de hele mailwisseling. Max.{' '}
              {MAX_BIJLAGEN_PER_ENGAGEMENT} bestanden, elk max.{' '}
              {formatteerBytes(MAX_BESTANDSGROOTTE_BYTES)}.
            </p>
            {bestanden.length < MAX_BIJLAGEN_PER_ENGAGEMENT && (
              <input
                type="file"
                accept=".pdf,.png,.docx,.xlsx"
                onChange={(e) => bestandGekozen(e.target.files)}
                data-testid="engagement-bestand-input"
                className="text-xs"
              />
            )}
            {bestanden.length > 0 && (
              <ul className="mt-2 space-y-1">
                {bestanden.map((bestand, i) => (
                  <li
                    key={`${bestand.name}-${i}`}
                    className="flex items-center justify-between rounded bg-card px-2 py-1 text-xs text-ink"
                  >
                    <span className="flex items-center gap-1.5">
                      <FileText size={12} />
                      {bestand.name} ({formatteerBytes(bestand.size)})
                    </span>
                    <button
                      type="button"
                      onClick={() => verwijderBestand(i)}
                      aria-label={`${bestand.name} verwijderen`}
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(contractId || responseId) && (
            <div className="space-y-1.5">
              {contractId && (
                <label className="flex items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    checked={koppelContract}
                    onChange={(e) => setKoppelContract(e.target.checked)}
                  />
                  Koppelen aan dit contract
                </label>
              )}
              {responseId && (
                <label className="flex items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    checked={koppelSurvey}
                    onChange={(e) => setKoppelSurvey(e.target.checked)}
                  />
                  Koppelen aan deze vragenlijst-inzending
                </label>
              )}
            </div>
          )}

          {geenKoppelingGekozen && (
            <div
              role="alert"
              data-testid="engagement-geen-koppeling-nudge"
              className="flex gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800"
            >
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Overweeg dit te koppelen aan een contract of vragenlijst-ronde,
                zodat het straks terug te vinden is.
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void aanmaken()}
              disabled={bezig || !titel.trim()}
              data-testid="engagement-opslaan"
              className="rounded bg-brand-primary px-4 py-1.5 text-xs font-medium text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {bezig ? 'Bezig…' : 'Dossier opslaan'}
            </button>
            <button
              type="button"
              onClick={() => setToonFormulier(false)}
              className="rounded border border-line px-4 py-1.5 text-xs text-ink-muted"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

      {laden ? (
        <p className="text-sm text-ink-muted">Bezig met laden…</p>
      ) : zichtbareEngagements.length === 0 ? (
        <p
          data-testid="engagement-leeg"
          className="px-2 py-4 text-sm text-ink-muted"
        >
          Geen dossiers.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="engagement-lijst">
          {zichtbareEngagements.map((engagement) => (
            <li
              key={engagement.engagementId}
              data-testid="engagement-rij"
              className="rounded border border-line bg-surface p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-ink">
                    {engagement.titel}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {new Date(engagement.createdAt).toLocaleDateString(
                      'nl-NL',
                      { day: 'numeric', month: 'short', year: 'numeric' },
                    )}{' '}
                    · {engagement.createdByNaam ?? 'onbekend'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void intrekken(engagement.engagementId)}
                  aria-label="Dossier intrekken"
                  title="Dossier intrekken"
                >
                  <Trash2 size={14} className="text-ink-muted" />
                </button>
              </div>

              {engagement.links.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {engagement.links.map((link) => (
                    <span
                      key={link.linkId}
                      className="rounded bg-card px-1.5 py-0.5 text-[11px] text-ink-muted"
                    >
                      {link.linkType === 'contract' ? 'Contract' : 'Survey'}
                    </span>
                  ))}
                </div>
              )}

              {engagement.attachments.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {engagement.attachments.map((bijlage) => (
                    <li
                      key={bijlage.attachmentId}
                      className="flex items-center justify-between text-xs"
                    >
                      <a
                        href={bijlageDownloadUrl(bijlage.attachmentId)}
                        data-testid="engagement-bijlage-link"
                        className="inline-flex items-center gap-1 text-brand-primary hover:underline"
                      >
                        <Download size={11} />
                        {bijlage.originalFilename} (
                        {formatteerBytes(bijlage.sizeBytes)})
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          void bijlageIntrekken(
                            engagement.engagementId,
                            bijlage.attachmentId,
                          )
                        }
                        aria-label={`${bijlage.originalFilename} verwijderen`}
                      >
                        <X size={11} className="text-ink-muted" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Compileer**

Run: `npm run build`

Expected: geen TypeScript-fouten. Los importpaden/kleurtokens op die niet
overeenkomen met wat er daadwerkelijk in `@/shared/design-tokens` of de
Tailwind-config van deze repo staat (dit component is geschreven naar het
patroon van `uitnodigen/page.tsx`, dat gebruikt `text-ink`/`bg-card`/
`border-line` als Tailwind-klassen — niet de `tokens.*`-stijl van MVM_V2,
dat is een ander project).

- [ ] **Step 3: Commit**

```bash
git add src/shared/components/EngagementPanel.tsx
git commit -m "feat(vendor): EngagementPanel component"
```

---

### Task 16: Inpluggen op het vendorscherm + badge

**Files:**
- Modify: `src/app/beheer/leveranciers/[id]/page.tsx`

- [ ] **Step 1: Lees het volledige bestand**

Open `src/app/beheer/leveranciers/[id]/page.tsx` volledig om de exacte
plek van de rechterkolom en de badge-strip te vinden (het bestand is al
deels gelezen tijdens het ontwerp — lees nu de rest, met name waar
`Contracten` wordt gerenderd en waar de badge-strip met kerngegevens staat).

- [ ] **Step 2: Voeg de import en het component toe**

Voeg `import { EngagementPanel } from '@/shared/components/EngagementPanel';`
toe bovenaan, en plaats `<EngagementPanel vendorId={vendorId}
vendorName={vendor.name} />` in de rechterkolom, na de bestaande
`<Contracten ... />`-sectie (of naast `VendorUitvraagPaneel`, afhankelijk van
de exacte layout die je aantreft — volg de bestaande
grid/flex-structuur van die kolom).

- [ ] **Step 3: Voeg een badge toe aan de badge-strip**

Zoek de bestaande badge-strip (waar bijv. KVK-nummer, plaats, aantal
contracten als kleine chips getoond worden — zoek naar hoe
`ClassificatieBadges` of vergelijkbare chips gerenderd worden). Voeg een
badge toe die het aantal engagements toont, met een `onClick` die naar de
`EngagementPanel`-sectie scrollt (`document.getElementById(...)?.scrollIntoView()`
of een React-ref, afhankelijk van wat al elders in dit bestand gebruikt
wordt voor soortgelijke in-page-navigatie — zo niet aanwezig, gebruik een
eenvoudige anchor-link `href="#engagement-panel"` met een `id` op de sectie).
Het exacte aantal moet uit `EngagementPanel` naar boven komen — geef
`EngagementPanel` een optionele `onAantalChange`-callback-prop, of laat de
pagina zelf de lijst ophalen met `haalEngagements()` voor het badge-getal en
geef die als prop door (kies de eenvoudigste optie die past bij hoe deze
pagina al data laadt — waarschijnlijk kan het aantal uit de al aanwezige
`vendor`-data of een aparte lichte call komen; als geen van beide praktisch
is, is een simpele losse `haalEngagements(vendorId).length` in de bestaande
`laad()`-functie van deze pagina de eenvoudigste route).

- [ ] **Step 4: Start de dev-server en test handmatig**

Run: `npm run dev`

Navigeer naar een leveranciersscherm, maak een dossier aan met een bijlage,
controleer dat de badge het juiste aantal toont, dat intrekken werkt, en dat
de nudge-melding verschijnt als je geen contract/survey koppelt (dit scherm
heeft immers geen `contractId`/`responseId`-context, dus de nudge verschijnt
hier niet vanzelf — die nudge is alleen relevant op de contract-/survey-
varianten in Task 17; controleer op dit scherm vooral dat aanmaken zonder
koppeling gewoon lukt).

- [ ] **Step 5: Commit**

```bash
git add src/app/beheer/leveranciers/[id]/page.tsx
git commit -m "feat(vendor): EngagementPanel + badge op het vendorscherm"
```

---

### Task 17: Inpluggen op contract- en surveyresponsscherm

**Files:**
- Modify: het contractdetailscherm (zoek het exacte pad — waarschijnlijk
  onder `src/app/beheer/leveranciers/[id]/Contracten.tsx` of een eigen
  contractdetail-route; controleer eerst of contracten een eigen pagina
  hebben of alleen als sectie op het vendorscherm bestaan)
- Modify: `src/app/beheer/status/[responseId]/page.tsx`

- [ ] **Step 1: Onderzoek of er een apart contractdetailscherm bestaat**

Run: `grep -rn "contract" src/app --include="*.tsx" -l | grep -i detail`

Als er geen apart contractdetailscherm bestaat (contracten alleen als
uitklapbare sectie op het vendorscherm getoond worden via `Contracten.tsx`),
plug `EngagementPanel` daar in met `contractId={contract.contractId}` per
contractrij — pas dan het patroon in Step 2 hieronder aan naar wat je
daadwerkelijk aantreft.

- [ ] **Step 2: Plug `EngagementPanel` in op het contractscherm**

```typescript
<EngagementPanel
  vendorId={vendor.vendorId}
  vendorName={vendor.name}
  contractId={contract.contractId}
/>
```

- [ ] **Step 3: Plug `EngagementPanel` in op `status/[responseId]/page.tsx`**

Open `src/app/beheer/status/[responseId]/page.tsx`, zoek waar `vendorId` en
`vendorName` al beschikbaar zijn (dit scherm toont immers al de
survey-respons van een specifieke leverancier — die data is er al), en voeg
toe:

```typescript
<EngagementPanel
  vendorId={regel.vendorId}
  vendorName={regel.vendorNaam}
  responseId={responseId}
/>
```

(Pas veldnamen aan op wat dit bestand daadwerkelijk als variabelen gebruikt
— lees het bestand eerst volledig, met name rond regel 440 waar bijlagen nu
al getoond worden, om de juiste plek en beschikbare variabelen te vinden.)

- [ ] **Step 4: Test handmatig dat de nudge verschijnt**

Run: `npm run dev`

Open het contractscherm, klik "Nieuw dossier", vink de contract-koppeling
uit (indien de checkbox standaard aan staat) — controleer dat de
nudge-waarschuwing verschijnt. Vink hem weer aan, controleer dat de
waarschuwing verdwijnt.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(vendor): EngagementPanel inpluggen op contract- en surveyresponsscherm"
```

---

### Task 18: E2e-test (Playwright) voor het vendorscherm-pad

**Files:**
- Create: `e2e/vendor-engagements.spec.ts` (of het equivalente pad — bekijk
  eerst `e2e/uitnodigen.spec.ts` voor de exacte Playwright-conventies van
  deze repo: fixtures, hoe wordt ingelogd, hoe `data-testid` wordt
  aangesproken)

- [ ] **Step 1: Bekijk het bestaande patroon**

Open `e2e/uitnodigen.spec.ts` en `e2e/beheer-leveranciers.spec.ts` volledig
om te zien hoe een test inlogt, naar een leveranciersscherm navigeert, en
`data-testid`-selectors gebruikt.

- [ ] **Step 2: Schrijf een e2e-test die het golden path dekt**

Volg het exacte fixture-/login-patroon uit de bestanden in Step 1. De test
moet minimaal:
1. Navigeren naar een leveranciersscherm
2. Op "Nieuw dossier" klikken (`data-testid="engagement-nieuw"`)
3. Een titel invullen en opslaan
4. Controleren dat het dossier in de lijst verschijnt
   (`data-testid="engagement-rij"`)
5. Het dossier intrekken en controleren dat het uit de lijst verdwijnt

- [ ] **Step 3: Draai de test**

Run: (het exacte Playwright-testcommando van deze repo — controleer
`package.json` scripts, waarschijnlijk `npm run test:e2e` of
`npx playwright test`)

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/vendor-engagements.spec.ts
git commit -m "test(e2e): vendor-dossiers - golden path via de UI"
```

---

## Self-Review

**Spec coverage:**
- Datamodel (3 tabellen, koppeltabel, soft-delete) → Tasks 1-5 ✓
- Bestandsvalidatie (PDF/PNG/DOCX/XLSX, 10MB, max 3, gedeelde signature-
  detectie) → Task 6 ✓
- Rol `medewerker`, voorbereid op latere beperking → Task 8 (`VereistRol`) ✓
- API-routes uit spec → Task 8 ✓
- `rechten-contract.ts`/opruimen-consistentie (CLAUDE.md-valkuil) → Task 4 ✓
- `EngagementPanel` herbruikbaar op 3 schermen → Tasks 15-17 ✓
- Badge op vendorscherm → Task 16 ✓
- Nudge tegen screenshot-circus + nudge tegen "wezen" → Task 15 (in het
  component) ✓
- Downloadlink, geen preview → Task 15/16 (gewoon `<a href>`) ✓
- Geen status-workflow, geen campagne-groepering, geen mail-uit-de-app →
  bewust niet gebouwd, geen taken nodig ✓

**Placeholder scan:** geen TBD/TODO in de taken zelf. Enkele taken (16, 17,
18) bevatten bewust "onderzoek eerst het exacte bestand/pad" instructies in
plaats van hardgecodeerde regelnummers — dat is een bewuste keuze omdat de
frontend-repo (`MCM2-frontend`) niet in dezelfde mate is ingelezen als de
backend-repo tijdens het schrijven van dit plan; de bestaande patronen
(`Contracten.tsx`, `status/[responseId]/page.tsx`) zijn wel geïdentificeerd
en de taken wijzen er expliciet naartoe. Dit is geen "vul dit later in" in de
zin die de skill verbiedt (geen ontbrekende requirement), maar een
"verifieer dit exacte detail in een bestand dat pas bij uitvoering vers
gelezen wordt" — conform CLAUDE.md's eigen regel "lees eerst, dan handelen"
en "verzin geen kolomnaam/route".

**Type consistency:** `VendorEngagement`/`EngagementLink`/
`EngagementAttachment` in de backend-service (Task 7) en de frontend-types
(Task 14) zijn met opzet 1-op-1 dezelfde veldnamen (camelCase, want de
controller/service serialiseert al naar camelCase — zie `naarEngagement()`
in Task 7). `linkType`-waarden (`'contract' | 'survey_response'`) zijn
consistent tussen migratie-CHECK (Task 2), service (Task 7), invoer (Task 8)
en frontend-types (Task 14).
