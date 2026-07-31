-- =============================================================================
-- Identiteit en membership: de databasekant van Issue #7, spoor 1.
--
-- Vandaag leidt de backend de tenant af uit een ongeverifieerde client-header
-- (X-Tenant-Id). Dat is het openstaande P0-restpunt: MCM2-CLAUDE.md §6 eist dat
-- de tenant uitsluitend uit geverifieerde identiteit, membership en autorisatie
-- komt. Deze migratie levert de twee dingen die daarvoor in de database moeten
-- bestaan: een koppeling van een gebruiker aan een externe identiteit, en een
-- expliciete vastlegging van welke gebruiker bij welke tenant hoort.
--
-- De guard zelf is applicatiecode en staat in src/auth/. Deze migratie maakt
-- alleen mogelijk dat die guard iets heeft om tegen te controleren.
--
-- ── Waarom external_subject en niet email ────────────────────────────────────
--
-- Het ID-token van Entra External ID bevat `oid` (object id), `email` en `sub`.
-- De koppeling gaat op `oid`: dat is de stabiele identifier van de gebruiker
-- binnen de tenant. Een e-mailadres verandert (naamswijziging, andere afdeling,
-- van kees@ naar k.maling@) en is daarmee ongeschikt als sleutel — bij een
-- wijziging zou de gebruiker stilzwijgend een ander account worden, inclusief
-- verlies van zijn memberships.
--
-- `email` blijft wel bestaan op clm.user, maar als weergavegegeven, niet als
-- sleutel. Zo staat het ook in de PoC-bevindingen (stap 2): eerst de claims
-- inspecteren, dán bepalen waarop gekoppeld wordt.
--
-- De kolom heet `external_subject` en niet `entra_oid`, omdat ADR-006 een
-- generieke identity-/claimsinterface voorschrijft: Entra is de huidige
-- provider, niet per definitie de enige. Een latere tweede provider vult
-- dezelfde kolom met zijn eigen stabiele subject-identifier.
--
-- ── Waarom een aparte membershiptabel ────────────────────────────────────────
--
-- clm.user heeft al een tenant_id. Dat lijkt genoeg, maar maakt een gebruiker
-- permanent van één tenant. §6 staat een tenant-switch expliciet toe wanneer de
-- gebruiker server-side aantoonbaar lid is van beide tenants. Zonder aparte
-- tabel is die switch alleen te bouwen door de gebruiker te dupliceren — en dan
-- is "dezelfde persoon" een aanname op basis van een e-mailadres in plaats van
-- een vastgelegd feit.
--
-- clm.user.tenant_id blijft staan en behoudt zijn betekenis: de tenant waar de
-- gebruiker administratief thuishoort (en waar zijn rij door RLS zichtbaar is).
-- tenant_membership zegt iets anders: waar mag deze persoon werken. Voor de
-- huidige situatie — één interne beheerder bij één tenant — zijn die twee
-- gelijk, en dat is precies waarom dit nu goedkoop in te voeren is.
--
-- ── En toch: één actief membership per gebruiker ─────────────────────────────
--
-- De tabelvorm maakt meerdere memberships mogelijk, maar een unieke index
-- verbiedt het (zie §2b hieronder). Dat is geen tegenspraak maar een bewuste
-- volgorde: de structuur is klaar voor de dag dat het nodig is, de regel is
-- vandaag zo streng mogelijk.
--
-- Reden: alleen platformbeheer heeft meerdere tenants nodig — een klantgebruiker
-- werkt bij één klant. En platformbeheer is een wezenlijk ánder soort toegang:
-- support bij een klant hoort herkenbaar en auditbaar te zijn, niet
-- ononderscheidbaar van een medewerker van die klant. Een gewone
-- membership-rij zou dat verschil juist wegpoetsen.
--
-- Welk patroon daarvoor het juiste is (impersonation, break-glass, aparte
-- identiteitslaag) is uitgezocht werk, geen aanname: Issue #57. Tot dat besluit
-- komt de platformbeheerder via directe databasetoegang, buiten de applicatie
-- om — precies zoals nu.
--
-- Een constraint weghalen is één regel. Hem achteraf toevoegen op data die er
-- al niet aan voldoet is een opruimactie. Vandaar deze kant op.
-- =============================================================================

-- ── 1. external_subject op clm.user ──────────────────────────────────────────

-- NULLABLE, en dat blijft zo. Niet elke gebruiker logt in: clm.user bevat ook
-- respondenten van interne beoordelingen (survey_response.respondent_user_id)
-- en straks seed-gebruikers van de demo-tenant. Verplicht stellen zou die
-- rijen onmogelijk maken.
ALTER TABLE clm."user" ADD COLUMN external_subject text;--> statement-breakpoint

-- Uniek waar gevuld: één externe identiteit is precies één gebruiker.
-- Een partiële index, want NULL mag vaak voorkomen — zonder WHERE-clausule
-- zou een gewone UNIQUE dat overigens ook toestaan, maar de partiële vorm
-- maakt de bedoeling expliciet en houdt de index klein.
--
-- LET OP: dit is bewust een globale unieke index, niet per tenant. Eén
-- Entra-identiteit hoort bij één persoon; diezelfde persoon bij twee tenants
-- laten werken is precies waar tenant_membership voor is, niet een tweede
-- user-rij met hetzelfde subject.
CREATE UNIQUE INDEX user_external_subject_key
    ON clm."user" (external_subject)
    WHERE external_subject IS NOT NULL;--> statement-breakpoint

COMMENT ON COLUMN clm."user".external_subject IS
    'Stabiele identifier uit de identity provider (Entra: de oid-claim). Nooit het e-mailadres: dat verandert. NULL voor gebruikers die niet inloggen, zoals respondenten van interne beoordelingen.';--> statement-breakpoint

-- ── 2. clm.tenant_membership ─────────────────────────────────────────────────

CREATE TABLE clm.tenant_membership (
    user_id    uuid        NOT NULL REFERENCES clm."user" (user_id)   ON DELETE CASCADE,
    tenant_id  uuid        NOT NULL REFERENCES clm.tenant (tenant_id) ON DELETE RESTRICT,
    role       text        NOT NULL DEFAULT 'reviewer',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,

    CONSTRAINT tenant_membership_pkey PRIMARY KEY (user_id, tenant_id),

    -- Twee rollen, geen rollentabel. Een aparte tabel met twee rijen is
    -- overhead zonder opbrengst; groeit de set, dan is dat een eigen migratie.
    --   admin    — beheert leveranciers, vragenlijsten en rondes
    --   reviewer — vult interne beoordelingen in, leest resultaten
    CONSTRAINT tenant_membership_role_check
        CHECK (role IN ('admin', 'reviewer'))
);--> statement-breakpoint

-- ON DELETE CASCADE op user_id, ON DELETE RESTRICT op tenant_id — bewust
-- asymmetrisch. Een verwijderde gebruiker moet zijn memberships meenemen (ze
-- betekenen niets meer). Een tenant verwijderen terwijl er nog leden zijn hoort
-- juist te stuiten: dat is de vorm die overal in dit schema gebruikt wordt voor
-- tenantgebonden data.

CREATE INDEX tenant_membership_tenant_id_idx
    ON clm.tenant_membership (tenant_id);--> statement-breakpoint

-- ── 2b. Eén actief membership per gebruiker ──────────────────────────────────
--
-- Zie de toelichting bovenaan. Partieel op deleted_at IS NULL: een ingetrokken
-- membership blijft staan als historie (wie mocht wanneer waar werken is
-- auditinformatie), maar telt niet mee voor deze regel. Een gebruiker die van
-- tenant wisselt krijgt dus een zacht verwijderde oude rij plus een nieuwe.
--
-- Deze index is de enige plek waar "één tenant per gebruiker" wordt afgedwongen.
-- Wordt hij weggehaald bij het besluit uit Issue #57, dan is dat een migratie
-- met precies één DROP INDEX — en niets anders hoeft mee te veranderen.
CREATE UNIQUE INDEX tenant_membership_een_actief_per_gebruiker
    ON clm.tenant_membership (user_id)
    WHERE deleted_at IS NULL;--> statement-breakpoint

COMMENT ON INDEX clm.tenant_membership_een_actief_per_gebruiker IS
    'Eén actieve tenant per gebruiker. Bewust de strengste stand: alleen platformbeheer heeft meerdere tenants nodig, en dat vraagt een eigen, auditbaar mechanisme (Issue #57). Weghalen is één DROP INDEX zodra dat besluit valt.';--> statement-breakpoint

-- De guard doet exact één vraag per verzoek: "is deze gebruiker lid van deze
-- tenant, en met welke rol?" De primaire sleutel (user_id, tenant_id) bedient
-- die lookup al. Deze extra index bedient de andere kant: "wie zijn de leden
-- van tenant X" — het ledenoverzicht in de beheerkant.

ALTER TABLE clm.tenant_membership ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Zelfde vorm als elke andere tenantgebonden tabel: USING én WITH CHECK, beide
-- op clm.current_tenant_id() (§7.4). Zonder WITH CHECK zou een tenant een
-- membership voor een ándere tenant kunnen aanmaken — daarmee zou de tabel die
-- de tenantgrens moet bewaken zelf een manier zijn om eroverheen te stappen.
--
-- Bewust géén `deleted_at IS NULL` in USING: dat maakte zacht verwijderen
-- onmogelijk (Issue #31, migratie 0004). Filteren op soft delete hoort in de
-- query, niet in de policy.
CREATE POLICY tenant_membership_isolation ON clm.tenant_membership
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

CREATE TRIGGER trg_tenant_membership_updated_at
    BEFORE UPDATE ON clm.tenant_membership
    FOR EACH ROW EXECUTE FUNCTION clm.set_updated_at();--> statement-breakpoint

COMMENT ON TABLE clm.tenant_membership IS
    'Welke gebruiker mag in welke tenant werken, en met welke rol. De guard leidt de tenantcontext hieruit af (Issue #7). Los van clm.user.tenant_id: dat is waar de gebruiker administratief thuishoort, dit is waar hij mag werken.';--> statement-breakpoint

-- ── 3. clm.gebruiker_bij_subject() ───────────────────────────────────────────
--
-- Het kip-ei-probleem, en waarom deze functie moet bestaan.
--
-- De guard moet de gebruiker opzoeken op external_subject vóórdat de tenant
-- bekend is — de tenant volgt immers uit het membership van die gebruiker. Maar
-- clm.user staat onder RLS: zonder tenantcontext levert een SELECT nul rijen.
-- En de tenantcontext is precies wat we proberen vast te stellen.
--
-- Zonder oplossing zijn er twee slechte uitwegen: de runtime-rol BYPASSRLS
-- geven (verboden, §6, en de reden dat P0 bestaat), of de client laten vertellen
-- welke tenant hij wil (dat is de header die we juist afschaffen).
--
-- SECURITY DEFINER is de derde weg: deze functie draait met de rechten van zijn
-- eigenaar (clm_migrator) en ziet daarmee langs RLS heen — maar uitsluitend
-- binnen wat deze functie zelf doet, en dat is scherp begrensd:
--
--   1. Zoekt op external_subject, niet op tenant. De aanroeper kan geen tenant
--      opgeven en dus ook niet naar een tenant "vissen".
--   2. Geeft alleen (user_id, tenant_id, role) terug van rijen waar de
--      gebruiker daadwerkelijk lid is. Geen namen, geen e-mailadressen, geen
--      andere gebruikers.
--   3. Wie geen geldig ID-token heeft, heeft geen external_subject en krijgt
--      dus niets. De sleutel komt uit een geverifieerd token, niet uit invoer.
--
-- Het is dezelfde vorm als clm.resolve_survey_token() uit migratie 0003: ook
-- die moet een tenant vaststellen vóórdat er tenantcontext is. Dat patroon is
-- hier bewust herhaald in plaats van een tweede oplossing te verzinnen.
--
-- RETURNS TABLE en niet één rij, terwijl de unieke index uit §2b er hoogstens
-- één toestaat. Dat is opzet: valt het besluit uit Issue #57 de andere kant op,
-- dan verandert hier niets. De aanroeper hoort nu al te behandelen dat er nul
-- of één rij terugkomt, en straks eventueel meer.
CREATE OR REPLACE FUNCTION clm.gebruiker_bij_subject(p_external_subject text)
RETURNS TABLE (user_id uuid, tenant_id uuid, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = clm, pg_temp
AS $$
    SELECT m.user_id, m.tenant_id, m.role
    FROM clm.tenant_membership m
    JOIN clm."user" u ON u.user_id = m.user_id
    WHERE u.external_subject = p_external_subject
      AND p_external_subject IS NOT NULL
      AND u.deleted_at IS NULL
      AND m.deleted_at IS NULL
    ORDER BY m.created_at;
$$;--> statement-breakpoint

-- `SET search_path` is niet optioneel bij SECURITY DEFINER: zonder die regel
-- kan een aanroeper met een eigen search_path een functie of tabel voorschuiven
-- die de definer-rechten misbruikt. Standaardadvies uit de PostgreSQL-
-- documentatie, en hier verplicht omdat deze functie langs RLS kijkt.

-- Uitvoerrecht expliciet: PUBLIC eraf, alleen de runtime-rollen erop. Een
-- SECURITY DEFINER-functie die iedereen mag aanroepen is een openstaande deur.
REVOKE ALL ON FUNCTION clm.gebruiker_bij_subject(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION clm.gebruiker_bij_subject(text) TO clm_api, clm_admin;--> statement-breakpoint

COMMENT ON FUNCTION clm.gebruiker_bij_subject(text) IS
    'Zoekt gebruiker + memberships op de external_subject uit een geverifieerd ID-token. SECURITY DEFINER omdat de tenantcontext hier nog niet bestaat — dat is precies wat de aanroeper wil vaststellen. Geeft nooit meer terug dan user_id, tenant_id en role.';
