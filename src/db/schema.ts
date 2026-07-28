import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
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
