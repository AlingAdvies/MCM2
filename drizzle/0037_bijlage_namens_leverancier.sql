-- ── 0037 — Beheerder kan een bijlage namens de leverancier toevoegen ────────
--
-- Aanleiding: een leverancier publiceert een certificaat (bv. ISO 27001) op
-- zijn eigen website in plaats van het te uploaden. De contractbeheerder wil
-- dat certificaat dan zelf ophalen en vastleggen bij de betreffende vraag,
-- zodat het auditspoor compleet is — zonder dat dit lijkt alsof de
-- leverancier het zelf heeft aangeleverd.
--
-- Twee kolommen op de bestaande tabel, geen nieuwe. NULL/false (de default)
-- is het bestaande gedrag: een bijlage die de leverancier zelf uploadde via
-- het portaal. Gevuld betekent: een medewerker heeft dit namens de
-- leverancier toegevoegd — dat onderscheid moet zichtbaar blijven op de
-- bijlage zelf, niet alleen af te leiden uit een los audit-logboek.

ALTER TABLE clm.survey_attachment
    ADD COLUMN uploaded_by_user_id uuid REFERENCES clm."user"(user_id) ON DELETE SET NULL;--> statement-breakpoint

ALTER TABLE clm.survey_attachment
    ADD COLUMN uploaded_by_admin boolean NOT NULL DEFAULT false;--> statement-breakpoint

COMMENT ON COLUMN clm.survey_attachment.uploaded_by_user_id IS
    'NULL = de leverancier heeft dit bestand zelf geüpload via het portaal (bestaand gedrag). Gevuld: welke medewerker het namens de leverancier heeft toegevoegd (migratie 0037). ON DELETE SET NULL: het bewijsstuk zelf blijft bestaan als de medewerker later wordt verwijderd — alleen het "wie" vervalt dan.';--> statement-breakpoint

COMMENT ON COLUMN clm.survey_attachment.uploaded_by_admin IS
    'true wanneer een medewerker dit bestand namens de leverancier heeft toegevoegd (migratie 0037) — het onderscheid tussen "leverancier zegt het zelf" en "beheerder heeft het extern geverifieerd en vastgelegd". Losse kolom naast uploaded_by_user_id (in plaats van alleen NULL-check) omdat een toekomstige achtergrondtaak ooit ook namens de leverancier zou kunnen uploaden zonder een user_id te hebben — dat moet dan nog steeds als "niet de leverancier zelf" herkenbaar zijn.';--> statement-breakpoint

-- ── RLS-policy herzien: de bestaande WITH CHECK eiste r.status = 'pending' ──
--
-- Dat klopt nog steeds voor de leverancier (migratie 0005: een ingediende
-- respons is dicht, geen nieuwe bijlagen meer). Het klopt niet meer voor een
-- medewerker die namens de leverancier iets toevoegt — dat mag júist ook ná
-- indienen, dat is het hele scenario van deze migratie.
--
-- clm.current_actor() (migratie 0013) maakt het onderscheid: BijlageService
-- zet de actor op 'medewerker' voor voegToeAlsBeheer() en op 'leverancier'
-- voor het bestaande voegToe(). De status-eis geldt daarom alleen nog voor
-- de leverancier; een medewerker mag altijd toevoegen (mits de applicatielaag
-- zelf allows_upload/max_files al gecontroleerd heeft — die controle stond
-- en staat in BijlageService, niet in deze policy).

DROP POLICY IF EXISTS survey_attachment_isolation ON clm.survey_attachment;--> statement-breakpoint

CREATE POLICY survey_attachment_isolation ON clm.survey_attachment
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (
        tenant_id = clm.current_tenant_id()
        AND EXISTS (
            SELECT 1
              FROM clm.survey_response r
             WHERE r.response_id = survey_attachment.response_id
               AND r.tenant_id   = clm.current_tenant_id()
               AND (
                   clm.current_actor() = 'medewerker'
                   OR r.status = 'pending'
               )
        )
    );--> statement-breakpoint

COMMENT ON POLICY survey_attachment_isolation ON clm.survey_attachment IS
    'Tenant-isolatie plus: een leverancier (of onbekende actor) mag alleen toevoegen aan een respons die nog pending is (migratie 0005); een medewerker mag ook toevoegen aan een al ingediende respons (migratie 0037, namens de leverancier). BijlageService.voegToeAlsBeheer() zet de actor op medewerker, voegToe() op leverancier.';
