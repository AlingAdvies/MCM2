-- Migratie 0038: per-tenant feature-entitlements (spec
-- docs/superpowers/specs/2026-09-03-tenant-feature-entitlements-design.md).
--
-- Geen rij voor een tenant/feature-combinatie betekent: uit. `enabled` heeft
-- bewust geen kolom-default — elke rij ontstaat via een expliciete
-- handeling (deze migratie, of een platformbeheerder die schakelt).

CREATE TABLE clm.tenant_feature (
    tenant_id    uuid NOT NULL REFERENCES clm.tenant(tenant_id) ON DELETE CASCADE,
    feature_key  text NOT NULL,
    enabled      boolean NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   uuid REFERENCES clm."user"(user_id),
    CONSTRAINT tenant_feature_pkey PRIMARY KEY (tenant_id, feature_key)
);--> statement-breakpoint

COMMENT ON TABLE clm.tenant_feature IS
    'Welke optionele features een tenant mag gebruiken (platformbeheer-schakelaar). Geen rij = uit.';--> statement-breakpoint

CREATE INDEX tenant_feature_tenant_id_idx ON clm.tenant_feature(tenant_id);--> statement-breakpoint

ALTER TABLE clm.tenant_feature ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.tenant_feature FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Lezen: elke tenant ziet alleen zijn eigen rijen (voor GET /auth/sessie).
-- clm.current_tenant_id() leest de sessievariabele app.current_tenant_id,
-- gezet door DatabaseService.withTenant() — zelfde functie als elke andere
-- RLS-policy in dit schema gebruikt (zie migratie 0000).
CREATE POLICY tenant_feature_isolation ON clm.tenant_feature
    USING (tenant_id = clm.current_tenant_id());--> statement-breakpoint

-- Schrijven: via de gewone tenant-runtime (clm_api/clm_admin), net als
-- clm.contract — anders dan clm.platform_admin (migratie 0020), dat de
-- runtime-rol nooit schrijft: hier moet de platformbeheerder juist via de
-- webapplicatie kunnen schakelen (spec §5, PlatformController-routes). De
-- echte grens is PlatformAdminGuard op de route, niet de databaserol; RLS
-- houdt bovendien elke tenant bij zijn eigen rijen, ook al kan clm_api er
-- technisch bij. Geen DELETE: schakelen is altijd een update van `enabled`,
-- een rij verdwijnt nooit.
REVOKE DELETE ON clm.tenant_feature FROM clm_api, clm_admin;--> statement-breakpoint

-- Bestaande tenants behouden de contractmodule (spec §4): zonder deze stap
-- verdwijnt de module bij uitrol voor Transdev, AlingAdvies, demo, Bizaline
-- en Platformbeheer.
INSERT INTO clm.tenant_feature (tenant_id, feature_key, enabled)
SELECT tenant_id, 'contractmodule', true
FROM clm.tenant
WHERE deleted_at IS NULL;
