-- =============================================================================
-- clm.survey_response_event — de uitnodigingsgeschiedenis van één deelnemer.
--
-- Issue #258. Uitnodigingen gaan vaak buiten MCM2 om de deur uit (Power
-- Automate). Na nabellen blijkt dan dat een uitnodiging naar iemand anders
-- moet: link intrekken, nieuwe link, opnieuw versturen — en soms nog een keer
-- omdat het adres niet klopte. MCM2 hield daar geen spoor van bij:
--   - handmatig_verzonden_op (0044) is één datum, zonder adres, die bij elke
--     registratie wordt overschreven;
--   - heruitnodigen() zet die datum terug op NULL;
--   - intrekken werd nergens vastgelegd.
-- Na twee resends was dus niet meer te zien of, wanneer en aan wie er
-- verstuurd was.
--
-- Append-only, zelfde patroon als clm.vendor_engagement_note (0043): elke
-- gebeurtenis is een eigen rij. Anders dan bij een notitie is er ook geen
-- zacht verwijderen: een verkeerd geregistreerde verzending blijft zichtbaar
-- staan, in lijn met het besluit van 26-09 bij 0044 ("een verkeerd gezette
-- datum blijft zichtbaar in plaats van stilzwijgend te verdwijnen"). Vandaar
-- alleen SELECT en INSERT voor de applicatie.
--
-- handmatig_verzonden_op blijft bestaan als "laatst verstuurd": de berekende
-- status (respons-status.ts) en de bestaande schermen leunen erop en
-- veranderen in deze stap niet.
--
-- ON DELETE CASCADE naar survey_response: een gebeurtenis heeft geen bestaan
-- zonder de uitnodiging. survey_response zelf wordt door de applicatie nooit
-- verwijderd (RESTRICT vanaf survey_run); alleen tenant-opschonen doet dat, en
-- dan hoort de geschiedenis mee te gaan — zelfde redenering als
-- contract_werkingsgebied (0046).
-- =============================================================================

CREATE TABLE "clm"."survey_response_event" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"soort" text NOT NULL,
	"adres" text,
	"toelichting" text,
	"plaatsgevonden_op" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "clm"."survey_response_event"
    ADD CONSTRAINT "survey_response_event_response_id_fk"
    FOREIGN KEY ("response_id") REFERENCES "clm"."survey_response"("response_id")
    ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."survey_response_event"
    ADD CONSTRAINT "survey_response_event_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "clm"."survey_response_event"
    ADD CONSTRAINT "survey_response_event_created_by_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "clm"."user"("user_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Zelfde lijst als SOORTEN_GEBEURTENIS in src/survey/uitnodigingsgeschiedenis.ts.
ALTER TABLE "clm"."survey_response_event"
    ADD CONSTRAINT "survey_response_event_soort_check"
    CHECK (soort IN ('verstuurd', 'niet_aangekomen', 'ingetrokken', 'nieuwe_link'));--> statement-breakpoint

-- Een verzending zonder adres is precies het gat dat deze tabel dicht.
ALTER TABLE "clm"."survey_response_event"
    ADD CONSTRAINT "survey_response_event_adres_check"
    CHECK (
        (soort <> 'verstuurd' OR adres IS NOT NULL)
        AND (adres IS NULL OR char_length(adres) BETWEEN 3 AND 320)
    );--> statement-breakpoint

-- Zelfde grens als de notities (0043).
ALTER TABLE "clm"."survey_response_event"
    ADD CONSTRAINT "survey_response_event_toelichting_check"
    CHECK (toelichting IS NULL OR char_length(toelichting) BETWEEN 1 AND 500);--> statement-breakpoint

CREATE INDEX "survey_response_event_tenant_id_idx"
    ON "clm"."survey_response_event" USING btree ("tenant_id");--> statement-breakpoint

CREATE INDEX "survey_response_event_response_id_idx"
    ON "clm"."survey_response_event" USING btree ("response_id");--> statement-breakpoint

ALTER TABLE clm.survey_response_event ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.survey_response_event FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Alleen medewerkers: de leverancier (tokenpad) hoeft niet te zien hoe vaak
-- en naar wie er is nagebeld.
CREATE POLICY survey_response_event_isolation ON clm.survey_response_event
    USING (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    )
    WITH CHECK (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    );--> statement-breakpoint

COMMENT ON TABLE clm.survey_response_event IS
    'Uitnodigingsgeschiedenis per deelnemer: verstuurd (aan welk adres), kwam niet aan, ingetrokken, nieuwe link. Append-only, geen UPDATE of DELETE door de applicatie.';--> statement-breakpoint

-- Expliciet, nooit via ALTER DEFAULT PRIVILEGES (ARCHITECTUUR.md
-- Platformgarantie 3; migraties 0022, 0039). REVOKE ALL eerst: op een verse
-- database geeft de default-ACL uit 0001 anders ook UPDATE en DELETE mee.
REVOKE ALL ON clm.survey_response_event FROM clm_api, clm_admin, clm_readonly;--> statement-breakpoint
GRANT SELECT, INSERT ON clm.survey_response_event TO clm_api, clm_admin;
