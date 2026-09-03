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
CREATE POLICY tenant_feature_isolation ON clm.tenant_feature
    USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint

-- Schrijven: uitsluitend via de migratierol (clm_migrator, schema-owner),
-- nooit via de gewone tenant-runtime. Zelfde figuur als clm.platform_admin
-- (migratie 0020): de databaselaag is de onderste bewakingslaag, de guard
-- op de route erboven. clm_api_runtime is lid van de groepsrol clm_api, die
-- door ALTER DEFAULT PRIVILEGES (migratie 0001) standaard CRUD krijgt op elke
-- nieuwe clm-tabel — dat moeten we hier expliciet terugdraaien tot SELECT.
REVOKE INSERT, UPDATE, DELETE ON clm.tenant_feature FROM clm_api, clm_admin;--> statement-breakpoint
GRANT SELECT ON clm.tenant_feature TO clm_api, clm_admin;--> statement-breakpoint

-- Bestaande tenants behouden de contractmodule (spec §4): zonder deze stap
-- verdwijnt de module bij uitrol voor Transdev, AlingAdvies, demo, Bizaline
-- en Platformbeheer.
INSERT INTO clm.tenant_feature (tenant_id, feature_key, enabled)
SELECT tenant_id, 'contractmodule', true
FROM clm.tenant
WHERE deleted_at IS NULL;
