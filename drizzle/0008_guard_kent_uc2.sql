-- =============================================================================
-- BUGFIX: de guard weigerde élke interne beoordeling (UC2) met 410 Gone.
--
-- Gevonden op 2026-07-29 bij het bouwen van GET /survey/respond/questions —
-- de eerste keer dat een UC2-link daadwerkelijk over HTTP werd opgehaald.
--
-- WAT ER MIS WAS. resolve_survey_token() bepaalt vendor_active met:
--
--     LEFT JOIN clm.vendor v ON v.vendor_id = r.vendor_id
--     (v.vendor_id IS NOT NULL AND v.deleted_at IS NULL) AS vendor_active
--
-- Bij UC2 is survey_response.vendor_id bewust NULL: de invuller is een
-- Transdev-collega, geen leverancier (ontwerp §1c). De LEFT JOIN levert dan
-- niets, vendor_active wordt false, en de guard geeft 410 met de reden
-- 'vendor-inactief'. Elke interne beoordeling was daarmee onbereikbaar.
--
-- Migratie 0006 is geschreven vóórdat UC2 bestond; 0005 maakte vendor_id
-- nullable zonder deze functie mee te nemen. Geen enkele test merkte het,
-- omdat geen enkele test een UC2-link over HTTP ophaalde. Aangetoond tegen de
-- database, niet beredeneerd: alle drie de UC2-responses in de testset gaven
-- guard_zegt_actief = false.
--
-- DE FIX. Kijk naar subject_vendor_id in plaats van vendor_id. Die kolom is bij
-- BEIDE use cases gevuld en is NOT NULL — het is per definitie de leverancier
-- waar de survey over gaat. De controle "bestaat deze leverancier nog en is hij
-- niet zacht verwijderd" hoort daar dan ook op te slaan:
--
--   UC1  vendor_id = subject_vendor_id  → zelfde uitkomst als voorheen
--   UC2  vendor_id IS NULL              → nu de beoordeelde leverancier
--
-- Voor UC1 verandert er dus niets. Dat is geen aanname: een CHECK-constraint
-- uit migratie 0005 dwingt af dat bij survey_kind = 'vendor_compliance' geldt
-- dat vendor_id = subject_vendor_id.
--
-- WAAROM DIT DE JUISTE CONTROLE IS. De bedoeling van vendor_active is: heeft
-- deze vragenlijst nog een onderwerp? Een beoordeling over een leverancier die
-- uit het bestand verwijderd is, hoort niet meer ingevuld te worden — of de
-- invuller nu de leverancier zelf is of een collega. subject_vendor_id drukt
-- precies dat uit; vendor_id drukte uit "wie vult in", en dat is een andere
-- vraag.
--
-- CREATE OR REPLACE mag hier wél, anders dan bij 0006: de RETURNS TABLE blijft
-- ongewijzigd. Daarmee blijven ook de rechten staan (die hangen aan het
-- functie-object) en is de GRANT-herhaling uit 0006 hier niet nodig. De
-- REVOKE/GRANT staan er toch, zodat deze migratie ook op een database met een
-- afwijkende rechtenstand het juiste eindresultaat geeft.
-- =============================================================================

CREATE OR REPLACE FUNCTION clm.resolve_survey_token(p_token_hash TEXT)
RETURNS TABLE (
    response_id   UUID,
    tenant_id     UUID,
    status        TEXT,
    expires_at    TIMESTAMPTZ,
    submitted_at  TIMESTAMPTZ,
    vendor_active BOOLEAN,
    run_closed    BOOLEAN,
    run_status    TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
    SELECT r.response_id,
           r.tenant_id,
           r.status,
           r.expires_at,
           r.submitted_at,
           -- subject_vendor_id, niet vendor_id: de leverancier waar de survey
           -- OVER gaat, niet degene die invult. Bij UC2 is dat het verschil
           -- tussen werken en 410.
           (v.vendor_id IS NOT NULL AND v.deleted_at IS NULL) AS vendor_active,
           (run.revoked_at IS NOT NULL
            OR (run.closes_at IS NOT NULL AND run.closes_at < now())) AS run_closed,
           run.status AS run_status
      FROM clm.survey_response r
      LEFT JOIN clm.vendor     v   ON v.vendor_id = r.subject_vendor_id
      LEFT JOIN clm.survey_run run ON run.run_id  = r.run_id
     WHERE r.token_hash = p_token_hash
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.resolve_survey_token(TEXT) IS
    'Zoekt een survey-response op via de SHA-256-hash van het leverancierstoken. SECURITY DEFINER omdat de tenantcontext pas na deze lookup gezet kan worden. Retourneert uitsluitend geldigheidsvelden, nooit inhoudelijke gegevens. vendor_active slaat op subject_vendor_id (de beoordeelde leverancier), zodat UC2 werkt waar de invuller geen leverancier is.';--> statement-breakpoint

REVOKE ALL ON FUNCTION clm.resolve_survey_token(TEXT) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clm.resolve_survey_token(TEXT) TO clm_api, clm_admin;
