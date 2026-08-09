-- De eerste login van een uitgenodigde beheerder.
--
-- ── Het probleem ─────────────────────────────────────────────────────────────
--
-- Sinds de platformroute (0020) maakt een platformbeheerder een tenant aan met
-- een eerste admin: naam en e-mailadres. Die gebruikersrij krijgt géén
-- `external_subject`, want de `oid` uit Entra bestaat pas na een echte login.
--
-- Maar `clm.sessie_aanmaken()` zoekt juist op die kolom:
--
--     WHERE u.external_subject = p_external_subject
--
-- Een rij met NULL matcht nooit. De uitgenodigde admin kan dus niet inloggen,
-- en de tenant blijft onbruikbaar. Vastgesteld op 2026-08-09 met de eerste
-- echte tenant (AlingAdvies).
--
-- ── De oplossing, en waarom hij hier staat ───────────────────────────────────
--
-- Bij een login met een onbekende `oid` zoekt deze functie een wachtende rij op
-- e-mailadres, en koppelt de `oid` daaraan — één keer, onomkeerbaar.
--
-- In de applicatielaag zou dat ook kunnen, maar dan is het één vergeten
-- WHERE-clausule van een account-overname verwijderd. Hier is elke voorwaarde
-- onderdeel van dezelfde query, en de functie is de enige weg naar binnen.
--
-- ── De voorwaarden, en wat elk ervan tegenhoudt ──────────────────────────────
--
--   1. precies één wachtende rij met dat e-mailadres
--      → bij twee kandidaten weigeren in plaats van gokken
--
--   2. external_subject IS NULL
--      → nooit een bestaande koppeling overschrijven; dat zou een
--        account-overname zijn in plaats van een eerste login
--
--   3. koppelbaar_tot is niet verstreken
--      → een uitnodiging die maanden blijft liggen sluit vanzelf. Zonder deze
--        voorwaarde blijft elke ooit aangemaakte rij eeuwig koppelbaar.
--
--   4. het e-maildomein komt overeen
--      → de aanroeper geeft het adres uit het ID-token door; de vergelijking
--        gebeurt hier, hoofdletterongevoelig
--
--   5. de login kwam via een federatieve provider
--      → de idp-claim moet aanwezig zijn. Bij Entra External ID betekent dat:
--        de gebruiker is geauthenticeerd bij zijn eigen organisatie, met hun
--        MFA-beleid. Een lokaal aangemaakt CIAM-account zonder federatie heeft
--        die claim niet.
--
-- ── Wat dit NIET afdekt, en waarom dat aanvaard is ───────────────────────────
--
-- Entra levert geen `email_verified`-claim; dat is gemeten op 2026-08-08, niet
-- aangenomen. Het restrisico is dat wie een uitgenodigd e-mailadres kent én bij
-- dezelfde federatieve provider kan inloggen, de uitnodiging kan opeisen.
--
-- Op deze schaal — één platformbeheerder die zelf elke tenant aanmaakt, en een
-- uitnodiging die na 90 dagen vervalt — is dat venster smal en het gevolg
-- zichtbaar: de koppeling staat in de audit trail, en de echte admin merkt dat
-- hij niet meer binnenkomt. Bij meer tenants hoort hier een uitnodigingstoken;
-- zie docs/ontwerp/tenants-gebruikers-en-platformbeheer.md §5.2.

-- ── 1. Hoe lang een uitnodiging geldig is ────────────────────────────────────
--
-- NULL betekent: geen uitnodiging, deze rij is niet koppelbaar. Dat is de
-- veilige stand voor alle bestaande gebruikers — die hebben immers al een oid.

ALTER TABLE clm."user"
    ADD COLUMN koppelbaar_tot timestamptz;--> statement-breakpoint

COMMENT ON COLUMN clm."user".koppelbaar_tot IS
    'Tot wanneer een oid aan deze rij gekoppeld mag worden bij de eerste login. NULL is de veilige stand: niet koppelbaar. Wordt gezet door de platformroute bij het uitnodigen, standaard 90 dagen.';--> statement-breakpoint

-- Bedient de lookup hieronder: welke wachtende rij hoort bij dit e-mailadres.
-- Partieel, want alleen rijen zonder oid zijn ooit kandidaat.
CREATE INDEX user_wachtend_op_koppeling_idx
    ON clm."user" (lower(email))
    WHERE external_subject IS NULL AND deleted_at IS NULL;--> statement-breakpoint

-- ── 2. De koppelfunctie ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION clm.koppel_eerste_login(
    p_external_subject text,
    p_email            text,
    p_identity_provider text
)
RETURNS TABLE (user_id uuid, tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
DECLARE
    v_user_id   uuid;
    v_tenant_id uuid;
    v_aantal    int;
BEGIN
    -- Voorwaarde 5: zonder federatie geen koppeling.
    IF p_identity_provider IS NULL OR trim(p_identity_provider) = '' THEN
        RETURN;
    END IF;

    IF p_email IS NULL OR trim(p_email) = '' THEN
        RETURN;
    END IF;

    IF p_external_subject IS NULL OR trim(p_external_subject) = '' THEN
        RETURN;
    END IF;

    -- Voorwaarde 2: nooit koppelen aan een oid die al bestaat. Zou die
    -- controle ontbreken, dan kon een tweede login een bestaande gebruiker
    -- overschrijven.
    IF EXISTS (
        SELECT 1 FROM clm."user"
         WHERE external_subject = p_external_subject
    ) THEN
        RETURN;
    END IF;

    -- Voorwaarden 1, 3 en 4 in één query: tellen én ophalen.
    SELECT count(*) INTO v_aantal
      FROM clm."user" u
     WHERE lower(u.email) = lower(p_email)
       AND u.external_subject IS NULL
       AND u.deleted_at IS NULL
       AND u.koppelbaar_tot IS NOT NULL
       AND u.koppelbaar_tot > now();

    -- Voorwaarde 1: bij nul of meer dan één kandidaat weigeren. Gokken zou
    -- betekenen dat de uitkomst van volgorde afhangt.
    IF v_aantal <> 1 THEN
        RETURN;
    END IF;

    SELECT u.user_id, u.tenant_id
      INTO v_user_id, v_tenant_id
      FROM clm."user" u
     WHERE lower(u.email) = lower(p_email)
       AND u.external_subject IS NULL
       AND u.deleted_at IS NULL
       AND u.koppelbaar_tot IS NOT NULL
       AND u.koppelbaar_tot > now();

    -- De tenantcontext moet gezet zijn vóór de UPDATE, en dat is het kip-ei
    -- van deze hele functie: clm."user" heeft een policy op
    -- clm.current_tenant_id(), maar bij een eerste login is die context er nog
    -- niet — de tenant vólgt uit de rij die we net gevonden hebben.
    --
    -- De SELECT's hierboven konden nog zonder: die draaien als eigenaar op een
    -- tabel zonder FORCE (migratie 0011). Schrijven kan dat niet.
    --
    -- `true` als derde argument: alleen binnen deze transactie, zodat de
    -- aanroeper zijn eigen context niet kwijtraakt.
    PERFORM set_config('app.current_tenant_id', v_tenant_id::text, true);

    UPDATE clm."user"
       SET external_subject = p_external_subject,
           koppelbaar_tot   = NULL
     WHERE clm."user".user_id = v_user_id;

    -- De koppeling zelf is auditinformatie: hij bepaalt wie voortaan als deze
    -- gebruiker binnenkomt. audit.audit_event heeft dezelfde policy, en de
    -- context staat hierboven al goed.
    INSERT INTO audit.audit_event
        (tenant_id, action_type, entity_type, entity_id, new_values)
    VALUES (
        v_tenant_id, 'eerste_login_gekoppeld', 'user', v_user_id,
        jsonb_build_object('identity_provider', p_identity_provider)
    );

    RETURN QUERY SELECT v_user_id, v_tenant_id;
END;
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.koppel_eerste_login(text, text, text) IS
    'Koppelt bij de eerste login een oid aan een uitgenodigde gebruikersrij. Vijf voorwaarden, alle vijf nodig: precies één kandidaat op e-mailadres, external_subject nog leeg, de oid nog nergens in gebruik, de uitnodiging niet verstreken, en een federatieve login. Geeft niets terug wanneer een voorwaarde niet gehaald wordt — nooit een exception met details, want die zou verklappen welk e-mailadres bestaat.';--> statement-breakpoint

-- Zelfde rechten als de andere definer-functies (0009, 0010): PUBLIC eraf,
-- expliciet aan de applicatierollen.
REVOKE ALL ON FUNCTION clm.koppel_eerste_login(text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clm.koppel_eerste_login(text, text, text) TO clm_api, clm_admin;
