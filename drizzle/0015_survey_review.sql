-- =============================================================================
-- clm.survey_review — het oordeel van een medewerker over één ingediende
-- respons.
--
-- Aanleiding: fase C van docs/superpowers/plans/2026-08-03-surveybeheer.md,
-- §2a. De eigenaar wil dat een Transdev-collega een ingevulde vragenlijst kan
-- beoordelen. Dat lijkt op UC2 en is het niet: UC2 is een tweede vragenlijst,
-- dit is één oordeel over een bestaande respons.
--
-- ── Waarom een eigen tabel en geen kolom op survey_response ──────────────────
--
-- Omdat er meerdere oordelen mogen zijn en geen enkele wordt overschreven.
-- Elk oordeel staat met naam en datum vast. Dat is precies de reden dat een
-- reviewer mag beoordelen zonder admin te zijn (plan §2a): hij kan niets
-- stilletjes wijzigen, alleen iets toevoegen dat zichtbaar van hem is.
--
-- Een kolom op survey_response zou het vorige oordeel wissen en die redenering
-- ondergraven — en juist in een compliance-dossier is "wat vond men er eerder
-- van" de vraag die je later stelt.
--
-- ── Bewust GEEN unieke sleutel op response_id ────────────────────────────────
--
-- Meerdere oordelen zijn het punt, niet een gebrek. Een tweede beoordelaar mag
-- ernaast komen te staan, en een herzien oordeel komt eronder in plaats van
-- eroverheen.
--
-- ── De eerste tabel waar de tenantgrens niet volstaat ────────────────────────
--
-- Elke bestaande policy in dit project luidt:
--
--     USING (tenant_id = clm.current_tenant_id())
--
-- Dat klopt overal: zelfde tenant = mag het zien. Hier niet. Een leverancier
-- zit in dezelfde tenant als de medewerker die hem beoordeelt, maar mag dat
-- oordeel niet lezen — en dat verschil kon de database tot migratie 0013 niet
-- zien.
--
-- Daarom eist de policy hieronder naast de tenant ook actor 'medewerker'.
-- Dit is de eerste en voorlopig enige plek waar clm.current_actor() in een
-- policy staat; 0013 legde alleen de functie aan.
--
-- ── De actor-eis staat ook in WITH CHECK ─────────────────────────────────────
--
-- Zonder dat zou een leverancierspad wél kunnen schrijven wat het niet kan
-- lezen. Dat is een lek dat pas opvalt als de rij er al staat — en dan is er
-- een oordeel vastgelegd door iets dat geen medewerker is.
--
-- ── Wat hier NIET in staat ───────────────────────────────────────────────────
--
-- "Beoordelen mag alleen op een ingediende respons" is een controle in de
-- service, geen constraint. Reden: de foutmelding moet uitleggen wáárom het
-- niet kan ("deze leverancier heeft nog niet ingediend"), en een CHECK levert
-- alleen een constraintnaam op.
-- =============================================================================

CREATE TABLE "clm"."survey_review" (
	"review_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"toelichting" text DEFAULT '' NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "clm"."survey_review"
    ADD CONSTRAINT "survey_review_tenant_id_tenant_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."survey_review"
    ADD CONSTRAINT "survey_review_response_id_survey_response_response_id_fk"
    FOREIGN KEY ("response_id") REFERENCES "clm"."survey_response"("response_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- ON DELETE restrict, bewust niet SET NULL: een oordeel zonder naam is
-- waardeloos in een compliance-dossier.
ALTER TABLE "clm"."survey_review"
    ADD CONSTRAINT "survey_review_reviewer_user_id_user_user_id_fk"
    FOREIGN KEY ("reviewer_user_id") REFERENCES "clm"."user"("user_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Dezelfde vorm als de bestaande statuscontroles (migratie 0005): een typefout
-- in code wordt een databasefout en geen rij met onzin.
ALTER TABLE "clm"."survey_review"
    ADD CONSTRAINT "survey_review_verdict_check"
    CHECK (verdict IN ('goed', 'nadere_vragen', 'niet_goed'));--> statement-breakpoint

CREATE INDEX "survey_review_tenant_id_idx"
    ON "clm"."survey_review" USING btree ("tenant_id");--> statement-breakpoint

CREATE INDEX "survey_review_response_id_idx"
    ON "clm"."survey_review" USING btree ("response_id");--> statement-breakpoint

-- ── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE clm.survey_review ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- FORCE conform migratie 0011: RLS geldt ook voor de eigenaar van de tabel.
-- Zonder FORCE zou clm_migrator alle oordelen van alle tenants zien.
ALTER TABLE clm.survey_review FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY survey_review_isolation ON clm.survey_review
    USING (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    )
    WITH CHECK (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    );--> statement-breakpoint

COMMENT ON TABLE clm.survey_review IS
    'Oordelen over ingediende responses. Append-only in de praktijk: rijen worden nooit overschreven, intrekken gaat via deleted_at. Alleen leesbaar en schrijfbaar door actor medewerker — een leverancier mag het oordeel over zichzelf niet zien, ook al staat het in zijn eigen tenant.';--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON clm.survey_review TO clm_api_runtime;
