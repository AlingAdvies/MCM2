-- =============================================================================
-- Goedkeuren als vierde oordeel op clm.survey_review.
--
-- Aanleiding: docs/superpowers/plans/2026-08-07-statuswaarheid-per-vendor.md
-- §3.2. De eigenaar wil dat de app de centrale waarheid is voor de status van
-- een vragenlijst per leverancier: opgestuurd en nog niet terug, terug maar nog
-- niet beoordeeld, beoordeeld maar nog niet goedgekeurd, beoordeeld en
-- goedgekeurd.
--
-- Drie van die vier waren al af te leiden uit bestaande gegevens
-- (submitted_at, en het bestaan van een survey_review-rij). "Beoordeeld en
-- goedgekeurd" was de enige die nergens bestond.
--
-- ── Waarom hier en niet in een eigen tabel ───────────────────────────────────
--
-- Goedkeuren is dezelfde soort uitspraak als de drie bestaande oordelen: van
-- een genoemd persoon, op een genoemd moment, over één respons, en nooit
-- overschreven. Een aparte tabel zou dezelfde kolommen, dezelfde policy en
-- dezelfde append-only-regel dupliceren, plus een query opleveren die twee
-- tabellen moet samenvoegen om "wat is de huidige status" te beantwoorden.
--
-- ── Waarom niet op survey_response ───────────────────────────────────────────
--
-- survey_response.status (migratie 0003) is de INVULstatus: waar staat de
-- leverancier in zijn eigen proces (pending/submitted/revoked). Goedkeuring is
-- een uitspraak van de ORGANISATIE over die inzending. Die twee in één kolom
-- levert waarden op die elkaar ongemerkt uitsluiten — kan een 'revoked'
-- respons goedgekeurd zijn?
--
-- ── Waarom een verdict en geen kolom is_goedgekeurd ──────────────────────────
--
-- Een boolean op survey_review zou zeggen "dit oordeel is óók een goedkeuring",
-- terwijl het een eigen uitspraak is die los van een inhoudelijk oordeel kan
-- staan: een collega mag goedkeuren zonder eerst 'goed' te hebben gezegd.
--
-- ── Wat dit NIET verandert ───────────────────────────────────────────────────
--
-- De RLS-policy niet, de kolommen niet, de rechten niet. Alleen de verzameling
-- toegestane waarden. Bestaande rijen blijven geldig: 'goedgekeurd' komt erbij,
-- er gaat niets af. Daarom is deze migratie ook veilig op een gevulde database.
-- =============================================================================

ALTER TABLE clm.survey_review
    DROP CONSTRAINT survey_review_verdict_check;--> statement-breakpoint

ALTER TABLE clm.survey_review
    ADD CONSTRAINT survey_review_verdict_check
    CHECK (verdict IN ('goed', 'nadere_vragen', 'niet_goed', 'goedgekeurd'));--> statement-breakpoint

COMMENT ON CONSTRAINT survey_review_verdict_check ON clm.survey_review IS
    'Vier oordelen. De eerste drie zijn inhoudelijk: wat vindt de beoordelaar van de inzending. Goedgekeurd is een processtap die de inzending afsluit — dezelfde vorm (naam, datum, nooit overschreven), andere betekenis. Het scherm zet ze daarom niet als vier gelijkwaardige knoppen naast elkaar.';
