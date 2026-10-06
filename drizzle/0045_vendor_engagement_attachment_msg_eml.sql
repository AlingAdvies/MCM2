-- =============================================================================
-- clm.vendor_engagement_attachment — .msg en .eml toegestaan als bijlagetype.
--
-- Aanleiding: Transdev-gebruikers werken vrijwel uitsluitend in Outlook voor
-- leveranciers-communicatie. Relevante mailwisseling moet als bewijsstuk in
-- het dossier te bewaren zijn, niet alleen als PDF-afdruk. Zie
-- docs/superpowers/plans/2026-10-06-msg-eml-bijlagetype-vendor-dossiers.md.
--
-- .msg (Outlook-berichtformaat, binair OLE/CFBF-compound-document) en .eml
-- (standaard RFC822-mailformaat, platte tekst) krijgen elk een eigen vaste
-- content-type-string, op dezelfde manier als de bestaande PDF/PNG-typen:
-- de CHECK-constraint staat ze toe, de applicatiecode
-- (vendor-engagement-bestand-validatie.ts) stelt het type vast op basis van
-- de bestandsinhoud zelf, niet op het door de browser beweerde type.
--
-- CHECK-constraints kunnen niet met ALTER worden gewijzigd — de oude wordt
-- gedropt en een nieuwe met dezelfde naam, uitgebreide lijst, aangemaakt.
-- =============================================================================

ALTER TABLE "clm"."vendor_engagement_attachment"
    DROP CONSTRAINT "vendor_engagement_attachment_content_type_check";--> statement-breakpoint

ALTER TABLE "clm"."vendor_engagement_attachment"
    ADD CONSTRAINT "vendor_engagement_attachment_content_type_check"
    CHECK (content_type IN (
        'application/pdf',
        'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-outlook',
        'message/rfc822'
    ));--> statement-breakpoint

COMMENT ON TABLE clm.vendor_engagement_attachment IS
    'Bijlagen bij een vendor-dossier (max. 3 per engagement, PDF/PNG/DOCX/XLSX/MSG/EML, max. 10MB). Append-only, intrekken via deleted_at.';
