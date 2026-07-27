-- =============================================================================
-- P0-afronding: migration-role en runtime-role strikt scheiden (MCM2-CLAUDE.md §6).
--
-- Deze migratie is een HISTORISCH, EENMALIG herstel voor de bestaande
-- Supabase-database, waar de schema's/tabellen/functies in clm/ref/audit al
-- bestonden als eigendom van de Supabase-beheerrol 'postgres' (aangemaakt
-- vóórdat clm_migrator bestond). Op elke NIEUWE database (CI, een verse
-- omgeving) maakt clm_migrator deze objecten vanaf de eerste migratie zelf
-- aan — dan is hij al eigenaar ("the owner is normally the role that
-- executed the creation statement", PostgreSQL-documentatie) en zijn de
-- ALTER ... OWNER TO-statements hieronder een idempotente no-op: ze
-- veranderen niets, maar geven ook geen foutmelding. Zie ADR-009 voor de
-- volledige achtergrond, inclusief waarom een ownership-overdracht ván
-- clm_migrator náar clm_migrator (op een verse database) triviaal toegestaan
-- is (PostgreSQL: SET ROLE naar jezelf is altijd toegestaan), terwijl een
-- overdracht ván een andere rol dat niet per definitie is.
--
-- Vereisten voor ALTER ... OWNER TO die deze migratie op Supabase liet
-- werken (uitgevoerd als de Supabase-beheerrol 'postgres', niet als
-- clm_migrator — 'postgres' is daar geen echte superuser, maar had via een
-- tijdelijke GRANT clm_migrator TO postgres, buiten deze migratie om,
-- voldoende rechten): de uitvoerende rol moet SET ROLE naar de nieuwe
-- eigenaar kunnen doen, en de nieuwe eigenaar moet CREATE hebben op het
-- schema. Beide zijn op een verse database via prisma/roles/bootstrap-
-- roles.sql voor clm_migrator zelf al geregeld, dus vereisen op een nieuwe
-- omgeving geen aparte actie.
-- =============================================================================

ALTER SCHEMA clm OWNER TO clm_migrator;
ALTER SCHEMA ref OWNER TO clm_migrator;
ALTER SCHEMA audit OWNER TO clm_migrator;

ALTER TABLE clm.tenant OWNER TO clm_migrator;
ALTER TABLE clm."user" OWNER TO clm_migrator;
ALTER TABLE clm.vendor OWNER TO clm_migrator;
ALTER TABLE clm.vendor_contact OWNER TO clm_migrator;
ALTER TABLE clm.vendor_tag OWNER TO clm_migrator;
ALTER TABLE ref.vendor_category OWNER TO clm_migrator;
ALTER TABLE ref.business_criticality OWNER TO clm_migrator;
ALTER TABLE ref.compliance_status OWNER TO clm_migrator;
ALTER TABLE audit.audit_event OWNER TO clm_migrator;

ALTER FUNCTION clm.current_tenant_id() OWNER TO clm_migrator;
ALTER FUNCTION clm.set_updated_at() OWNER TO clm_migrator;

-- Prisma's eigen migratie-boekhoudingstabel staat in het public-schema en
-- moet om dezelfde reden eigendom van clm_migrator worden, anders kan
-- `prisma migrate deploy`/`status` deze niet lezen/bijwerken.
ALTER TABLE public._prisma_migrations OWNER TO clm_migrator;

-- clm_migrator zelf heeft geen BYPASSRLS en mag nooit door de applicatie
-- worden gebruikt als runtime-rol — uitsluitend voor het uitvoeren van
-- migraties (prisma migrate deploy), nooit voor request-verkeer.
