-- ── 0033 — Tenant wijzigen/deactiveren, sessiewissel voor platformbeheer ────
--
-- Drie hoofdtoevoegingen voor de platformbeheer-uitbreiding (spec
-- 2026-08-27-platformbeheer-uitbreiding-design.md):
--
--   1. clm.tenant krijgt deleted_at (soft-delete, ontbrak nog).
--   2. De registertrigger (0026) reageert nu ook op deleted_at, anders
--      blijft een gedeactiveerde tenant zichtbaar in het RLS-vrije
--      register terwijl hij via clm.tenant zelf onbereikbaar is.
--   3. clm.sessie_wisselen(): een tweede sessie aanmaken vanuit een
--      bestaande geldige sessie, voor een tenant waar een geldig
--      (support-)membership op staat. Geen Entra-login nodig.
--   4. clm.eigen_tenant_vinden(): de blijvende tenant van een gebruiker
--      opzoeken, voor de terugkeer-route (SECURITY DEFINER nodig — zie
--      hieronder).
--   5. clm.sessie_aanmaken() opnieuw gedefinieerd met een check op
--      tenant.deleted_at — die kolom bestond nog niet toen 0010 geschreven
--      werd, dus een lid van een gedeactiveerde tenant kon zonder deze
--      aanpassing gewoon blijven inloggen.

-- ── 1. deleted_at op clm.tenant ──────────────────────────────────────────────

ALTER TABLE clm.tenant ADD COLUMN deleted_at timestamptz;--> statement-breakpoint

COMMENT ON COLUMN clm.tenant.deleted_at IS
    'Soft-delete: NULL = actief. Een gedeactiveerde tenant kan niet meer inloggen (sessie_aanmaken, sessie_wisselen) en verdwijnt uit clm.tenant_register. Geen reactiveren-pad — zie de spec sectie 6.';--> statement-breakpoint

-- ── 2. Registertrigger uitgebreid: name EN deleted_at ────────────────────────
--
-- CREATE OR REPLACE vervangt de functie uit 0026 volledig; de trigger zelf
-- moet opnieuw aangemaakt worden omdat de kolomlijst van "UPDATE OF" niet
-- met CREATE OR REPLACE valt aan te passen.

CREATE OR REPLACE FUNCTION clm.tenant_register_bijhouden()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL THEN
        DELETE FROM clm.tenant_register WHERE register_id = NEW.tenant_id;
    ELSE
        INSERT INTO clm.tenant_register (register_id, name, aangemaakt_op)
        VALUES (NEW.tenant_id, NEW.name, COALESCE(NEW.created_at, now()))
        ON CONFLICT (register_id) DO UPDATE SET name = EXCLUDED.name;
    END IF;

    RETURN NEW;
END;
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.tenant_register_bijhouden() IS
    'Houdt clm.tenant_register gelijk aan clm.tenant: naam bijwerken bij UPDATE OF name, verwijderen uit het register bij een deactivering (UPDATE OF deleted_at, migratie 0033). SECURITY DEFINER omdat de aanroepende rol geen schrijfrecht op het register heeft.';--> statement-breakpoint

DROP TRIGGER tenant_register_bijhouden ON clm.tenant;--> statement-breakpoint

CREATE TRIGGER tenant_register_bijhouden
    AFTER INSERT OR UPDATE OF name, deleted_at ON clm.tenant
    FOR EACH ROW
    EXECUTE FUNCTION clm.tenant_register_bijhouden();--> statement-breakpoint

-- ── 3. clm.sessie_wisselen() ─────────────────────────────────────────────────
--
-- Bewijs van identiteit: een geldige, niet-verlopen sessie (p_huidige_token_
-- hash). Autorisatie: een geldig, niet-verlopen membership op de doeltenant,
-- en de doeltenant zelf niet gedeactiveerd. Geeft niets terug als een van
-- beide ontbreekt — zelfde stijl als sessie_aanmaken() (0010).

-- ⚠ v_role wordt in twee stappen bepaald, niet met één JOIN naar clm.tenant.
-- clm.tenant heeft FORCE ROW LEVEL SECURITY (migratie 0011) — die geldt óók
-- voor de eigenaar van een SECURITY DEFINER-functie. Een gewone JOIN naar
-- clm.tenant levert daarom altijd nul rijen op zolang er nog geen
-- app.current_tenant_id gezet is (gemeten: sessie_aanmaken() faalde hierop
-- stil tijdens het testen van deze migratie). clm.tenant_membership heeft
-- geen FORCE, dus die query mag wél zonder context. Zodra de doeltenant
-- bekend is, zet set_config() de context binnen deze transactie, en pas dán
-- is clm.tenant leesbaar.
-- external_subject is NOT NULL op clm.sessie (migratie 0010) — de nieuwe
-- sessierij neemt daarom het subject van de bestaande sessie over. Er komt
-- geen nieuwe Entra-login aan te pas, dus er is geen ander subject om te
-- gebruiken; het blijft hetzelfde geverifieerde ID als de oorspronkelijke
-- login.
CREATE FUNCTION clm.sessie_wisselen(
    p_huidige_token_hash text,
    p_doel_tenant_id uuid,
    p_nieuwe_token_hash text,
    p_geldigheid interval
)
RETURNS TABLE (sessie_id uuid, user_id uuid, tenant_id uuid, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
DECLARE
    v_user_id           uuid;
    v_external_subject  text;
    v_role              text;
    v_tenant_actief     boolean;
BEGIN
    SELECT s.user_id, s.external_subject INTO v_user_id, v_external_subject
      FROM clm.sessie s
     WHERE s.token_hash = p_huidige_token_hash
       AND s.verloopt_op > now();

    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    SELECT m.role INTO v_role
      FROM clm.tenant_membership m
     WHERE m.user_id = v_user_id
       AND m.tenant_id = p_doel_tenant_id
       AND m.deleted_at IS NULL
       AND (m.verloopt_op IS NULL OR m.verloopt_op > now());

    IF v_role IS NULL THEN
        RETURN;
    END IF;

    PERFORM set_config('app.current_tenant_id', p_doel_tenant_id::text, true);

    SELECT t.deleted_at IS NULL INTO v_tenant_actief
      FROM clm.tenant t WHERE t.tenant_id = p_doel_tenant_id;

    IF v_tenant_actief IS NOT TRUE THEN
        RETURN;
    END IF;

    RETURN QUERY
    INSERT INTO clm.sessie (
        token_hash, user_id, tenant_id, role, external_subject, verloopt_op
    )
    VALUES (p_nieuwe_token_hash, v_user_id, p_doel_tenant_id, v_role,
            v_external_subject,
            now() + p_geldigheid)
    RETURNING clm.sessie.sessie_id, clm.sessie.user_id,
              clm.sessie.tenant_id, clm.sessie.role;
END;
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.sessie_wisselen(text, uuid, text, interval) IS
    'Maakt, vanuit een bestaande geldige sessie, een tweede sessie aan voor een tenant waar de gebruiker een geldig membership op heeft — geen Entra-login nodig. Gebruikt door platformbeheer om na support-toegang direct te wisselen (spec 2026-08-27-platformbeheer-uitbreiding-design.md, sectie 5a). De oorspronkelijke sessie blijft bestaan. Zet zelf app.current_tenant_id vóór het lezen van clm.tenant (FORCE RLS) — zie de code-commentaar erboven.';--> statement-breakpoint

REVOKE ALL ON FUNCTION clm.sessie_wisselen(text, uuid, text, interval) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clm.sessie_wisselen(text, uuid, text, interval) TO clm_migrator, clm_api, clm_admin;--> statement-breakpoint

-- ── 4. clm.eigen_tenant_vinden() ─────────────────────────────────────────────
--
-- Voor de terugkeer-route (spec §5c): de blijvende (niet-support) tenant
-- van een gebruiker opzoeken. clm.tenant_membership heeft RLS met de policy
-- `tenant_id = clm.current_tenant_id()` (migratie 0009) — een gewone query
-- binnen withTenant(sessieTenantId, ...) ziet daardoor UITSLUITEND rijen
-- van de sessie-tenant (de support-tenant op dit moment), nooit de eigen
-- tenant die we juist zoeken. SECURITY DEFINER is hier nodig en
-- verdedigbaar om dezelfde reden als sessie_wisselen(): de functie neemt
-- zelf een user_id als parameter (geen tenant uit de invoer) en geeft alleen
-- een tenant_id terug, geen andere kolom.

CREATE FUNCTION clm.eigen_tenant_vinden(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
    SELECT tenant_id FROM clm.tenant_membership
     WHERE user_id = p_user_id
       AND role != 'support'
       AND deleted_at IS NULL
     ORDER BY created_at
     LIMIT 1;
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.eigen_tenant_vinden(uuid) IS
    'Zoekt de blijvende (niet-support) tenant van een gebruiker, voor de terugkeer-route na support-toegang (spec 2026-08-27-platformbeheer-uitbreiding-design.md, sectie 5c). SECURITY DEFINER omdat clm.tenant_membership RLS heeft op de sessie-tenant — vanuit een support-sessie zou een gewone query de eigen tenant nooit vinden.';--> statement-breakpoint

REVOKE ALL ON FUNCTION clm.eigen_tenant_vinden(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clm.eigen_tenant_vinden(uuid) TO clm_migrator, clm_api, clm_admin;--> statement-breakpoint

-- ── 5. clm.gebruikersnaam() — een gat blootgelegd door de eerste échte
--    end-to-end support-sessietest ─────────────────────────────────────────
--
-- clm."user" is gebonden aan precies één tenant (tenant_id NOT NULL,
-- RLS-policy user_isolation: tenant_id = current_tenant_id()). Een
-- platformbeheerder die via support-toegang naar een andere tenant wisselt
-- heeft daar GEEN clm.user-rij — alleen een clm.tenant_membership-rij met
-- role = 'support'. SessieService.profiel() deed tot nu toe een gewone
-- JOIN clm.tenant op clm."user", en die vindt binnen de support-tenant
-- niets: de gebruiker "bestaat" daar simpelweg niet als rij.
--
-- Dit gat bestond al vóór deze migratie (het bestaande support-toegang-
-- mechanisme via ADR-015 heeft hetzelfde probleem), maar werd nooit
-- blootgelegd omdat er nooit een echte GET /auth/sessie-aanroep vanuit een
-- support-sessie werd getest — zie de toelichting bovenaan
-- platform-uitbreiding.e2e-spec.ts en platformbeheer.spec.ts.
--
-- Oplossing: de naam ophalen los van de tenantcontext, via user_id — geen
-- tenant in de invoer of uitvoer, dus geen cross-tenant-lek.

CREATE FUNCTION clm.gebruikersnaam(p_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
    SELECT full_name FROM clm."user"
     WHERE user_id = p_user_id
       AND deleted_at IS NULL;
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.gebruikersnaam(uuid) IS
    'Naam van een gebruiker, los van tenantcontext — nodig voor SessieService.profiel() bij een support-sessie: clm."user" is aan één tenant gebonden en de gebruiker heeft in de doeltenant geen eigen rij. Migratie 0033.';--> statement-breakpoint

REVOKE ALL ON FUNCTION clm.gebruikersnaam(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clm.gebruikersnaam(uuid) TO clm_migrator, clm_api, clm_admin;--> statement-breakpoint

-- ── 5. sessie_aanmaken(): ook een gedeactiveerde tenant blokkeert login ──────
--
-- De membership-lookup in 0010 checkt user.deleted_at en membership.
-- deleted_at, maar niet tenant.deleted_at — die kolom bestond toen nog
-- niet. Zonder deze aanpassing kan een lid van een gedeactiveerde tenant
-- alsnog inloggen.
--
-- ⚠ Zelfde valkuil als sessie_wisselen() hierboven: clm.tenant heeft FORCE
-- ROW LEVEL SECURITY, dus een JOIN clm.tenant in dezelfde SELECT als
-- clm.tenant_membership/clm."user" (die geen FORCE hebben) levert altijd nul
-- rijen op — óók binnen deze SECURITY DEFINER-functie, óók als eigenaar.
-- Gemeten tijdens het testen van deze migratie: sessie_aanmaken() faalde
-- stil (geen sessie, geen fout) zodra de tenant-JOIN erbij kwam. Membership
-- eerst vinden, dán pas context zetten en clm.tenant apart controleren.

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
    v_user_id       uuid;
    v_tenant_id     uuid;
    v_role          text;
    v_tenant_actief boolean;
BEGIN
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
        RETURN;
    END IF;

    PERFORM set_config('app.current_tenant_id', v_tenant_id::text, true);

    SELECT t.deleted_at IS NULL INTO v_tenant_actief
      FROM clm.tenant t WHERE t.tenant_id = v_tenant_id;

    IF v_tenant_actief IS NOT TRUE THEN
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

COMMENT ON FUNCTION clm.sessie_aanmaken(text, text, interval) IS
    'Maakt een sessie voor de eerste (oudste) membership van een geverifieerd subject. Sluit sinds migratie 0033 ook een gedeactiveerde tenant uit (t.deleted_at, via set_config i.p.v. een JOIN — clm.tenant heeft FORCE RLS), naast een gedeactiveerd lid of membership.';--> statement-breakpoint
