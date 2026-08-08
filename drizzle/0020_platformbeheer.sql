-- Platformbeheer: wie mag een tenant aanmaken, en wie mag er tijdelijk meekijken.
--
-- Sluit Issue #57 en implementeert ADR-015.
--
-- ── Wat hier gebeurt, en waarom in deze vorm ─────────────────────────────────
--
-- Migratie 0009 zette de strengste stand: één actief membership per gebruiker,
-- met in het commentaar al de uitweg benoemd — "alleen platformbeheer heeft
-- meerdere tenants nodig, en dat vraagt een eigen, auditbaar mechanisme
-- (Issue #57). Weghalen is één DROP INDEX zodra dat besluit valt."
--
-- Dat besluit is gevallen, maar de uitvoering is nauwer dan één DROP INDEX.
-- Een gewone gebruiker houdt exact de bescherming van 0009; alleen de nieuwe
-- rol 'support' mag naast een bestaand membership staan. Zie stap 4.
--
-- ── Waarom platformbeheer geen leesrecht over tenants heen krijgt ────────────
--
-- Onderzocht op 2026-08-08 (ISO 27001 A.8.15/16, SOC 2 CC6.2/6.3/7.2, en de
-- praktijk bij Okta, Atlassian, Microsoft, Google, AWS, Broadcom): een alziende
-- platformrol geldt nog slechts als break-glass. De aanbevolen vorm is
-- just-in-time, tenant-scoped toegang.
--
-- De winst is technisch en niet alleen procedureel: bij een tenant-scoped rol
-- beschermt RLS ook tegen een verkeerd geschreven supportquery. Bij een
-- superuser doet het dat niet.

-- ── 1. clm.platform_admin ────────────────────────────────────────────────────
--
-- Een aparte tabel en geen kolom op clm."user", omdat het iets anders zegt:
-- platformbeheerder-zijn geldt tegenover het plátform, niet tegenover de tenant
-- waar iemand administratief thuishoort.
--
-- Bewust GEEN row level security. Elke andere tabel in clm hangt aan een tenant
-- en wordt door RLS daarop afgegrensd; deze hangt aan geen enkele tenant. Een
-- policy op clm.current_tenant_id() zou hier nul rijen opleveren en daarmee de
-- tabel onbruikbaar maken. De afscherming loopt via GRANT (stap 5): de
-- runtime-rol mag lezen, niet schrijven.

CREATE TABLE clm.platform_admin (
    user_id      uuid        NOT NULL REFERENCES clm."user" (user_id) ON DELETE CASCADE,
    toegekend_op timestamptz NOT NULL DEFAULT now(),
    toelichting  text,
    deleted_at   timestamptz,

    CONSTRAINT platform_admin_pkey PRIMARY KEY (user_id)
);--> statement-breakpoint

COMMENT ON TABLE clm.platform_admin IS
    'Wie het platform beheert: tenants aanmaken en zichzelf tijdelijk support-toegang geven. Staat los van tenant_membership — dat zegt waar iemand mag werken, dit zegt iets over het platform zelf. Zonder RLS, want deze tabel hoort bij geen enkele tenant; de afscherming loopt via GRANT.';--> statement-breakpoint

COMMENT ON COLUMN clm.platform_admin.deleted_at IS
    'Zacht verwijderen, zoals overal in dit schema. Wie ooit platformbeheerder was is auditinformatie en verdwijnt niet.';--> statement-breakpoint

-- ── 2. De rol 'support' ──────────────────────────────────────────────────────
--
-- Dezelfde manoeuvre als 0017 met survey_review_verdict_check: de constraint
-- vervangen, niet de kolom aanpassen.
--
-- Waarom een derde rol en niet gewoon 'admin' voor de platformbeheerder: de
-- kern van Issue #57. Een platformbeheerder met een gewone membership-rij is in
-- de audit trail niet te onderscheiden van een medewerker van de klant, en dat
-- is precies verkeerd om. 'support' maakt het verschil zichtbaar in elke rij
-- die hij achterlaat.
--
-- Het is een leesrol. Dat 'support' niet mag schrijven wordt afgedwongen in de
-- applicatielaag (RolGuard), niet hier: RLS kent de rol van de sessie niet, en
-- een policy die dat wél zou doen zou de tenantcontext moeten verlaten.

ALTER TABLE clm.tenant_membership
    DROP CONSTRAINT tenant_membership_role_check;--> statement-breakpoint

ALTER TABLE clm.tenant_membership
    ADD CONSTRAINT tenant_membership_role_check
    CHECK (role IN ('admin', 'reviewer', 'support'));--> statement-breakpoint

COMMENT ON CONSTRAINT tenant_membership_role_check ON clm.tenant_membership IS
    'Drie rollen. admin en reviewer horen bij de klant: beheren en beoordelen. support hoort bij het platform — meekijken zonder wijzigen, tijdelijk, en herkenbaar als zodanig in de audit trail (ADR-015).';--> statement-breakpoint

-- ── 3. Toegang die verloopt ──────────────────────────────────────────────────
--
-- NULL in verloopt_op is een gewoon, blijvend membership — de bestaande rijen
-- veranderen dus niet van betekenis. Een waarde maakt het tijdelijk.
--
-- Toegang is een gebeurtenis, geen toestand. Okta hanteert 24 uur voor
-- support-toegang, Microsoft trekt in bij het sluiten van de case; de
-- literatuur adviseert uren tot één werkdag. Wij nemen acht uur als standaard,
-- en die staat in de applicatielaag: een DEFAULT hier zou ook gewone
-- memberships laten verlopen.

ALTER TABLE clm.tenant_membership
    ADD COLUMN verloopt_op    timestamptz,
    ADD COLUMN reden          text,
    ADD COLUMN toegekend_door uuid REFERENCES clm."user" (user_id);--> statement-breakpoint

COMMENT ON COLUMN clm.tenant_membership.verloopt_op IS
    'Wanneer dit membership vervalt. NULL is blijvend — de gewone situatie voor admin en reviewer. Een waarde hoort bij support-toegang. Het filteren gebeurt bij het lezen: een verlopen rij blijft staan als auditinformatie.';--> statement-breakpoint

COMMENT ON COLUMN clm.tenant_membership.reden IS
    'Waarom deze toegang is gegeven. Verplicht bij support (afgedwongen in de applicatielaag): SOC 2 CC6.3 vraagt een justification bij elke elevation.';--> statement-breakpoint

COMMENT ON COLUMN clm.tenant_membership.toegekend_door IS
    'Wie de toegang gaf. Bij support-toegang is dat de platformbeheerder zelf; zodra er een goedkeuringsstroom komt is dit de goedkeurder.';--> statement-breakpoint

-- ── 4. De unieke index wordt nauwer, niet weggehaald ─────────────────────────
--
-- 0009 voorzag hier één DROP INDEX. Dat zou de bescherming voor álle gebruikers
-- opheffen, terwijl alleen support-toegang de versoepeling nodig heeft.
--
-- Dus: dezelfde index, met role <> 'support' erbij. Een gewone gebruiker kan nog
-- steeds geen tweede actief membership krijgen, ook niet door een bug in de
-- applicatielaag — dat was de hele reden dat 0009 hem zo streng zette. Een
-- platformbeheerder kan er wel een support-rij naast hebben, in een andere
-- tenant, tijdelijk.

DROP INDEX clm.tenant_membership_een_actief_per_gebruiker;--> statement-breakpoint

CREATE UNIQUE INDEX tenant_membership_een_actief_per_gebruiker
    ON clm.tenant_membership (user_id)
    WHERE deleted_at IS NULL AND role <> 'support';--> statement-breakpoint

COMMENT ON INDEX clm.tenant_membership_een_actief_per_gebruiker IS
    'Eén actieve tenant per gebruiker, nu met uitzondering voor support. De bescherming uit 0009 blijft voor admin en reviewer volledig gelden; alleen platformbeheer mag een tijdelijke support-rij ernaast hebben (ADR-015, Issue #57).';--> statement-breakpoint

-- Waar staat support-toegang, en welke is nog geldig. Bedient de vraag "wie kan
-- er nu bij deze tenant" — het ledenoverzicht en de latere access review.
CREATE INDEX tenant_membership_support_idx
    ON clm.tenant_membership (tenant_id, verloopt_op)
    WHERE role = 'support' AND deleted_at IS NULL;--> statement-breakpoint

-- ── 5. Rechten ───────────────────────────────────────────────────────────────
--
-- De runtime-rol mag lezen wie platformbeheerder is — de guard moet die vraag
-- per verzoek kunnen stellen. Schrijven niet: een platformbeheerder erbij zetten
-- is een handeling van de migratierol, bewust buiten de applicatie om. Zolang er
-- geen scherm voor is, is dat de veiligste stand.
--
-- ── Waarom hier een REVOKE staat, en waarom die niet gemist mag worden ───────
--
-- Migratie 0001 zet `ALTER DEFAULT PRIVILEGES IN SCHEMA clm GRANT SELECT,
-- INSERT, UPDATE, DELETE ON TABLES TO clm_api, clm_admin`. Elke nieuwe tabel in
-- clm krijgt die rechten dus vanzelf, en clm_api_runtime is lid van clm_api.
--
-- Een `GRANT SELECT` hieronder voegt daar niets aan toe: de schrijfrechten zijn
-- er al vóórdat deze migratie iets zegt. Zonder de REVOKE kan de runtime-rol
-- zichzelf platformbeheerder maken — de ene rij in dit schema waarmee je alle
-- andere beperkingen omzeilt.
--
-- Gevonden door de tegenproef in test/platformbeheer.e2e-spec.ts, niet door
-- deze migratie te lezen. Dat is precies waar die test voor is.

REVOKE INSERT, UPDATE, DELETE ON clm.platform_admin FROM clm_api;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON clm.platform_admin FROM clm_admin;--> statement-breakpoint

GRANT SELECT ON clm.platform_admin TO clm_api_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON clm.platform_admin TO clm_migrator;
