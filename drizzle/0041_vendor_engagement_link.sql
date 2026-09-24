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
-- doel zelf bij het aanmaken van een link (VendorEngagementService).
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
-- geen levenscyclus om zacht te bewaren (zie toelichting hierboven). Ook hier
-- eerst REVOKE ALL: de default-ACL (migratie 0001) geeft op een verse
-- database al UPDATE mee, wat dit contract niet voorschrijft (een koppeling
-- wordt vervangen door verwijderen + opnieuw aanmaken, niet bijgewerkt).
REVOKE ALL ON clm.vendor_engagement_link FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON clm.vendor_engagement_link TO clm_api, clm_admin;
