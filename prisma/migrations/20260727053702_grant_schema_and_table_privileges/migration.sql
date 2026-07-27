-- =============================================================================
-- Herstel P0: ontbrekende schema- en tabelrechten voor de vier clm_*-rollen.
--
-- De vorige migratie (20260724140521_init_tenant_vendor_audit) maakte de
-- schemas, tabellen en RLS-policies aan, maar gaf geen enkel GRANT USAGE of
-- GRANT op tabellen aan clm_api/clm_admin/clm_readonly/clm_audit_reader.
-- Zonder deze grants is RLS niet effectief bruikbaar: een rol zonder
-- BYPASSRLS kan de tabellen dan simpelweg niet bereiken, dus "RLS is actief"
-- was nooit daadwerkelijk doorgetest via een echte, niet-bypassende rol.
--
-- clm_admin krijgt hier bewust dezelfde rechten als clm_api. Er bestaat nog
-- geen functioneel onderscheid tussen "gewone runtime" en "admin" in de
-- applicatie. Dit is een tijdelijke, expliciete keuze — geen aanname dat
-- clm_admin altijd identiek blijft. Zodra er een concrete admin-only-actie
-- ontstaat (bijv. tenant aanmaken/verwijderen, rolbeheer), moet dit worden
-- herzien; clm_admin kan dan uitgroeien tot een eigen feature met eigen,
-- ruimere rechten. Zie docs/adr/ADR-008-clm-admin-rechten.md.
-- =============================================================================

-- Schema USAGE — alle vier rollen moeten de schemas kunnen "zien"
GRANT USAGE ON SCHEMA clm, ref, audit TO clm_api, clm_admin, clm_readonly, clm_audit_reader;

-- clm_api: CRUD op clm en ref (geen DELETE op audit — audit is append-only,
-- zie MCM2-CLAUDE.md §7.7)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA clm TO clm_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ref TO clm_api;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA audit TO clm_api;

-- clm_admin: voorlopig identiek aan clm_api (zie toelichting hierboven)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA clm TO clm_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ref TO clm_admin;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA audit TO clm_admin;

-- clm_readonly: uitsluitend lezen, alle drie schemas
GRANT SELECT ON ALL TABLES IN SCHEMA clm TO clm_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA ref TO clm_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA audit TO clm_readonly;

-- clm_audit_reader: uitsluitend lezen, uitsluitend audit
GRANT SELECT ON ALL TABLES IN SCHEMA audit TO clm_audit_reader;

-- Toekomstige tabellen in deze schemas erven automatisch dezelfde rechten,
-- zodat een volgende migratie deze stap niet hoeft te herhalen.
ALTER DEFAULT PRIVILEGES IN SCHEMA clm
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clm_api, clm_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA ref
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clm_api, clm_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
    GRANT SELECT, INSERT ON TABLES TO clm_api, clm_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA clm
    GRANT SELECT ON TABLES TO clm_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA ref
    GRANT SELECT ON TABLES TO clm_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
    GRANT SELECT ON TABLES TO clm_readonly, clm_audit_reader;

-- clm_api en clm_admin voeren ook sequence-gebruik nodig (indien later
-- SERIAL/IDENTITY-kolommen ontstaan; huidige tabellen gebruiken UUID's,
-- maar dit voorkomt een stille blokkade bij een toekomstige tabel).
GRANT USAGE ON ALL SEQUENCES IN SCHEMA clm, ref, audit TO clm_api, clm_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA clm
    GRANT USAGE ON SEQUENCES TO clm_api, clm_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA ref
    GRANT USAGE ON SEQUENCES TO clm_api, clm_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
    GRANT USAGE ON SEQUENCES TO clm_api, clm_admin;
