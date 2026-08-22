-- =============================================================================
-- clm.contract_survey_template krijgt een wachtlijst-kolom.
--
-- Spec: docs/superpowers/specs/2026-08-22-contractmanagement-ui-design.md §9.
--
-- Uitvinkbaar door de beheerder, geen automatisch proces dat hem zet of
-- wist: een leverancier "op de wachtlijst" voor de volgende ronde van een
-- vragenlijst betekent alleen dat hij voorgeselecteerd wordt zodra iemand
-- bewust een nieuwe ronde start via het nieuwe wachtlijst-scherm — nooit
-- dat er vanzelf iets verstuurd wordt.
--
-- Geen nieuwe tabel: de wachtlijst-status hoort per definitie bij een
-- specifieke contract-template-koppeling, en die koppeling bestaat al
-- sinds migratie 0027.
-- =============================================================================

ALTER TABLE clm.contract_survey_template
    ADD COLUMN wachtlijst boolean NOT NULL DEFAULT false;--> statement-breakpoint

COMMENT ON COLUMN clm.contract_survey_template.wachtlijst IS
    'Staat deze leverancier klaar om voorgesteld te worden bij de volgende ronde van deze vragenlijst? Uitvinkbaar door de beheerder, nooit automatisch gezet. Zie spec §9.';
