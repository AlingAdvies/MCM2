-- =============================================================================
-- Baseline-convergentie — de productiedatabase krijgt wat de migratieketen al
-- heeft: vier tenant-indexen en zes UUID-defaults.
--
-- Aanleiding: Issue #25 (Drizzle-migratiestand initialiseren) en Issue #29
-- (ontbrekende gen_random_uuid()-defaults).
--
-- ── Waarom deze migratie er is ───────────────────────────────────────────────
--
-- Op 2026-08-04 is met scripts/baseline-vergelijken.js gemeten wat het verschil
-- is tussen `clm-enterprise` en een verse database uit migratie 0000 + 0001. De
-- opzet van die meting: een lege container met UITSLUITEND de baseline erop,
-- daarnaast de productiedatabase, en beide structureel uitgelezen — kolommen,
-- constraints, indexen, RLS, policies, functies en triggers.
--
-- Drie soorten verschillen kwamen daaruit. Twee ervan zijn cosmetisch en worden
-- hier bewust NIET aangeraakt:
--
--   1. DEFAULT now() versus DEFAULT CURRENT_TIMESTAMP — in PostgreSQL exact
--      hetzelfde. Prisma schreef de ene vorm, Drizzle de andere.
--   2. Constraint-namen (user_tenant_id_fkey versus
--      user_tenant_id_tenant_tenant_id_fk) plus ON UPDATE CASCADE op de
--      foreign keys, wat Prisma's standaard was. Hernoemen op een
--      productiedatabase is kosmetiek met risico en zonder opbrengst.
--
-- Wat hier WEL wordt rechtgezet, is het derde verschil: vier ontbrekende
-- indexen en zes ontbrekende defaults. Beide zijn echt, en beide zijn veilig
-- toe te voegen op een gevulde tabel.
--
-- ── Waarom de indexen ertoe doen ─────────────────────────────────────────────
--
-- Elke RLS-policy in dit project luidt `USING (tenant_id = clm.current_tenant_id())`.
-- Zonder index op tenant_id betekent dat een volledige tabelscan bij élke query
-- — niet alleen bij een filter die de gebruiker zelf kiest, maar bij alles wat
-- de policy raakt.
--
-- Vandaag is dat onzichtbaar: de tabellen zijn zo goed als leeg. Bij een pilot
-- met echte data wordt het een prestatieprobleem dat lastig te herleiden is,
-- juist omdat de trage query er in de applicatiecode onschuldig uitziet.
--
-- Gemeten op 2026-08-04: clm-enterprise heeft 11 indexen, allemaal primary keys
-- en unique-constraints. Geen enkele op tenant_id.
--
-- ── Waarom vijf defaults en niet twaalf ──────────────────────────────────────
--
-- Issue #29 noemt "alle 12 UUID-kolommen" en somt daarbij ook foreign keys op
-- (clm.user.tenant_id, clm.vendor.owner_user_id, en zo verder). Die horen
-- uitdrukkelijk GEEN default te krijgen: hun waarde komt uit de bovenliggende
-- rij, niet uit een generator. Een default daarop zou een rij met een
-- willekeurige, niet-bestaande verwijzing kunnen opleveren — precies het soort
-- stille datafout dat achteraf niet te herstellen is.
--
-- Van de 14 UUID-kolommen die op 2026-08-04 in clm-enterprise gemeten zijn, is
-- er in vijf tabellen een UUID-primary-key. Alleen die vijf krijgen hier een
-- default, gelijk aan wat migratie 0000 voor een verse database oplevert.
--
-- De zesde tabel, clm.vendor_tag, heeft een samengestelde primary key
-- (vendor_id, tag) en dus geen eigen UUID-kolom. Zie onderaan.
--
-- ── Waarom dit veilig is op een gevulde tabel ────────────────────────────────
--
-- CREATE INDEX IF NOT EXISTS en ALTER COLUMN SET DEFAULT raken geen bestaande
-- rijen: een default geldt alleen voor toekomstige INSERTs zonder die kolom, en
-- een index verandert geen data. Er wordt niets herschreven en niets verwijderd.
--
-- Alle statements zijn idempotent. Deze migratie draait daarom zonder gevolgen
-- op omgevingen waar de keten al compleet is (ontwikkelcontainers, CI) — daar
-- bestaan de indexen en defaults al en gebeurt er niets.
--
-- ── Wat dit oplost ───────────────────────────────────────────────────────────
--
-- Issue #29 volledig: een INSERT zonder expliciete UUID faalde op
-- clm-enterprise met "null value in column ... violates not-null constraint".
-- Dat is waarom 6 van de 19 e2e-tests faalden tegen een uit productie herstelde
-- database, terwijl dezelfde tests groen waren tegen een verse.
--
-- Voor Issue #25 is dit de voorwaarde, niet de oplossing: pas als het schema
-- overeenkomt met de baseline is het verantwoord om Drizzle's boekhouding te
-- initialiseren met 0000 en 0001 als "reeds toegepast".
--
-- ── Wat baseline-vergelijken.js hierna NOG meldt, en waarom dat klopt ────────
--
-- Dit is op 2026-08-04 doorgemeten op een replica: de echte productiedump in
-- een wegwerpcontainer, gebaselined, daarna de hele keten 0002 t/m 0014.
-- Resultaat: 9 tabellen werden er 18, alle defaults en indexen aanwezig,
-- schema-conformiteit GOEDGEKEURD (17 van 17 tests).
--
-- Het vergelijkingsscript meldt daarna nog vier groepen "ONTBREEKT". Die zijn
-- alle vier terecht en mogen NIET worden dichtgetimmerd:
--
--   * created_at DEFAULT now() vs CURRENT_TIMESTAMP en de constraint-namen —
--     de cosmetische verschillen, zie hierboven.
--   * rls=true force=false — migratie 0011 zet FORCE ROW LEVEL SECURITY aan.
--     Het script vergelijkt tegen de baseline, en daarin stond dat nog niet.
--   * policies met `deleted_at IS NULL` — migratie 0004 heeft die voorwaarde
--     er juist bewust uitgehaald.
--
-- Met andere woorden: het script vergelijkt met 0000 + 0001, niet met de
-- eindtoestand. Wat het na de volledige keten meldt, is het verschil dat de
-- migraties 0002 t/m 0014 opzettelijk hebben aangebracht. Voor de eindtoestand
-- is `npm run verify:schema` de juiste controle.
-- =============================================================================

-- ── Vier tenant-indexen ──────────────────────────────────────────────────────
--
-- Namen gelijk aan wat migratie 0000 op een verse database aanmaakt, zodat de
-- twee omgevingen daarna niet alsnog op naamgeving verschillen.

CREATE INDEX IF NOT EXISTS "audit_event_tenant_id_idx"
    ON "audit"."audit_event" USING btree ("tenant_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vendor_tenant_id_idx"
    ON "clm"."vendor" USING btree ("tenant_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vendor_contact_tenant_id_idx"
    ON "clm"."vendor_contact" USING btree ("tenant_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vendor_tag_tenant_id_idx"
    ON "clm"."vendor_tag" USING btree ("tenant_id");--> statement-breakpoint

-- ── Zes UUID-defaults op primary keys ────────────────────────────────────────
--
-- Uitsluitend primary keys. Foreign keys krijgen bewust geen default; zie de
-- toelichting hierboven.

ALTER TABLE "audit"."audit_event"
    ALTER COLUMN "audit_event_id" SET DEFAULT gen_random_uuid();--> statement-breakpoint

ALTER TABLE "clm"."tenant"
    ALTER COLUMN "tenant_id" SET DEFAULT gen_random_uuid();--> statement-breakpoint

ALTER TABLE "clm"."user"
    ALTER COLUMN "user_id" SET DEFAULT gen_random_uuid();--> statement-breakpoint

ALTER TABLE "clm"."vendor"
    ALTER COLUMN "vendor_id" SET DEFAULT gen_random_uuid();--> statement-breakpoint

ALTER TABLE "clm"."vendor_contact"
    ALTER COLUMN "contact_id" SET DEFAULT gen_random_uuid();

-- clm.vendor_tag krijgt bewust NIETS: die tabel heeft een samengestelde
-- primary key (vendor_id, tag) en dus geen eigen UUID-kolom. Beide delen zijn
-- betekenisdragend — de leverancier en het label — en een gegenereerde waarde
-- zou daar onzin zijn.
