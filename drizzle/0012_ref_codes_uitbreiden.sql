-- =============================================================================
-- REF-CODES UITBREIDEN: de lookup-lijsten dekken nu de praktijk van Transdev.
--
-- Aanleiding: fase 3 van het plan (demo-tenant met mock data). De
-- leveranciersgegevens van MVM_V2 gebruiken negen code-waarden die hier nog
-- niet bestonden. Zonder deze migratie faalt elke INSERT daarop op een foreign
-- key, of — erger — wordt de data vervlakt naar 'other'/'high' en toont de
-- demo iets anders dan de werkelijkheid.
--
-- ── Waarom uitbreiden en niet mappen ─────────────────────────────────────────
--
-- Deze drie tabellen zijn bedoeld om te groeien; dat is het hele punt van een
-- lookup-tabel in plaats van een enum. Vervlakken zou betekenen dat de helft
-- van de leveranciers in de demo 'Overig' heet, en dat Transdev bij de eerste
-- echte vulling alsnog deze migratie nodig heeft — dan met gevulde rijen die
-- omgezet moeten worden.
--
-- De codes komen uit MVM_V2 (src/data/vendors.mock.ts), dat functioneel
-- leidend is (STATUS.md). Labels zijn Nederlands, conform de bestaande rijen.
--
-- ── Twee waarden die meer zijn dan een categorie ─────────────────────────────
--
-- 'critical' als business_criticality staat bewust bóven 'high': MVM_V2
-- gebruikt beide naast elkaar en het verschil is betekenisvol — 'high' is een
-- leverancier die je niet kwijt wilt, 'critical' een leverancier zonder wie de
-- dienstverlening stilstaat. Die twee samenvouwen zou de kritiekste
-- leveranciers onzichtbaar maken in precies de lijst die ze moet tonen.
--
-- 'at_risk' als compliance_status is de tussentoestand tussen 'compliant' en
-- 'non_compliant': wél een oordeel geveld, nog geen overtreding. Zonder die
-- waarde is er geen manier om "let hierop" vast te leggen zonder meteen
-- "voldoet niet" te zeggen, en dat is een zwaarder oordeel dan bedoeld.
--
-- ON CONFLICT DO NOTHING, net als de baseline: deze migratie is idempotent en
-- draait ongewijzigd tegen een database waar iemand de codes al handmatig
-- heeft toegevoegd.
-- =============================================================================

INSERT INTO ref.vendor_category (code, label) VALUES
    ('maintenance', 'Onderhoud'),
    ('consulting', 'Advies'),
    ('energy', 'Energie'),
    ('facilities', 'Facilitair'),
    ('insurance', 'Verzekeringen'),
    ('security', 'Beveiliging'),
    ('telecom', 'Telecom')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

INSERT INTO ref.business_criticality (code, label) VALUES
    ('critical', 'Kritiek')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint

INSERT INTO ref.compliance_status (code, label) VALUES
    ('at_risk', 'Aandacht vereist')
ON CONFLICT (code) DO NOTHING;
