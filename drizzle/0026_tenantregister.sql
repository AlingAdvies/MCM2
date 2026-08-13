-- ── 0026 — Een tenantregister voor platformbeheer (ADR-017) ─────────────────
--
-- WAAROM DEZE MIGRATIE BESTAAT
--
-- Op 2026-08-13 bleek dat platformbeheer niet kan zien wélke tenants er zijn.
-- `POST /platform/tenants` gaf 409 "bestaat al", terwijl een telling op
-- clm.tenant nul rijen opleverde. Beide waar: clm.tenant heeft RLS met FORCE
-- (migratie 0011) en geen enkele applicatierol heeft BYPASSRLS. Zonder
-- tenantcontext levert elke SELECT nul rijen.
--
-- Nul rijen betekende dus "je mag niets zien", niet "er staat niets" — exact
-- de meetfout die op 2026-08-10 tot dataverlies leidde.
--
-- Gevolg is een kip-eiprobleem: `GET /platform/tenants/:id` en
-- `POST /platform/tenants/:id/toegang` vragen allebei een tenant-id, en er is
-- geen weg om die id te achterhalen.
--
-- ── Wat dit NIET is ─────────────────────────────────────────────────────────
--
-- Geen leesrecht over tenants heen. ADR-015 blijft onverkort gelden: wie in de
-- gegevens van een tenant wil, wordt tijdelijk lid van díé tenant, in de rol
-- `support`, met een reden en een vervaldatum.
--
-- Dit register bevat uitsluitend id, naam en aanmaakdatum — de telefoonlijst
-- die dat mechanisme bruikbaar maakt. Komt er ooit een kolom bij die iets over
-- de klant zégt (aantal gebruikers, laatste activiteit, abonnement), dan is dat
-- een nieuw besluit en niet een uitbreiding van deze migratie.
--
-- ── Waarom een aparte tabel en niet de RLS van clm.tenant afhalen ───────────
--
-- Onderzocht op 2026-08-13 (vijftien bronnen; PostgreSQL-documentatie,
-- Supabase, pgDash, Cybertec). Beide patronen zijn gangbaar; de tenantlijst
-- buiten RLS houden wordt zelfs "bijzonder aantrekkelijk voor dit probleem"
-- genoemd.
--
-- De keuze viel op een aparte tabel omdat die niets bestaands aanraakt.
-- clm.tenant is een kerntabel; RLS eraf halen betekent een policy wijzigen en
-- daarna via GRANT/REVOKE opnieuw dichtzetten wat die policy deed. Een fout
-- daarin is een cross-tenant lek.
--
-- Afgevallen: een BYPASSRLS-rol (een loper voor een telefoonlijst, en er is
-- geen apart beheerkanaal), een SECURITY DEFINER-functie (search_path-valkuil,
-- lastig te controleren) en een admin-conditie in de policy (één SQL-injectie
-- die `SET app.is_platform_admin` uitvoert heft de tenantgrens overal op —
-- door het onderzoek onomwonden afgeraden).

-- ── 1. De tabel ─────────────────────────────────────────────────────────────
--
-- Bewust GEEN row level security, om dezelfde reden als clm.platform_admin
-- (migratie 0020): deze tabel hoort bij geen enkele tenant. Een policy op
-- clm.current_tenant_id() zou nul rijen opleveren en de tabel onbruikbaar
-- maken. De afscherming loopt via GRANT — zie stap 4.
--
-- Geen foreign key naar clm.tenant. Een FK zou een lookup op die tabel doen en
-- die staat achter RLS met FORCE — precies het probleem dat deze migratie
-- oplost. Bovendien is dit een register en geen afgeleide view: raakt een rij
-- in clm.tenant ooit weg, dan hoort het spoor dat de tenant bestaan heeft te
-- blijven. De trigger houdt beide gelijk zolang ze beide bestaan.

-- ⚠ De sleutelkolom heet `register_id`, NIET `tenant_id`. Dat is geen
-- smaakkwestie maar een eis van de bewaking.
--
-- MCM2-CLAUDE.md §7: iedere tabel met een `tenant_id`-kolom heeft RLS nodig,
-- met policies op zowel USING als WITH CHECK. `schema-inventory.ts` leidt
-- "tenantgebonden" letterlijk af uit de aanwezigheid van die kolomnaam, en
-- `schema-conformiteit.e2e-spec.ts` maakt de run rood als de RLS ontbreekt.
--
-- Die regel is juist, en deze tabel is de uitzondering die hem niet mag
-- verzwakken: hier is de uuid de SLEUTEL van de registerrij, niet de tenant
-- waartoe de rij behoort. De tabel hoort bij geen enkele tenant — precies zoals
-- clm.platform_admin, die om dezelfde reden geen tenant_id heeft (0020).
--
-- Gemeten, niet aangenomen: de eerste versie noemde de kolom `tenant_id` en
-- drie bewakingstests sloegen terecht aan.

CREATE TABLE clm.tenant_register (
    register_id    uuid        NOT NULL,
    name           text        NOT NULL,
    aangemaakt_op  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT tenant_register_pkey PRIMARY KEY (register_id)
);--> statement-breakpoint

COMMENT ON COLUMN clm.tenant_register.register_id IS
    'Het tenant-id waar deze registerrij over gaat. Heet bewust niet tenant_id: die naam betekent in dit schema "deze rij hoort bij die tenant" en verplicht tot RLS (MCM2-CLAUDE.md §7). Hier is het de sleutel van het register zelf.';--> statement-breakpoint

COMMENT ON TABLE clm.tenant_register IS
    'Welke tenants er bestaan: id, naam, aanmaakdatum. Meer niet. Zonder RLS, want dit hoort bij geen enkele tenant — de afscherming loopt via GRANT. Bestaat omdat clm.tenant achter RLS met FORCE staat en platformbeheer daardoor geen tenant-id kon achterhalen (ADR-017). NOOIT uitbreiden met klantgegevens: toegang tot de gegevens van een tenant loopt via support-toegang, ADR-015.';--> statement-breakpoint

COMMENT ON COLUMN clm.tenant_register.name IS
    'Kopie van clm.tenant.name, bijgehouden door een trigger. Geen foreign key: het register mag een zacht verwijderde tenant houden.';--> statement-breakpoint

-- ── 2. De trigger die het register bijhoudt ─────────────────────────────────
--
-- Bewust een trigger en geen applicatiecode. `platform.service.ts` is vandaag
-- de enige schrijfweg naar clm.tenant, maar een seed, een migratie of een
-- herstelactie is dat morgen ook. Een trigger kan niet vergeten worden.
--
-- SECURITY DEFINER is hier nodig én verdedigbaar: de trigger schrijft naar een
-- tabel waar de aanroepende rol geen rechten op heeft. De functie is drie
-- regels lang, raakt uitsluitend het register, gebruikt geen dynamische SQL en
-- leest geen invoer buiten NEW. `SET search_path` staat er verplicht bij — een
-- SECURITY DEFINER-functie zonder is kwetsbaar voor search-path-manipulatie
-- (Cybertec, en dezelfde reden als bij clm.resolve_survey_token in 0003).

CREATE FUNCTION clm.tenant_register_bijhouden()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
BEGIN
    INSERT INTO clm.tenant_register (register_id, name, aangemaakt_op)
    VALUES (NEW.tenant_id, NEW.name, COALESCE(NEW.created_at, now()))
    ON CONFLICT (register_id) DO UPDATE SET name = EXCLUDED.name;

    RETURN NEW;
END;
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.tenant_register_bijhouden() IS
    'Houdt clm.tenant_register gelijk aan clm.tenant. SECURITY DEFINER omdat de aanroepende rol geen schrijfrecht op het register heeft; search_path expliciet gezet omdat een SECURITY DEFINER-functie zonder dat kwetsbaar is voor search-path-manipulatie.';--> statement-breakpoint

-- EXECUTE weghalen bij PUBLIC. Postgres geeft dat standaard weg, en bij een
-- SECURITY DEFINER-functie is dat precies wat je niet wilt: iedereen zou hem
-- los kunnen aanroepen en zo een rij in het register kunnen schrijven.
--
-- Er komt géén GRANT voor terug. Een trigger wordt door de database zelf
-- aangeroepen, niet door een rol — de functie hoeft voor niemand uitvoerbaar te
-- zijn. Bewaakt door test/rechten-contract.e2e-spec.ts.
REVOKE ALL ON FUNCTION clm.tenant_register_bijhouden() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER tenant_register_bijhouden
    AFTER INSERT OR UPDATE OF name ON clm.tenant
    FOR EACH ROW
    EXECUTE FUNCTION clm.tenant_register_bijhouden();--> statement-breakpoint

-- ── 3. Bestaande tenants inhalen ────────────────────────────────────────────
--
-- De trigger vangt alleen wat er ná deze migratie gebeurt. Wat er al staat moet
-- er één keer in.
--
-- ⚠ Dit is het lastigste stuk van deze migratie, en de eerste versie was FOUT.
--
-- Deze migratie draait als clm_migrator, en die heeft geen BYPASSRLS. Een kale
-- `INSERT INTO … SELECT FROM clm.tenant` levert daardoor nul rijen op — precies
-- het probleem dat deze migratie oplost.
--
-- De eerste poging gebruikte een SECURITY DEFINER-functie. Die werkte niet, en
-- de reden is leerzaam: SECURITY DEFINER draait als de EIGENAAR van de functie,
-- en dat is hier óók clm_migrator. Geen BYPASSRLS, dus geen ontsnapping. De
-- migratie meldde desondanks "Migraties voltooid" en het register bleef leeg —
-- gemeten op een wegwerpcontainer met twee bestaande tenants erin, want vanaf
-- nul valt dit niet op (er is dan niets in te halen).
--
-- Wat wél werkt en niets verzwakt: clm_migrator is de eigenaar van clm.tenant,
-- en een eigenaar mag FORCE ROW LEVEL SECURITY tijdelijk opheffen. Zonder FORCE
-- valt de eigenaar buiten RLS — dat is standaardgedrag van PostgreSQL en
-- precies waarvoor FORCE in 0011 is aangezet.
--
-- Drie waarborgen maken dit verdedigbaar:
--
--   1. Het gebeurt binnen één migratie, die in één transactie draait. Er is
--      geen moment waarop een andere sessie er langs kan.
--   2. RLS zelf blijft aan staan; alleen de eigenaar-uitzondering keert even
--      terug. Voor clm_api_runtime verandert er niets.
--   3. FORCE gaat er in hetzelfde blok weer op, en tegenproef 5 leest terug dat
--      het gelukt is.

ALTER TABLE clm.tenant NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

INSERT INTO clm.tenant_register (register_id, name, aangemaakt_op)
SELECT t.tenant_id, t.name, t.created_at FROM clm.tenant t
ON CONFLICT (register_id) DO UPDATE SET name = EXCLUDED.name;--> statement-breakpoint

ALTER TABLE clm.tenant FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ── 4. Rechten ──────────────────────────────────────────────────────────────
--
-- ⚠ De REVOKE is hier het belangrijkste statement van de hele migratie.
--
-- Migratie 0001 zet `ALTER DEFAULT PRIVILEGES IN SCHEMA clm GRANT SELECT,
-- INSERT, UPDATE, DELETE ... TO clm_api`. Elke nieuwe tabel in clm krijgt die
-- rechten dus automatisch, vóórdat deze migratie er iets over zegt. Zonder de
-- REVOKE zou clm_api_runtime het register gewoon kunnen lezen én schrijven —
-- en dan lekt de lijst van alle tenantnamen naar elke ingelogde klant.
--
-- Dezelfde val als bij clm.platform_admin in 0020, met hetzelfde antwoord.
-- Tegenproef 2 van ADR-017 toetst precies dit.

REVOKE ALL ON clm.tenant_register FROM clm_api;--> statement-breakpoint
REVOKE ALL ON clm.tenant_register FROM clm_admin;--> statement-breakpoint
REVOKE ALL ON clm.tenant_register FROM clm_api_runtime;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON clm.tenant_register TO clm_migrator;--> statement-breakpoint

-- ── Leesrecht voor de applicatie, en alleen lezen ───────────────────────────
--
-- `GET /platform/tenants` draait onder clm_api_runtime en heeft dit nodig.
--
-- SELECT en niets meer. Het register wordt door een trigger bijgehouden, niet
-- door de applicatie; INSERT of UPDATE zou een tweede schrijfweg openen die
-- uiteen kan lopen met clm.tenant. De REVOKE hierboven haalde de automatische
-- rechten uit 0001 weg — dit zet er precies één voor terug.
--
-- Waarom dit veilig is ondanks dat élke ingelogde gebruiker onder deze rol
-- draait: de route zit achter PlatformAdminGuard, die per verzoek in
-- clm.platform_admin kijkt. De databaserol is de onderste laag, de guard de
-- bovenste. Zonder de guard zou dit GRANT de tenantnamen aan iedere klant
-- tonen — dat is de reden dat het GRANT en de route in dezelfde wijziging
-- horen, en niet los van elkaar worden uitgerold.
GRANT SELECT ON clm.tenant_register TO clm_api;--> statement-breakpoint
