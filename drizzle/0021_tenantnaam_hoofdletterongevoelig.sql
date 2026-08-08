-- Tenantnamen botsen ook als alleen de hoofdletters verschillen.
--
-- ── Wat er misging ───────────────────────────────────────────────────────────
--
-- `tenant_name_key` (baseline 0000) is hoofdlettergevoelig. Daarmee kunnen
-- 'AlingAdvies' en 'alingadvies' naast elkaar bestaan als twee verschillende
-- klanten. Voor een tenantnaam — die in schermen, mails en de audit trail
-- verschijnt — is dat vrijwel altijd een vergissing en nooit een bedoeling.
--
-- Gevonden op 2026-08-08 door de e2e-suite van de platformroutes: het
-- aanmaken van 'alingadvies' náást 'AlingAdvies' hoorde 409 te geven en gaf
-- 201. In de applicatielaag was dat niet op te lossen: die draait in de
-- tenantcontext van de nieuwe tenant, en RLS verbergt daar elke bestaande
-- tenant. Een SELECT vindt dus nooit iets, hoeveel gelijknamige tenants er ook
-- zijn.
--
-- Een constraint kent geen RLS. Daarom hoort deze regel hier en niet in de code.
--
-- ── Waarom de oude index blijft ──────────────────────────────────────────────
--
-- Hij is strenger noch zwakker maar iets anders: hij bewaakt de exacte naam.
-- Beide houden is geen dubbelop — de nieuwe vangt wat de oude doorlaat. Hem
-- weghalen zou bovendien een tweede migratie in dezelfde stap zijn, zonder dat
-- iets erom vraagt.

CREATE UNIQUE INDEX tenant_name_ongeacht_hoofdletters
    ON clm.tenant (lower(name));--> statement-breakpoint

COMMENT ON INDEX clm.tenant_name_ongeacht_hoofdletters IS
    'Tenantnamen zijn uniek ongeacht hoofdletters. tenant_name_key bewaakt de exacte schrijfwijze; deze index vangt wat die doorlaat — twee klanten die alleen in hoofdletters verschillen zijn een vergissing, geen bedoeling.';
