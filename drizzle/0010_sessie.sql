-- =============================================================================
-- Sessies: onthouden wie er ingelogd is (Issue #7, spoor 1).
--
-- Na een geslaagde login bij Entra moet de server bij élk volgend verzoek weten
-- wie de gebruiker is. Het ID-token daarvoor telkens opnieuw meesturen kan niet:
-- dat token hoort de browser nooit in handen te krijgen (het is een XSS-doelwit
-- en het is niet in te trekken). In plaats daarvan krijgt de browser een
-- betekenisloze sleutel in een httpOnly cookie, en die sleutel wijst hier naar.
--
-- ── Waarom in de database en niet in het geheugen ────────────────────────────
--
-- Besluit van de eigenaar, 2026-07-30. Sessies in het procesgeheugen zijn
-- eenvoudiger, maar:
--   1. iedereen is uitgelogd bij elke herstart — ook bij een gewone deploy,
--      en dat is precies het moment waarop je een demo geeft;
--   2. het breekt zodra er een tweede container draait: de ene weet niet wat
--      de andere weet. Dat is geen theoretisch scenario maar de beoogde
--      uitrolvorm (ADR-012).
--
-- ── Waarom gehasht ───────────────────────────────────────────────────────────
--
-- Hetzelfde patroon als survey_response.token_hash (migratie 0003): de database
-- bewaart SHA-256 van het token, nooit het token zelf. Wie de database in handen
-- krijgt, kan daarmee niet inloggen — hij heeft de afdruk, niet de sleutel.
--
-- Dat is hier zwaarder dan bij de surveylink: een sessietoken hoort bij een
-- interne beheerder met schrijfrechten op de hele tenant.
--
-- ── Waarom GEEN RLS op deze tabel ────────────────────────────────────────────
--
-- Élke andere tenantgebonden tabel heeft RLS (§7.4). Deze bewust niet, en dat
-- verdient uitleg omdat het een uitzondering is op een harde regel.
--
-- Het is exact hetzelfde kip-ei-probleem als bij clm.gebruiker_bij_subject() in
-- migratie 0009: de sessie moet opgezocht worden vóórdat de tenantcontext
-- bestaat — de tenant vólgt immers uit de sessie. Een RLS-policy op
-- current_tenant_id() zou hier altijd nul rijen opleveren en daarmee elke login
-- onbruikbaar maken.
--
-- De toegang loopt daarom, net als daar, via een SECURITY DEFINER-functie met
-- een scherp begrensde opdracht. De tabel zelf is voor de runtime-rol
-- onbereikbaar: geen SELECT, geen INSERT, geen UPDATE, geen DELETE. Alleen de
-- drie functies onderaan mogen erbij, en die geven nooit meer terug dan nodig.
--
-- tenant_id staat er wél op — niet voor RLS, maar omdat de guard hem eruit
-- leest om `SET LOCAL` mee te vullen. Dat is de hele reden dat deze tabel
-- bestaat.
-- =============================================================================

CREATE TABLE clm.sessie (
    sessie_id     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash    text        NOT NULL,
    user_id       uuid        NOT NULL REFERENCES clm."user" (user_id)   ON DELETE CASCADE,
    tenant_id     uuid        NOT NULL REFERENCES clm.tenant (tenant_id) ON DELETE RESTRICT,

    -- Meegekopieerd uit tenant_membership op het moment van inloggen. Bewust
    -- geen join bij elk verzoek: een rolwijziging hoort pas te gelden bij de
    -- volgende login, niet halverwege een sessie.
    role          text        NOT NULL,

    -- De oid uit het ID-token. Puur voor onderzoek achteraf: "welke
    -- Entra-identiteit hoorde bij deze sessie" is bij een incident de eerste
    -- vraag, en dan is de user-rij misschien al verwijderd.
    external_subject text     NOT NULL,

    aangemaakt_op timestamptz NOT NULL DEFAULT now(),
    verloopt_op   timestamptz NOT NULL,

    -- Schuift mee bij gebruik (glijdend venster van 8 uur, besluit eigenaar
    -- 2026-07-30). Ook de signalering voor "deze sessie is al dagen stil".
    laatst_gezien timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT sessie_token_hash_key UNIQUE (token_hash),

    -- Zelfde vorm als survey_response: dwingt af dat hier een SHA-256-afdruk
    -- staat en niet per ongeluk het token zelf. Een bug die het ruwe token zou
    -- wegschrijven, stuit hierop in plaats van stilzwijgend te slagen.
    CONSTRAINT sessie_token_hash_format_check
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),

    CONSTRAINT sessie_role_check CHECK (role IN ('admin', 'reviewer'))

    -- BEWUST GEEN CHECK (verloopt_op > aangemaakt_op).
    --
    -- Die stond er eerst wel, en leek redelijk: een sessie die verloopt vóór
    -- hij bestond, is onzin. Bij het testen bleek hij te streng — hij blokkeert
    -- namelijk ook het *intrekken* van een lopende sessie, en dat is precies
    -- wat je wilt kunnen bij een gestolen laptop of een vertrokken medewerker.
    -- Intrekken gebeurt door verloopt_op naar het verleden te zetten; de rij
    -- blijft dan bestaan tot de eerstvolgende opruiming.
    --
    -- Het scenario dat de constraint moest afvangen (een sessie aanmaken die
    -- meteen verlopen is) wordt afgevangen waar het hoort: sessie_aanmaken()
    -- krijgt de geldigheidsduur van de applicatie, niet van de gebruiker.
);--> statement-breakpoint

CREATE INDEX sessie_user_id_idx ON clm.sessie (user_id);--> statement-breakpoint

-- Voor het opruimen van verlopen sessies.
CREATE INDEX sessie_verloopt_op_idx ON clm.sessie (verloopt_op);--> statement-breakpoint

COMMENT ON TABLE clm.sessie IS
    'Server-side sessies voor interne gebruikers (Issue #7). Bewust zonder RLS: de sessie wordt opgezocht vóórdat de tenantcontext bestaat. Toegang uitsluitend via de SECURITY DEFINER-functies hieronder; de runtime-rol heeft geen rechten op de tabel zelf.';--> statement-breakpoint

-- ── Rechten: de tabel is dicht ───────────────────────────────────────────────
--
-- ALTER DEFAULT PRIVILEGES uit migratie 0001 geeft clm_api en clm_admin
-- automatisch CRUD op nieuwe tabellen in clm. Voor deze tabel halen we dat
-- expliciet weer weg: zonder RLS zou een rechtstreekse SELECT alle sessies van
-- alle tenants tonen.
REVOKE ALL ON clm.sessie FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint

-- ── clm.sessie_aanmaken() ────────────────────────────────────────────────────
--
-- Draait ná een geslaagde tokenverificatie. Controleert zelf dat de gebruiker
-- daadwerkelijk lid is van de tenant — de aanroeper kan dus geen sessie
-- verzinnen voor een tenant waar hij niet hoort, ook niet met een bug in de
-- applicatielaag.
CREATE OR REPLACE FUNCTION clm.sessie_aanmaken(
    p_token_hash text,
    p_external_subject text,
    p_geldigheid interval
)
RETURNS TABLE (sessie_id uuid, user_id uuid, tenant_id uuid, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
DECLARE
    v_user_id   uuid;
    v_tenant_id uuid;
    v_role      text;
BEGIN
    -- Membership is de autorisatie. Geen membership, geen sessie.
    SELECT m.user_id, m.tenant_id, m.role
      INTO v_user_id, v_tenant_id, v_role
      FROM clm.tenant_membership m
      JOIN clm."user" u ON u.user_id = m.user_id
     WHERE u.external_subject = p_external_subject
       AND p_external_subject IS NOT NULL
       AND u.deleted_at IS NULL
       AND m.deleted_at IS NULL
     ORDER BY m.created_at
     LIMIT 1;

    IF v_user_id IS NULL THEN
        -- Geen exception met details: dat zou verklappen of een subject bestaat.
        RETURN;
    END IF;

    RETURN QUERY
    INSERT INTO clm.sessie (
        token_hash, user_id, tenant_id, role, external_subject, verloopt_op
    )
    VALUES (
        p_token_hash, v_user_id, v_tenant_id, v_role, p_external_subject,
        now() + p_geldigheid
    )
    RETURNING clm.sessie.sessie_id, clm.sessie.user_id,
              clm.sessie.tenant_id, clm.sessie.role;
END;
$$;--> statement-breakpoint

-- ── clm.sessie_oplossen() ────────────────────────────────────────────────────
--
-- De heetste route van de applicatie: draait bij élk verzoek van een ingelogde
-- gebruiker. Zoekt de sessie op de hash, weigert verlopen sessies, en schuift
-- in dezelfde stap het venster op.
--
-- Verlengen zit hier en niet in een aparte aanroep, omdat het anders een tweede
-- ronde naar de database kost bij elk verzoek.
CREATE OR REPLACE FUNCTION clm.sessie_oplossen(
    p_token_hash text,
    p_geldigheid interval
)
RETURNS TABLE (sessie_id uuid, user_id uuid, tenant_id uuid, role text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
    UPDATE clm.sessie s
       SET laatst_gezien = now(),
           verloopt_op   = now() + p_geldigheid
     WHERE s.token_hash = p_token_hash
       AND p_token_hash IS NOT NULL
       AND s.verloopt_op > now()
    RETURNING s.sessie_id, s.user_id, s.tenant_id, s.role;
$$;--> statement-breakpoint

-- ── clm.sessie_beeindigen() ──────────────────────────────────────────────────
--
-- Uitloggen verwijdert de rij (besluit eigenaar 2026-07-30). Wie wat deed staat
-- al in de audit trail; een tabel met inlogpatronen erbij bewaren is een
-- persoonsgegeven met een bewaartermijn die niemand gaat bewaken.
--
-- Ruimt meteen verlopen sessies op: zonder dat groeit de tabel eindeloos, en
-- een aparte opruimtaak is een extra ding dat stil kan falen.
CREATE OR REPLACE FUNCTION clm.sessie_beeindigen(p_token_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
    WITH opgeruimd AS (
        DELETE FROM clm.sessie WHERE verloopt_op < now()
    )
    DELETE FROM clm.sessie
     WHERE token_hash = p_token_hash
       AND p_token_hash IS NOT NULL;
$$;--> statement-breakpoint

-- Uitvoerrechten expliciet. PUBLIC eraf: een SECURITY DEFINER-functie die
-- iedereen mag aanroepen is een openstaande deur.
REVOKE ALL ON FUNCTION clm.sessie_aanmaken(text, text, interval) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION clm.sessie_oplossen(text, interval)       FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION clm.sessie_beeindigen(text)               FROM PUBLIC;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION clm.sessie_aanmaken(text, text, interval) TO clm_api, clm_admin;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clm.sessie_oplossen(text, interval)       TO clm_api, clm_admin;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clm.sessie_beeindigen(text)               TO clm_api, clm_admin;
