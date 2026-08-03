-- =============================================================================
-- app.current_actor — de database leert het verschil tussen een medewerker
-- en een leverancier.
--
-- Aanleiding: het plan docs/superpowers/plans/2026-08-03-surveybeheer.md, §2a.
-- De eigenaar heeft vastgesteld dat een leverancier nooit bij een beoordeling
-- mag komen. Dat bleek met wat er is niet af te dwingen.
--
-- ── Wat er ontbrak ───────────────────────────────────────────────────────────
--
-- withTenant() zet precies één sessievariabele: app.current_tenant_id. Zowel
-- het leverancierspad (vragenlijst-lezen, antwoord-indienen, bijlage) als het
-- medewerkerspad (vendor, sessie) roept die functie identiek aan, met dezelfde
-- tenantId. Elke bestaande policy luidt:
--
--     USING (tenant_id = clm.current_tenant_id())
--
-- Gemeten op 2026-08-03: de database kan op dit moment geen onderscheid maken
-- tussen een medewerker en een leverancier van dezelfde tenant. Beide zien
-- exact dezelfde rijen.
--
-- Voor elke bestaande tabel is dat juist. Overal in MCM2 geldt "zelfde tenant
-- = mag het zien" — de leverancier hoort zijn eigen respons te kunnen lezen,
-- en die staat in zijn tenant.
--
-- clm.survey_review (migratie 0014) is de eerste tabel waar dat NIET waar is.
--
-- ── Waarom een policy en niet alleen een guard ───────────────────────────────
--
-- Zonder deze variabele zou de bescherming van een beoordeling volledig
-- bestaan uit de afwezigheid van een route die haar teruggeeft. Dat houdt
-- stand tot iemand een route bouwt die "de respons met alles eromheen"
-- ophaalt — en die persoon hoeft deze regel niet te kennen.
--
-- Dat is exact het faalpatroon van tegenproef 6 (MCM2-CLAUDE.md §15b):
-- tenantId lekte via /auth/sessie terwijl alle acht browsertests groen bleven,
-- omdat geen enkel scherm dat veld toonde. De afwezigheid van een lek is niet
-- de aanwezigheid van een grens.
--
-- Vergelijk vragenlijst-lezen.service.ts r. 148: "De query filtert daarom op
-- response_id en niet op subject_vendor_id. Zodra iemand dat omdraait, ontstaat
-- het lek dat er nu niet is." Die opmerking beschrijft een discipline. Deze
-- migratie maakt er een grendel van.
--
-- Dit vervangt de guards niet. Een leverancier hoort al bij de route te
-- stranden; dit is de tweede grendel voor het geval de eerste ooit ontbreekt.
-- Dezelfde gedachte als de WITH CHECK-clausules in migratie 0005, die schrijven
-- op een ingediende respons tegenhouden terwijl de applicatie dat óók al doet.
--
-- ── Deze migratie verandert geen gedrag ──────────────────────────────────────
--
-- Er wordt niets aan bestaande policies gewijzigd. Na deze migratie ziet
-- iedereen exact dezelfde rijen als ervoor. Dat is opzet: hij raakt ~15
-- aanroepers in de applicatie en moet groen zijn vóórdat de eerste policy
-- erop gaat leunen (migratie 0014).
--
-- ── Waarom 'onbekend' de standaard is ────────────────────────────────────────
--
-- current_setting(..., TRUE) geeft NULL terug als de variabele niet gezet is —
-- bijvoorbeeld in een migratie, in psql, of in code die deze regel niet kent.
--
-- Die NULL wordt hier 'onbekend' en NIET 'medewerker'. Een vergeten actor moet
-- de striktste uitkomst geven, niet de ruimste: wie de variabele niet zet,
-- krijgt geen toegang tot wat achter de actor-eis ligt. De omgekeerde keuze
-- zou betekenen dat elke nieuwe aanroeper die het vergeet stilzwijgend
-- medewerkersrechten krijgt — precies het soort stille fout dat dit project
-- probeert uit te sluiten.
-- =============================================================================

CREATE OR REPLACE FUNCTION clm.current_actor()
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('app.current_actor', TRUE), ''), 'onbekend')
$$;--> statement-breakpoint

COMMENT ON FUNCTION clm.current_actor() IS
    'Leest de soort aanroeper uit de PostgreSQL sessie-variabele app.current_actor, gezet door DatabaseService.withTenant(). Waarden: medewerker, leverancier, onbekend. Niet gezet betekent onbekend, en onbekend krijgt de minste rechten.';--> statement-breakpoint
