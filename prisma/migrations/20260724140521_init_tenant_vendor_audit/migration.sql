-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "clm";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ref";

-- CreateTable
CREATE TABLE "ref"."vendor_category" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "vendor_category_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ref"."business_criticality" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "business_criticality_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ref"."compliance_status" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "compliance_status_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "clm"."tenant" (
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "clm"."user" (
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "clm"."vendor" (
    "vendor_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kvk_number" TEXT,
    "vestigingsnummer" TEXT,
    "statutory_name" TEXT,
    "trade_names" TEXT[],
    "legal_form" TEXT,
    "incorporation_date" DATE,
    "sbi_code" TEXT,
    "sbi_description" TEXT,
    "category_code" TEXT,
    "business_criticality_code" TEXT,
    "compliance_status_code" TEXT,
    "country" TEXT NOT NULL DEFAULT 'NL',
    "city" TEXT,
    "website" TEXT,
    "annual_spend_eur" DECIMAL(15,2),
    "risk_score" SMALLINT,
    "owner_user_id" UUID,
    "last_review_date" DATE,
    "next_review_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("vendor_id")
);

-- CreateTable
CREATE TABLE "clm"."vendor_contact" (
    "contact_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "job_title" TEXT,
    "role_description" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "vendor_contact_pkey" PRIMARY KEY ("contact_id")
);

-- CreateTable
CREATE TABLE "clm"."vendor_tag" (
    "vendor_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tag" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_tag_pkey" PRIMARY KEY ("vendor_id","tag")
);

-- CreateTable
CREATE TABLE "audit"."audit_event" (
    "audit_event_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "action_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("audit_event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_name_key" ON "clm"."tenant"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_tenant_id_kvk_number_key" ON "clm"."vendor"("tenant_id", "kvk_number");

-- AddForeignKey
ALTER TABLE "clm"."user" ADD CONSTRAINT "user_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clm"."vendor" ADD CONSTRAINT "vendor_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clm"."vendor" ADD CONSTRAINT "vendor_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "clm"."user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clm"."vendor" ADD CONSTRAINT "vendor_category_code_fkey" FOREIGN KEY ("category_code") REFERENCES "ref"."vendor_category"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clm"."vendor" ADD CONSTRAINT "vendor_business_criticality_code_fkey" FOREIGN KEY ("business_criticality_code") REFERENCES "ref"."business_criticality"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clm"."vendor" ADD CONSTRAINT "vendor_compliance_status_code_fkey" FOREIGN KEY ("compliance_status_code") REFERENCES "ref"."compliance_status"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clm"."vendor_contact" ADD CONSTRAINT "vendor_contact_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "clm"."vendor"("vendor_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clm"."vendor_tag" ADD CONSTRAINT "vendor_tag_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "clm"."vendor"("vendor_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Row Level Security — tenant isolatie
-- Principe: de NestJS-app zet aan het begin van elke request-transactie:
--   SET LOCAL app.current_tenant_id = '<uuid>';
-- Alle policies vergelijken tenant_id met deze sessie-variabele.
-- =============================================================================

CREATE OR REPLACE FUNCTION clm.current_tenant_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
$$;

COMMENT ON FUNCTION clm.current_tenant_id() IS
    'Leest tenant_id uit de PostgreSQL sessie-variabele app.current_tenant_id, gezet door TenantMiddleware.';

-- updated_at trigger-functie
CREATE OR REPLACE FUNCTION clm.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_updated_at
    BEFORE UPDATE ON clm."user"
    FOR EACH ROW EXECUTE FUNCTION clm.set_updated_at();

CREATE TRIGGER trg_vendor_updated_at
    BEFORE UPDATE ON clm.vendor
    FOR EACH ROW EXECUTE FUNCTION clm.set_updated_at();

CREATE TRIGGER trg_vendor_contact_updated_at
    BEFORE UPDATE ON clm.vendor_contact
    FOR EACH ROW EXECUTE FUNCTION clm.set_updated_at();

-- RLS inschakelen
ALTER TABLE clm.tenant         ENABLE ROW LEVEL SECURITY;
ALTER TABLE clm."user"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE clm.vendor         ENABLE ROW LEVEL SECURITY;
ALTER TABLE clm.vendor_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE clm.vendor_tag     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_event  ENABLE ROW LEVEL SECURITY;

-- Policies — elke tabel krijgt zowel USING als WITH CHECK (Database-regel 3)
CREATE POLICY tenant_isolation ON clm.tenant
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());

CREATE POLICY user_isolation ON clm."user"
    USING (tenant_id = clm.current_tenant_id() AND deleted_at IS NULL)
    WITH CHECK (tenant_id = clm.current_tenant_id());

CREATE POLICY vendor_isolation ON clm.vendor
    USING (tenant_id = clm.current_tenant_id() AND deleted_at IS NULL)
    WITH CHECK (tenant_id = clm.current_tenant_id());

CREATE POLICY vendor_contact_isolation ON clm.vendor_contact
    USING (tenant_id = clm.current_tenant_id() AND deleted_at IS NULL)
    WITH CHECK (tenant_id = clm.current_tenant_id());

CREATE POLICY vendor_tag_isolation ON clm.vendor_tag
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());

CREATE POLICY audit_event_tenant_isolation ON audit.audit_event
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());

-- ref-schema: bewust geen RLS (tenant-agnostische lookup-data)

-- Seed-data voor lookup-tabellen
INSERT INTO ref.vendor_category (code, label) VALUES
    ('other', 'Overig'),
    ('it_services', 'IT-diensten'),
    ('consultancy', 'Consultancy');

INSERT INTO ref.business_criticality (code, label) VALUES
    ('low', 'Laag'),
    ('medium', 'Gemiddeld'),
    ('high', 'Hoog');

INSERT INTO ref.compliance_status (code, label) VALUES
    ('no_requirements', 'Geen vereisten'),
    ('compliant', 'Voldoet'),
    ('non_compliant', 'Voldoet niet');

-- Demo-tenant voor lokale ontwikkeling (fallback in TenantMiddleware)
INSERT INTO clm.tenant (tenant_id, name) VALUES
    (gen_random_uuid(), 'demo');
