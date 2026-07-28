import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// De drie schema's uit ADR-003. Drizzle kent geen "multiSchema"-vlag zoals
// Prisma: een pgSchema-object is de namespace waaronder de tabellen hangen.
export const clm = pgSchema('clm');
export const ref = pgSchema('ref');
export const audit = pgSchema('audit');

// ─── ref schema: lookup-tabellen (bewust geen RLS, tenant-agnostisch) ──────

export const vendorCategory = ref.table('vendor_category', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
});

export const businessCriticality = ref.table('business_criticality', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
});

export const complianceStatus = ref.table('compliance_status', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
});

// ─── clm schema: fundament ────────────────────────────────────────────────

export const tenant = clm.table(
  'tenant',
  {
    tenantId: uuid('tenant_id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('tenant_name_key').on(t.name)],
);

export const user = clm.table('user', {
  userId: uuid('user_id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenant.tenantId, { onDelete: 'restrict' }),
  fullName: text('full_name').notNull(),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ─── clm schema: vendor-cluster ───────────────────────────────────────────

export const vendor = clm.table(
  'vendor',
  {
    vendorId: uuid('vendor_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    kvkNumber: text('kvk_number'),
    vestigingsnummer: text('vestigingsnummer'),
    statutoryName: text('statutory_name'),
    tradeNames: text('trade_names').array(),
    legalForm: text('legal_form'),
    incorporationDate: date('incorporation_date'),
    sbiCode: text('sbi_code'),
    sbiDescription: text('sbi_description'),
    categoryCode: text('category_code').references(() => vendorCategory.code, {
      onDelete: 'set null',
    }),
    businessCriticalityCode: text('business_criticality_code').references(
      () => businessCriticality.code,
      { onDelete: 'set null' },
    ),
    complianceStatusCode: text('compliance_status_code').references(
      () => complianceStatus.code,
      { onDelete: 'set null' },
    ),
    country: text('country').notNull().default('NL'),
    city: text('city'),
    website: text('website'),
    annualSpendEur: numeric('annual_spend_eur', { precision: 15, scale: 2 }),
    riskScore: smallint('risk_score'),
    ownerUserId: uuid('owner_user_id').references(() => user.userId, {
      onDelete: 'set null',
    }),
    lastReviewDate: date('last_review_date'),
    nextReviewDate: date('next_review_date'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('vendor_tenant_id_kvk_number_key').on(t.tenantId, t.kvkNumber),
    index('vendor_tenant_id_idx').on(t.tenantId),
  ],
);

export const vendorContact = clm.table(
  'vendor_contact',
  {
    contactId: uuid('contact_id').primaryKey().defaultRandom(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendor.vendorId, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    jobTitle: text('job_title'),
    roleDescription: text('role_description'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('vendor_contact_tenant_id_idx').on(t.tenantId)],
);

export const vendorTag = clm.table(
  'vendor_tag',
  {
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendor.vendorId, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    tag: text('tag').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('vendor_tag_pkey').on(t.vendorId, t.tag),
    index('vendor_tag_tenant_id_idx').on(t.tenantId),
  ],
);

// ─── clm schema: survey-cluster ───────────────────────────────────────────
// Zie docs/superpowers/specs/2026-07-28-leveranciertoken-ontwerp.md §4.
// Bewust minimaal: dit gaat over toegang, niet over de vragenlijst. De
// vraagstructuur (vraagtype A/B) hangt aan OV-6 en OV-8, die nog openstaan.

export const surveyTemplate = clm.table(
  'survey_template',
  {
    templateId: uuid('template_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    // De scope eist versionering (journey B): een lopende run verwijst naar
    // een vaste versie, zodat een latere templatewijziging bestaande
    // responses niet met terugwerkende kracht verandert.
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('survey_template_tenant_name_version_key').on(
      t.tenantId,
      t.name,
      t.version,
    ),
    index('survey_template_tenant_id_idx').on(t.tenantId),
  ],
);

export const surveyRun = clm.table(
  'survey_run',
  {
    runId: uuid('run_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => surveyTemplate.templateId, { onDelete: 'restrict' }),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Sluitmoment van de ronde. Wordt door de guard meegewogen: de striktste
    // van expires_at (per token) en closes_at (per ronde) wint. Zonder die
    // controle zou een gesloten ronde stilzwijgend bruikbaar blijven — zie
    // ontwerp §5a.
    closesAt: timestamp('closes_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('survey_run_tenant_id_idx').on(t.tenantId)],
);

export const surveyResponse = clm.table(
  'survey_response',
  {
    responseId: uuid('response_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    runId: uuid('run_id')
      .notNull()
      // RESTRICT, niet CASCADE zoals vendor_contact/vendor_tag: een ingediende
      // response is bewijsmateriaal en mag nooit stilzwijgend meeverdwijnen.
      .references(() => surveyRun.runId, { onDelete: 'restrict' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendor.vendorId, { onDelete: 'restrict' }),
    // SHA-256 van het ruwe token, nooit het token zelf. Scheidt databasetoegang
    // van surveytoegang: een databasedump geeft geen toegang tot openstaande
    // surveys. Geen bcrypt/argon2 — de invoer is 256 bits entropie, dus een
    // traag algoritme voegt niets toe en kost bij elke request tijd.
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('survey_response_token_hash_key').on(t.tokenHash),
    uniqueIndex('survey_response_run_vendor_key').on(t.runId, t.vendorId),
    index('survey_response_tenant_id_idx').on(t.tenantId),
  ],
);

// ─── audit schema ──────────────────────────────────────────────────────────

export const auditEvent = audit.table(
  'audit_event',
  {
    auditEventId: uuid('audit_event_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    actionType: text('action_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    oldValues: jsonb('old_values'),
    newValues: jsonb('new_values'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('audit_event_tenant_id_idx').on(t.tenantId)],
);

// ─── Relaties ──────────────────────────────────────────────────────────────
// Puur voor de query-API van Drizzle; genereert geen SQL en verandert het
// schema niet.

export const tenantRelations = relations(tenant, ({ many }) => ({
  users: many(user),
  vendors: many(vendor),
}));

export const userRelations = relations(user, ({ one, many }) => ({
  tenant: one(tenant, {
    fields: [user.tenantId],
    references: [tenant.tenantId],
  }),
  ownedVendors: many(vendor),
}));

export const vendorRelations = relations(vendor, ({ one, many }) => ({
  tenant: one(tenant, {
    fields: [vendor.tenantId],
    references: [tenant.tenantId],
  }),
  owner: one(user, {
    fields: [vendor.ownerUserId],
    references: [user.userId],
  }),
  category: one(vendorCategory, {
    fields: [vendor.categoryCode],
    references: [vendorCategory.code],
  }),
  businessCriticality: one(businessCriticality, {
    fields: [vendor.businessCriticalityCode],
    references: [businessCriticality.code],
  }),
  complianceStatus: one(complianceStatus, {
    fields: [vendor.complianceStatusCode],
    references: [complianceStatus.code],
  }),
  contacts: many(vendorContact),
  tags: many(vendorTag),
}));

export const vendorContactRelations = relations(vendorContact, ({ one }) => ({
  vendor: one(vendor, {
    fields: [vendorContact.vendorId],
    references: [vendor.vendorId],
  }),
}));

export const vendorTagRelations = relations(vendorTag, ({ one }) => ({
  vendor: one(vendor, {
    fields: [vendorTag.vendorId],
    references: [vendor.vendorId],
  }),
}));

export const surveyTemplateRelations = relations(
  surveyTemplate,
  ({ one, many }) => ({
    tenant: one(tenant, {
      fields: [surveyTemplate.tenantId],
      references: [tenant.tenantId],
    }),
    runs: many(surveyRun),
  }),
);

export const surveyRunRelations = relations(surveyRun, ({ one, many }) => ({
  tenant: one(tenant, {
    fields: [surveyRun.tenantId],
    references: [tenant.tenantId],
  }),
  template: one(surveyTemplate, {
    fields: [surveyRun.templateId],
    references: [surveyTemplate.templateId],
  }),
  responses: many(surveyResponse),
}));

export const surveyResponseRelations = relations(surveyResponse, ({ one }) => ({
  tenant: one(tenant, {
    fields: [surveyResponse.tenantId],
    references: [tenant.tenantId],
  }),
  run: one(surveyRun, {
    fields: [surveyResponse.runId],
    references: [surveyRun.runId],
  }),
  vendor: one(vendor, {
    fields: [surveyResponse.vendorId],
    references: [vendor.vendorId],
  }),
}));

// ─── Tenant-context ────────────────────────────────────────────────────────
// Iedere tenantgebonden query draait binnen een transactie die begint met
// SET LOCAL app.current_tenant_id. De RLS-policies vergelijken tenant_id met
// clm.current_tenant_id(), die deze sessievariabele leest.
//
// SET LOCAL accepteert geen query-parameters ($1) — een PostgreSQL-restrictie,
// geen keuze. Daarom set_config(), dat wél parameters accepteert: geen
// stringinterpolatie, dus geen SQL-injectierisico. Dit vervangt bewust het
// $executeRawUnsafe-patroon uit de geparkeerde branch
// feat/fase0-skeleton-vendors.
export const setTenantContext = (tenantId: string) =>
  sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
