-- =============================================================================
-- Issue #29: DEFAULT gen_random_uuid() ontbreekt op de UUID-primaire sleutels
-- in de bestaande Supabase-database.
--
-- Oorzaak: de oorspronkelijke Prisma-migratie maakte de tabellen zonder
-- database-default. Prisma's `@default(uuid())` is een Prisma-level default —
-- de client genereerde de UUID en stuurde die mee bij elke INSERT. Er stond
-- dus nooit een DEFAULT-clausule in PostgreSQL zelf.
--
-- Drizzle's `.defaultRandom()` verwacht het omgekeerde: de database genereert.
-- Op een verse database uit `0000_baseline_bestaand_schema.sql` staat de
-- default er daarom wél; op de bestaande Supabase-database niet. Zonder deze
-- migratie faalt daar elke INSERT die geen expliciete UUID meestuurt, op een
-- NOT NULL-constraint.
--
-- Waarom een database-default beter is dan een applicatie-default: hij geldt
-- voor iedereen die schrijft — de applicatie, een migratiescript, een
-- handmatige INSERT tijdens incidentherstel. Een applicatie-default geldt
-- alleen zolang je via die applicatie gaat.
--
-- Idempotent: ALTER COLUMN ... SET DEFAULT zet dezelfde waarde opnieuw en is
-- een no-op op een database waar hij al staat. Veilig op zowel een verse als
-- de bestaande database.
--
-- Let op: dit herstelt uitsluitend de PRIMAIRE SLEUTELS. Kolommen als
-- vendor.tenant_id krijgen bewust géén default — een tenant_id hoort altijd
-- expliciet gezet te worden vanuit geverifieerde identiteit, nooit
-- stilzwijgend gegenereerd (MCM2-CLAUDE.md §6).
--
-- Waarom handgeschreven: `drizzle-kit generate` detecteert dit verschil NIET.
-- Het vergelijkt het schema met zijn eigen momentopnames in drizzle/meta/,
-- niet met de werkelijke database. Op 2026-07-28 geverifieerd: na het
-- verwijderen van een default meldt drizzle-kit "No schema changes, nothing
-- to migrate". Alleen test/schema-conformiteit.e2e-spec.ts vangt dit.
-- =============================================================================

ALTER TABLE clm.tenant
    ALTER COLUMN tenant_id SET DEFAULT gen_random_uuid();--> statement-breakpoint

ALTER TABLE clm."user"
    ALTER COLUMN user_id SET DEFAULT gen_random_uuid();--> statement-breakpoint

ALTER TABLE clm.vendor
    ALTER COLUMN vendor_id SET DEFAULT gen_random_uuid();--> statement-breakpoint

ALTER TABLE clm.vendor_contact
    ALTER COLUMN contact_id SET DEFAULT gen_random_uuid();--> statement-breakpoint

ALTER TABLE audit.audit_event
    ALTER COLUMN audit_event_id SET DEFAULT gen_random_uuid();
