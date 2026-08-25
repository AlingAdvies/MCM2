import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
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

export const contractStatus = ref.table('contract_status', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
});

export const complianceThema = ref.table('compliance_thema', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
});

// ─── clm schema: fundament ────────────────────────────────────────────────

export const tenant = clm.table(
  'tenant',
  {
    tenantId: uuid('tenant_id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // Migratie 0025. Waar een antwoord van een leverancier heen gaat: van de
    // tenant, niet van het platform. NULL is een geldige stand — de
    // berichttekst verwijst dan naar de contactpersoon bij de tenant.
    antwoordEmail: text('antwoord_email'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('tenant_name_key').on(t.name),
    // Migratie 0021. tenant_name_key bewaakt de exacte schrijfwijze; deze
    // vangt wat die doorlaat — 'AlingAdvies' naast 'alingadvies' is een
    // vergissing, geen tweede klant. Hoort in de database en niet in de code,
    // want de aanmaakroute draait in de context van de nieuwe tenant en RLS
    // verbergt daar elke bestaande tenant.
    uniqueIndex('tenant_name_ongeacht_hoofdletters').on(sql`lower(${t.name})`),
  ],
);

export const user = clm.table(
  'user',
  {
    userId: uuid('user_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    fullName: text('full_name').notNull(),
    email: text('email'),
    // Stabiele identifier uit de identity provider (Entra: de oid-claim).
    // Nooit het e-mailadres: dat verandert, een oid niet. NULL voor gebruikers
    // die niet inloggen — respondenten van interne beoordelingen bijvoorbeeld.
    externalSubject: text('external_subject'),
    // Migratie 0023. Tot wanneer een oid aan deze rij gekoppeld mag worden bij
    // de eerste login. NULL is de veilige stand: niet koppelbaar.
    koppelbaarTot: timestamp('koppelbaar_tot', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('user_external_subject_key')
      .on(t.externalSubject)
      .where(sql`${t.externalSubject} IS NOT NULL`),
  ],
);

/**
 * Welke gebruiker mag in welke tenant werken, en met welke rol.
 *
 * Los van user.tenantId: dat is waar de gebruiker administratief thuishoort,
 * dit is waar hij mag werken. Het verschil telt zodra iemand lid is van twee
 * tenants — §6 staat die switch toe, mits server-side aantoonbaar (Issue #7).
 */
export const tenantMembership = clm.table(
  'tenant_membership',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.userId, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    // 'admin' beheert leveranciers, vragenlijsten en rondes.
    // 'reviewer' vult interne beoordelingen in en leest resultaten.
    // 'support' kijkt mee vanuit het platform: lezen, tijdelijk, en
    // herkenbaar als zodanig in de audit trail (ADR-015).
    role: text('role').notNull().default('reviewer'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // Migratie 0020. NULL is een blijvend membership — de gewone situatie voor
    // admin en reviewer. Een waarde hoort bij support-toegang, die verloopt.
    verlooptOp: timestamp('verloopt_op', { withTimezone: true }),
    reden: text('reden'),
    toegekendDoor: uuid('toegekend_door').references(() => user.userId),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.tenantId] }),
    index('tenant_membership_tenant_id_idx').on(t.tenantId),
    // Eén actieve tenant per gebruiker — behalve voor support. Migratie 0020
    // maakte deze index nauwer in plaats van hem weg te halen (Issue #57): de
    // bescherming blijft daarmee volledig gelden voor admin en reviewer.
    // Partieel op deleted_at: ingetrokken memberships blijven staan als
    // historie, maar tellen niet mee.
    uniqueIndex('tenant_membership_een_actief_per_gebruiker')
      .on(t.userId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.role} <> 'support'`),
    index('tenant_membership_support_idx')
      .on(t.tenantId, t.verlooptOp)
      .where(sql`${t.role} = 'support' AND ${t.deletedAt} IS NULL`),
  ],
);

/**
 * Wie het platform beheert (migratie 0020, ADR-015).
 *
 * Geen tenant_id, en dat is het punt: platformbeheerder-zijn geldt tegenover
 * het platform, niet tegenover een tenant. Daarmee is deze tabel automatisch
 * niet-tenantgebonden voor de schema-inventaris, en valt hij buiten de
 * RLS-eis — de afscherming loopt via GRANT.
 *
 * Meekijken in een tenant gebeurt niet vanuit deze tabel maar via een
 * tijdelijk `support`-membership in tenant_membership. De tenantgrens blijft
 * zo intact: ook een supportsessie doorloopt RLS.
 */
export const platformAdmin = clm.table('platform_admin', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.userId, { onDelete: 'cascade' }),
  toegekendOp: timestamp('toegekend_op', { withTimezone: true })
    .notNull()
    .defaultNow(),
  toelichting: text('toelichting'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/**
 * Welke tenants er bestaan (migratie 0026, ADR-017).
 *
 * ── Waarom deze tabel naast clm.tenant staat ────────────────────────────────
 *
 * `clm.tenant` heeft RLS met FORCE (0011) en geen enkele applicatierol heeft
 * BYPASSRLS. Zonder tenantcontext levert een SELECT dus nul rijen — ook voor
 * platformbeheer. Dat gaf op 2026-08-13 een kip-eiprobleem: elke
 * platformhandeling vraagt een tenant-id, en er was geen weg om die te vinden.
 *
 * Erger nog: die nul rijen zagen eruit als "er staat niets". Precies de
 * meetfout die op 2026-08-10 tot dataverlies leidde.
 *
 * ── Wat hier NIET in hoort ──────────────────────────────────────────────────
 *
 * Klantgegevens. Drie kolommen, en dat blijft zo. Toegang tot de gegevens van
 * een tenant loopt via een tijdelijk `support`-membership (ADR-015), niet via
 * deze tabel. Komt er ooit een kolom bij die iets over de klant zégt — aantal
 * gebruikers, laatste activiteit, abonnement — dan is dat een nieuw besluit.
 *
 * ── Waarom de sleutel `register_id` heet en niet `tenant_id` ────────────────
 *
 * §7 van MCM2-CLAUDE.md zegt: iedere tabel met een `tenant_id`-kolom heeft RLS
 * nodig, met policies op USING én WITH CHECK. `schema-inventory.ts` leidt
 * "tenantgebonden" letterlijk uit die kolomnaam af, en drie bewakingstests
 * maken de run rood als de RLS ontbreekt.
 *
 * Die regel is juist en mag niet verzwakt worden voor deze ene tabel. Hier is
 * de uuid de sleutel van de registerrij, niet de tenant waartoe de rij behoort
 * — dezelfde reden dat clm.platform_admin geen tenant_id heeft (0020). De naam
 * `register_id` maakt dat verschil zichtbaar in plaats van het weg te
 * definiëren.
 *
 * De tabel hoort bij geen enkele tenant, staat daarom buiten RLS, en is via
 * GRANT dicht (rechten-contract: GEEN).
 *
 * Wordt bijgehouden door een trigger op clm.tenant, niet door applicatiecode.
 */
export const tenantRegister = clm.table('tenant_register', {
  registerId: uuid('register_id').primaryKey(),
  name: text('name').notNull(),
  aangemaaktOp: timestamp('aangemaakt_op', { withTimezone: true })
    .notNull()
    .defaultNow(),
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

export const vendorComplianceThema = clm.table(
  'vendor_compliance_thema',
  {
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendor.vendorId, { onDelete: 'cascade' }),
    themaCode: text('thema_code')
      .notNull()
      .references(() => complianceThema.code, { onDelete: 'restrict' }),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('vendor_compliance_thema_pkey').on(t.vendorId, t.themaCode),
    index('vendor_compliance_thema_tenant_id_idx').on(t.tenantId),
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

// ─── clm schema: contractmanagement ────────────────────────────────────────
// Zie docs/superpowers/specs/2026-08-22-contractmanagement-design.md.

export const contract = clm.table(
  'contract',
  {
    contractId: uuid('contract_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendor.vendorId, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    contractNumber: text('contract_number'),
    // NULL betekent "gebruik de is_primary-contactpersoon van de vendor" —
    // applicatielogica, geen database-default. Zie spec §2.1.
    vendorContactId: uuid('vendor_contact_id').references(
      () => vendorContact.contactId,
      { onDelete: 'set null' },
    ),
    ownerUserId: uuid('owner_user_id').references(() => user.userId, {
      onDelete: 'set null',
    }),
    // Kent geen 'verlopend' — dat is berekend uit end_date, nooit
    // opgeslagen. Zie spec §2.3.
    statusCode: text('status_code').references(() => contractStatus.code, {
      onDelete: 'set null',
    }),
    valueEur: numeric('value_eur', { precision: 15, scale: 2 }),
    startDate: date('start_date'),
    endDate: date('end_date'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('contract_tenant_id_idx').on(t.tenantId),
    index('contract_vendor_id_idx').on(t.vendorId),
  ],
);

export const contractSurveyTemplate = clm.table(
  'contract_survey_template',
  {
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contract.contractId, { onDelete: 'cascade' }),
    surveyTemplateId: uuid('survey_template_id')
      .notNull()
      .references(() => surveyTemplate.templateId, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    // Staat deze leverancier klaar om voorgesteld te worden bij de volgende
    // ronde van deze vragenlijst? Uitvinkbaar, nooit automatisch gezet.
    // Migratie 0028, spec 2026-08-22-contractmanagement-ui-design.md §9.
    wachtlijst: boolean('wachtlijst').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('contract_survey_template_pkey').on(
      t.contractId,
      t.surveyTemplateId,
    ),
    index('contract_survey_template_tenant_id_idx').on(t.tenantId),
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
    // Op welk contract deze ronde betrekking heeft.
    //
    // Nog niet in gebruik en bewust zonder foreign key: er bestaat nog geen
    // clm.contract-tabel. MCM2 heeft vendor en vendor_contact wél, contracten
    // niet — dat is een eigen bouwspoor (zie docs/STATUS.md).
    //
    // Nu toegevoegd op verzoek van de eigenaar, omdat de kolom later toevoegen
    // een migratie kost op een tabel die dan gevulde, mogelijk bevroren rondes
    // bevat. Als lege kolom is dat een ALTER die niets hoeft te backfillen;
    // straks is het alleen nog de FK erbij leggen.
    //
    // Nullable blijft het ook daarna: een ronde hoeft niet aan een contract te
    // hangen. Een leverancier kan beoordeeld worden vóór er een overeenkomst
    // is, en de acht Transdev-vragen gaan over de organisatie, niet over één
    // contract.
    contractId: uuid('contract_id'),
  },
  (t) => [
    index('survey_run_tenant_id_idx').on(t.tenantId),
    index('survey_run_contract_id_idx').on(t.contractId),
  ],
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

/**
 * Het oordeel van een medewerker over één ingediende respons.
 *
 * ── Waarom een eigen tabel en niet een kolom op survey_response ─────────────
 *
 * Omdat er meerdere oordelen mogen zijn. Elk oordeel staat met naam en datum
 * vast en wordt nooit overschreven (plan §2a). Dat is precies waarom een
 * reviewer mag beoordelen zonder admin te zijn: hij kan niets stilletjes
 * wijzigen, alleen iets toevoegen dat zichtbaar van hem is. Een kolom op de
 * respons zou het vorige oordeel wissen en die redenering ondergraven.
 *
 * ── De eerste tabel waar de tenantgrens niet genoeg is ──────────────────────
 *
 * Overal elders geldt "zelfde tenant = mag het zien". Hier niet: een
 * leverancier zit in dezelfde tenant als de medewerker die hem beoordeelt,
 * maar mag dat oordeel niet lezen. Daarvoor is `app.current_actor` gemaakt
 * (migratie 0013). De policy eist naast de tenant dus ook actor
 * `medewerker` — zie migratie 0015.
 */
export const surveyReview = clm.table(
  'survey_review',
  {
    reviewId: uuid('review_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    responseId: uuid('response_id')
      .notNull()
      .references(() => surveyResponse.responseId, { onDelete: 'restrict' }),
    // goed | nadere_vragen | niet_goed | goedgekeurd (migratie 0017). Als CHECK
    // in de database, zodat een typefout in code een databasefout wordt en geen
    // rij met onzin. De eerste drie zijn inhoudelijk; goedgekeurd is een
    // processtap die de inzending afsluit.
    verdict: text('verdict').notNull(),
    // NOT NULL met '' als lege waarde, net als survey_question.body: dan hoeft
    // de aanroeper nergens onderscheid te maken tussen null en leeg.
    toelichting: text('toelichting').notNull().default(''),
    // Wie het oordeel gaf. Bewust geen onDelete: 'set null' — een oordeel
    // zonder naam is waardeloos in een compliance-dossier.
    reviewerUserId: uuid('reviewer_user_id')
      .notNull()
      .references(() => user.userId, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Intrekken kan wel, wissen niet: de historie blijft leesbaar.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('survey_review_tenant_id_idx').on(t.tenantId),
    index('survey_review_response_id_idx').on(t.responseId),
  ],
);

/**
 * Wat voor database is dit (migratie 0019).
 *
 * ── De enige tabel zonder tenant_id, en dat is opzet ────────────────────────
 *
 * Dit gaat niet over een klant maar over de database als geheel: is hij
 * wegwerp, of moet hij met rust gelaten worden. Eén rij, afgedwongen door een
 * boolean als primaire sleutel.
 *
 * ── Waarom hier en niet in een script ───────────────────────────────────────
 *
 * Een poortnummer of containerlabel zit náást de database en klopt niet meer
 * zodra iets verhuist. Dit reist mee: een dump neemt hem over, en een kopie van
 * productie draagt zichtbaar 'beschermd' met zich mee.
 *
 * Gelezen door test/jest-e2e.setup.ts, die weigert te draaien tegen een
 * beschermde database. Standaard is 'beschermd' — een database die zich niet
 * meldt, wordt als productie behandeld.
 */
export const omgeving = clm.table('omgeving', {
  // Boolean als primaire sleutel met DEFAULT true: een tweede INSERT loopt op
  // de sleutel stuk, dus er is altijd precies één rij.
  id: boolean('id').primaryKey().default(true),
  // wegwerp | beschermd. CHECK in de database (migratie 0019).
  soort: text('soort').notNull(),
  toelichting: text('toelichting').notNull().default(''),
  gemarkeerdOp: timestamp('gemarkeerd_op', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Een notitie bij een inzending, voor collega's onderling (migratie 0018).
 *
 * ── Waarom dit geen survey_review is ────────────────────────────────────────
 *
 * Een notitie is géén oordeel. "Gebeld, komt volgende week" past in geen van de
 * vier verdicts, en hem daar toch in persen zou een verdict afdwingen dat er
 * niet is.
 *
 * Het verschil is niet cosmetisch: een oordeel bepaalt de status van de
 * inzending, een notitie niet. In één tabel zou elke statusquery de notities
 * eruit moeten filteren — en die filter vergeten is een stille fout.
 *
 * De policy is wél letterlijk dezelfde: de leverancier zit in dezelfde tenant
 * en mag niet meelezen wat er over hem geschreven wordt.
 */
export const responseNote = clm.table(
  'response_note',
  {
    noteId: uuid('note_id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    responseId: uuid('response_id')
      .notNull()
      .references(() => surveyResponse.responseId, { onDelete: 'restrict' }),
    // Eén tekstveld, geen titel of categorie. De eigenaar was expliciet: het
    // hoeft geen geautomatiseerde fabriek te worden. Een CHECK in de database
    // weigert een lege notitie.
    tekst: text('tekst').notNull(),
    // ON DELETE restrict, zoals survey_review.reviewer_user_id: een notitie
    // zonder afzender is in een dossier waardeloos. "Gebeld" — door wie?
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => user.userId, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Intrekken kan wel, wissen niet — net als bij een oordeel.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('response_note_tenant_id_idx').on(t.tenantId),
    index('response_note_response_id_idx').on(t.responseId),
  ],
);

/**
 * Wie een vragenlijst beoordeelt (ADR-013, besluit 2).
 *
 * ── Aan de vragenlijst, niet aan de vendor of de ronde ──────────────────────
 *
 * Beoordelen is vakinhoud, geen eigenaarschap. Wie een IT-compliancelijst kan
 * beoordelen — bij Transdev de CISO — kan dat voor élke vendor. De
 * contractmanager van vendor X kan dat voor géén enkele, ook niet voor zijn
 * eigen vendor.
 *
 * Dat onderscheid is de kern van ADR-013: beheren is eigenaarschap, beoordelen
 * is expertise. Die twee horen niet aan hetzelfde object.
 *
 * ── Een hulpmiddel, geen autorisatiegrens ───────────────────────────────────
 *
 * Deze koppeling bepaalt wat iemand in zijn werkvoorraad ziet, **niet wat hij
 * mag** (ADR-013 besluit 3). Elke reviewer binnen de tenant mag elke inzending
 * beoordelen. Een harde grens zou het proces stilleggen zodra de gekoppelde
 * beoordelaar ziek is, en dan wijzigt iemand met databasetoegang de koppeling —
 * een noodgreep buiten de app om, zonder spoor.
 *
 * De fallback is de contractmanager, die intern regelt dat een bevoegd persoon
 * beoordeelt. Dat werkt alleen als de app het niet blokkeert.
 *
 * ── Geen unieke sleutel op template_id ──────────────────────────────────────
 *
 * Meerdere beoordelaars zijn toegestaan. Bij Transdev is het er waarschijnlijk
 * één, maar die ene gaat met vakantie. Nu toestaan kost niets; later verruimen
 * is een migratie op productiedata.
 */
export const templateReviewer = clm.table(
  'template_reviewer',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => surveyTemplate.templateId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.userId, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Wie de koppeling legde. Anders dan bij survey_review geen restrict:
    // dit is administratie, geen oordeel — een koppeling blijft bruikbaar
    // als degene die hem legde is vertrokken.
    createdBy: uuid('created_by').references(() => user.userId, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    // Samengestelde primaire sleutel: dezelfde persoon twee keer aan dezelfde
    // lijst koppelen is geen fout die stil hoort te slagen.
    primaryKey({ columns: [t.templateId, t.userId] }),
    index('template_reviewer_tenant_id_idx').on(t.tenantId),
    index('template_reviewer_user_id_idx').on(t.userId),
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
  memberships: many(tenantMembership),
}));

/**
 * Server-side sessies voor interne gebruikers (migratie 0010, Issue #7).
 *
 * LET OP — deze tabel is voor de runtime-rol niet rechtstreeks bereikbaar. De
 * rechten zijn expliciet ingetrokken; alle toegang loopt via de drie
 * SECURITY DEFINER-functies `clm.sessie_aanmaken()`, `clm.sessie_oplossen()`
 * en `clm.sessie_beeindigen()`.
 *
 * Reden: de sessie moet opgezocht worden vóórdat de tenantcontext bestaat — de
 * tenant vólgt immers uit de sessie. RLS zou hier dus altijd nul rijen geven.
 * De tabelbeschrijving staat hier voor typeveiligheid en documentatie; een
 * query erop vanuit de applicatie levert "permission denied".
 */
export const sessie = clm.table(
  'sessie',
  {
    sessieId: uuid('sessie_id').primaryKey().defaultRandom(),
    // SHA-256 van het token, nooit het token zelf — zelfde patroon als
    // survey_response.token_hash.
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.userId, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.tenantId, { onDelete: 'restrict' }),
    // Meegekopieerd bij inloggen: een rolwijziging geldt pas bij de volgende
    // login, niet halverwege een sessie.
    role: text('role').notNull(),
    externalSubject: text('external_subject').notNull(),
    aangemaaktOp: timestamp('aangemaakt_op', { withTimezone: true })
      .notNull()
      .defaultNow(),
    verlooptOp: timestamp('verloopt_op', { withTimezone: true }).notNull(),
    laatstGezien: timestamp('laatst_gezien', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('sessie_token_hash_key').on(t.tokenHash),
    index('sessie_user_id_idx').on(t.userId),
    index('sessie_verloopt_op_idx').on(t.verlooptOp),
  ],
);

export const tenantMembershipRelations = relations(
  tenantMembership,
  ({ one }) => ({
    user: one(user, {
      fields: [tenantMembership.userId],
      references: [user.userId],
    }),
    tenant: one(tenant, {
      fields: [tenantMembership.tenantId],
      references: [tenant.tenantId],
    }),
  }),
);

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

// ─── Actor-context ─────────────────────────────────────────────────────────
// Naast de tenant legt elke transactie vast wélke soort aanroeper hem opent.
// De database kon dat verschil tot migratie 0013 niet zien: het tokenpad van
// een leverancier en het sessiepad van een medewerker riepen withTenant()
// identiek aan, met dezelfde tenantId.
//
// Voor alle bestaande tabellen is dat juist — "zelfde tenant = mag het zien"
// geldt daar. clm.survey_review is de eerste tabel waar dat niet opgaat: een
// leverancier mag het oordeel over zichzelf niet lezen, ook al staat het in
// zijn eigen tenant.
//
// Zie drizzle/0013_actor_context.sql voor de volledige onderbouwing.
export type Actor = 'medewerker' | 'leverancier';

export const setActorContext = (actor: Actor) =>
  sql`SELECT set_config('app.current_actor', ${actor}, true)`;
