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
    // Welke van de twee use cases deze ronde bedient (ontwerp §1c).
    // 'vendor_compliance': de leverancier vult zelf in over zichzelf.
    // 'internal_review':   een collega beoordeelt de leverancier.
    surveyKind: text('survey_kind').notNull().default('vendor_compliance'),
    // Lifecycle uit ontwerp §2b: draft → active → finished → archived.
    // Was voorheen impliciet af te leiden uit closes_at/revoked_at; expliciet
    // maken voorkomt dat de eerste uitzondering die afleiding breekt.
    status: text('status').notNull().default('draft'),
    // Test Mode (ontwerp §2b): een echte run met een echt token, alleen
    // gemarkeerd. Bewust geen sandbox die de guard omzeilt — dan test je een
    // nabootsing in plaats van het werkelijke pad.
    isTest: boolean('is_test').notNull().default(false),
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
    // De leverancier als DEELNEMER: wie vult in. Leeg bij UC2 — daar vult een
    // Transdev-collega in, en die is geen leverancier. Was NOT NULL vóór
    // ontwerp §1c; de UC1-garantie is overgenomen door de partiële unieke
    // index en de twee CHECK-constraints in migratie 0005.
    vendorId: uuid('vendor_id').references(() => vendor.vendorId, {
      onDelete: 'restrict',
    }),
    // De leverancier als ONDERWERP: over wie gaat het. Bij beide use cases
    // gevuld. Bij UC1 dezelfde rij als vendor_id — dat is geen redundantie
    // maar de vastlegging dat de leverancier daar zelf aan het woord is.
    // Hierdoor staan de zelfverklaring (UC1) en de praktijkscore (UC2) over
    // dezelfde partij automatisch naast elkaar.
    subjectVendorId: uuid('subject_vendor_id')
      .notNull()
      .references(() => vendor.vendorId, { onDelete: 'restrict' }),
    // Alleen UC2. Optioneel: de tokenroute vraagt geen account, dus een
    // invuller hoeft geen clm.user-record te hebben. Wordt bruikbaar zodra
    // spoor 1 (Entra-guard) er is.
    respondentUserId: uuid('respondent_user_id').references(() => user.userId, {
      onDelete: 'set null',
    }),
    // Naam of rol van de invuller wanneer er geen user-record is.
    respondentLabel: text('respondent_label'),
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
    // Partieel: geldt alleen waar vendor_id gevuld is (UC1). Daarmee blijft
    // "één leverancier, één respons" volledig gelden, terwijl UC2 meerdere
    // collega's per leverancier toestaat. Een niet-partiële variant zou bij
    // het toelaten van UC2 ook de UC1-garantie verzwakken.
    uniqueIndex('survey_response_run_vendor_key')
      .on(t.runId, t.vendorId)
      .where(sql`${t.vendorId} IS NOT NULL`),
    index('survey_response_tenant_id_idx').on(t.tenantId),
    index('survey_response_subject_vendor_id_idx').on(t.subjectVendorId),
  ],
);

// ─── clm schema: vragenlijst-cluster ──────────────────────────────────────
// Zie docs/superpowers/specs/2026-07-28-vragenlijst-ontwerp.md.
// Niveau B: de tenant kiest per vraag een antwoordtype uit acht.

// Categorieën zijn optioneel per vragenlijst (ontwerp §2). UC1 (de acht
// Transdev-vragen) heeft er geen; UC2 heeft er vijf met een score per
// categorie. MVM_V2 is hierin functioneel leidend.
export const surveyCategory = clm.table(
  'survey_category',
  {
    categoryId: uuid('category_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => surveyTemplate.templateId, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    // Onder deze drempel is de categoriescore null in plaats van een
    // gemiddelde over te weinig punten. Bij Transdev staat die op 3: zonder
    // deze regel zou één ingevulde vraag uit vier een volwaardig ogende score
    // opleveren. Overgenomen uit MVM_V2's minAnswersPerCategory.
    minAnswers: smallint('min_answers').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('survey_category_template_position_key').on(
      t.templateId,
      t.position,
    ),
    uniqueIndex('survey_category_template_name_key').on(t.templateId, t.name),
    // Doel van deze index is niet snelheid maar de samengestelde foreign key
    // vanuit survey_question: die dwingt af dat een vraag geen categorie van
    // een ándere template kan aanwijzen.
    uniqueIndex('survey_category_id_template_key').on(
      t.categoryId,
      t.templateId,
    ),
    index('survey_category_tenant_id_idx').on(t.tenantId),
  ],
);

export const surveyQuestion = clm.table(
  'survey_question',
  {
    questionId: uuid('question_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => surveyTemplate.templateId, { onDelete: 'restrict' }),
    // Nullable: een vragenlijst is óf ingedeeld in categorieën óf een platte
    // lijst. Verplicht stellen zou UC1 dwingen tot een kunstmatige
    // "Algemeen"-categorie die nergens getoond wordt. De samengestelde FK naar
    // (category_id, template_id) staat in migratie 0005.
    categoryId: uuid('category_id'),
    position: integer('position').notNull(),
    // Stabiele tekstsleutel naast de UUID. Bij een nieuwe templateversie
    // krijgt vraag 4 een nieuwe question_id maar behoudt question_key = 'q4',
    // zodat antwoorden over versies heen vergelijkbaar blijven. Zonder dat is
    // een jaar-op-jaar-vergelijking niet te maken — precies het punt van een
    // jaarlijkse compliance-survey.
    questionKey: text('question_key').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    // Een van de acht typen uit ontwerp §2a. De toegestane waarden staan als
    // CHECK-constraint in migratie 0005.
    answerType: text('answer_type').notNull(),
    // Typespecifieke instellingen: options[], min/max, schaallabels,
    // comment-plicht. Bewust JSONB en geen twintig kolommen — een kolom per
    // instelling geeft een tabel die grotendeels NULL is en een migratie per
    // nieuw vraagtype. Let op: de database bewaakt de inhoud hiervan niet
    // (ontwerp §2a), dat is servicelaagwerk.
    config: jsonb('config').notNull().default({}),
    isRequired: boolean('is_required').notNull().default(true),
    allowsUpload: boolean('allows_upload').notNull().default(false),
    maxFiles: smallint('max_files').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('survey_question_template_key_key').on(
      t.templateId,
      t.questionKey,
    ),
    uniqueIndex('survey_question_template_position_key').on(
      t.templateId,
      t.position,
    ),
    // Weer geen snelheidsindex: nodig voor de samengestelde FK vanuit
    // survey_answer, die het antwoordtype aan dat van de vraag koppelt.
    uniqueIndex('survey_question_id_answer_type_key').on(
      t.questionId,
      t.answerType,
    ),
    index('survey_question_tenant_id_idx').on(t.tenantId),
    index('survey_question_category_id_idx').on(t.categoryId),
  ],
);

export const surveyAnswer = clm.table(
  'survey_answer',
  {
    answerId: uuid('answer_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    responseId: uuid('response_id')
      .notNull()
      .references(() => surveyResponse.responseId, { onDelete: 'restrict' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => surveyQuestion.questionId, { onDelete: 'restrict' }),
    // Bewust gedupliceerd vanaf de vraag. Zonder deze kolom zou de
    // vormconstraint hieronder de vraagtabel moeten raadplegen, en dat kan een
    // CHECK niet. De samengestelde FK in migratie 0005 zorgt dat de waarde
    // nooit kan afwijken van die op de vraag.
    answerType: text('answer_type').notNull(),
    // Aparte kolommen per waardesoort, geen JSONB. Reden is bruikbaarheid
    // achteraf: een rating in NUMERIC is te sorteren, middelen en aggregeren.
    // Dezelfde waarde als tekst in JSONB is dat niet — daar moet elke query
    // casten en laat één niet-numerieke waarde de hele query klappen.
    answerCode: text('answer_code'),
    answerCodes: text('answer_codes').array(),
    answerText: text('answer_text'),
    answerNumber: numeric('answer_number'),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('survey_answer_response_question_key').on(
      t.responseId,
      t.questionId,
    ),
    index('survey_answer_tenant_id_idx').on(t.tenantId),
    index('survey_answer_response_id_idx').on(t.responseId),
  ],
);

export const surveyAttachment = clm.table(
  'survey_attachment',
  {
    attachmentId: uuid('attachment_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    responseId: uuid('response_id')
      .notNull()
      .references(() => surveyResponse.responseId, { onDelete: 'restrict' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => surveyQuestion.questionId, { onDelete: 'restrict' }),
    // Zoals de leverancier hem aanleverde. Nooit als pad gebruiken:
    // '../../etc/passwd.pdf' is een geldige bestandsnaam.
    originalName: text('original_name').notNull(),
    // Servergegenereerd: <tenant_id>/<response_id>/<uuid>. Geen enkel teken
    // uit de invoer.
    storageKey: text('storage_key').notNull(),
    // Wat de server heeft vastgesteld uit de eerste bytes, niet wat de client
    // beweerde (ontwerp §6).
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    // Bij een compliance-bewijsstuk moet later aantoonbaar zijn dat het
    // bestand niet gewijzigd is sinds indiening. Zelfde redenering als achter
    // de append-only audit trail.
    sha256: text('sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('survey_attachment_storage_key_key').on(t.storageKey),
    index('survey_attachment_tenant_id_idx').on(t.tenantId),
    index('survey_attachment_response_id_idx').on(t.responseId),
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
  // Twee verwijzingen naar dezelfde tabel: de leverancier is bij UC1 de
  // deelnemer en bij UC2 het onderwerp. Drizzle vereist expliciete
  // relationName's om die uit elkaar te houden.
  responsesAsParticipant: many(surveyResponse, {
    relationName: 'responseParticipant',
  }),
  responsesAsSubject: many(surveyResponse, {
    relationName: 'responseSubject',
  }),
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
    categories: many(surveyCategory),
    questions: many(surveyQuestion),
  }),
);

export const surveyCategoryRelations = relations(
  surveyCategory,
  ({ one, many }) => ({
    tenant: one(tenant, {
      fields: [surveyCategory.tenantId],
      references: [tenant.tenantId],
    }),
    template: one(surveyTemplate, {
      fields: [surveyCategory.templateId],
      references: [surveyTemplate.templateId],
    }),
    questions: many(surveyQuestion),
  }),
);

export const surveyQuestionRelations = relations(
  surveyQuestion,
  ({ one, many }) => ({
    tenant: one(tenant, {
      fields: [surveyQuestion.tenantId],
      references: [tenant.tenantId],
    }),
    template: one(surveyTemplate, {
      fields: [surveyQuestion.templateId],
      references: [surveyTemplate.templateId],
    }),
    category: one(surveyCategory, {
      fields: [surveyQuestion.categoryId],
      references: [surveyCategory.categoryId],
    }),
    answers: many(surveyAnswer),
  }),
);

export const surveyAnswerRelations = relations(surveyAnswer, ({ one }) => ({
  tenant: one(tenant, {
    fields: [surveyAnswer.tenantId],
    references: [tenant.tenantId],
  }),
  response: one(surveyResponse, {
    fields: [surveyAnswer.responseId],
    references: [surveyResponse.responseId],
  }),
  question: one(surveyQuestion, {
    fields: [surveyAnswer.questionId],
    references: [surveyQuestion.questionId],
  }),
}));

export const surveyAttachmentRelations = relations(
  surveyAttachment,
  ({ one }) => ({
    tenant: one(tenant, {
      fields: [surveyAttachment.tenantId],
      references: [tenant.tenantId],
    }),
    response: one(surveyResponse, {
      fields: [surveyAttachment.responseId],
      references: [surveyResponse.responseId],
    }),
    question: one(surveyQuestion, {
      fields: [surveyAttachment.questionId],
      references: [surveyQuestion.questionId],
    }),
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

export const surveyResponseRelations = relations(
  surveyResponse,
  ({ one, many }) => ({
    tenant: one(tenant, {
      fields: [surveyResponse.tenantId],
      references: [tenant.tenantId],
    }),
    run: one(surveyRun, {
      fields: [surveyResponse.runId],
      references: [surveyRun.runId],
    }),
    // De leverancier als deelnemer (UC1); leeg bij UC2.
    vendor: one(vendor, {
      fields: [surveyResponse.vendorId],
      references: [vendor.vendorId],
      relationName: 'responseParticipant',
    }),
    // De leverancier als onderwerp; bij beide use cases gevuld.
    subjectVendor: one(vendor, {
      fields: [surveyResponse.subjectVendorId],
      references: [vendor.vendorId],
      relationName: 'responseSubject',
    }),
    respondent: one(user, {
      fields: [surveyResponse.respondentUserId],
      references: [user.userId],
    }),
    answers: many(surveyAnswer),
    attachments: many(surveyAttachment),
  }),
);

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
