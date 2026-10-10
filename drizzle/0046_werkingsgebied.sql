-- =============================================================================
-- Werkingsgebied op contracten (#234).
--
-- clm.werkingsgebied: tenant-eigen waardenlijst (ANF, HWGO, Utrecht Binnen…),
-- zelfde opzet als ref.vendor_category sinds 0034 (PK (tenant_id, code)).
-- clm.contract_werkingsgebied: koppeling contract <-> werkingsgebied, meerdere
-- per contract (zelfde opzet als clm.vendor_compliance_thema, 0031).
--
-- 'Centraal beheerd' is bewust GEEN apart veld: een tenant maakt daarvoor een
-- werkingsgebied (bijv. 'Centraal') aan en vinkt het aan (besluit eigenaar
-- 10-10, na het bekijken van het formulier — een apart veld was dubbel).
--
-- Expliciete GRANTs: default privileges werken op productie niet betrouwbaar
-- voor nieuwe clm-tabellen (CLAUDE.md punt 8, migratie 0039).
-- =============================================================================

CREATE TABLE clm.werkingsgebied (
    tenant_id  uuid        NOT NULL,
    code       text        NOT NULL,
    label      text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT werkingsgebied_pkey PRIMARY KEY (tenant_id, code),
    CONSTRAINT werkingsgebied_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES clm.tenant (tenant_id) ON DELETE CASCADE
);--> statement-breakpoint

ALTER TABLE clm.werkingsgebied ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.werkingsgebied FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY werkingsgebied_isolation ON clm.werkingsgebied
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

REVOKE ALL ON clm.werkingsgebied FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON clm.werkingsgebied TO clm_api, clm_admin;--> statement-breakpoint

CREATE TABLE clm.contract_werkingsgebied (
    contract_id         uuid        NOT NULL,
    tenant_id           uuid        NOT NULL,
    werkingsgebied_code text        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT contract_werkingsgebied_pkey PRIMARY KEY (contract_id, werkingsgebied_code),
    CONSTRAINT contract_werkingsgebied_contract_fk FOREIGN KEY (contract_id)
        REFERENCES clm.contract (contract_id) ON DELETE CASCADE,
    CONSTRAINT contract_werkingsgebied_gebied_fk FOREIGN KEY (tenant_id, werkingsgebied_code)
        REFERENCES clm.werkingsgebied (tenant_id, code) ON DELETE CASCADE,
    CONSTRAINT contract_werkingsgebied_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES clm.tenant (tenant_id) ON DELETE CASCADE
);--> statement-breakpoint

CREATE INDEX contract_werkingsgebied_tenant_idx ON clm.contract_werkingsgebied (tenant_id);--> statement-breakpoint
CREATE INDEX contract_werkingsgebied_gebied_idx ON clm.contract_werkingsgebied (tenant_id, werkingsgebied_code);--> statement-breakpoint

ALTER TABLE clm.contract_werkingsgebied ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.contract_werkingsgebied FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY contract_werkingsgebied_isolation ON clm.contract_werkingsgebied
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

REVOKE ALL ON clm.contract_werkingsgebied FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON clm.contract_werkingsgebied TO clm_api, clm_admin;--> statement-breakpoint

COMMENT ON TABLE clm.werkingsgebied IS
    'Tenant-eigen werkingsgebieden (concessies/organisatie-onderdelen), bijv. ANF, HWGO. #234.';--> statement-breakpoint
COMMENT ON TABLE clm.contract_werkingsgebied IS
    'Koppeling contract <-> werkingsgebied, meerdere per contract. #234.';
