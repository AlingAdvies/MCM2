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
--
-- BEWUSTE KEUZE (herzien na een mislukte eerdere versie): deze migratie is
-- PUUR STRUCTUUR. Hij bevat geen aannames over hoeveel tenants of vendors
-- er al bestaan, en zaait geen data. Een eerdere versie probeerde de
-- bestaande platform-brede rijen (baseline-seed uit migratie 0000) direct
-- hier te herverdelen over elke bestaande tenant — dat werkte pas na drie
-- pogingen op de demo-database (391 vendors) en zou bij de volgende
-- afwijkende databasetoestand (een tenant die zijn categorieën al zelf
-- had aangepast, een productieomgeving met andere aantallen) opnieuw
-- kunnen breken. Een schemamigratie hoort niet af te hangen van de
-- actuele inhoud van de data.
--
-- Gevolg: bestaande vendor.category_code-waarden verliezen hier hun
-- betekenis (de rij waar ze naar verwezen bestaat straks niet meer in deze
-- vorm) en worden daarom EXPLICIET LEEGGEMAAKT, niet geraden. Een vendor
-- toont na deze migratie "geen categorie" totdat een tenant-admin het zelf
-- instelt via /vendor-categories, of totdat een apart, bewust gedraaid
-- reparatiescript per omgeving de standaardset zaait en oude verwijzingen
-- herstelt (zie scripts/seed-vendor-categorieen.js — NIET onderdeel van
-- deze migratieketen, met eigen logging, één keer per omgeving handmatig
-- te draaien). Nieuwe tenants krijgen de standaardset automatisch via
-- PlatformService.tenantAanmaken().
-- Naam-onafhankelijk: eerdere versies van deze migratie gokten de
-- constraint-naam (vendor_category_code_vendor_category_code_fk), maar
-- bleek op de demo-database een andere door Drizzle gegenereerde naam te
-- hebben, en op productie weer een andere (vendor_category_code_fkey —
-- kennelijk uit een oudere, handmatige of Prisma-achtige aanmaak van vóór
-- deze tabel onder Drizzle-beheer kwam). Een DROP CONSTRAINT ... IF EXISTS
-- op de verkeerde naam faalt niet, maar laat de echte constraint ongemoeid
-- staan — en dan faalt de PRIMARY KEY-drop verderop alsnog, met de
-- migratie al gedeeltelijk uitgevoerd. Zoek de constraint daarom op aan de
-- hand van wat hij DOET (een FK op clm.vendor die naar ref.vendor_category
-- verwijst), niet aan de hand van een aangenomen naam.
DO $$
DECLARE
    fk_naam text;
BEGIN
    SELECT con.conname INTO fk_naam
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_class frel ON frel.oid = con.confrelid
    JOIN pg_namespace fnsp ON fnsp.oid = frel.relnamespace
    WHERE con.contype = 'f'
      AND nsp.nspname = 'clm' AND rel.relname = 'vendor'
      AND fnsp.nspname = 'ref' AND frel.relname = 'vendor_category';

    IF fk_naam IS NOT NULL THEN
        EXECUTE format('ALTER TABLE clm.vendor DROP CONSTRAINT %I', fk_naam);
    END IF;
END $$;--> statement-breakpoint

UPDATE clm.vendor SET category_code = NULL WHERE category_code IS NOT NULL;--> statement-breakpoint

DELETE FROM ref.vendor_category;--> statement-breakpoint

ALTER TABLE ref.vendor_category ADD COLUMN tenant_id uuid NOT NULL;--> statement-breakpoint

ALTER TABLE ref.vendor_category
    ADD CONSTRAINT vendor_category_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES clm.tenant(tenant_id) ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE ref.vendor_category DROP CONSTRAINT vendor_category_pkey;--> statement-breakpoint
ALTER TABLE ref.vendor_category ADD PRIMARY KEY (tenant_id, code);--> statement-breakpoint

-- vendor.category_code wijst nu naar de samengestelde sleutel hierboven.
-- Elke waarde is hierboven al op NULL gezet, dus deze FK kan niet falen.
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
    'Vendor-categorieën, per tenant. Was platform-breed vóór migratie 0034; elke tenant beheert nu zijn eigen lijst via /vendor-categories. Migratie 0034 zaait GEEN data (bewust, zie de toelichting in die migratie) — nieuwe tenants krijgen de standaardset via PlatformService.tenantAanmaken(); bestaande omgevingen via het losse scripts/seed-vendor-categorieen.js.';--> statement-breakpoint

COMMENT ON TABLE ref.business_risk_tier IS
    'Transdev-achtige enterprise-brede business-risk-classificatie (Tier 1/2/3). Geen relatie met ref.business_criticality — dat is het resultaat van de IT-risk-assessment. Zie docs/superpowers/specs/2026-08-28-coupa-schema-uitbreiding-design.md.';
