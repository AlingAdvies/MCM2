-- =============================================================================
-- clm.import_extra_contact — extra contactgegevens per import-rij (#198,
-- vervolg op migratie 0035, bevindingen bij het eerste echte gebruik 31-08).
--
-- Ontwerp: docs/superpowers/specs/2026-08-31-contract-import-design.md §10.3.
--
-- Waarom een aparte tabel en geen extra kolommen op import_row: een rij kan
-- een onbepaald aantal extra contactkanalen hebben (email_2, email_3, ...),
-- en dat past niet in vaste kolommen zonder een migratie per extra kanaal.
-- Bewust GEEN vendor_contact-rij en GEEN koppeling: dit is een hulptabel om
-- na de import handmatig te verwerken, geen automatisch aangemaakt contact
-- (besluit eigenaar: "een hulptabel om de extra contactpersonen per contract
-- op te lijsten, zodat deze handmatig kunnen worden toegevoegd").
-- =============================================================================

CREATE TABLE clm.import_extra_contact (
    extra_contact_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL,
    row_id              uuid NOT NULL,
    -- Volgnummer uit de kolomnaam (email_2 -> 2, full_name_3 -> 3), zodat
    -- email_2 en full_name_2 bij elkaar horen ook als er maar één van de
    -- twee is ingevuld.
    volgnummer          integer NOT NULL,
    email               text,
    full_name           text
);--> statement-breakpoint

ALTER TABLE clm.import_extra_contact
    ADD CONSTRAINT import_extra_contact_tenant_id_tenant_tenant_id_fk
    FOREIGN KEY (tenant_id) REFERENCES clm.tenant(tenant_id)
    ON DELETE cascade;--> statement-breakpoint

ALTER TABLE clm.import_extra_contact
    ADD CONSTRAINT import_extra_contact_row_id_import_row_row_id_fk
    FOREIGN KEY (row_id) REFERENCES clm.import_row(row_id)
    ON DELETE cascade;--> statement-breakpoint

CREATE INDEX import_extra_contact_tenant_id_idx
    ON clm.import_extra_contact USING btree (tenant_id);--> statement-breakpoint

CREATE INDEX import_extra_contact_row_id_idx
    ON clm.import_extra_contact USING btree (row_id);--> statement-breakpoint

ALTER TABLE clm.import_extra_contact ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.import_extra_contact FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY import_extra_contact_isolation ON clm.import_extra_contact
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

COMMENT ON TABLE clm.import_extra_contact IS
    'Extra contactgegevens (email_2, full_name_2, ...) uit een contract-import die niet in het primaire email/naam-paar pasten. Geen vendor_contact-rij, geen koppeling — een hulplijst om na de import handmatig te verwerken. Zie docs/superpowers/specs/2026-08-31-contract-import-design.md §10.3.';--> statement-breakpoint

-- REVOKE vóór GRANT, zelfde patroon als migratie 0035.
REVOKE ALL ON clm.import_extra_contact FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT ON clm.import_extra_contact TO clm_api, clm_admin;
