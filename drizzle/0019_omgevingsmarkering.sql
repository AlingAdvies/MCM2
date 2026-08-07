-- =============================================================================
-- clm.omgeving — wat is dit voor database?
--
-- Aanleiding: op 2026-08-07 draaiden de e2e-tests tegen de demo-database. Ze
-- maakten hun testtenants aan en ruimden op; de demo-tenant verdween, 400
-- testleveranciers bleven achter. Geen enkele bescherming sloeg aan.
--
-- ── Waarom de bestaande bescherming dit niet ving ────────────────────────────
--
-- scripts/db-doelwit.js kent één criterium: is de host lokaal, ja of nee. Dat
-- werkt voor productie (Supabase staat op aws-1-eu-west-1.pooler.supabase.com)
-- maar binnen 'localhost' wordt niets onderscheiden. De demo op poort 55450 en
-- een wegwerpcontainer op 55440 zijn daar identiek.
--
-- En die bescherming zit alleen in vier scripts. De e2e-tests hebben hem niet:
-- test/jest-e2e.setup.ts bestond uit één regel, `import 'dotenv/config'`. Elke
-- suite pakt DATABASE_URL en begint met DELETE FROM.
--
-- ── Waarom in de database en niet in een script ──────────────────────────────
--
-- Een poortnummer, een containernaam of een omgevingsvariabele zit náást de
-- database: verhuist hij, dan klopt de markering niet meer. Een label op een
-- Docker-container werkt bovendien niet voor Supabase, want daar is geen
-- container.
--
-- Deze tabel reist mee met de database zelf. Een dump-en-restore neemt hem
-- over, een verhuizing naar een andere poort verandert niets, en een kopie van
-- productie draagt zichtbaar 'beschermd' met zich mee.
--
-- ── Waarom 'wegwerp' NIET de standaard is ────────────────────────────────────
--
-- De rij wordt bij deze migratie gezet op 'beschermd'. Dat is de veilige kant:
-- een database die vergeet zich te benoemen, wordt behandeld als productie.
-- Zou de standaard 'wegwerp' zijn, dan is precies de database die niemand heeft
-- ingericht — de nieuwe, de vergeten, de per ongeluk aangemaakte — vogelvrij.
--
-- Een wegwerpdatabase moet zich dus expliciet als zodanig aanmelden. Dat doen
-- scripts/verify-volledig.js en scripts/demo-omgeving.js na het opzetten.
-- =============================================================================

CREATE TABLE "clm"."omgeving" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"soort" text NOT NULL,
	"toelichting" text NOT NULL DEFAULT '',
	"gemarkeerd_op" timestamp with time zone DEFAULT now() NOT NULL,
	-- Eén rij, altijd. `id` is een boolean met DEFAULT true als primaire
	-- sleutel: een tweede INSERT loopt op de sleutel stuk. Zonder deze truc kan
	-- er een tweede rij ontstaan en is niet meer te zeggen welke geldt.
	CONSTRAINT "omgeving_precies_een_rij_check" CHECK (id = true)
);
--> statement-breakpoint

ALTER TABLE "clm"."omgeving"
    ADD CONSTRAINT "omgeving_soort_check"
    CHECK (soort IN ('wegwerp', 'beschermd'));--> statement-breakpoint

-- Bewust 'beschermd': zie de kop. Een bestaande database — productie, demo,
-- of die van een collega — komt hier als beschermd uit, en dat is de bedoeling.
INSERT INTO "clm"."omgeving" (soort, toelichting)
VALUES ('beschermd', 'Standaard bij migratie 0019. Een wegwerpdatabase meldt zich expliciet aan via scripts/markeer-wegwerp.js.');--> statement-breakpoint

-- ── Row Level Security ──────────────────────────────────────────────────────
--
-- Geen tenant_id: dit gaat over de database als geheel, niet over een klant.
-- Daarmee valt deze tabel buiten het patroon van alle andere tabellen, en dat
-- is de reden dat hij hier expliciet wordt toegelicht in plaats van stil
-- afwijkt.
--
-- Wel leesbaar voor de runtime-rol: de guard in de tests moet hem kunnen lezen
-- zonder migratierechten. Niet schrijfbaar — een database omkatten van
-- beschermd naar wegwerp hoort een bewuste beheerhandeling te zijn, via
-- clm_migrator.

ALTER TABLE clm.omgeving ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.omgeving FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Iedereen binnen de database mag lezen. Dat moet, want de guard in de tests
-- draait als clm_api_runtime en heeft geen migratierechten.
CREATE POLICY omgeving_leesbaar ON clm.omgeving
    FOR SELECT
    USING (true);--> statement-breakpoint

-- Alleen clm_migrator mag de markering wijzigen.
--
-- Twee lagen, en allebei nodig: het GRANT hieronder bepaalt wie het commando
-- mag uitvoeren, deze policy welke rijen hij ziet. Met FORCE RLS geldt de
-- policy óók voor de tabeleigenaar — zonder deze regel raakt een UPDATE als
-- clm_migrator nul rijen en meldt het script "geen rij gevonden", een melding
-- die naar de verkeerde oorzaak wijst. (Gemeten op 2026-08-07.)
--
-- De runtime-rol krijgt geen UPDATE-recht: een database omkatten van beschermd
-- naar wegwerp hoort een bewuste beheerhandeling te zijn, niet iets wat de
-- applicatie kan.
CREATE POLICY omgeving_beheer ON clm.omgeving
    FOR UPDATE
    TO clm_migrator
    USING (true)
    WITH CHECK (true);--> statement-breakpoint

COMMENT ON TABLE clm.omgeving IS
    'Wat voor database is dit: wegwerp of beschermd. Eén rij. Gelezen door test/jest-e2e.setup.ts, die weigert te draaien tegen een beschermde database. Standaard beschermd — een database die zich niet meldt, wordt als productie behandeld.';--> statement-breakpoint

GRANT SELECT ON clm.omgeving TO clm_api_runtime;--> statement-breakpoint

-- clm_migrator is eigenaar en heeft daarmee al rechten; dit maakt expliciet
-- wat de bedoeling is en overleeft een toekomstige eigenaarswissel.
GRANT SELECT, UPDATE ON clm.omgeving TO clm_migrator;
