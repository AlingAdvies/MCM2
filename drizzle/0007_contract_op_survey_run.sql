-- =============================================================================
-- survey_run krijgt contract_id: op welk contract een ronde betrekking heeft.
--
-- De survey is onderdeel van een contractmanagement-applicatie. Een
-- leveranciersbeoordeling zonder de vraag "op welke overeenkomst?" is een half
-- oordeel — dat is de reden dat deze kolom er hoort te komen.
--
-- BEWUST NOG ZONDER FOREIGN KEY. Er bestaat nog geen clm.contract-tabel: MCM2
-- heeft vendor en vendor_contact wel, contracten niet. Dat is een eigen
-- bouwspoor met een eigen datamodel (MVM_V2's Contract heeft 24 velden,
-- inclusief CATS CM v4-levenscyclus). Zodra die tabel er is, is dit één
-- ALTER TABLE ... ADD CONSTRAINT erbij.
--
-- WAAROM NU EN NIET STRAKS. Als lege kolom is dit een ALTER die niets hoeft te
-- backfillen. Straks bevat survey_run gevulde rondes, en de bevriezingstrigger
-- uit migratie 0005 maakt wijzigen rond lopende rondes bewust lastig. Eén regel
-- nu bespaart dan een migratie met een backfillstap.
--
-- NULLABLE, EN DAT BLIJFT ZO. Een ronde hoeft niet aan een contract te hangen:
-- een leverancier kan beoordeeld worden voordat er een overeenkomst is, en de
-- acht Transdev-vragen gaan over de organisatie als geheel, niet over een
-- specifiek contract. Verplicht stellen zou UC1 breken.
--
-- Geen RLS-wijziging nodig: survey_run heeft al een policy op tenant_id, en
-- een kolom erbij valt daar automatisch onder. Zodra clm.contract bestaat,
-- moet díé tabel een eigen policy krijgen — een FK naar een tabel zonder RLS
-- zou een lek zijn.
-- =============================================================================

ALTER TABLE "clm"."survey_run" ADD COLUMN "contract_id" uuid;--> statement-breakpoint

-- Rapportage vraagt straks "alle rondes over contract X". Zonder index is dat
-- een volledige scan over een tabel die per tenant per jaar aangroeit.
CREATE INDEX "survey_run_contract_id_idx" ON "clm"."survey_run" USING btree ("contract_id");--> statement-breakpoint

COMMENT ON COLUMN "clm"."survey_run"."contract_id" IS
    'Op welk contract deze ronde betrekking heeft. Nog zonder foreign key: clm.contract bestaat nog niet. Blijft nullable, ook na invoering van die tabel.';
