CREATE TABLE "clm"."survey_answer" (
	"answer_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"answer_type" text NOT NULL,
	"answer_code" text,
	"answer_codes" text[],
	"answer_text" text,
	"answer_number" numeric,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clm"."survey_attachment" (
	"attachment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"original_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clm"."survey_category" (
	"category_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"min_answers" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clm"."survey_question" (
	"question_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"category_id" uuid,
	"position" integer NOT NULL,
	"question_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"answer_type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"allows_upload" boolean DEFAULT false NOT NULL,
	"max_files" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "clm"."survey_response_run_vendor_key";--> statement-breakpoint
ALTER TABLE "clm"."survey_response" ALTER COLUMN "vendor_id" DROP NOT NULL;--> statement-breakpoint
-- HANDMATIG AANGEPAST t.o.v. de gegenereerde migratie.
-- drizzle-kit produceerde hier één statement: ADD COLUMN ... uuid NOT NULL.
-- Dat slaagt alleen op een lege tabel en faalt op elke database met bestaande
-- responses ("column contains null values") — dus ook op clm-enterprise zodra
-- daar een survey loopt. Daarom in drie stappen: kolom toevoegen zonder NOT
-- NULL, vullen, en dan pas de eis opleggen.
--
-- De backfill zet subject_vendor_id op vendor_id. Dat klopt per definitie voor
-- alle bestaande rijen: die dateren van vóór UC2, dus daar is de leverancier
-- zowel deelnemer als onderwerp.
ALTER TABLE "clm"."survey_response" ADD COLUMN "subject_vendor_id" uuid;--> statement-breakpoint
UPDATE clm.survey_response
   SET subject_vendor_id = vendor_id
 WHERE subject_vendor_id IS NULL;--> statement-breakpoint
ALTER TABLE "clm"."survey_response" ALTER COLUMN "subject_vendor_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "clm"."survey_response" ADD COLUMN "respondent_user_id" uuid;--> statement-breakpoint
ALTER TABLE "clm"."survey_response" ADD COLUMN "respondent_label" text;--> statement-breakpoint
ALTER TABLE "clm"."survey_run" ADD COLUMN "survey_kind" text DEFAULT 'vendor_compliance' NOT NULL;--> statement-breakpoint
ALTER TABLE "clm"."survey_run" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "clm"."survey_run" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clm"."survey_answer" ADD CONSTRAINT "survey_answer_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_answer" ADD CONSTRAINT "survey_answer_response_id_survey_response_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "clm"."survey_response"("response_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_answer" ADD CONSTRAINT "survey_answer_question_id_survey_question_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "clm"."survey_question"("question_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_attachment" ADD CONSTRAINT "survey_attachment_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_attachment" ADD CONSTRAINT "survey_attachment_response_id_survey_response_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "clm"."survey_response"("response_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_attachment" ADD CONSTRAINT "survey_attachment_question_id_survey_question_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "clm"."survey_question"("question_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_category" ADD CONSTRAINT "survey_category_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_category" ADD CONSTRAINT "survey_category_template_id_survey_template_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "clm"."survey_template"("template_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_question" ADD CONSTRAINT "survey_question_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_question" ADD CONSTRAINT "survey_question_template_id_survey_template_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "clm"."survey_template"("template_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "survey_answer_response_question_key" ON "clm"."survey_answer" USING btree ("response_id","question_id");--> statement-breakpoint
CREATE INDEX "survey_answer_tenant_id_idx" ON "clm"."survey_answer" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "survey_answer_response_id_idx" ON "clm"."survey_answer" USING btree ("response_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_attachment_storage_key_key" ON "clm"."survey_attachment" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "survey_attachment_tenant_id_idx" ON "clm"."survey_attachment" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "survey_attachment_response_id_idx" ON "clm"."survey_attachment" USING btree ("response_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_category_template_position_key" ON "clm"."survey_category" USING btree ("template_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_category_template_name_key" ON "clm"."survey_category" USING btree ("template_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_category_id_template_key" ON "clm"."survey_category" USING btree ("category_id","template_id");--> statement-breakpoint
CREATE INDEX "survey_category_tenant_id_idx" ON "clm"."survey_category" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_question_template_key_key" ON "clm"."survey_question" USING btree ("template_id","question_key");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_question_template_position_key" ON "clm"."survey_question" USING btree ("template_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_question_id_answer_type_key" ON "clm"."survey_question" USING btree ("question_id","answer_type");--> statement-breakpoint
CREATE INDEX "survey_question_tenant_id_idx" ON "clm"."survey_question" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "survey_question_category_id_idx" ON "clm"."survey_question" USING btree ("category_id");--> statement-breakpoint
ALTER TABLE "clm"."survey_response" ADD CONSTRAINT "survey_response_subject_vendor_id_vendor_vendor_id_fk" FOREIGN KEY ("subject_vendor_id") REFERENCES "clm"."vendor"("vendor_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clm"."survey_response" ADD CONSTRAINT "survey_response_respondent_user_id_user_user_id_fk" FOREIGN KEY ("respondent_user_id") REFERENCES "clm"."user"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "survey_response_subject_vendor_id_idx" ON "clm"."survey_response" USING btree ("subject_vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_response_run_vendor_key" ON "clm"."survey_response" USING btree ("run_id","vendor_id") WHERE "clm"."survey_response"."vendor_id" IS NOT NULL;--> statement-breakpoint

-- =============================================================================
-- HANDGESCHREVEN DEEL — alles hieronder komt NIET uit drizzle-kit.
--
-- drizzle-kit generate produceert uitsluitend tabellen, indexen en foreign
-- keys. RLS, policies, CHECK-constraints, samengestelde foreign keys, functies
-- en triggers zijn handwerk (ADR-010).
--
-- Ontwerp: docs/superpowers/specs/2026-07-28-vragenlijst-ontwerp.md
-- =============================================================================


-- ── 1. Samengestelde foreign keys ─────────────────────────────────────────
-- Twee verwijzingen die een gewone foreign key niet kan bewaken, omdat er
-- telkens een tweede kolom is die mee moet kloppen.

-- Een vraag mag geen categorie van een ándere template aanwijzen. RLS
-- beschermt tegen een andere tenant, niet tegen een andere template bínnen
-- dezelfde tenant. Zonder deze constraint is dat servicelaagwerk waar één
-- vergeten controle volstaat; met deze constraint weigert de database het.
ALTER TABLE clm.survey_question
    ADD CONSTRAINT survey_question_category_template_fk
    FOREIGN KEY (category_id, template_id)
    REFERENCES clm.survey_category (category_id, template_id)
    ON DELETE RESTRICT;--> statement-breakpoint

-- Het answer_type op een antwoord moet gelijk zijn aan dat op de vraag. De
-- kolom staat bewust gedupliceerd op survey_answer: zonder die kolom zou de
-- vormconstraint (blok 2) de vraagtabel moeten raadplegen, en dat kan een
-- CHECK niet.
ALTER TABLE clm.survey_answer
    ADD CONSTRAINT survey_answer_question_type_fk
    FOREIGN KEY (question_id, answer_type)
    REFERENCES clm.survey_question (question_id, answer_type)
    ON DELETE RESTRICT;--> statement-breakpoint


-- ── 2. CHECK-constraints ──────────────────────────────────────────────────

-- survey_run: de twee use cases en de lifecycle uit ontwerp §1c en §2b.
ALTER TABLE clm.survey_run
    ADD CONSTRAINT survey_run_kind_check
    CHECK (survey_kind IN ('vendor_compliance', 'internal_review'));--> statement-breakpoint

ALTER TABLE clm.survey_run
    ADD CONSTRAINT survey_run_status_check
    CHECK (status IN ('draft', 'active', 'finished', 'archived'));--> statement-breakpoint

-- survey_response: welke rolverdeling bij welke use case hoort.
--
-- Bij UC1 vallen deelnemer en onderwerp samen; bij UC2 is er geen deelnemende
-- leverancier. Samen met de partiële unieke index hierboven vervangt dit de
-- garantie die vóór deze migratie in `vendor_id NOT NULL` zat. Zonder die
-- vervanging zou het versoepelen van NOT NULL stilzwijgend een garantie
-- weghalen.
--
-- Waarom een trigger en geen CHECK-constraint: survey_kind staat op
-- survey_run, niet op survey_response. Een CHECK mag geen subquery bevatten en
-- kan die kolom dus niet raadplegen. De uitwijk zou zijn survey_kind te
-- dupliceren op survey_response, maar dat levert een derde plek op waar de
-- waarde kan afwijken — en juist het voorkomen daarvan is het doel.
CREATE OR REPLACE FUNCTION clm.assert_response_rollen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = clm, pg_temp
AS $fn$
DECLARE
    soort TEXT;
BEGIN
    SELECT r.survey_kind INTO soort
      FROM clm.survey_run r
     WHERE r.run_id = NEW.run_id;

    IF soort = 'vendor_compliance' THEN
        -- UC1: de leverancier vult in over zichzelf. Deelnemer en onderwerp
        -- moeten dezelfde rij aanwijzen.
        IF NEW.vendor_id IS NULL OR NEW.vendor_id <> NEW.subject_vendor_id THEN
            RAISE EXCEPTION
                'Bij vendor_compliance moet vendor_id gelijk zijn aan subject_vendor_id'
                USING ERRCODE = 'raise_exception';
        END IF;
    ELSIF soort = 'internal_review' THEN
        -- UC2: een collega vult in over de leverancier. De invuller is geen
        -- leverancier, dus vendor_id blijft leeg.
        IF NEW.vendor_id IS NOT NULL THEN
            RAISE EXCEPTION
                'Bij internal_review moet vendor_id leeg zijn; de invuller is geen leverancier'
                USING ERRCODE = 'raise_exception';
        END IF;
    END IF;

    RETURN NEW;
END;
$fn$;--> statement-breakpoint

COMMENT ON FUNCTION clm.assert_response_rollen() IS
    'Bewaakt de rolverdeling per use case: bij vendor_compliance vallen deelnemer en onderwerp samen, bij internal_review is er geen deelnemende leverancier. Zie vragenlijst-ontwerp paragraaf 1c.';--> statement-breakpoint

CREATE TRIGGER survey_response_rollen
    BEFORE INSERT OR UPDATE ON clm.survey_response
    FOR EACH ROW EXECUTE FUNCTION clm.assert_response_rollen();--> statement-breakpoint

-- survey_question: acht bekende typen, plus 'instruction' als negende
-- vraagvorm die zelf geen antwoord oplevert.
ALTER TABLE clm.survey_question
    ADD CONSTRAINT survey_question_answer_type_check
    CHECK (answer_type IN (
        'instruction', 'confirmation', 'open_text', 'yes_no',
        'single_choice', 'multi_choice', 'rating', 'number', 'file_upload'
    ));--> statement-breakpoint

-- Een leesblok kan niet verplicht zijn: er valt niets te beantwoorden. Zonder
-- deze regel is een vragenlijst met een inleidend tekstblok nooit volledig in
-- te dienen — de waarschijnlijkste bug bij het bouwen van de validatie.
ALTER TABLE clm.survey_question
    ADD CONSTRAINT survey_question_instruction_not_required_check
    CHECK (answer_type <> 'instruction' OR is_required = false);--> statement-breakpoint

ALTER TABLE clm.survey_question
    ADD CONSTRAINT survey_question_upload_files_check
    CHECK (
        (allows_upload = false AND max_files = 0)
        OR (allows_upload = true AND max_files BETWEEN 1 AND 5)
    );--> statement-breakpoint

ALTER TABLE clm.survey_question
    ADD CONSTRAINT survey_question_position_check
    CHECK (position >= 1);--> statement-breakpoint

ALTER TABLE clm.survey_category
    ADD CONSTRAINT survey_category_position_check
    CHECK (position >= 1);--> statement-breakpoint

ALTER TABLE clm.survey_category
    ADD CONSTRAINT survey_category_min_answers_check
    CHECK (min_answers >= 0);--> statement-breakpoint

-- survey_answer: 'instruction' ontbreekt bewust — een leesblok krijgt nooit
-- een antwoordrij.
ALTER TABLE clm.survey_answer
    ADD CONSTRAINT survey_answer_type_check
    CHECK (answer_type IN (
        'confirmation', 'open_text', 'yes_no', 'single_choice',
        'multi_choice', 'rating', 'number', 'file_upload'
    ));--> statement-breakpoint

-- De vormconstraint: elk type vult precies één waardekolom en laat de rest
-- leeg. Zonder dit kan een bug een rating als tekst wegschrijven of een
-- keuzecode in answer_number proppen. Dat merk je pas maanden later bij de
-- eerste rapportage, wanneer de data niet meer te repareren is omdat niemand
-- weet wat er oorspronkelijk bedoeld was.
ALTER TABLE clm.survey_answer
    ADD CONSTRAINT survey_answer_shape_check
    CHECK (
        CASE answer_type
            WHEN 'confirmation' THEN
                answer_code IN ('confirmed', 'not_confirmed',
                                'not_applicable', 'cannot_upload')
                AND answer_codes IS NULL
                AND answer_text IS NULL AND answer_number IS NULL
            WHEN 'yes_no' THEN
                answer_code IN ('yes', 'no') AND answer_codes IS NULL
                AND answer_text IS NULL AND answer_number IS NULL
            WHEN 'single_choice' THEN
                answer_code IS NOT NULL AND answer_codes IS NULL
                AND answer_text IS NULL AND answer_number IS NULL
            WHEN 'multi_choice' THEN
                answer_codes IS NOT NULL
                AND array_length(answer_codes, 1) >= 1
                AND answer_code IS NULL AND answer_text IS NULL
                AND answer_number IS NULL
            WHEN 'open_text' THEN
                answer_text IS NOT NULL AND length(btrim(answer_text)) >= 1
                AND answer_code IS NULL AND answer_codes IS NULL
                AND answer_number IS NULL
            WHEN 'rating' THEN
                answer_number IS NOT NULL
                AND answer_number = trunc(answer_number)
                AND answer_code IS NULL AND answer_codes IS NULL
                AND answer_text IS NULL
            WHEN 'number' THEN
                answer_number IS NOT NULL
                AND answer_code IS NULL AND answer_codes IS NULL
                AND answer_text IS NULL
            WHEN 'file_upload' THEN
                answer_code IS NULL AND answer_codes IS NULL
                AND answer_text IS NULL AND answer_number IS NULL
            ELSE false
        END
    );--> statement-breakpoint

-- De toelichtingsplicht bij 'confirmation', op databaseniveau (ontwerp §3).
-- Alles behalve een bevestiging vereist uitleg.
--
-- De ondergrens van 10 tekens houdt "n/a" en "-" tegen: die maken het veld
-- formeel gevuld en inhoudelijk leeg, en zien er in een overzicht uit als een
-- antwoord. Dat is erger dan een leeg veld.
--
-- Een fout in de validatiecode levert hierdoor een databasefout op in plaats
-- van een halfleeg compliance-antwoord dat er volledig uitziet.
ALTER TABLE clm.survey_answer
    ADD CONSTRAINT survey_answer_comment_required_check
    CHECK (
        answer_type <> 'confirmation'
        OR answer_code = 'confirmed'
        OR length(btrim(coalesce(comment, ''))) >= 10
    );--> statement-breakpoint

ALTER TABLE clm.survey_answer
    ADD CONSTRAINT survey_answer_comment_length_check
    CHECK (comment IS NULL OR length(comment) <= 2000);--> statement-breakpoint

-- survey_attachment: de grenzen uit OV-7 (maximaal 5 MB, PDF of PNG).
--
-- Het maximum aantal bestanden staat bewust NIET in een CHECK: dat komt uit
-- survey_question.max_files en varieert per vraag. Een CHECK kan noch over
-- meerdere rijen tellen noch een andere tabel raadplegen. Die telling gebeurt
-- in de transactie met SELECT ... FOR UPDATE op de responserij (ontwerp §4).
ALTER TABLE clm.survey_attachment
    ADD CONSTRAINT survey_attachment_size_check
    CHECK (byte_size > 0 AND byte_size <= 5242880);--> statement-breakpoint

ALTER TABLE clm.survey_attachment
    ADD CONSTRAINT survey_attachment_content_type_check
    CHECK (content_type IN ('application/pdf', 'image/png'));--> statement-breakpoint


-- ── 3. Row Level Security ─────────────────────────────────────────────────
-- Verplicht voor elke tenantgebonden tabel (MCM2-CLAUDE.md §7): zowel USING
-- als WITH CHECK. Zonder WITH CHECK kan een rij met een vreemde tenant_id
-- weggeschreven worden die daarna onzichtbaar is — een lek dat pas bij een
-- audit opvalt.
--
-- Bewust géén `deleted_at IS NULL` in USING: dat maakte zacht verwijderen
-- onmogelijk (Issue #31, migratie 0004).

ALTER TABLE clm.survey_category   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.survey_question   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.survey_answer     ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.survey_attachment ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY survey_category_isolation ON clm.survey_category
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

CREATE POLICY survey_question_isolation ON clm.survey_question
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

-- survey_answer en survey_attachment: naast tenant-isolatie geldt dat er
-- alleen geschreven mag worden zolang de response nog openstaat. Dat is de
-- database-kant van de éénmaligheid (AC12): een bug in de applicatie kan de
-- éénmaligheid hiermee niet omzeilen.
--
-- Let op de asymmetrie. Lezen mag altijd binnen de eigen tenant — een
-- ingediende response moet leesbaar blijven, anders is het bewijsmateriaal
-- onbereikbaar. Schrijven mag alleen bij status 'pending'.
CREATE POLICY survey_answer_isolation ON clm.survey_answer
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (
        tenant_id = clm.current_tenant_id()
        AND EXISTS (
            SELECT 1
              FROM clm.survey_response r
             WHERE r.response_id = survey_answer.response_id
               AND r.tenant_id   = clm.current_tenant_id()
               AND r.status      = 'pending'
        )
    );--> statement-breakpoint

CREATE POLICY survey_attachment_isolation ON clm.survey_attachment
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (
        tenant_id = clm.current_tenant_id()
        AND EXISTS (
            SELECT 1
              FROM clm.survey_response r
             WHERE r.response_id = survey_attachment.response_id
               AND r.tenant_id   = clm.current_tenant_id()
               AND r.status      = 'pending'
        )
    );--> statement-breakpoint


-- ── 4. Bevriezing van een lopende ronde ───────────────────────────────────
-- Een tenant wijzigt vraag 4 terwijl twaalf leveranciers midden in het
-- invullen zitten. Zonder bevriezing krijg je antwoorden op vragen die
-- inmiddels anders luiden. Bij een instrument dat contractueel bewijsmateriaal
-- oplevert is dat onbruikbaar: je kunt achteraf niet vaststellen waar iemand
-- precies mee heeft ingestemd.
--
-- Wijzigen mag altijd, maar raakt alleen nieuwe rondes. Zodra er aan een
-- template een run hangt die niet meer in 'draft' staat, is de template
-- bevroren; wijzigen kan dan alleen via een kopie naar een nieuwe versie.
--
-- Afgedwongen met een trigger en niet met een `if` in de servicelaag: anders
-- is de garantie zo sterk als de code die hem toevallig niet omzeilt, en hier
-- hangt bewijskracht aan.

CREATE OR REPLACE FUNCTION clm.assert_template_niet_bevroren()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = clm, pg_temp
AS $fn$
DECLARE
    doel_template UUID;
BEGIN
    doel_template := COALESCE(NEW.template_id, OLD.template_id);

    IF EXISTS (
        SELECT 1
          FROM clm.survey_run r
         WHERE r.template_id = doel_template
           AND r.status <> 'draft'
    ) THEN
        RAISE EXCEPTION
            'Vragenlijst % is bevroren: er loopt of liep een ronde. Kopieer naar een nieuwe versie.',
            doel_template
            USING ERRCODE = 'raise_exception';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$fn$;--> statement-breakpoint

COMMENT ON FUNCTION clm.assert_template_niet_bevroren() IS
    'Weigert wijzigingen aan vragen of categorieen van een template waaraan een niet-draft run hangt. Zie vragenlijst-ontwerp paragraaf 2.';--> statement-breakpoint

CREATE TRIGGER survey_question_bevriezing
    BEFORE INSERT OR UPDATE OR DELETE ON clm.survey_question
    FOR EACH ROW EXECUTE FUNCTION clm.assert_template_niet_bevroren();--> statement-breakpoint

CREATE TRIGGER survey_category_bevriezing
    BEFORE INSERT OR UPDATE OR DELETE ON clm.survey_category
    FOR EACH ROW EXECUTE FUNCTION clm.assert_template_niet_bevroren();--> statement-breakpoint


-- ── 5. Rechten ────────────────────────────────────────────────────────────
-- ALTER DEFAULT PRIVILEGES uit migratie 0001 dekt tabellen die daarna door
-- clm_migrator zijn aangemaakt. Expliciet herhalen is idempotent en maakt de
-- rechten leesbaar bij deze tabellen in plaats van impliciet elders.

GRANT SELECT, INSERT, UPDATE, DELETE
    ON clm.survey_category, clm.survey_question,
       clm.survey_answer, clm.survey_attachment
    TO clm_api, clm_admin;--> statement-breakpoint

GRANT SELECT
    ON clm.survey_category, clm.survey_question,
       clm.survey_answer, clm.survey_attachment
    TO clm_readonly;
