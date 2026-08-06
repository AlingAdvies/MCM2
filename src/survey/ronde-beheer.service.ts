import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import { genereerToken, hashToken } from './survey-token';
import {
  magOvergaan,
  mogelijkeOvergangen,
  type NieuweRonde,
  type Uitnodigingen,
} from './ronde-invoer';

/**
 * Rondes starten en leveranciers uitnodigen (fase B van
 * docs/superpowers/plans/2026-08-03-surveybeheer.md).
 *
 * ── Dit is de eerste productiecode die tokens uitgeeft ───────────────────────
 *
 * Tot nu toe riepen alleen `seed-demo-tenant.js` en `otap-doorloop.js`
 * `genereerToken()` aan. Er bestond dus geen weg waarlangs een échte uitnodiging
 * tot stand kwam. Die weg is dit bestand.
 *
 * Dat maakt het de gevoeligste plek van dit plan: de tokenlaag is al bewezen en
 * groen, en alles hier moet die laag gebruiken zoals hij bedoeld is — niet
 * ernaast bouwen.
 *
 * ── Het ruwe token bestaat één keer ──────────────────────────────────────────
 *
 * `uitnodigen()` geeft de ruwe tokens terug in zijn antwoord. Dat is de enige
 * keer dat ze bestaan; de database bewaart alleen `hashToken(...)`. Er is geen
 * "toon nogmaals", en dat is geen omissie maar het ontwerp: wie een databasedump
 * in handen krijgt kan daarmee geen enkele openstaande survey openen.
 *
 * Het gevolg voor de aanroeper is dat het antwoord van deze methode het enige
 * moment is waarop de links doorgegeven kunnen worden. Het scherm moet dat
 * zeggen vóórdat de beheerder wegklikt.
 *
 * ── Waarom hier geen e-mail verstuurd wordt ──────────────────────────────────
 *
 * Verleidelijk, want de tokens zijn hier beschikbaar. Maar e-mail hangt aan de
 * SMTP-instellingen per tenant, en die zijn ontworpen maar niet gebouwd (spec
 * 2026-08-04-beheermenu-tenantinstellingen). Fase D voegt het toe. Tot dan
 * kopieert de beheerder de links zelf — een bewuste tussenstap, geen
 * halfbakken versie.
 */

/** Eén uitgegeven uitnodiging, met het ruwe token erbij. */
export interface Uitnodiging {
  responseId: string;
  vendorId: string;
  vendorNaam: string;
  /**
   * Het ruwe token. Bestaat alleen in dit antwoord en nergens anders.
   *
   * Bewust niet `tokenHash`: die is voor niemand nuttig en zou een aanvaller
   * die het antwoord onderschept de helft van het werk geven.
   */
  token: string;
  expiresAt: string;
  /**
   * Het adres van de primaire contactpersoon, als die er is.
   *
   * Kan ontbreken: niet elke leverancier heeft een contactpersoon met een
   * e-mailadres. Dat is geen fout hier — het token bestaat en de link werkt.
   * Wel iets dat zichtbaar moet zijn bij het versturen, anders is die
   * leverancier stilzwijgend overgeslagen.
   */
  contactEmail?: string;
}

/**
 * Wat er nodig is om de uitnodigingsmails te kunnen samenstellen.
 *
 * Komt uit dezelfde transactie als de tokens, zodat er geen tweede query nodig
 * is die tussentijds iets anders kan zien.
 */
export interface UitnodigingContext {
  tenantNaam: string;
  vragenlijstNaam: string;
}

export interface UitnodigingResultaat {
  uitnodigingen: Uitnodiging[];
  context: UitnodigingContext;
}

export interface RondeGestart {
  runId: string;
  templateId: string;
  templateNaam: string;
  status: string;
  surveyKind: string;
  isTest: boolean;
  closesAt: string | null;
}

interface RunRij extends Record<string, unknown> {
  run_id: string;
  template_id: string;
  template_naam: string;
  status: string;
  survey_kind: string;
  is_test: boolean;
  closes_at: Date | string | null;
}

interface VendorRij extends Record<string, unknown> {
  vendor_id: string;
  name: string;
  /** `null` als de leverancier geen contactpersoon met e-mailadres heeft. */
  contact_email: string | null;
}

function iso(waarde: Date | string | null): string | null {
  if (waarde === null || waarde === undefined) return null;
  return waarde instanceof Date ? waarde.toISOString() : String(waarde);
}

@Injectable()
export class RondeBeheerService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Maakt een nieuwe ronde aan, in status `draft`.
   *
   * ── Waarom draft en niet meteen actief ──────────────────────────────────────
   *
   * Een actieve ronde bevriest de vragenlijst (trigger
   * `survey_question_bevriezing`, migratie 0005). Dat is onomkeerbaar: daarna
   * kan er geen vraag meer bij, weg of anders.
   *
   * Door in `draft` te beginnen kan de beheerder de deelnemers samenstellen en
   * de sluitdatum kiezen vóórdat die grendel valt. Het scherm legt dat uit op
   * het moment dat hij op starten drukt, niet erna met een foutmelding.
   */
  async maakRonde(
    tenantId: string,
    invoer: NieuweRonde,
  ): Promise<RondeGestart> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        // Eerst kijken of de vragenlijst bestaat binnen deze tenant. Zonder
        // deze controle levert een onbekend template_id een foreign-key-fout
        // op — een 500 met een databasemelding, waar een 404 hoort.
        const templates = await tx.execute<{ name: string }>(
          sql`SELECT name FROM clm.survey_template
               WHERE template_id = ${invoer.templateId}`,
        );

        if (templates.rows.length === 0) {
          throw new NotFoundException('Deze vragenlijst bestaat niet.');
        }

        // Een vragenlijst zonder vragen is geen vragenlijst. Uitzetten zou een
        // leverancier een lege lijst voorschotelen, en de ronde daarna
        // bevriezen op die lege toestand.
        const vragen = await tx.execute<{ aantal: string }>(
          sql`SELECT count(*) AS aantal FROM clm.survey_question
               WHERE template_id = ${invoer.templateId}
                 AND answer_type <> 'instruction'`,
        );

        if (Number(vragen.rows[0]?.aantal ?? 0) === 0) {
          throw new BadRequestException({
            message:
              'Deze vragenlijst bevat geen vragen. Er valt niets uit te vragen.',
            veld: 'templateId',
          });
        }

        const aangemaakt = await tx.execute<RunRij>(
          sql`INSERT INTO clm.survey_run
                  (tenant_id, template_id, survey_kind, status, closes_at,
                   is_test)
              VALUES (${tenantId}, ${invoer.templateId}, ${invoer.surveyKind},
                      'draft', ${invoer.closesAt?.toISOString() ?? null},
                      ${invoer.isTest})
              RETURNING run_id, template_id, status, survey_kind, is_test,
                        closes_at`,
        );

        const r = aangemaakt.rows[0];

        return {
          runId: r.run_id,
          templateId: r.template_id,
          templateNaam: templates.rows[0].name,
          status: r.status,
          surveyKind: r.survey_kind,
          isTest: r.is_test,
          closesAt: iso(r.closes_at),
        };
      },
      'medewerker',
    );
  }

  /**
   * Verandert de status van een ronde.
   *
   * De toegestane overgangen staan in `ronde-invoer.ts`. De CHECK-constraint in
   * de database bewaakt wélke waarden bestaan; welke vólgorde geldig is, is een
   * regel van de applicatie.
   *
   * ── Wat er gebeurt bij draft → active ───────────────────────────────────────
   *
   * `started_at` blijft staan op wat het was (`now()` bij het aanmaken). De
   * bevriezing gebeurt niet hier maar in de database: de trigger op
   * `survey_question` weigert vanaf dat moment elke wijziging aan een
   * vragenlijst waarop een actieve ronde loopt.
   */
  async wijzigStatus(
    tenantId: string,
    runId: string,
    nieuweStatus: string,
  ): Promise<RondeGestart> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const huidige = await tx.execute<RunRij>(
          sql`SELECT r.run_id, r.template_id, t.name AS template_naam,
                     r.status, r.survey_kind, r.is_test, r.closes_at
                FROM clm.survey_run r
                JOIN clm.survey_template t ON t.template_id = r.template_id
               WHERE r.run_id = ${runId}`,
        );

        const r = huidige.rows[0];

        if (!r) {
          throw new NotFoundException('Deze ronde bestaat niet.');
        }

        if (r.status === nieuweStatus) {
          // Geen fout: twee keer op dezelfde knop drukken hoort geen melding op
          // te leveren die eruitziet alsof er iets mis is.
          return this.naarGestart(r);
        }

        if (!magOvergaan(r.status, nieuweStatus)) {
          const mogelijk = mogelijkeOvergangen(r.status);

          throw new ConflictException(
            mogelijk.length === 0
              ? `Deze ronde is ${r.status} en kan niet meer van status veranderen.`
              : `Een ronde met status '${r.status}' kan alleen naar: ${mogelijk.join(', ')}.`,
          );
        }

        const bijgewerkt = await tx.execute<RunRij>(
          sql`UPDATE clm.survey_run
                 SET status = ${nieuweStatus}
               WHERE run_id = ${runId}
              RETURNING run_id, template_id, status, survey_kind, is_test,
                        closes_at`,
        );

        return this.naarGestart({
          ...bijgewerkt.rows[0],
          template_naam: r.template_naam,
        });
      },
      'medewerker',
    );
  }

  /**
   * Nodigt leveranciers uit voor een ronde en geeft hun tokens terug.
   *
   * ── Alles in één transactie, en waarom dat hier telt ────────────────────────
   *
   * `withTenant()` draait de hele callback in één transactie. Faalt er één
   * invoeging, dan rolt alles terug — inclusief de al gegenereerde tokens, die
   * dan nergens meer bestaan.
   *
   * Dat is precies wat je wilt. Het alternatief — per leverancier los invoegen —
   * levert bij een fout halverwege een ronde op waarin sommige tokens wél in de
   * database staan maar de beheerder ze niet meer te zien krijgt. Die
   * leveranciers zouden dan een uitnodiging hebben die niemand kan versturen.
   *
   * ── Waarom een onbekende leverancier de hele oproep afwijst ─────────────────
   *
   * Besluit van de opdrachtgever (2026-07-29, plan §2c): een onbekend adres
   * wordt geweigerd en teruggemeld, niet stilzwijgend aangemaakt. Dat levert
   * binnen een jaar dubbele records op, en het leveranciersbestand is de lijst
   * waar de rapportage op leunt.
   *
   * Hier is het strikter dan alleen "niet aanmaken": één onbekende id wijst het
   * hele verzoek af. Een deelselectie uitnodigen zou de beheerder in de waan
   * laten dat iedereen een link heeft.
   */
  async uitnodigen(
    tenantId: string,
    runId: string,
    invoer: Uitnodigingen,
  ): Promise<UitnodigingResultaat> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        // Naast de status ook de namen ophalen die de uitnodigingsmail nodig
        // heeft. In dezelfde query en dus dezelfde transactie: een tweede
        // uitvraag achteraf kan een gewijzigde tenantnaam zien, en dan staat er
        // in de mail iets anders dan wat er op het scherm stond.
        const rondes = await tx.execute<{
          status: string;
          template_naam: string;
          tenant_naam: string;
        }>(
          sql`SELECT r.status, t.name AS template_naam, tn.name AS tenant_naam
                FROM clm.survey_run r
                JOIN clm.survey_template t ON t.template_id = r.template_id
                JOIN clm.tenant tn ON tn.tenant_id = r.tenant_id
               WHERE r.run_id = ${runId}`,
        );

        const ronde = rondes.rows[0];

        if (!ronde) {
          throw new NotFoundException('Deze ronde bestaat niet.');
        }

        // Uitnodigen mag in draft (nog samenstellen) en in active (er komt
        // iemand bij — besluit eigenaar 2026-08-04). Niet in finished of
        // archived: die zijn afgesloten, en een nieuwe link uitgeven zou de
        // rapportage over die ronde achteraf veranderen.
        if (ronde.status !== 'draft' && ronde.status !== 'active') {
          throw new ConflictException(
            `Deze ronde is ${ronde.status}. Er kunnen geen leveranciers meer bij.`,
          );
        }

        // Alle opgegeven leveranciers in één keer opzoeken. RLS filtert
        // vanzelf wat van een andere tenant is; die id's ontbreken dan
        // gewoon in het resultaat en worden hieronder gemeld als onbekend.
        // Het adres van de primaire contactpersoon komt hier meteen mee.
        //
        // DISTINCT ON met een expliciete volgorde: een leverancier kan meerdere
        // contactpersonen hebben, en zonder die volgorde is het willekeurig wie
        // de uitnodiging krijgt. `is_primary` eerst, daarna de oudste — dat is
        // voorspelbaar en herhaalbaar.
        //
        // LEFT JOIN, geen INNER: een leverancier zonder contactpersoon hoort
        // gewoon in de lijst te staan. Het token wordt aangemaakt en de link
        // werkt; alleen het versturen lukt niet, en dat meldt de verzender.
        const gevonden = await tx.execute<VendorRij>(
          sql`SELECT v.vendor_id, v.name, c.email AS contact_email
                FROM clm.vendor v
                LEFT JOIN LATERAL (
                       SELECT email
                         FROM clm.vendor_contact
                        WHERE vendor_id = v.vendor_id
                          AND deleted_at IS NULL
                          AND email IS NOT NULL
                        ORDER BY is_primary DESC, created_at ASC
                        LIMIT 1
                     ) c ON true
               WHERE v.vendor_id = ANY(${sql.param(invoer.vendorIds)}::uuid[])
                 AND v.deleted_at IS NULL`,
        );

        const perId = new Map(
          gevonden.rows.map((v) => [v.vendor_id.toLowerCase(), v]),
        );

        const onbekend = invoer.vendorIds.filter(
          (id) => !perId.has(id.toLowerCase()),
        );

        if (onbekend.length > 0) {
          throw new BadRequestException({
            message:
              onbekend.length === 1
                ? 'Eén van de gekozen leveranciers bestaat niet meer. Ververs de lijst en probeer opnieuw.'
                : `${onbekend.length} van de gekozen leveranciers bestaan niet meer. Ververs de lijst en probeer opnieuw.`,
            veld: 'vendorIds',
          });
        }

        // Wie al is uitgenodigd, overslaan in plaats van de hele oproep laten
        // stranden op de unieke index (run_id, vendor_id).
        //
        // Dat is een bewust verschil met de onbekende leverancier hierboven.
        // Daar wijst het op verouderde schermdata; hier op iemand die twee keer
        // aanvinkt, en dan is de bedoeling duidelijk: hij hoort erbij, en dat
        // is hij al.
        const bestaand = await tx.execute<{ vendor_id: string }>(
          sql`SELECT vendor_id FROM clm.survey_response
               WHERE run_id = ${runId}
                 AND vendor_id = ANY(${sql.param(invoer.vendorIds)}::uuid[])`,
        );

        const alUitgenodigd = new Set(
          bestaand.rows.map((r) => r.vendor_id.toLowerCase()),
        );

        const teDoen = invoer.vendorIds.filter(
          (id) => !alUitgenodigd.has(id.toLowerCase()),
        );

        if (teDoen.length === 0) {
          throw new ConflictException(
            'Deze leveranciers zijn al uitgenodigd voor deze ronde.',
          );
        }

        const verloopt = new Date(
          Date.now() + invoer.geldigheidDagen * 24 * 60 * 60 * 1000,
        );

        const uitnodigingen: Uitnodiging[] = [];

        for (const vendorId of teDoen) {
          const vendor = perId.get(vendorId.toLowerCase())!;

          // Hier gebeurt het. Eén token per deelnemer, uit randomBytes(32),
          // en alleen de hash gaat de database in.
          const token = genereerToken();

          const rij = await tx.execute<{ response_id: string }>(
            sql`INSERT INTO clm.survey_response
                    (tenant_id, run_id, vendor_id, subject_vendor_id,
                     token_hash, status, expires_at)
                VALUES (${tenantId}, ${runId}, ${vendorId}, ${vendorId},
                        ${hashToken(token)}, 'pending',
                        ${verloopt.toISOString()})
                RETURNING response_id`,
          );

          uitnodigingen.push({
            responseId: rij.rows[0].response_id,
            vendorId,
            vendorNaam: vendor.name,
            token,
            expiresAt: verloopt.toISOString(),
            contactEmail: vendor.contact_email ?? undefined,
          });
        }

        return {
          uitnodigingen,
          context: {
            tenantNaam: ronde.tenant_naam,
            vragenlijstNaam: ronde.template_naam,
          },
        };
      },
      'medewerker',
    );
  }

  private naarGestart(r: RunRij): RondeGestart {
    return {
      runId: r.run_id,
      templateId: r.template_id,
      templateNaam: r.template_naam,
      status: r.status,
      surveyKind: r.survey_kind,
      isTest: r.is_test,
      closesAt: iso(r.closes_at),
    };
  }
}
