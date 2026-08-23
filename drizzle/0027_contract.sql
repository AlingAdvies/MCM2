-- =============================================================================
-- clm.contract — de contractmanagement-basismodule.
--
-- Ontwerp: docs/superpowers/specs/2026-08-22-contractmanagement-design.md
-- Aanleiding: opmerkingen 21-08 punt 2/2a/2c, roadmap-issues #156/#157.
--
-- Lost de belofte van migratie 0007 in: survey_run.contract_id kreeg toen
-- bewust nog geen foreign key, met het commentaar "zodra clm.contract
-- bestaat, is dit één ALTER TABLE erbij". Dat gebeurt hieronder in stap 4.
-- =============================================================================

-- ── 1. ref.contract_status — vaste waardenlijst, zelfde patroon als
-- ref.compliance_status / ref.business_criticality / ref.vendor_category.
--
-- "verlopend" staat hier bewust niet in: dat is een berekende weergavestatus
-- (status = 'actief' AND end_date <= vandaag + 90 dagen), nooit een
-- opgeslagen waarde. Zie spec §2.3 voor de volledige redenering — een
-- opgeslagen "verlopend" zou een achtergrondtaak vereisen die hem bijhoudt,
-- met het risico dat die taak stil achterloopt.

CREATE TABLE ref.contract_status (
    code  text PRIMARY KEY,
    label text NOT NULL
);--> statement-breakpoint

INSERT INTO ref.contract_status (code, label) VALUES
    ('actief', 'Actief'),
    ('verlopen', 'Verlopen'),
    ('opgezegd', 'Opgezegd')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

-- ref-schema: bewust geen RLS (tenant-agnostische lookup-data), zelfde als
-- de andere ref-tabellen.

-- ── 2. clm.contract ───────────────────────────────────────────────────────
--
-- Patroon: clm.vendor / clm.vendor_contact (0000_baseline_bestaand_schema).
--
-- vendor_contact_id is NULLABLE met applicatie-fallback (niet een
-- database-default): NULL betekent "gebruik de is_primary-contactpersoon
-- van de vendor". Een database-default zou bevriezen op het moment van
-- invoegen; de fallback hoort in de leeslaag. Zie spec §2.1.
--
-- contract_number heeft bewust geen uniekheidseis: het komt uit een extern
-- ERP-systeem dat MCM2 niet controleert.

CREATE TABLE clm.contract (
    contract_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL,
    vendor_id         uuid NOT NULL,
    name              text NOT NULL,
    contract_number   text,
    vendor_contact_id uuid,
    owner_user_id     uuid,
    status_code       text,
    value_eur         numeric(15, 2),
    start_date        date,
    end_date          date,
    note              text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz,
    deleted_at        timestamptz
);--> statement-breakpoint

ALTER TABLE clm.contract
    ADD CONSTRAINT contract_tenant_id_tenant_tenant_id_fk
    FOREIGN KEY (tenant_id) REFERENCES clm.tenant(tenant_id)
    ON DELETE restrict;--> statement-breakpoint

ALTER TABLE clm.contract
    ADD CONSTRAINT contract_vendor_id_vendor_vendor_id_fk
    FOREIGN KEY (vendor_id) REFERENCES clm.vendor(vendor_id)
    ON DELETE cascade;--> statement-breakpoint

ALTER TABLE clm.contract
    ADD CONSTRAINT contract_vendor_contact_id_vendor_contact_contact_id_fk
    FOREIGN KEY (vendor_contact_id) REFERENCES clm.vendor_contact(contact_id)
    ON DELETE set null;--> statement-breakpoint

ALTER TABLE clm.contract
    ADD CONSTRAINT contract_owner_user_id_user_user_id_fk
    FOREIGN KEY (owner_user_id) REFERENCES clm."user"(user_id)
    ON DELETE set null;--> statement-breakpoint

ALTER TABLE clm.contract
    ADD CONSTRAINT contract_status_code_contract_status_code_fk
    FOREIGN KEY (status_code) REFERENCES ref.contract_status(code)
    ON DELETE set null;--> statement-breakpoint

CREATE INDEX contract_tenant_id_idx ON clm.contract USING btree (tenant_id);--> statement-breakpoint
CREATE INDEX contract_vendor_id_idx ON clm.contract USING btree (vendor_id);--> statement-breakpoint

CREATE TRIGGER trg_contract_updated_at
    BEFORE UPDATE ON clm.contract
    FOR EACH ROW EXECUTE FUNCTION clm.set_updated_at();--> statement-breakpoint

ALTER TABLE clm.contract ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.contract FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Bewust GEEN "AND deleted_at IS NULL" in USING — dat is exact de fout die
-- migratie 0004 (Issue #31) al eens oploste op vendor/user/vendor_contact.
-- Met dat filter in USING toetst Postgres bij een UPDATE de zichtbaarheid
-- van het RESULTAAT: zodra deleted_at gevuld wordt, valt de nieuwe rij
-- buiten de policy en weigert de soft delete zelf met "new row violates
-- row-level security policy" — precies de operatie die soft delete moet
-- toestaan. RLS is de tenant-isolatiegrens; het filteren van zacht
-- verwijderde rijen is een zaak van de query (zie ContractService, dat
-- overal expliciet "AND deleted_at IS NULL" toevoegt), niet van de
-- beveiligingslaag.
CREATE POLICY contract_isolation ON clm.contract
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

COMMENT ON TABLE clm.contract IS
    'Contracten bij een leverancier. vendor_contact_id is nullable: NULL betekent "gebruik de is_primary-contactpersoon van de vendor" (applicatielogica, geen database-default). status_code kent geen "verlopend" — die status is berekend uit end_date, nooit opgeslagen. Zie docs/superpowers/specs/2026-08-22-contractmanagement-design.md.';--> statement-breakpoint

-- REVOKE vóór GRANT, conform migratie 0022 (src/db/rechten-contract.ts): een
-- kale GRANT beperkt niets, want ALTER DEFAULT PRIVILEGES (migratie 0001)
-- geeft clm_api via het lidmaatschap van clm_api_runtime al SELECT, INSERT,
-- UPDATE, DELETE op elke nieuwe tabel in clm. Zonder de REVOKE hieronder zou
-- clm_api_runtime dus ook DELETE krijgen — ruimer dan bedoeld, en op een
-- manier die alleen lokaal opvalt (Supabase kent die default niet).
--
-- Zacht verwijderd via deleted_at, net als vendor — geen DELETE nodig.
REVOKE ALL ON clm.contract FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON clm.contract TO clm_api, clm_admin;--> statement-breakpoint

-- ── 3. clm.contract_survey_template — many-to-many, geen extra kolommen ────
--
-- Welke vragenlijst-templates relevant zijn voor een contract. Geen
-- frequentie- of verplicht/optioneel-veld: dat raakt de nog niet gebouwde
-- rondes/herhaling-feature en is bewust uitgesteld. Zie spec §2.4.

CREATE TABLE clm.contract_survey_template (
    contract_id       uuid NOT NULL,
    survey_template_id uuid NOT NULL,
    tenant_id         uuid NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT contract_survey_template_pkey
        PRIMARY KEY (contract_id, survey_template_id)
);--> statement-breakpoint

ALTER TABLE clm.contract_survey_template
    ADD CONSTRAINT contract_survey_template_contract_id_contract_contract_id_fk
    FOREIGN KEY (contract_id) REFERENCES clm.contract(contract_id)
    ON DELETE cascade;--> statement-breakpoint

ALTER TABLE clm.contract_survey_template
    ADD CONSTRAINT contract_survey_template_survey_template_id_fk
    FOREIGN KEY (survey_template_id) REFERENCES clm.survey_template(template_id)
    ON DELETE cascade;--> statement-breakpoint

CREATE INDEX contract_survey_template_tenant_id_idx
    ON clm.contract_survey_template USING btree (tenant_id);--> statement-breakpoint

ALTER TABLE clm.contract_survey_template ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.contract_survey_template FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY contract_survey_template_isolation ON clm.contract_survey_template
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

COMMENT ON TABLE clm.contract_survey_template IS
    'Welke vragenlijst-templates relevant zijn voor een contract. Many-to-many, geen extra velden. Zie docs/superpowers/specs/2026-08-22-contractmanagement-design.md §2.4.';--> statement-breakpoint

-- Een koppeling bestaat of niet. Wijzigen heeft geen betekenis — ontkoppelen
-- en opnieuw koppelen wel. Zelfde redenering als template_reviewer (0022).
REVOKE ALL ON clm.contract_survey_template FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON clm.contract_survey_template TO clm_api, clm_admin;--> statement-breakpoint

-- ── 4. survey_run.contract_id krijgt zijn foreign key ──────────────────────
--
-- Migratie 0007 introduceerde de kolom bewust zonder FK. Dit is het
-- aangekondigde vervolg. ON DELETE SET NULL, niet CASCADE of RESTRICT: een
-- survey-ronde is bewijsmateriaal en mag niet verdwijnen als het contract
-- wordt verwijderd — hij verliest alleen de koppeling. Zie spec §2.5.

ALTER TABLE clm.survey_run
    ADD CONSTRAINT survey_run_contract_id_contract_contract_id_fk
    FOREIGN KEY (contract_id) REFERENCES clm.contract(contract_id)
    ON DELETE set null;--> statement-breakpoint

COMMENT ON COLUMN clm.survey_run.contract_id IS
    'Op welk contract deze ronde betrekking heeft. Nullable: een ronde hoeft niet aan een contract te hangen. FK toegevoegd in migratie 0027 zodra clm.contract bestond, zoals migratie 0007 al aankondigde.';
