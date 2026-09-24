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
-- (VendorEngagementService), niet met een CHECK-constraint -- een CHECK kan
-- niet over meerdere rijen tellen.
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
-- src/vendor/vendor-engagement-bestand-validatie.ts.
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

-- REVOKE ALL vóór de GRANT: zelfde reden als migratie 0040/0041 — de
-- default-ACL (migratie 0001) geeft anders ook DELETE mee op een verse
-- database, in weerspraak met "een bijlage verdwijnt niet, wordt zacht
-- verwijderd".
REVOKE ALL ON clm.vendor_engagement_attachment FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON clm.vendor_engagement_attachment TO clm_api, clm_admin;
