-- =============================================================================
-- clm.vendor_engagement — een "dossier" bij een leverancier voor intensiever,
-- meervoudig mailcontact (bijv. een contractonderhandeling).
--
-- Aanleiding: docs/superpowers/specs/2026-09-24-vendor-dossiers-design.md.
-- Klantoverleg Transdev: rondom een survey en/of contract ontstaat soms een
-- traject dat verder gaat dan de bestaande notitiefunctie (response_note) --
-- niet gebonden aan één survey-response, en met voorkeur voor bijlagen
-- (geëxporteerde mailcorrespondentie) in plaats van getypte samenvattingen.
--
-- ── Waarom een eigen tabel en geen uitbreiding van response_note ────────────
--
-- response_note is altijd gekoppeld aan precies één survey_response. Een
-- engagement moet breder kunnen: aan een leverancier, optioneel aan één of
-- meer contracten en/of survey-responses (zie vendor_engagement_link), of aan
-- geen van beide (een los verzoek aan de leverancier, nog geen contract of
-- survey). De twee concepten door elkaar zetten zou van response_note een
-- generieke tabel maken die twee verschillende doelen dient -- precies de
-- "stille fout"-valkuil die response_note zelf al vermijdt ten opzichte van
-- survey_review.
--
-- ── Geen status/workflow-veld ────────────────────────────────────────────────
--
-- Besluit eigenaar 2026-09-24: MVP zonder open/afgehandeld-status.
-- Zichtbaarheid "er speelt iets" komt uit het enkele bestaan van een
-- niet-verwijderd engagement.
--
-- ── Geen limiet op aantal engagements per leverancier ────────────────────────
--
-- Een leverancier kan meerdere, onafhankelijke, gelijktijdig lopende
-- dossiers hebben. Geen unique constraint op vendor_id.
-- =============================================================================

CREATE TABLE "clm"."vendor_engagement" (
	"engagement_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"titel" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement"
    ADD CONSTRAINT "vendor_engagement_tenant_id_tenant_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement"
    ADD CONSTRAINT "vendor_engagement_vendor_id_vendor_vendor_id_fk"
    FOREIGN KEY ("vendor_id") REFERENCES "clm"."vendor"("vendor_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Een dossier zonder auteur is niet te herleiden -- zelfde redenering als
-- response_note.author_user_id.
ALTER TABLE "clm"."vendor_engagement"
    ADD CONSTRAINT "vendor_engagement_created_by_user_id_user_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "clm"."user"("user_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement"
    ADD CONSTRAINT "vendor_engagement_titel_niet_leeg_check"
    CHECK (length(btrim(titel)) > 0);--> statement-breakpoint

CREATE INDEX "vendor_engagement_tenant_id_idx"
    ON "clm"."vendor_engagement" USING btree ("tenant_id");--> statement-breakpoint

-- Op vendor_id: engagements worden altijd per leverancier opgehaald (badge +
-- panel op het vendorscherm).
CREATE INDEX "vendor_engagement_vendor_id_idx"
    ON "clm"."vendor_engagement" USING btree ("vendor_id");--> statement-breakpoint

-- ── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE clm.vendor_engagement ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.vendor_engagement FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Zelfde vorm als response_note: tenant én actor, in USING én WITH CHECK.
-- Een leverancier heeft geen eigen inlogpad naar deze tabel (er is geen
-- controller-route achter SurveyTokenGuard die hem aanraakt), maar de
-- actor-eis is hier bewust hetzelfde consequente patroon als bij
-- response_note -- geen uitzondering zonder reden.
CREATE POLICY vendor_engagement_isolation ON clm.vendor_engagement
    USING (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    )
    WITH CHECK (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    );--> statement-breakpoint

COMMENT ON TABLE clm.vendor_engagement IS
    'Een dossier bij een leverancier voor intensiever, meervoudig mailcontact (bijv. een contractonderhandeling). Geen status/workflow in de MVP. Append-only, intrekken via deleted_at.';--> statement-breakpoint

-- Geen DELETE: intrekken gaat via een UPDATE op deleted_at. GRANT hier
-- expliciet, in dezelfde migratie als de CREATE TABLE -- niet vertrouwen op
-- ALTER DEFAULT PRIVILEGES (zie migratie 0039, CLAUDE.md punt 8).
GRANT SELECT, INSERT, UPDATE ON clm.vendor_engagement TO clm_api, clm_admin;
