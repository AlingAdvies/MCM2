-- 0034_coupa_schema_uitbreiding.sql
-- Zie docs/superpowers/specs/2026-08-28-coupa-schema-uitbreiding-design.md.

-- ── 1. vendor.coupa_supplier_number — matchsleutel (#185) ──────────────────
ALTER TABLE clm.vendor ADD COLUMN coupa_supplier_number text;--> statement-breakpoint

-- ── 2. contract.contract_type — placeholder (#187) ─────────────────────────
ALTER TABLE clm.contract ADD COLUMN contract_type text;--> statement-breakpoint

-- ── 3. contract.dpa_aanwezig — tri-state vlag (#189) ───────────────────────
ALTER TABLE clm.contract ADD COLUMN dpa_aanwezig boolean;--> statement-breakpoint

-- ── 4. ref.business_risk_tier + contract.business_risk_tier_code (#188) ────
-- Bewust een ANDER concept dan ref.business_criticality (dat is het
-- resultaat van de IT-risk-assessment en bepaalt survey-relevantie, zie
-- src/survey/contractmanager.service.ts). business_risk_tier is Transdev's
-- enterprise-brede business-risk-classificatie, los van IT. Niet fuseren
-- ondanks de oppervlakkige gelijkenis in waarden (High/Medium/Low-achtig).
CREATE TABLE ref.business_risk_tier (
    code text PRIMARY KEY,
    label text NOT NULL
);--> statement-breakpoint

INSERT INTO ref.business_risk_tier (code, label) VALUES
    ('tier_1', 'Tier 1 — High impact (strategisch)'),
    ('tier_2', 'Tier 2 — Medium impact'),
    ('tier_3', 'Tier 3 — Low impact');--> statement-breakpoint

ALTER TABLE clm.contract ADD COLUMN business_risk_tier_code text
    REFERENCES ref.business_risk_tier(code) ON DELETE SET NULL;--> statement-breakpoint

-- ── 5. ref.vendor_category wordt tenant-scoped (#186) ──────────────────────
-- Was platform-breed (geen tenant_id, geen RLS). Wordt nu tenant-data: elke
-- tenant beheert zijn eigen lijst via het nieuwe /vendor-categories-scherm.
-- Bestaande rijen zijn feitelijk AlingAdvies' lijst — die claimt de migratie
-- hier expliciet, in plaats van ze verweesd te laten.
ALTER TABLE ref.vendor_category ADD COLUMN tenant_id uuid;--> statement-breakpoint

UPDATE ref.vendor_category
    SET tenant_id = 'c9f2a68a-73e2-4f64-8e32-e3e010331edb';--> statement-breakpoint

ALTER TABLE ref.vendor_category ALTER COLUMN tenant_id SET NOT NULL;--> statement-breakpoint

ALTER TABLE ref.vendor_category
    ADD CONSTRAINT vendor_category_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES clm.tenant(tenant_id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE ref.vendor_category DROP CONSTRAINT vendor_category_pkey;--> statement-breakpoint
ALTER TABLE ref.vendor_category ADD PRIMARY KEY (tenant_id, code);--> statement-breakpoint

-- vendor.category_code wijst nu naar een samengestelde sleutel. De
-- bestaande kolom-FK (op alleen code) bestaat niet als losse constraint
-- (Drizzle's .references() genereert 'm inline) — check en verwijder hem
-- als hij bestaat, voeg de samengestelde FK toe.
ALTER TABLE clm.vendor DROP CONSTRAINT IF EXISTS vendor_category_code_vendor_category_code_fk;--> statement-breakpoint

ALTER TABLE clm.vendor
    ADD CONSTRAINT vendor_category_tenant_fk
    FOREIGN KEY (tenant_id, category_code)
    REFERENCES ref.vendor_category(tenant_id, code)
    ON DELETE SET NULL;--> statement-breakpoint

-- RLS: vendor_category is nu tenant-data, en krijgt daarom dezelfde
-- policy-vorm als clm.contract (migratie 0027). Let op: ref.vendor_category
-- staat niet in het clm-schema maar de policy-functie clm.current_tenant_id()
-- is schema-onafhankelijk aanroepbaar.
ALTER TABLE ref.vendor_category ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ref.vendor_category FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY vendor_category_isolation ON ref.vendor_category
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

COMMENT ON TABLE ref.vendor_category IS
    'Vendor-categorieën, per tenant. Was platform-breed vóór migratie 0034; elke tenant beheert nu zijn eigen lijst via /vendor-categories. Seed-bij-aanmaak in PlatformService.tenantAanmaken(), daarna volledig los van de bron.';--> statement-breakpoint

COMMENT ON TABLE ref.business_risk_tier IS
    'Transdev-achtige enterprise-brede business-risk-classificatie (Tier 1/2/3). Geen relatie met ref.business_criticality — dat is het resultaat van de IT-risk-assessment. Zie docs/superpowers/specs/2026-08-28-coupa-schema-uitbreiding-design.md.';
