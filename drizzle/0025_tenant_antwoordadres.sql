-- Waar een leverancier zijn antwoord naartoe stuurt.
--
-- ── Het gat ──────────────────────────────────────────────────────────────────
--
-- `antwoordAan` bestaat door de hele mailketen — in `UitnodigingGegevens`, in
-- `MailBericht`, en in `resend-mail-kanaal.ts` als `replyTo`. Alleen: het wordt
-- nergens gevuld. `UitnodigingContext` kent enkel `tenantNaam` en
-- `vragenlijstNaam`.
--
-- Gevolg: een leverancier die op "Beantwoorden" drukt, stuurt zijn vraag naar
-- het platformadres. Naar Bizaline dus, niet naar de klant. En de mailtekst
-- zegt dan letterlijk "Neem contact op met uw contactpersoon bij <klant>" —
-- zonder te zeggen wie dat is.
--
-- De code voorzag dit. In `uitnodiging-bericht.ts` staat bij die regel:
--
--     Deze regel voorkomt de mail die anders bij ons terechtkomt en die wij
--     niet kunnen beantwoorden: alleen de opdrachtgever weet of een leverancier
--     nog een contract heeft.
--
-- De helft was gebouwd, de vulling ontbrak.
--
-- ── Waarom een kolom en geen SMTP-instellingen ───────────────────────────────
--
-- Issue #76 beschrijft SMTP per tenant: host, poort, gebruikersnaam, een
-- versleuteld wachtwoord, een testknop. Dat lost hetzelfde probleem op en veel
-- meer, maar het vraagt een eigen ADR over sleutelbeheer en een write-only
-- veld dat niemand kan uitlezen.
--
-- Besluit van de eigenaar op 2026-08-09: dat is niet nodig zolang de mail
-- herkenbaar van de klant komt en een antwoord bij de klant belandt. De
-- weergavenaam doet het eerste al ("<Tenant> via MCM2"); deze kolom doet het
-- tweede.
--
-- Het envelopadres blijft van het platform, en dat is geen tussenoplossing:
-- versturen vanaf het domein van de klant vraagt SPF- en DKIM-records in hún
-- DNS. Zonder die records belandt alles in spam. Vandaar dat vrijwel elke SaaS
-- verstuurt vanaf een eigen geverifieerd domein en de klant in de weergavenaam
-- en het antwoordadres zet.
--
-- ── NULL is een geldige stand ────────────────────────────────────────────────
--
-- Niet elke tenant heeft een gedeeld postvak. De berichttekst vangt dat al af
-- met een alternatieve zin, dus een lege waarde levert geen halve mail op maar
-- een andere — en dat was er al vóór deze migratie.

ALTER TABLE clm.tenant
    ADD COLUMN antwoord_email text;--> statement-breakpoint

COMMENT ON COLUMN clm.tenant.antwoord_email IS
    'Waar een antwoord van een leverancier heen gaat (Reply-To). Van de tenant, niet van het platform: alleen de opdrachtgever kan een vraag over zijn eigen uitvraag beantwoorden. NULL betekent geen antwoordadres; de berichttekst verwijst dan naar de contactpersoon bij de tenant.';--> statement-breakpoint

-- Dezelfde vorm als `isGeldigMailadres()` in src/mail/mail-adres.ts: iets vóór
-- de @, iets erna, een punt in het domein, geen witruimte.
--
-- Bewust ruim en niet RFC 5322-volledig. Een afgewezen geldig adres is erger
-- dan een doorgelaten ongeldig adres: het eerste betekent dat een beheerder
-- zijn eigen postvak niet kan invullen, het tweede levert een bounce op. Die
-- afweging staat uitgeschreven in mail-adres.ts en wordt hier herhaald zodat
-- database en applicatie hetzelfde toestaan.
--
-- Plusadressering (contractmanagement+mcm2@klant.nl) moet werken: daar leunt de
-- hele testopzet van het mailkanaal op.
ALTER TABLE clm.tenant
    ADD CONSTRAINT tenant_antwoord_email_format_check
    CHECK (
        antwoord_email IS NULL
        OR (antwoord_email ~ '^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$'
            AND length(antwoord_email) <= 254)
    );
