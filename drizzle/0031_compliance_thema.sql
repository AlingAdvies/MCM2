-- =============================================================================
-- clm.vendor_compliance_thema — compliance-thema's per leverancier.
--
-- Ontwerp: docs/superpowers/specs/2026-08-25-audit-bewijsvoering-design.md, Deel 1.
-- Aanleiding: Transdev moet leveranciers per audit-thema (bijv. Cybersecurity)
-- kunnen oplijsten. business_criticality alleen zegt niets over WAAR een
-- leverancier relevant voor is.
--
-- Multi-value (besluit eigenaar): een leverancier kan tegelijk relevant zijn
-- voor meerdere thema's. Losstaand van survey_template/survey_run — het thema
-- is een eigenschap van de leverancier, puur een filtercriterium.
-- =============================================================================

-- ── 1. ref.compliance_thema — vaste waardenlijst, zelfde patroon als
-- ref.compliance_status / ref.business_criticality / ref.vendor_category.

CREATE TABLE ref.compliance_thema (
    code  text PRIMARY KEY,
    label text NOT NULL
);--> statement-breakpoint

INSERT INTO ref.compliance_thema (code, label) VALUES
    ('cybersecurity', 'Cybersecurity'),
    ('kwaliteit', 'Kwaliteit'),
    ('continuiteit', 'Continuïteit')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

-- ref-schema: bewust geen RLS (tenant-agnostische lookup-data), zelfde als
-- de andere ref-tabellen.

-- ── 2. clm.vendor_compliance_thema — many-to-many, geen extra kolommen ─────
--
-- Patroon: clm.contract_survey_template (migratie 0027). tenant_id staat
-- direct op de koppeltabel (niet afgeleid via vendor_id) — zelfde reden als
-- daar: een simpele, gelijkvormige RLS-policy zonder subquery naar vendor.

CREATE TABLE clm.vendor_compliance_thema (
    vendor_id  uuid NOT NULL,
    thema_code text NOT NULL,
    tenant_id  uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT vendor_compliance_thema_pkey
        PRIMARY KEY (vendor_id, thema_code)
);--> statement-breakpoint

ALTER TABLE clm.vendor_compliance_thema
    ADD CONSTRAINT vendor_compliance_thema_vendor_id_vendor_vendor_id_fk
    FOREIGN KEY (vendor_id) REFERENCES clm.vendor(vendor_id)
    ON DELETE cascade;--> statement-breakpoint

ALTER TABLE clm.vendor_compliance_thema
    ADD CONSTRAINT vendor_compliance_thema_thema_code_fk
    FOREIGN KEY (thema_code) REFERENCES ref.compliance_thema(code)
    ON DELETE restrict;--> statement-breakpoint

ALTER TABLE clm.vendor_compliance_thema
    ADD CONSTRAINT vendor_compliance_thema_tenant_id_tenant_tenant_id_fk
    FOREIGN KEY (tenant_id) REFERENCES clm.tenant(tenant_id)
    ON DELETE cascade;--> statement-breakpoint

CREATE INDEX vendor_compliance_thema_tenant_id_idx
    ON clm.vendor_compliance_thema USING btree (tenant_id);--> statement-breakpoint

CREATE INDEX vendor_compliance_thema_vendor_id_idx
    ON clm.vendor_compliance_thema USING btree (vendor_id);--> statement-breakpoint

ALTER TABLE clm.vendor_compliance_thema ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.vendor_compliance_thema FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY vendor_compliance_thema_isolation ON clm.vendor_compliance_thema
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

COMMENT ON TABLE clm.vendor_compliance_thema IS
    'Welke compliance-thema''s relevant zijn voor een leverancier (bijv. Cybersecurity). Many-to-many, geen extra velden, geen koppeling naar survey_template — puur een filtercriterium op de leverancier. Zie docs/superpowers/specs/2026-08-25-audit-bewijsvoering-design.md.';--> statement-breakpoint

-- Een koppeling bestaat of niet. Wijzigen heeft geen betekenis — ontkoppelen
-- en opnieuw koppelen wel. Zelfde redenering als contract_survey_template (0027).
REVOKE ALL ON clm.vendor_compliance_thema FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON clm.vendor_compliance_thema TO clm_api, clm_admin;
