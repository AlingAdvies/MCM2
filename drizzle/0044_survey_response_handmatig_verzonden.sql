-- =============================================================================
-- clm.survey_response.handmatig_verzonden_op — registratie van een verzending
-- die buiten het mailkanaal van MCM2 om is gedaan (bijv. via Power Automate).
--
-- Dit is een FEIT, geen afgeleide status: past in het principe van
-- respons-status.ts ("berekend, niet opgeslagen") omdat de kolom niet de
-- status zelf vastlegt, alleen het moment van een handeling die buiten het
-- systeem plaatsvond en die het systeem niet zelf kan waarnemen. bepaalStatus()
-- leest deze kolom als extra feit naast submitted_at, net zoals closes_at.
--
-- Eenmalig, bewust niet corrigeerbaar via een aparte "intrek"-route (besluit
-- eigenaar 2026-09-26): een verkeerd gezette datum blijft zichtbaar in plaats
-- van stilzwijgend te verdwijnen. Een nieuwe registratie op dezelfde respons
-- overschrijft de vorige waarde (zie ronde-beheer.service.ts,
-- registreerHandmatigeVerzending()).
-- =============================================================================

ALTER TABLE "clm"."survey_response"
    ADD COLUMN "handmatig_verzonden_op" timestamp with time zone;
