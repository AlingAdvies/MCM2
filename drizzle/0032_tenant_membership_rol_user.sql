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
    'Vier rollen. admin, user en reviewer horen bij de klant: user heeft dezelfde schrijfrechten als admin behalve op tenant-gebruikersbeheer zelf (issue #75). support hoort bij het platform — meekijken zonder wijzigen, tijdelijk (ADR-015).';
