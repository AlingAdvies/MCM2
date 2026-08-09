-- Een uitgenodigde beheerder koppelt zich met een token, niet met een claim.
--
-- ── Wat er mis was aan voorwaarde 5 ──────────────────────────────────────────
--
-- Migratie 0023 eist bij de eerste login dat er een `idp`-claim aanwezig is:
-- de login moet via een federatieve provider zijn binnengekomen. Dat leek een
-- waarborg, maar hij toetst de *vorm* van de login en niet de identiteit van
-- de aanvrager. Welke provider het is, wordt niet gecontroleerd — wie zich bij
-- een willekeurige federatieve provider aanmeldt én het uitgenodigde
-- e-mailadres kent, komt binnen.
--
-- Daarmee was de koppeling in de praktijk beveiligd door één ding: het kennen
-- van een e-mailadres. Dat stond in 0023 ook eerlijk opgeschreven, als aanvaard
-- restrisico (regels 49-59), met de aantekening dat hier een uitnodigingstoken
-- hoort zodra er meer tenants zijn.
--
-- Dat moment is nu, en om twee redenen tegelijk:
--
--   1. De eis kost méér dan hij oplevert. Ze sluit elke inlogmethode uit die
--      geen federatie is — e-mail met eenmalige code bijvoorbeeld — terwijl ze
--      de aanval waar het om gaat niet tegenhoudt.
--
--   2. Wat een zakelijke klant werkelijk vraagt is niet "kwam deze login via
--      een federatie", maar "is deze toegang aantoonbaar toegekend". Een token
--      dat de platformbeheerder uitgeeft beantwoordt die vraag; een claim over
--      de inlogmethode niet.
--
-- ── Wat er voor in de plaats komt ────────────────────────────────────────────
--
-- Bij het aanmaken geeft de platformroute een token uit, precies zoals bij de
-- leverancierstokens (0003): 32 bytes willekeur, base64url in de link, SHA-256
-- in de database. Het ruwe token verlaat de applicatie één keer en is daarna
-- nergens meer op te vragen.
--
-- De winst zit in de unieke index. In 0023 was "precies één kandidaat" een
-- telling in de functie — code die kon meetellen wat niet meegeteld had moeten
-- worden. Nu is het een eigenschap van de database: twee rijen met dezelfde
-- hash kúnnen niet bestaan. De voorwaarde is daarmee niet zozeer strenger als
-- wel onmogelijk om per ongeluk te overtreden.
--
-- Het e-mailadres blijft als tweede controle staan. Token én adres moeten
-- kloppen; dat kost niets en maakt een link die bij de verkeerde persoon
-- belandt waardeloos.
--
-- ── Federatie afdwingen: bewust niet hier ────────────────────────────────────
--
-- Een tenant die eist dat alleen zijn eigen AD toegang geeft, hoort dat per
-- tenant en bij *elke* login afgedwongen te krijgen — niet globaal en alleen
-- bij de eerste. Dat is een kolom op clm.tenant en een controle in
-- clm.sessie_aanmaken(), en dat bouwen we bij de eerste klant die het vraagt,
-- omdat pas dan bekend is wat hij precies eist.
--
-- Voorwaarde 5 laten staan zou dat gat níét vullen: hij bewaakt alleen de
-- allereerste login en laat elke volgende ongemoeid.

-- ── 1. De kolom ──────────────────────────────────────────────────────────────

ALTER TABLE clm."user"
    ADD COLUMN uitnodiging_hash text;--> statement-breakpoint

COMMENT ON COLUMN clm."user".uitnodiging_hash IS
    'SHA-256 van het uitnodigingstoken, hex. NULL betekent: geen openstaande uitnodiging. Wordt gewist zodra de koppeling gelukt is — een token werkt precies één keer.';--> statement-breakpoint

-- Dezelfde controle als op survey_response.token_hash (0003): een afwijkende
-- lengte betekent dat er iets anders is opgeslagen dan een hash, en het meest
-- waarschijnlijke "iets anders" is het ruwe token.
ALTER TABLE clm."user"
    ADD CONSTRAINT user_uitnodiging_hash_format_check
    CHECK (uitnodiging_hash IS NULL OR uitnodiging_hash ~ '^[0-9a-f]{64}$');--> statement-breakpoint

-- Hier zit de kern van deze migratie. Partieel, want alleen openstaande
-- uitnodigingen doen mee; uniek, want twee rijen met dezelfde hash zouden
-- betekenen dat één token naar twee gebruikers leidt.
CREATE UNIQUE INDEX user_uitnodiging_hash_key
    ON clm."user" (uitnodiging_hash)
    WHERE uitnodiging_hash IS NOT NULL;--> statement-breakpoint

-- ── 2. De koppelfunctie ──────────────────────────────────────────────────────
--
-- DROP en opnieuw aanmaken, niet CREATE OR REPLACE: de parameterlijst
-- verandert (p_identity_provider eruit, p_uitnodiging_hash erin) en dat is een
-- andere functiehandtekening. Zonder DROP zouden er twee versies naast elkaar
-- staan en bepaalt PostgreSQL op grond van de argumenttypen welke hij pakt —
-- allebei text, dus dat zou een gok worden.

DROP FUNCTION IF EXISTS clm.koppel_eerste_login(text, text, text);--> statement-breakpoint

CREATE FUNCTION clm.koppel_eerste_login(
    p_external_subject  text,
    p_email             text,
    p_uitnodiging_hash  text
)
RETURNS TABLE (user_id uuid, tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
DECLARE
    v_user_id   uuid;
    v_tenant_id uuid;
BEGIN
    IF p_uitnodiging_hash IS NULL OR trim(p_uitnodiging_hash) = '' THEN
        RETURN;
    END IF;

    IF p_email IS NULL OR trim(p_email) = '' THEN
        RETURN;
    END IF;

    IF p_external_subject IS NULL OR trim(p_external_subject) = '' THEN
        RETURN;
    END IF;

    -- Nooit koppelen aan een oid die al bestaat. Zonder deze controle kon een
    -- tweede login een bestaande gebruiker overschrijven — een account-overname
    -- in plaats van een eerste login.
    IF EXISTS (
        SELECT 1 FROM clm."user"
         WHERE external_subject = p_external_subject
    ) THEN
        RETURN;
    END IF;

    -- Alle voorwaarden in één query. Geen aparte telling meer zoals in 0023:
    -- de unieke index garandeert dat dit er hoogstens één is.
    --
    -- Het e-mailadres staat er als tweede controle bij, hoofdletterongevoelig.
    -- Een token dat bij de verkeerde persoon belandt werkt daardoor niet, ook
    -- niet als die persoon hem in handen krijgt vóór de geadresseerde.
    SELECT u.user_id, u.tenant_id
      INTO v_user_id, v_tenant_id
      FROM clm."user" u
     WHERE u.uitnodiging_hash = p_uitnodiging_hash
       AND lower(u.email)     = lower(p_email)
       AND u.external_subject IS NULL
       AND u.deleted_at       IS NULL
       AND u.koppelbaar_tot   IS NOT NULL
       AND u.koppelbaar_tot   > now();

    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    -- De tenantcontext moet gezet zijn vóór de UPDATE, en dat is het kip-ei van
    -- deze hele functie: clm."user" heeft een policy op clm.current_tenant_id(),
    -- maar bij een eerste login is die context er nog niet — de tenant vólgt uit
    -- de rij die we net gevonden hebben.
    --
    -- De SELECT hierboven kon nog zonder: die draait als eigenaar op een tabel
    -- zonder FORCE (migratie 0011). Schrijven kan dat niet.
    --
    -- `true` als derde argument: alleen binnen deze transactie, zodat de
    -- aanroeper zijn eigen context niet kwijtraakt.
    PERFORM set_config('app.current_tenant_id', v_tenant_id::text, true);

    -- Alle drie tegelijk: de oid erin, en beide sporen van de uitnodiging eruit.
    -- Daarmee werkt het token precies één keer, ook wanneer twee aanvragen
    -- elkaar overlappen — de tweede vindt niets meer.
    UPDATE clm."user"
       SET external_subject  = p_external_subject,
           uitnodiging_hash  = NULL,
           koppelbaar_tot    = NULL
     WHERE clm."user".user_id = v_user_id;

    -- De koppeling bepaalt wie voortaan als deze gebruiker binnenkomt, en is
    -- daarmee auditinformatie. Het token staat er niet in, ook niet gehasht:
    -- de audit trail is voor de tenant leesbaar en hoeft geen sleutelmateriaal
    -- te bevatten.
    INSERT INTO audit.audit_event
        (tenant_id, action_type, entity_type, entity_id, new_values)
    VALUES (
        v_tenant_id, 'eerste_login_gekoppeld', 'user', v_user_id,
        jsonb_build_object('via', 'uitnodigingstoken')
    );

    RETURN QUERY SELECT v_user_id, v_tenant_id;
END;
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.koppel_eerste_login(text, text, text) IS
    'Koppelt bij de eerste login een oid aan een uitgenodigde gebruikersrij, op vertoon van het uitnodigingstoken. Voorwaarden: de hash hoort bij precies een openstaande uitnodiging (afgedwongen door een unieke index), het e-mailadres komt overeen, external_subject is nog leeg, de oid is nog nergens in gebruik, en de uitnodiging is niet verstreken. Geeft niets terug wanneer een voorwaarde niet gehaald wordt — nooit een exception met details, want die zou verklappen welke uitnodiging bestaat.';--> statement-breakpoint

-- Zelfde rechten als de andere definer-functies (0009, 0010, 0023): PUBLIC
-- eraf, expliciet aan de applicatierollen. Na een DROP zijn de oude rechten
-- weg, dus dit is geen herhaling maar noodzaak.
REVOKE ALL ON FUNCTION clm.koppel_eerste_login(text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clm.koppel_eerste_login(text, text, text) TO clm_api, clm_admin;--> statement-breakpoint

-- ── 3. Bestaande uitnodigingen ───────────────────────────────────────────────
--
-- Een rij die nog wacht op zijn eerste login heeft geen uitnodiging_hash en is
-- daarmee niet meer koppelbaar. Dat is opzet: hij is uitgegeven onder de oude
-- voorwaarden, en die zijn zwakker dan de nieuwe.
--
-- koppelbaar_tot wordt hier op NULL gezet zodat de stand ook zichtbaar klopt:
-- een openstaande uitnodiging zonder token is geen openstaande uitnodiging.
-- Opnieuw uitnodigen levert een rij op die wél deugt.

UPDATE clm."user"
   SET koppelbaar_tot = NULL
 WHERE external_subject IS NULL
   AND koppelbaar_tot IS NOT NULL;
