-- =============================================================================
-- clm.contract — opzegtermijn, waarschuwingstermijn, verlengt-automatisch.
--
-- Ontwerp: docs/superpowers/specs/2026-08-23-contract-opzegtermijn-design.md
-- Aanleiding: issue #174 — de kale-einddatum-urgentiekleur (tussenoplossing
-- van 23-08) kan geen "opzegtermijn verstreken"-waarschuwing geven zonder
-- deze velden.
--
-- auto_renews krijgt bewust GEEN eigen ref-tabel (anders dan
-- ref.contract_status): drie vaste, niet-tenant-configureerbare waarden
-- rechtvaardigen geen aparte tabel. Zie de spec §3 voor de volledige
-- afweging.
-- =============================================================================

ALTER TABLE clm.contract
    ADD COLUMN notice_period_days  integer,
    ADD COLUMN warning_days_before integer NOT NULL DEFAULT 90,
    ADD COLUMN auto_renews         text;--> statement-breakpoint

ALTER TABLE clm.contract
    ADD CONSTRAINT contract_auto_renews_check
    CHECK (auto_renews IN ('ja', 'nee', 'onbekend') OR auto_renews IS NULL);--> statement-breakpoint

COMMENT ON COLUMN clm.contract.notice_period_days IS
    'Opzegtermijn in dagen vóór end_date. Nullable: niet elk contract heeft dit bekend.';--> statement-breakpoint
COMMENT ON COLUMN clm.contract.warning_days_before IS
    'Hoeveel dagen vóór de referentiedatum (opzegdatum, of end_date zonder opzegtermijn) gewaarschuwd wordt. Instelbaar per contract, default 90.';--> statement-breakpoint
COMMENT ON COLUMN clm.contract.auto_renews IS
    'ja/nee/onbekend — door de contractbeheerder zelf vastgesteld, geen afgeleide waarde. Default onbekend (NULL) bij aanmaken.';
