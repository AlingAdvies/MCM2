-- =============================================================================
-- clm.import_job / clm.import_row — admin-only contract-import (#198).
--
-- Ontwerp: docs/superpowers/specs/2026-08-31-contract-import-design.md.
-- Vervolg op #190 (contractdata-uploadtool) — de daadwerkelijke kolommenlijst
-- bleek een contract-import met find-or-create op vendor + vendor_contact,
-- niet een vendor-only-import zoals oorspronkelijk gevraagd.
--
-- import_type staat al op de job (v1: uitsluitend 'contract') zodat een
-- toekomstig tweede importtype geen migratie op deze tabel vraagt, alleen een
-- nieuwe waarde en een eigen verwerkingsmodule.
-- =============================================================================

CREATE TABLE clm.import_job (
    job_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL,
    import_type         text NOT NULL,
    created_by_user_id  uuid NOT NULL,
    filename            text NOT NULL,
    file_hash           text NOT NULL,
    row_count           integer NOT NULL,
    status              text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    confirmed_at        timestamptz,
    CONSTRAINT import_job_status_check
        CHECK (status IN ('preview', 'bevestigd'))
);--> statement-breakpoint

ALTER TABLE clm.import_job
    ADD CONSTRAINT import_job_tenant_id_tenant_tenant_id_fk
    FOREIGN KEY (tenant_id) REFERENCES clm.tenant(tenant_id)
    ON DELETE cascade;--> statement-breakpoint

ALTER TABLE clm.import_job
    ADD CONSTRAINT import_job_created_by_user_id_user_user_id_fk
    FOREIGN KEY (created_by_user_id) REFERENCES clm."user"(user_id)
    ON DELETE restrict;--> statement-breakpoint

CREATE INDEX import_job_tenant_id_idx
    ON clm.import_job USING btree (tenant_id);--> statement-breakpoint

-- ── import_row ───────────────────────────────────────────────────────────────
--
-- created_*/matched_* zijn bewust vier aparte kolommen (twee per entiteit) in
-- plaats van één: het resultaatscherm moet apart kunnen tonen wat déze import
-- nieuw aanmaakte versus hergebruikte (besluit eigenaar, 2026-08-31).

CREATE TABLE clm.import_row (
    row_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL,
    job_id              uuid NOT NULL,
    row_number          integer NOT NULL,
    raw_data            jsonb NOT NULL,
    normalized_data     jsonb NOT NULL,
    findings            jsonb NOT NULL,
    importable          boolean NOT NULL,
    result              text,
    created_contract_id uuid,
    created_vendor_id   uuid,
    matched_vendor_id   uuid,
    created_contact_id  uuid,
    matched_contact_id  uuid,
    CONSTRAINT import_row_result_check
        CHECK (result IS NULL OR result IN ('created', 'skipped', 'failed'))
);--> statement-breakpoint

ALTER TABLE clm.import_row
    ADD CONSTRAINT import_row_tenant_id_tenant_tenant_id_fk
    FOREIGN KEY (tenant_id) REFERENCES clm.tenant(tenant_id)
    ON DELETE cascade;--> statement-breakpoint

ALTER TABLE clm.import_row
    ADD CONSTRAINT import_row_job_id_import_job_job_id_fk
    FOREIGN KEY (job_id) REFERENCES clm.import_job(job_id)
    ON DELETE cascade;--> statement-breakpoint

ALTER TABLE clm.import_row
    ADD CONSTRAINT import_row_created_contract_id_contract_contract_id_fk
    FOREIGN KEY (created_contract_id) REFERENCES clm.contract(contract_id)
    ON DELETE set null;--> statement-breakpoint

ALTER TABLE clm.import_row
    ADD CONSTRAINT import_row_created_vendor_id_vendor_vendor_id_fk
    FOREIGN KEY (created_vendor_id) REFERENCES clm.vendor(vendor_id)
    ON DELETE set null;--> statement-breakpoint

ALTER TABLE clm.import_row
    ADD CONSTRAINT import_row_matched_vendor_id_vendor_vendor_id_fk
    FOREIGN KEY (matched_vendor_id) REFERENCES clm.vendor(vendor_id)
    ON DELETE set null;--> statement-breakpoint

ALTER TABLE clm.import_row
    ADD CONSTRAINT import_row_created_contact_id_vendor_contact_contact_id_fk
    FOREIGN KEY (created_contact_id) REFERENCES clm.vendor_contact(contact_id)
    ON DELETE set null;--> statement-breakpoint

ALTER TABLE clm.import_row
    ADD CONSTRAINT import_row_matched_contact_id_vendor_contact_contact_id_fk
    FOREIGN KEY (matched_contact_id) REFERENCES clm.vendor_contact(contact_id)
    ON DELETE set null;--> statement-breakpoint

CREATE INDEX import_row_tenant_id_idx
    ON clm.import_row USING btree (tenant_id);--> statement-breakpoint

CREATE INDEX import_row_job_id_idx
    ON clm.import_row USING btree (job_id);--> statement-breakpoint

-- ── RLS — zelfde vorm als ref.vendor_category (migratie 0034) ─────────────────

ALTER TABLE clm.import_job ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.import_job FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY import_job_isolation ON clm.import_job
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

ALTER TABLE clm.import_row ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.import_row FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY import_row_isolation ON clm.import_row
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

COMMENT ON TABLE clm.import_job IS
    'Eén CSV-importpoging (preview of bevestigd). import_type onderscheidt toekomstige importsoorten; v1 kent alleen ''contract''. Zie docs/superpowers/specs/2026-08-31-contract-import-design.md.';--> statement-breakpoint

COMMENT ON TABLE clm.import_row IS
    'Eén brondrij van een import_job: ruwe cellen, genormaliseerde waarden, bevindingen, en na bevestiging het resultaat. created_*/matched_* houden apart bij wat déze import nieuw aanmaakte versus hergebruikte.';--> statement-breakpoint

-- REVOKE vóór GRANT, conform migratie 0027 (src/db/rechten-contract.ts): een
-- kale GRANT beperkt niets, want ALTER DEFAULT PRIVILEGES (migratie 0001)
-- geeft clm_api via het lidmaatschap van clm_api_runtime al SELECT, INSERT,
-- UPDATE, DELETE op elke nieuwe tabel in clm. Zonder de REVOKE hieronder zou
-- clm_api_runtime dus ook DELETE krijgen — ruimer dan bedoeld.
--
-- Geen DELETE nodig: een import-job/-rij is het traceerbaarheidsspoor van de
-- import en wordt door de applicatie niet verwijderd.
REVOKE ALL ON clm.import_job FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON clm.import_job TO clm_api, clm_admin;--> statement-breakpoint

REVOKE ALL ON clm.import_row FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON clm.import_row TO clm_api, clm_admin;
