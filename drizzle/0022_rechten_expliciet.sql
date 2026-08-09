-- Elk recht expliciet, ongeacht wat ALTER DEFAULT PRIVILEGES doet.
--
-- ── Waarom deze migratie bestaat ─────────────────────────────────────────────
--
-- Migratie 0001 zet `ALTER DEFAULT PRIVILEGES IN SCHEMA clm GRANT SELECT,
-- INSERT, UPDATE, DELETE ON TABLES TO clm_api, clm_admin`. Dat leek destijds
-- gemak; het bleek een lek dat twee kanten op werkt, en op 2026-08-08 kostte
-- het de eerste echte tenant een 500.
--
-- Een DEFAULT PRIVILEGE geldt alleen voor tabellen die daarná worden aangemaakt
-- door de rol die de instelling zette. Wordt de database elders opgebouwd — een
-- restore, een andere provider, een migratie die als een andere rol draait —
-- dan geldt hij niet. Op Supabase staat hij niet geregistreerd.
--
-- Gevolg, gemeten op 2026-08-08:
--
--   clm.tenant_membership   migratie 0009 geeft geen GRANT
--                           productie: GEEN rechten  → de 500
--                           lokaal:    alles         → tests groen
--
--   clm.omgeving            migratie 0019 geeft GRANT SELECT
--   clm.survey_review       productie: alleen wat de migratie zegt
--   clm.response_note       lokaal:    álles, want een GRANT beperkt niet —
--   clm.template_reviewer              hij vult aan wat de default al gaf
--
-- De tweede is de gevaarlijkste: lokaal en in CI draaide alles met ruimere
-- rechten dan productie. Een route die `DELETE FROM clm.omgeving` doet, faalt
-- in productie en slaagt in de tests.
--
-- ── Wat deze migratie doet ───────────────────────────────────────────────────
--
-- Per tabel: eerst alles intrekken, dan geven wat het contract voorschrijft
-- (src/db/rechten-contract.ts). REVOKE vóór GRANT, want alleen zo maakt het
-- niet meer uit wat er stond.
--
-- De default zelf blijft staan. Hem weghalen zou nieuwe tabellen zonder enig
-- recht laten ontstaan, en dat faalt dan pas bij de eerste query. Met deze
-- migratie én de bijbehorende test is dat niet langer nodig: een nieuwe tabel
-- zonder regel in het contract maakt de test rood, en dat is een betere plek om
-- het te merken.

-- ── 1. Het gat: tenant_membership ────────────────────────────────────────────
--
-- De tabel waar de platformroute op strandde. Gewone tenantdata: de applicatie
-- maakt hier memberships aan en kent support-toegang toe.

REVOKE ALL ON clm.tenant_membership FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON clm.tenant_membership TO clm_api, clm_admin;--> statement-breakpoint
GRANT SELECT ON clm.tenant_membership TO clm_readonly;--> statement-breakpoint

-- ── 2. Te ruim op een verse database ─────────────────────────────────────────
--
-- Deze vier hebben op productie de juiste, beperkte rechten en lokaal alles.
-- De REVOKE hieronder maakt beide gelijk.
--
-- omgeving (0019): de applicatie moet weten of dit een wegwerpdatabase is,
-- niet kunnen veranderen wat het antwoord is.

REVOKE ALL ON clm.omgeving FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT ON clm.omgeving TO clm_api, clm_admin;--> statement-breakpoint

-- survey_review en response_note: een oordeel of een notitie verdwijnt niet,
-- die wordt zacht verwijderd. Geen DELETE.

REVOKE ALL ON clm.survey_review FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON clm.survey_review TO clm_api, clm_admin;--> statement-breakpoint

REVOKE ALL ON clm.response_note FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON clm.response_note TO clm_api, clm_admin;--> statement-breakpoint

-- template_reviewer: een koppeling bestaat of niet. Wijzigen heeft geen
-- betekenis — ontkoppelen en opnieuw koppelen wel.

REVOKE ALL ON clm.template_reviewer FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON clm.template_reviewer TO clm_api, clm_admin;--> statement-breakpoint

-- ── 3. platform_admin: bevestigen wat 0020 al deed ───────────────────────────
--
-- Hier stond de REVOKE al goed (0020). Herhaald zodat deze migratie de
-- volledige stand zet en niet half — wie hem leest, ziet alles.

REVOKE ALL ON clm.platform_admin FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT ON clm.platform_admin TO clm_api, clm_admin;--> statement-breakpoint

-- ── 4. De audit trail blijft append-only ─────────────────────────────────────
--
-- §7.7: schrijven mag, wijzigen en verwijderen nooit. Expliciet zetten in
-- plaats van vertrouwen op de default in 0001, om dezelfde reden als hierboven.

REVOKE ALL ON audit.audit_event FROM clm_api, clm_admin;--> statement-breakpoint
GRANT SELECT, INSERT ON audit.audit_event TO clm_api, clm_admin;--> statement-breakpoint
GRANT SELECT ON audit.audit_event TO clm_readonly, clm_audit_reader;--> statement-breakpoint

-- ── Wat deze migratie NIET aanraakt ──────────────────────────────────────────
--
-- clm.sessie: die is in 0010 bewust volledig dichtgezet (REVOKE ALL), omdat de
-- sessie wordt opgezocht vóórdat de tenantcontext bestaat. Toegang loopt via
-- SECURITY DEFINER-functies. Ongemoeid laten.
--
-- De ref-tabellen: die hebben nu volledige schrijfrechten, wat ruimer is dan
-- nodig — de applicatie heeft geen route die ze wijzigt. Aanscherpen hoort bij
-- een eigen afweging en niet bij het dichten van dit gat; het contract legt de
-- huidige stand vast zodat de wijziging zichtbaar wordt wanneer hij komt.
--
-- FORCE ROW LEVEL SECURITY: de vijf tabellen zonder FORCE zijn geen
-- scheefgroei maar een gemeten besluit uit 0011 — met FORCE vallen de
-- SECURITY DEFINER-functies zelf onder RLS, en die draaien juist vóórdat er
-- tenantcontext is. Gevolg destijds: 77 falende tests, en in productie geen
-- login. Zie FORCE_RLS_UITZONDERINGEN in src/db/schema-inventory.ts.
