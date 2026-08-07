-- =============================================================================
-- clm.response_note — een notitie bij een inzending, voor collega's.
--
-- Aanleiding: docs/superpowers/plans/2026-08-07-statuswaarheid-per-vendor.md
-- §4.1 (B2), besluit eigenaar 2026-08-07. Het contractmanagementteam is klein
-- en zit bij elkaar; de app hoeft ze niet uit elkaar te houden, maar moet wél
-- de plek zijn waar staat wat er speelt.
--
-- ── Waarom dit geen survey_review is ─────────────────────────────────────────
--
-- Een notitie is géén oordeel. "Gebeld, komt volgende week" past niet in
-- 'goed', 'nadere_vragen', 'niet_goed' of 'goedgekeurd'. Hem daar toch in
-- persen zou een verdict afdwingen dat er niet is, of een vijfde nepwaarde
-- introduceren die de statusberekening moet leren negeren.
--
-- Het verschil is niet cosmetisch: een oordeel bepaalt de status van de
-- inzending, een notitie niet. Zouden ze in één tabel staan, dan moet elke
-- query die "wat is de huidige status" beantwoordt de notities eruit filteren
-- — en die filter vergeten is een stille fout.
--
-- ── Wat het WEL van survey_review overneemt ──────────────────────────────────
--
-- De policy, letterlijk. Een notitie over een leverancier is voor collega's,
-- en de leverancier zit in dezelfde tenant. Zonder de actor-eis leest hij mee
-- wat er over hem geschreven wordt — en dat is precies de situatie waarvoor
-- clm.current_actor() in migratie 0013 is gemaakt.
--
-- Ook append-only, om dezelfde reden: intrekken gaat via deleted_at. Een
-- notitie die spoorloos kan verdwijnen maakt het dossier onbetrouwbaar.
--
-- ── Geen titel, geen categorie, geen @-vermeldingen ──────────────────────────
--
-- Bewust één tekstveld. De eigenaar was expliciet: "het hoeft niet een totaal
-- geautomatiseerde fabriek te worden." Wie een notitie aan iemand wil richten,
-- schrijft dat op — het team spreekt elkaar toch.
-- =============================================================================

CREATE TABLE "clm"."response_note" (
	"note_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"tekst" text NOT NULL,
	"author_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "clm"."response_note"
    ADD CONSTRAINT "response_note_tenant_id_tenant_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."response_note"
    ADD CONSTRAINT "response_note_response_id_survey_response_response_id_fk"
    FOREIGN KEY ("response_id") REFERENCES "clm"."survey_response"("response_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- ON DELETE restrict, zoals survey_review.reviewer_user_id en anders dan
-- template_reviewer: een notitie zonder afzender is in een dossier waardeloos.
-- "Gebeld, komt volgende week" — door wie?
ALTER TABLE "clm"."response_note"
    ADD CONSTRAINT "response_note_author_user_id_user_user_id_fk"
    FOREIGN KEY ("author_user_id") REFERENCES "clm"."user"("user_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Een lege notitie is geen notitie. In de service staat de bruikbare melding;
-- dit vangt af wat daar langs zou komen (bijvoorbeeld via een toekomstig
-- importpad) en houdt de tabel schoon.
ALTER TABLE "clm"."response_note"
    ADD CONSTRAINT "response_note_tekst_niet_leeg_check"
    CHECK (length(btrim(tekst)) > 0);--> statement-breakpoint

CREATE INDEX "response_note_tenant_id_idx"
    ON "clm"."response_note" USING btree ("tenant_id");--> statement-breakpoint

-- Op response_id: notities worden altijd per inzending opgehaald.
CREATE INDEX "response_note_response_id_idx"
    ON "clm"."response_note" USING btree ("response_id");--> statement-breakpoint

-- ── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE clm.response_note ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- FORCE conform migratie 0011: RLS geldt ook voor de eigenaar van de tabel.
ALTER TABLE clm.response_note FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Zelfde vorm als survey_review (0015) en template_reviewer (0016): tenant én
-- actor, in USING én WITH CHECK. Zonder de actor-eis in WITH CHECK zou een
-- leverancierspad kunnen schrijven wat het niet kan lezen.
CREATE POLICY response_note_isolation ON clm.response_note
    USING (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    )
    WITH CHECK (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    );--> statement-breakpoint

COMMENT ON TABLE clm.response_note IS
    'Notities bij een inzending, voor collega''s onderling. Geen oordeel: raakt de status van de inzending niet. Append-only, intrekken via deleted_at. Alleen leesbaar en schrijfbaar door actor medewerker — de leverancier zit in dezelfde tenant en mag niet meelezen wat er over hem geschreven wordt.';--> statement-breakpoint

-- Geen DELETE: intrekken gaat via een UPDATE op deleted_at.
GRANT SELECT, INSERT, UPDATE ON clm.response_note TO clm_api_runtime;
