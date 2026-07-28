CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE SCHEMA "clm";
--> statement-breakpoint
CREATE SCHEMA "ref";
--> statement-breakpoint
CREATE TABLE "audit"."audit_event" (
	"audit_event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"old_values" jsonb,
	"new_values" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref"."business_criticality" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref"."compliance_status" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clm"."tenant" (
	"tenant_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clm"."user" (
	"user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clm"."vendor" (
	"vendor_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kvk_number" text,
	"vestigingsnummer" text,
	"statutory_name" text,
	"trade_names" text[],
	"legal_form" text,
	"incorporation_date" date,
	"sbi_code" text,
	"sbi_description" text,
	"category_code" text,
	"business_criticality_code" text,
	"compliance_status_code" text,
	"country" text DEFAULT 'NL' NOT NULL,
	"city" text,
	"website" text,
	"annual_spend_eur" numeric(15, 2),
	"risk_score" smallint,
	"owner_user_id" uuid,
	"last_review_date" date,
	"next_review_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ref"."vendor_category" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clm"."vendor_contact" (
	"contact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"job_title" text,
	"role_description" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clm"."vendor_tag" (
	"vendor_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_tag_pkey" PRIMARY KEY ("vendor_id","tag")
);
--> statement-breakpoint
ALTER TABLE "clm"."user" ADD CONSTRAINT "user_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."vendor" ADD CONSTRAINT "vendor_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."vendor" ADD CONSTRAINT "vendor_category_code_vendor_category_code_fk" FOREIGN KEY ("category_code") REFERENCES "ref"."vendor_category"("code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."vendor" ADD CONSTRAINT "vendor_business_criticality_code_business_criticality_code_fk" FOREIGN KEY ("business_criticality_code") REFERENCES "ref"."business_criticality"("code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."vendor" ADD CONSTRAINT "vendor_compliance_status_code_compliance_status_code_fk" FOREIGN KEY ("compliance_status_code") REFERENCES "ref"."compliance_status"("code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."vendor" ADD CONSTRAINT "vendor_owner_user_id_user_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "clm"."user"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."vendor_contact" ADD CONSTRAINT "vendor_contact_vendor_id_vendor_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "clm"."vendor"("vendor_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."vendor_tag" ADD CONSTRAINT "vendor_tag_vendor_id_vendor_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "clm"."vendor"("vendor_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_tenant_id_idx" ON "audit"."audit_event" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_name_key" ON "clm"."tenant" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_tenant_id_kvk_number_key" ON "clm"."vendor" USING btree ("tenant_id","kvk_number");--> statement-breakpoint
CREATE INDEX "vendor_tenant_id_idx" ON "clm"."vendor" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "vendor_contact_tenant_id_idx" ON "clm"."vendor_contact" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "vendor_tag_tenant_id_idx" ON "clm"."vendor_tag" USING btree ("tenant_id");--> statement-breakpoint

-- =============================================================================
-- Handgeschreven deel: Row Level Security, triggers en seed-data.
--
-- drizzle-kit genereert uitsluitend tabellen, indexen en foreign keys. RLS,
-- policies, functies en triggers vallen daarbuiten en zijn hieronder
-- overgenomen uit de Prisma-migratie 20260724140521_init_tenant_vendor_audit,
-- functioneel ongewijzigd. Dit is bewust handwerk: de securitylaag hoort niet
-- af te hangen van wat een generator toevallig wel of niet ondersteunt.
--
-- Let op bij schemawijzigingen: een door drizzle-kit gegenereerde migratie
-- bevat NOOIT automatisch RLS voor een nieuwe tabel. Elke nieuwe tenantgebonden
-- tabel vereist handmatig ENABLE ROW LEVEL SECURITY plus een policy met zowel
-- USING als WITH CHECK (MCM2-CLAUDE.md §7).
-- =============================================================================

CREATE OR REPLACE FUNCTION clm.current_tenant_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.current_tenant_id() IS
    'Leest tenant_id uit de PostgreSQL sessie-variabele app.current_tenant_id, gezet door DatabaseService.withTenant().';--> statement-breakpoint

CREATE OR REPLACE FUNCTION clm.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER trg_user_updated_at
    BEFORE UPDATE ON clm."user"
    FOR EACH ROW EXECUTE FUNCTION clm.set_updated_at();--> statement-breakpoint

CREATE TRIGGER trg_vendor_updated_at
    BEFORE UPDATE ON clm.vendor
    FOR EACH ROW EXECUTE FUNCTION clm.set_updated_at();--> statement-breakpoint

CREATE TRIGGER trg_vendor_contact_updated_at
    BEFORE UPDATE ON clm.vendor_contact
    FOR EACH ROW EXECUTE FUNCTION clm.set_updated_at();--> statement-breakpoint

ALTER TABLE clm.tenant         ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm."user"         ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.vendor         ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.vendor_contact ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.vendor_tag     ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit.audit_event  ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY tenant_isolation ON clm.tenant
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

CREATE POLICY user_isolation ON clm."user"
    USING (tenant_id = clm.current_tenant_id() AND deleted_at IS NULL)
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

CREATE POLICY vendor_isolation ON clm.vendor
    USING (tenant_id = clm.current_tenant_id() AND deleted_at IS NULL)
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

CREATE POLICY vendor_contact_isolation ON clm.vendor_contact
    USING (tenant_id = clm.current_tenant_id() AND deleted_at IS NULL)
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

CREATE POLICY vendor_tag_isolation ON clm.vendor_tag
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

CREATE POLICY audit_event_tenant_isolation ON audit.audit_event
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

-- ref-schema: bewust geen RLS (tenant-agnostische lookup-data)

INSERT INTO ref.vendor_category (code, label) VALUES
    ('other', 'Overig'),
    ('it_services', 'IT-diensten'),
    ('consultancy', 'Consultancy')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

INSERT INTO ref.business_criticality (code, label) VALUES
    ('low', 'Laag'),
    ('medium', 'Gemiddeld'),
    ('high', 'Hoog')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

INSERT INTO ref.compliance_status (code, label) VALUES
    ('no_requirements', 'Geen vereisten'),
    ('compliant', 'Voldoet'),
    ('non_compliant', 'Voldoet niet')
ON CONFLICT (code) DO NOTHING;