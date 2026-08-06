-- =============================================================================
-- clm.template_reviewer — wie beoordeelt welke vragenlijst.
--
-- Aanleiding: ADR-013, besluit 2. De domeincontext van de eigenaar
-- (2026-08-06): een contractmanager beheert een leverancier, maar de
-- beoordeling van een vakinhoudelijke vragenlijst hoort bij iemand anders —
-- bij Transdev de CISO voor IT-compliance.
--
-- ── Aan de vragenlijst, niet aan de vendor of de ronde ───────────────────────
--
-- Beoordelen is vakinhoud, geen eigenaarschap. Wie een IT-compliancelijst kan
-- beoordelen, kan dat voor élke vendor. De contractmanager van vendor X kan dat
-- voor géén enkele, ook niet voor zijn eigen vendor.
--
-- Beheren is eigenaarschap (vendor.owner_user_id, bestaat al sinds 0000),
-- beoordelen is expertise. Die twee hangen daarom aan verschillende objecten.
--
-- Het schaalt ook de goede kant op: komt er een Privacy/AVG-vragenlijst bij,
-- dan koppel je daar de FG aan zonder één vendor of ronde aan te raken.
--
-- ── Deze tabel is een HULPMIDDEL, geen autorisatiegrens ──────────────────────
--
-- ADR-013 besluit 3, en het minst vanzelfsprekende besluit erin. Deze koppeling
-- bepaalt wat iemand standaard in zijn werkvoorraad ziet, NIET wat hij mag.
-- Elke reviewer binnen de tenant mag elke inzending beoordelen.
--
-- Waarom niet exclusief: een harde grens legt het proces stil zodra de
-- gekoppelde beoordelaar ziek is. Dan wijzigt iemand met databasetoegang de
-- koppeling — een noodgreep buiten de app om, zonder spoor. Erger dan het
-- probleem.
--
-- De fallback is de contractmanager, die intern regelt dat een bevoegd persoon
-- beoordeelt. Dat werkt alleen als de app het niet blokkeert.
--
-- Dat is verdedigbaar omdat elk oordeel met naam en datum vastligt en nooit
-- wordt overschreven (migratie 0015). Wie buiten zijn vakgebied beoordeelt,
-- doet dat zichtbaar. Zonder die historie zou de grens hard moeten zijn.
--
-- **Gevolg voor wie hier later iets bouwt:** een route die deze tabel gebruikt
-- om toegang te WEIGEREN gaat in tegen dit besluit. Hij hoort te bepalen wat
-- er standaard getoond wordt, meer niet.
--
-- ── Geen unieke sleutel op template_id ───────────────────────────────────────
--
-- Meerdere beoordelaars per vragenlijst zijn toegestaan. Bij Transdev is het er
-- waarschijnlijk één, maar die ene gaat met vakantie. Nu toestaan kost niets;
-- later verruimen is een migratie op productiedata.
-- =============================================================================

CREATE TABLE "clm"."template_reviewer" (
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "template_reviewer_template_id_user_id_pk"
	    PRIMARY KEY("template_id","user_id")
);
--> statement-breakpoint

ALTER TABLE "clm"."template_reviewer"
    ADD CONSTRAINT "template_reviewer_tenant_id_tenant_tenant_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "clm"."tenant"("tenant_id")
    ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- CASCADE: verdwijnt de vragenlijst, dan is de koppeling betekenisloos.
ALTER TABLE "clm"."template_reviewer"
    ADD CONSTRAINT "template_reviewer_template_id_survey_template_template_id_fk"
    FOREIGN KEY ("template_id") REFERENCES "clm"."survey_template"("template_id")
    ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- CASCADE: verdwijnt de gebruiker, dan verdwijnt zijn koppeling mee. Anders
-- dan bij survey_review.reviewer_user_id, dat juist restrict is — een
-- vastgelegd oordeel moet zijn naam houden, een werkvoorraad niet.
ALTER TABLE "clm"."template_reviewer"
    ADD CONSTRAINT "template_reviewer_user_id_user_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "clm"."user"("user_id")
    ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- SET NULL: administratie, geen oordeel. De koppeling blijft bruikbaar als
-- degene die hem legde is vertrokken.
ALTER TABLE "clm"."template_reviewer"
    ADD CONSTRAINT "template_reviewer_created_by_user_user_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "clm"."user"("user_id")
    ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "template_reviewer_tenant_id_idx"
    ON "clm"."template_reviewer" USING btree ("tenant_id");--> statement-breakpoint

-- Op user_id, want de vraag "wat wacht er op mij" begint bij de ingelogde
-- gebruiker en niet bij de vragenlijst.
CREATE INDEX "template_reviewer_user_id_idx"
    ON "clm"."template_reviewer" USING btree ("user_id");--> statement-breakpoint

-- ── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE clm.template_reviewer ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clm.template_reviewer FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Zelfde vorm als survey_review (migratie 0015): tenant én actor. Een
-- leverancier hoort niet te kunnen zien wie zijn inzending beoordeelt — dat
-- is dezelfde redenering als bij het oordeel zelf.
CREATE POLICY template_reviewer_isolation ON clm.template_reviewer
    USING (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    )
    WITH CHECK (
        tenant_id = clm.current_tenant_id()
        AND clm.current_actor() = 'medewerker'
    );--> statement-breakpoint

COMMENT ON TABLE clm.template_reviewer IS
    'Koppelt een gebruiker aan een vragenlijst die hij beoordeelt. HULPMIDDEL, geen autorisatiegrens (ADR-013 besluit 3): bepaalt wat iemand in zijn werkvoorraad ziet, niet wat hij mag. Elke reviewer binnen de tenant mag elke inzending beoordelen.';--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON clm.template_reviewer TO clm_api_runtime;
