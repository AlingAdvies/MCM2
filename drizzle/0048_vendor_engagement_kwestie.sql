-- =============================================================================
-- clm.vendor_engagement — dossier als kwestie: open/afgerond + volgende stap.
--
-- Aanleiding (#248, besluit eigenaar 26-10-2026): het contractscherm leidt
-- "wat speelt er", "laatste contact" en "volgend moment" af uit de dossiers,
-- zonder apart begrip overleg of notulen. Daarvoor heeft een dossier een
-- status nodig (open/afgerond) en een optionele volgende stap met datum.
-- De status stond in de oorspronkelijke vendor-dossiers-design bewust buiten
-- de MVP; dit heft dat op.
--
-- Afronden vereist een korte uitkomst. Die wordt NIET hier opgeslagen maar
-- als laatste notitie in clm.vendor_engagement_note (bestaand append-only
-- patroon) — zo blijft er één plek voor de stand van een dossier.
--
-- Bestaande rijen krijgen status 'open' via de DEFAULT. Geen nieuwe tabel,
-- dus geen GRANT nodig (de bestaande tabelrechten gelden ook voor nieuwe
-- kolommen).
-- =============================================================================

ALTER TABLE "clm"."vendor_engagement"
    ADD COLUMN "status" text NOT NULL DEFAULT 'open',
    ADD COLUMN "afgerond_op" timestamp with time zone,
    ADD COLUMN "volgende_stap_tekst" text,
    ADD COLUMN "volgende_stap_datum" date;--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement"
    ADD CONSTRAINT "vendor_engagement_status_check"
    CHECK (status IN ('open', 'afgerond'));--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement"
    ADD CONSTRAINT "vendor_engagement_afgerond_op_check"
    CHECK ((status = 'afgerond') = (afgerond_op IS NOT NULL));--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement"
    ADD CONSTRAINT "vendor_engagement_volgende_stap_tekst_check"
    CHECK (volgende_stap_tekst IS NULL OR char_length(volgende_stap_tekst) <= 300);--> statement-breakpoint

COMMENT ON TABLE clm.vendor_engagement_attachment IS
    'Bijlagen bij een vendor-dossier (max. 10 per engagement, PDF/PNG/DOCX/XLSX/MSG/EML, max. 10MB). Append-only, intrekken via deleted_at.';
