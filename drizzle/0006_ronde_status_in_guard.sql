-- =============================================================================
-- Stap 2 uit de bouwvolgorde: de guard moet de lifecycle van een ronde
-- meewegen (vragenlijst-ontwerp §2b, §5 stap 1b).
--
-- Migratie 0005 gaf survey_run een expliciete status (draft/active/finished/
-- archived). De guard kende die nog niet: hij weegt alleen revoked_at en
-- closes_at. Gevolg vóór deze migratie: een ronde in 'draft' — nog niet
-- gepubliceerd, nog niet bedoeld voor leveranciers — is via een token gewoon
-- bereikbaar. Datzelfde geldt voor 'finished' en 'archived', zolang closes_at
-- toevallig leeg is.
--
-- Deze migratie voegt de status toe aan resolve_survey_token(). Bewust als
-- APARTE kolom en niet verwerkt in run_closed:
--
--   - 'draft' en 'finished' zijn voor een leverancier iets anders. Bij de
--     eerste is de ronde nog niet begonnen, bij de tweede voorbij. Eén
--     gedeelde melding maakt van dat verschil een raadsel.
--   - run_closed blijft betekenen wat het betekende (ingetrokken of voorbij
--     closes_at), zodat de bestaande controles ongewijzigd blijven werken.
--
-- De functie retourneert nog steeds uitsluitend geldigheidsvelden: geen namen,
-- geen e-mailadressen, geen antwoorden. Een status is geen inhoudelijk
-- gegeven — hij zegt of de link werkt, niet wat erachter zit.
-- =============================================================================

-- DROP vóór CREATE, niet CREATE OR REPLACE. PostgreSQL weigert een replace die
-- de RETURNS TABLE wijzigt ("cannot change return type of existing function") —
-- geverifieerd, niet aangenomen. Er komt een kolom bij, dus dit moet.
--
-- Het korte gat tussen DROP en CREATE is niet zichtbaar: migraties draaien in
-- een transactie, dus buiten deze transactie bestaat de oude functie tot het
-- moment dat de nieuwe er staat.
DROP FUNCTION IF EXISTS clm.resolve_survey_token(TEXT);--> statement-breakpoint

CREATE FUNCTION clm.resolve_survey_token(p_token_hash TEXT)
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
           (v.vendor_id IS NOT NULL AND v.deleted_at IS NULL) AS vendor_active,
           (run.revoked_at IS NOT NULL
            OR (run.closes_at IS NOT NULL AND run.closes_at < now())) AS run_closed,
           run.status AS run_status
      FROM clm.survey_response r
      LEFT JOIN clm.vendor     v   ON v.vendor_id = r.vendor_id
      LEFT JOIN clm.survey_run run ON run.run_id  = r.run_id
     WHERE r.token_hash = p_token_hash
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.resolve_survey_token(TEXT) IS
    'Zoekt een survey-response op via de SHA-256-hash van het leverancierstoken. SECURITY DEFINER omdat de tenantcontext pas na deze lookup gezet kan worden. Retourneert uitsluitend geldigheidsvelden, nooit inhoudelijke gegevens.';--> statement-breakpoint

-- Na een DROP zijn de rechten wég: ze hangen aan het functie-object, niet aan
-- de naam. Zonder deze twee regels kan clm_api de functie niet meer aanroepen
-- en werkt géén enkele leverancierslink meer. Dit is geen nette herhaling maar
-- een noodzaak.
REVOKE ALL ON FUNCTION clm.resolve_survey_token(TEXT) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clm.resolve_survey_token(TEXT) TO clm_api, clm_admin;
