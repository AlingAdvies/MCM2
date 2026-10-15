-- Migratie 0047: contractmodule alsnog aan voor de bestaande tenants
-- (correctie op 0038).
--
-- ── Wat er misging ──────────────────────────────────────────────────────────
--
-- Migratie 0038 wilde elke bestaande tenant de contractmodule geven:
--
--   INSERT INTO clm.tenant_feature (tenant_id, feature_key, enabled)
--   SELECT tenant_id, 'contractmodule', true FROM clm.tenant
--    WHERE deleted_at IS NULL;
--
-- Migraties draaien als clm_migrator (ADR-009), en clm.tenant staat achter
-- RLS met FORCE. Zonder tenantcontext ziet die SELECT nul tenants, en voegt de
-- INSERT stilzwijgend niets toe. Geen fout, geen melding.
--
-- ── Het gemeten bewijs (2026-10-15) ─────────────────────────────────────────
--
-- Read-only tegen productie, per tenant uit clm.tenant_register met de
-- tenantcontext gezet (controle: clm.tenant gaf per tenant precies 1 rij):
-- clm.tenant_feature heeft voor alle zes tenants nul rijen — ook Transdev
-- Nederland. Niemand merkte het, omdat de frontend-afscherming op 04-09 is
-- teruggedraaid en de backend features nergens afdwingt. Het kwam boven
-- vlak vóór die afscherming opnieuw zou worden ingevoerd: dan was het
-- Contracten-menu bij iedere tenant verdwenen.
--
-- ── Waarom dit lokaal en in CI nooit opviel ─────────────────────────────────
--
-- Op een verse wegwerpdatabase bestaan er bij het migreren nog geen tenants:
-- de INSERT van 0038 voegt daar óók niets toe, en dat is daar juist correct.
-- De fout is alleen zichtbaar op een database die al tenants had — productie
-- en staging. Zie test/contractmodule-herstel.e2e-spec.ts, die eerst tenants
-- aanmaakt en dán deze migratie draait.
--
-- ── Hoe het nu wel werkt ────────────────────────────────────────────────────
--
-- De tenantlijst komt uit clm.tenant_register (bewust zonder RLS, ADR-017).
-- Per tenant wordt de context gezet, zodat zowel de controle op clm.tenant als
-- de INSERT (WITH CHECK op tenant_feature) door RLS heen mogen. Alleen voor
-- actieve tenants. ON CONFLICT DO NOTHING: een tenant waarvoor de
-- platformbeheerder de module al bewust aan of uit zette, blijft ongemoeid.
-- Daarna de context weer leeg, zodat een volgende migratie in dezelfde
-- transactie er niet op leunt.

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT register_id FROM clm.tenant_register LOOP
        PERFORM set_config('app.current_tenant_id', r.register_id::text, true);

        INSERT INTO clm.tenant_feature (tenant_id, feature_key, enabled)
        SELECT t.tenant_id, 'contractmodule', true
          FROM clm.tenant t
         WHERE t.tenant_id = r.register_id
           AND t.deleted_at IS NULL
        ON CONFLICT (tenant_id, feature_key) DO NOTHING;
    END LOOP;

    PERFORM set_config('app.current_tenant_id', '', true);
END
$$;
