-- clm.tenant_membership krijgt een vierde toegestane rolwaarde: 'user'.
--
-- 'user' (contractbeheerder) krijgt dezelfde schrijfrechten als 'admin' op
-- alles behalve tenant-gebruikersbeheer zelf (Taak 3/4 in dit plan) en de
-- twee routes die zelf bevoegdheden toekennen (koppelReviewer/
-- ontkoppelReviewer, maakRonde — zie
-- docs/superpowers/specs/2026-08-27-tenant-gebruikersbeheer-design.md §3).
--
-- 'support' bestond al sinds migratie 0020 (ADR-015) en blijft ongewijzigd.
-- Geen wijziging aan de primary key of de unieke index
-- tenant_membership_een_actief_per_gebruiker: die blijven zoals migratie 0020
-- ze zette. Zie de spec §7 voor waarom een surrogaatsleutel hier bewust niet
-- gekozen is (botst met PlatformService.supportToegangGeven()).

ALTER TABLE clm.tenant_membership
    DROP CONSTRAINT tenant_membership_role_check;--> statement-breakpoint

ALTER TABLE clm.tenant_membership
    ADD CONSTRAINT tenant_membership_role_check
    CHECK (role IN ('admin', 'user', 'reviewer', 'support'));--> statement-breakpoint

COMMENT ON CONSTRAINT tenant_membership_role_check ON clm.tenant_membership IS
    'Vier rollen. admin, user en reviewer horen bij de klant: user heeft dezelfde schrijfrechten als admin behalve op tenant-gebruikersbeheer zelf (issue #75). support hoort bij het platform — meekijken zonder wijzigen, tijdelijk (ADR-015).';--> statement-breakpoint

-- ── Bijvangst: clm.sessie had een eigen, aparte CHECK-constraint ────────────
--
-- Migratie 0010 zette op clm.sessie een eigen `sessie_role_check CHECK (role
-- IN ('admin', 'reviewer'))`, los van tenant_membership_role_check. Migratie
-- 0020 voegde 'support' toe aan tenant_membership maar vergat deze tweede
-- constraint — met als gevolg dat clm.sessie_aanmaken() sindsdien nooit een
-- sessie kon aanmaken voor een gebruiker met rol 'support': de INSERT in
-- clm.sessie klapt op deze constraint, vóórdat er ooit een 403 op een route
-- aan te pas komt. Ontdekt tijdens het testen van issue #75 (27-08), bij het
-- schrijven van een e2e-test voor de rol 'user' — dezelfde fout zou daar
-- opnieuw zijn opgetreden.
--
-- Deze migratie repareert beide in één keer: 'user' erbij (waar dit issue om
-- gaat) én 'support' alsnog toegevoegd (het gat van 0020, nu pas gevonden).

ALTER TABLE clm.sessie
    DROP CONSTRAINT sessie_role_check;--> statement-breakpoint

ALTER TABLE clm.sessie
    ADD CONSTRAINT sessie_role_check
    CHECK (role IN ('admin', 'user', 'reviewer', 'support'));--> statement-breakpoint

COMMENT ON CONSTRAINT sessie_role_check ON clm.sessie IS
    'Moet gelijk blijven aan tenant_membership_role_check — dit is de rol zoals gekopieerd bij het inloggen (migratie 0010). Sinds 27-08 (issue #75) weer synchroon: 0020 voegde support toe aan tenant_membership maar niet hier, waardoor een support-sessie nooit kon worden aangemaakt.';
