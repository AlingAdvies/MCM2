-- =============================================================================
-- Rollen-bootstrap voor MCM2 — cluster-brede PostgreSQL-rollen.
--
-- Rollen zijn cluster-breed (niet database-specifiek) en horen daarom niet
-- in de per-database Prisma-migratiehistorie (prisma/migrations/). Dit
-- bestand is de enige bron van waarheid voor welke rollen moeten bestaan,
-- en wordt gebruikt door:
-- - CI (een verse, ephemere Postgres-container heeft nog geen enkele rol);
-- - het opzetten van een nieuwe omgeving (acceptatie, disaster recovery).
--
-- Idempotent: veilig opnieuw te draaien op een database waar de rollen al
-- bestaan (gebruikt DO-blokken met een existence-check in plaats van kale
-- CREATE ROLE, dat zou falen bij een tweede run).
--
-- Wachtwoorden worden hier NIET gezet — dat gebeurt per omgeving apart
-- (lokaal handmatig, CI via een gegenereerd/vast test-wachtwoord dat nooit
-- buiten de CI-run leeft, acceptatie/productie via een secretbeheerproces).
-- Dit bestand maakt uitsluitend de rollen aan en regelt hun onderlinge
-- rechten/lidmaatschap; zie docs/adr/ADR-008 en ADR-009 voor de achtergrond.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clm_api') THEN
        CREATE ROLE clm_api NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clm_admin') THEN
        CREATE ROLE clm_admin NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clm_readonly') THEN
        CREATE ROLE clm_readonly NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clm_audit_reader') THEN
        CREATE ROLE clm_audit_reader NOLOGIN;
    END IF;

    -- clm_api_runtime: inlogbare rol die de applicatie daadwerkelijk gebruikt,
    -- erft rechten van clm_api. Wachtwoord wordt apart gezet (ALTER ROLE ...
    -- PASSWORD), nooit hier hardcoded.
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clm_api_runtime') THEN
        CREATE ROLE clm_api_runtime LOGIN;
    END IF;

    -- clm_migrator: inlogbare rol die uitsluitend migraties uitvoert, nooit
    -- door de applicatie gebruikt. Eigenaar van de domeinschema's (zie
    -- prisma/migrations/20260727054911_transfer_ownership_to_migrator).
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clm_migrator') THEN
        CREATE ROLE clm_migrator LOGIN;
    END IF;
END
$$;

GRANT clm_api TO clm_api_runtime;

-- Sinds PostgreSQL 15 heeft een nieuwe rol standaard GEEN CREATE-recht op
-- de database of het public-schema (de impliciete PUBLIC-rol kreeg dit niet
-- meer als default — bewuste security-hardening, geen bug). clm_migrator
-- moet daarom expliciet CREATE krijgen om zelf schema's (clm, ref, audit)
-- en objecten in public (o.a. Prisma's _prisma_migrations) aan te maken.
-- Met deze rechten maakt clm_migrator die objecten vanaf het begin ZELF aan
-- via de Prisma-migraties — hij is dan meteen eigenaar (PostgreSQL: "the
-- owner is normally the role that executed the creation statement"), geen
-- aparte ownership-overdracht nodig. Zie ADR-009.
GRANT CREATE ON DATABASE postgres TO clm_migrator;
GRANT CREATE ON SCHEMA public TO clm_migrator;
