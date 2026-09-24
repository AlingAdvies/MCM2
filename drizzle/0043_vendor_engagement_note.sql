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
