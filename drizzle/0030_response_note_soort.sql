-- =============================================================================
-- clm.response_note — kolom "soort": werk versus vastgesteld.
--
-- Aanleiding: docs/superpowers/specs/2026-08-24-vastgestelde-notitie-design.md.
-- Een ingediende respons kan tussen tenant en leverancier besproken worden; de
-- uitkomst van dat overleg moet vastgelegd kunnen worden zonder het
-- oorspronkelijke, bevroren antwoord (survey_answer) aan te tasten.
--
-- ── Waarom een kolom en geen nieuwe tabel ────────────────────────────────────
--
-- Een "vastgestelde" notitie is qua vorm identiek aan een gewone notitie: vrije
-- tekst, wie, wanneer, nooit overschreven, alleen ingetrokken via deleted_at.
-- Het enige verschil is betekenis. Een parallelle tabel zou dezelfde velden
-- dupliceren voor niets.
--
-- Bestaande rijen krijgen 'werk' — geen gedragswijziging voor wat er al staat.
-- =============================================================================

ALTER TABLE "clm"."response_note"
    ADD COLUMN "soort" text NOT NULL DEFAULT 'werk';--> statement-breakpoint

ALTER TABLE "clm"."response_note"
    ADD CONSTRAINT "response_note_soort_check"
    CHECK (soort IN ('werk', 'vastgesteld'));--> statement-breakpoint

COMMENT ON COLUMN clm.response_note.soort IS
    'werk: losse werkaantekening. vastgesteld: een na overleg met de leverancier overeengekomen wijziging, vastgelegd naast het onaangetaste oorspronkelijke antwoord.';
