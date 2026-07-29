CREATE TABLE "clm"."survey_response" (
	"response_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clm"."survey_run" (
	"run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closes_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clm"."survey_template" (
	"template_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clm"."survey_response" ADD CONSTRAINT "survey_response_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_response" ADD CONSTRAINT "survey_response_run_id_survey_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "clm"."survey_run"("run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_response" ADD CONSTRAINT "survey_response_vendor_id_vendor_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "clm"."vendor"("vendor_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_run" ADD CONSTRAINT "survey_run_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_run" ADD CONSTRAINT "survey_run_template_id_survey_template_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "clm"."survey_template"("template_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_template" ADD CONSTRAINT "survey_template_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "survey_response_token_hash_key" ON "clm"."survey_response" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_response_run_vendor_key" ON "clm"."survey_response" USING btree ("run_id","vendor_id");--> statement-breakpoint
CREATE INDEX "survey_response_tenant_id_idx" ON "clm"."survey_response" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "survey_run_tenant_id_idx" ON "clm"."survey_run" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_template_tenant_name_version_key" ON "clm"."survey_template" USING btree ("tenant_id","name","version");--> statement-breakpoint
CREATE INDEX "survey_template_tenant_id_idx" ON "clm"."survey_template" USING btree ("tenant_id");--> statement-breakpoint

-- =============================================================================
-- Handgeschreven deel: CHECK-constraints, RLS, policies en de tokenlookup.
--
-- drizzle-kit genereert hiervan niets (ADR-010). Zonder dit deel zijn de
-- acceptatiecriteria AC11/AC12 uitsluitend afhankelijk van applicatiecode, en
-- hebben de drie nieuwe tenantgebonden tabellen geen tenant-isolatie.
--
-- Zie docs/superpowers/specs/2026-07-28-leveranciertoken-ontwerp.md.
-- =============================================================================

-- ── Constraints die de acceptatiecriteria op databaseniveau afdwingen ──────
-- Een fout in de guard levert hiermee een databasefout op, geen datalek.

ALTER TABLE clm.survey_response
    ADD CONSTRAINT survey_response_status_check
    CHECK (status IN ('pending', 'submitted', 'revoked'));--> statement-breakpoint

-- AC12: ingediend zonder tijdstip is onmogelijk, en andersom.
ALTER TABLE clm.survey_response
    ADD CONSTRAINT survey_response_submitted_consistent_check
    CHECK ((status = 'submitted') = (submitted_at IS NOT NULL));--> statement-breakpoint

-- Het token is base64url van 32 random bytes: altijd 43 tekens. De hash die we
-- opslaan is SHA-256 in hex: altijd 64 tekens. Een afwijkende lengte betekent
-- dat er iets anders is opgeslagen dan een hash — bijvoorbeeld het ruwe token.
ALTER TABLE clm.survey_response
    ADD CONSTRAINT survey_response_token_hash_format_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$');--> statement-breakpoint

-- ── Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE clm.survey_template ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.survey_run      ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.survey_response ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY survey_template_isolation ON clm.survey_template
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

CREATE POLICY survey_run_isolation ON clm.survey_run
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

CREATE POLICY survey_response_isolation ON clm.survey_response
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

-- ── Tokenlookup ────────────────────────────────────────────────────────────
--
-- Kip-en-ei: de tenantcontext moet gezet worden vóórdat er iets gelezen kan
-- worden, maar de tenant is pas bekend ná het opzoeken van het token. Deze
-- functie draait daarom SECURITY DEFINER en omzeilt RLS — maar retourneert
-- uitsluitend wat nodig is om de context te zetten en de geldigheid te
-- bepalen. Geen antwoorden, geen vendornamen, geen e-mailadressen.
--
-- Het aanvalsoppervlak is één rij met zeven velden, alleen bereikbaar met een
-- correcte SHA-256-hash — die je alleen hebt als je het ruwe token hebt.
--
-- SET search_path is hier geen detail maar een vereiste: zonder dat is een
-- SECURITY DEFINER-functie kwetsbaar voor search-path-manipulatie.
-- Zie postgresql.org/docs/current/sql-createfunction.html.
--
-- LEFT JOIN, geen JOIN: bij een gewone JOIN zou een zacht verwijderde vendor
-- de hele rij laten verdwijnen, waardoor "token bestaat niet" en "vendor is
-- weg" niet meer te onderscheiden zijn. Dat is precies het stille falen dat
-- ontwerp §5a uitsluit.

CREATE OR REPLACE FUNCTION clm.resolve_survey_token(p_token_hash TEXT)
RETURNS TABLE (
    response_id   UUID,
    tenant_id     UUID,
    status        TEXT,
    expires_at    TIMESTAMPTZ,
    submitted_at  TIMESTAMPTZ,
    vendor_active BOOLEAN,
    run_closed    BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
    SELECT r.response_id,
           r.tenant_id,
           r.status,
           r.expires_at,
           r.submitted_at,
           (v.vendor_id IS NOT NULL AND v.deleted_at IS NULL) AS vendor_active,
           (run.revoked_at IS NOT NULL
            OR (run.closes_at IS NOT NULL AND run.closes_at < now())) AS run_closed
      FROM clm.survey_response r
      LEFT JOIN clm.vendor     v   ON v.vendor_id = r.vendor_id
      LEFT JOIN clm.survey_run run ON run.run_id  = r.run_id
     WHERE r.token_hash = p_token_hash
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.resolve_survey_token(TEXT) IS
    'Zoekt een survey-response op via de SHA-256-hash van het leverancierstoken. SECURITY DEFINER omdat de tenantcontext pas ná deze lookup gezet kan worden. Retourneert uitsluitend geldigheidsvelden, nooit inhoudelijke gegevens.';--> statement-breakpoint

-- De runtime-rol mag de functie aanroepen; PUBLIC niet.
REVOKE ALL ON FUNCTION clm.resolve_survey_token(TEXT) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clm.resolve_survey_token(TEXT) TO clm_api, clm_admin;--> statement-breakpoint

-- ── Rechten op de nieuwe tabellen ──────────────────────────────────────────
-- ALTER DEFAULT PRIVILEGES uit migratie 0001 dekt tabellen die dáárna door
-- clm_migrator zijn aangemaakt. Expliciet herhalen is idempotent en maakt de
-- rechten leesbaar bij deze tabellen in plaats van impliciet elders.

GRANT SELECT, INSERT, UPDATE, DELETE
    ON clm.survey_template, clm.survey_run, clm.survey_response
    TO clm_api, clm_admin;--> statement-breakpoint

GRANT SELECT
    ON clm.survey_template, clm.survey_run, clm.survey_response
    TO clm_readonly;