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
  /**
   * De naam van de primaire contactpersoon, als die er is. Zelfde
   * optionaliteit als `contactEmail` — niet elke leverancier heeft een
   * contactpersoon. Toegevoegd voor de Excel-export (issue #222): een
   * leverancier zonder naam is in Outlook lastig te herkennen.
   */
  contactNaam?: string;
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
  /**
   * Waar een antwoord van de leverancier heen gaat (migratie 0025).
   *
   * Van de tenant, niet van het platform: alleen de opdrachtgever kan een vraag
   * over zijn eigen uitvraag beantwoorden. Ontbreekt hij, dan verwijst de
   * berichttekst naar de contactpersoon bij de tenant.
   */
  antwoordAan?: string;
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
  contractId: string | null;
}

interface RunRij extends Record<string, unknown> {
  run_id: string;
  template_id: string;
  template_naam: string;
  status: string;
  survey_kind: string;
  is_test: boolean;
  closes_at: Date | string | null;
  contract_id: string | null;
}

interface VendorRij extends Record<string, unknown> {
  vendor_id: string;
  name: string;
  /** `null` als de leverancier geen contactpersoon met e-mailadres heeft. */
  contact_email: string | null;
  /** `null` als de leverancier geen contactpersoon met e-mailadres heeft. */
  contact_naam: string | null;
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

        // Bestaat het contract, als er een is meegestuurd? RLS filtert
        // automatisch op tenant — een contract van een andere tenant levert
        // hier gewoon nul rijen op, niet een lek.
        if (invoer.contractId) {
          const contracten = await tx.execute<{ contract_id: string }>(
            sql`SELECT contract_id FROM clm.contract
               WHERE contract_id = ${invoer.contractId}
                 AND deleted_at IS NULL`,
          );

          if (contracten.rows.length === 0) {
            throw new NotFoundException('Dit contract bestaat niet.');
          }
        }

        const aangemaakt = await tx.execute<RunRij>(
          sql`INSERT INTO clm.survey_run
                  (tenant_id, template_id, survey_kind, status, closes_at,
                   is_test, contract_id)
              VALUES (${tenantId}, ${invoer.templateId}, ${invoer.surveyKind},
                      'draft', ${invoer.closesAt?.toISOString() ?? null},
                      ${invoer.isTest}, ${invoer.contractId})
              RETURNING run_id, template_id, status, survey_kind, is_test,
                        closes_at, contract_id`,
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
          contractId: r.contract_id,
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
                     r.status, r.survey_kind, r.is_test, r.closes_at,
                     r.contract_id
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
                        closes_at, contract_id`,
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
   * Archiveert een ronde in één actie, ongeacht de huidige status
   * (issue #205, 01-09).
   *
   * ── Waarom dit bestaat ───────────────────────────────────────────────────
   *
   * Vóór deze methode was er geen enkele manier om een ronde uit het
   * statusoverzicht (ContractmanagerService.haal(), zie het filter daar) te
   * krijgen zonder rechtstreeks in de database te schrijven. Aanleiding:
   * een token dat per ongeluk was aangemaakt maar nooit verstuurd, bleef
   * voor altijd als "opgestuurd, nog niet terug" in het overzicht staan.
   *
   * ── Waarom hier de tussenstappen automatisch doorlopen worden ───────────
   *
   * De bestaande overgangstabel staat alleen draft→active→finished→archived
   * toe — geen snelkoppeling. In plaats van dat aan de aanroeper (en dus de
   * UI) over te laten, doorloopt deze methode de tussenstappen zelf, binnen
   * dezelfde transactie: de aanroeper vraagt om één ding ("archiveer dit"),
   * niet om een reeks statuswaarden te kennen. `wijzigStatus()` blijft
   * bestaan voor de fijnmazige, bewuste overgangen (bv. active→finished
   * zonder meteen door te archiveren).
   */
  async archiveer(tenantId: string, runId: string): Promise<RondeGestart> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const huidige = await tx.execute<RunRij>(
          sql`SELECT r.run_id, r.template_id, t.name AS template_naam,
                     r.status, r.survey_kind, r.is_test, r.closes_at,
                     r.contract_id
                FROM clm.survey_run r
                JOIN clm.survey_template t ON t.template_id = r.template_id
               WHERE r.run_id = ${runId}`,
        );

        const r = huidige.rows[0];

        if (!r) {
          throw new NotFoundException('Deze ronde bestaat niet.');
        }

        if (r.status === 'archived') {
          // Twee keer archiveren is geen fout — zelfde redenering als
          // wijzigStatus() hierboven bij een status die al gold.
          return this.naarGestart(r);
        }

        const PAD_NAAR_ARCHIVED: Record<string, readonly string[]> = {
          draft: ['active', 'finished', 'archived'],
          active: ['finished', 'archived'],
          finished: ['archived'],
        };

        const stappen = PAD_NAAR_ARCHIVED[r.status];

        if (!stappen) {
          // Kan met de huidige OVERGANGEN-tabel niet voorkomen (alleen
          // 'archived' zelf heeft geen enkel pad, en die tak ving hierboven
          // al af) — maar geen aanname op een toekomstige nieuwe status.
          throw new ConflictException(
            `Deze ronde is ${r.status} en kan niet gearchiveerd worden.`,
          );
        }

        let huidigeStatus = r.status;
        for (const volgende of stappen) {
          if (!magOvergaan(huidigeStatus, volgende)) {
            throw new ConflictException(
              `Onverwachte overgang ${huidigeStatus} → ${volgende} tijdens archiveren.`,
            );
          }
          huidigeStatus = volgende;
        }

        const bijgewerkt = await tx.execute<RunRij>(
          sql`UPDATE clm.survey_run
                 SET status = 'archived'
               WHERE run_id = ${runId}
              RETURNING run_id, template_id, status, survey_kind, is_test,
                        closes_at, contract_id`,
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
   * Trekt de uitnodiging van één deelnemer in — een vergissing bij één
   * leverancier binnen een ronde, in tegenstelling tot `archiveer()` (de
   * hele ronde, bijvoorbeeld bij een periode-afsluiting).
   *
   * ── Waarom dit veld al bestond, alleen de schrijfkant niet ────────────────
   *
   * `survey_response.status` kent `'revoked'` al als toegestane waarde
   * (CHECK-constraint, migratie 0005) en het leverancierspad
   * (`survey-token.service.ts`) weigert al netjes een ingetrokken token —
   * maar er was nooit een route om die status vanaf de beheerkant te
   * ZETTEN. Deze methode is die ontbrekende schrijfkant, geen nieuw
   * concept.
   *
   * ── Waarom niet zomaar op elke status ──────────────────────────────────────
   *
   * Intrekken van een al ingediende respons zou bewijsmateriaal ongedaan
   * maken — dat hoort niet bij "ik heb me vergist bij het uitnodigen".
   * Alleen 'pending' mag naar 'revoked'; een 'submitted' of al 'revoked'
   * respons levert een 409 op, met de reden erbij.
   */
  async trekDeelnemerIn(
    tenantId: string,
    runId: string,
    responseId: string,
  ): Promise<{ responseId: string; status: string }> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const huidige = await tx.execute<{
          response_id: string;
          status: string;
        }>(
          sql`SELECT response_id, status FROM clm.survey_response
               WHERE response_id = ${responseId} AND run_id = ${runId}`,
        );

        const r = huidige.rows[0];

        if (!r) {
          throw new NotFoundException(
            'Deze deelnemer bestaat niet binnen deze ronde.',
          );
        }

        if (r.status === 'revoked') {
          // Twee keer intrekken is geen fout — zelfde redenering als
          // archiveer()/wijzigStatus() hierboven.
          return { responseId: r.response_id, status: r.status };
        }

        if (r.status !== 'pending') {
          throw new ConflictException(
            `Deze deelnemer is al ${r.status === 'submitted' ? 'ingediend' : r.status} en kan niet meer worden ingetrokken.`,
          );
        }

        const bijgewerkt = await tx.execute<{
          response_id: string;
          status: string;
        }>(
          sql`UPDATE clm.survey_response
                 SET status = 'revoked'
               WHERE response_id = ${responseId}
              RETURNING response_id, status`,
        );

        return {
          responseId: bijgewerkt.rows[0].response_id,
          status: bijgewerkt.rows[0].status,
        };
      },
      'medewerker',
    );
  }

  /**
   * Registreert dat een beheerder deze uitnodiging apart heeft verzonden,
   * buiten het ingebouwde mailkanaal om (bijv. via een extern mailproces
   * zoals Power Automate, na een Excel-export).
   *
   * ── Waarom dit een apart feit is, geen statusovergang ───────────────────────
   *
   * `survey_response.status` blijft 'pending' — er verandert niets aan de
   * tokengeldigheid of aan wat de leverancier kan doen. Dit legt alleen vast
   * wanneer een handeling BUITEN MCM2 heeft plaatsgevonden, zodat het
   * dashboard niet langer "opgestuurd" toont voor iets waarvan de eigenaar
   * weet dat de mail nog moet vertrekken (of juist al is vertrokken zonder
   * dat het ingebouwde mailkanaal het weet).
   *
   * ── Waarom geen validatie op de huidige status ──────────────────────────────
   *
   * In tegenstelling tot intrekken mag dit op elke respons die nog bestaat,
   * ook een 'submitted' of 'revoked' respons — de registratie beschrijft een
   * moment in het verleden ("ik heb dit toen verzonden"), niet een huidige
   * toestand. Een leverancier kan intussen al hebben ingediend terwijl de
   * beheerder deze registratie pas nu bijwerkt.
   *
   * ── Waarom eenmalig zetten volstaat (besluit eigenaar 2026-09-26) ───────────
   *
   * Geen aparte intrek-route: een tweede aanroep overschrijft de eerdere
   * datum. Dat is bewust minder streng dan `trekDeelnemerIn()` — een verkeerd
   * gezette datum is een correctie, geen bewijs dat ongedaan gemaakt wordt.
   */
  async registreerHandmatigeVerzending(
    tenantId: string,
    runId: string,
    responseId: string,
    verzondenOp: Date,
  ): Promise<{ responseId: string; handmatigVerzondenOp: string }> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const bijgewerkt = await tx.execute<{
          response_id: string;
          handmatig_verzonden_op: Date | string;
        }>(
          sql`UPDATE clm.survey_response
                 SET handmatig_verzonden_op = ${verzondenOp.toISOString()}
               WHERE response_id = ${responseId} AND run_id = ${runId}
              RETURNING response_id, handmatig_verzonden_op`,
        );

        if (bijgewerkt.rows.length === 0) {
          throw new NotFoundException(
            'Deze deelnemer bestaat niet binnen deze ronde.',
          );
        }

        return {
          responseId: bijgewerkt.rows[0].response_id,
          // iso(): zelfde normalisatie als elders in dit bestand (maakRonde,
          // wijzigStatus, archiveer) — de pg-driver geeft een timestamptz-
          // kolom terug als Date, niet als string.
          handmatigVerzondenOp: iso(bijgewerkt.rows[0].handmatig_verzonden_op)!,
        };
      },
      'medewerker',
    );
  }

  /**
   * Geeft een ingetrokken deelnemer een nieuw token binnen dezelfde ronde.
   *
   * ── Waarom UPDATE en geen nieuwe rij ─────────────────────────────────────────
   *
   * De unieke index `survey_response_run_vendor_key` staat maar één actieve
   * rij per (run_id, vendor_id) toe. Een 'revoked' rij telt daar ook in mee
   * — een tweede INSERT voor dezelfde combinatie zou op die index stuklopen.
   * In plaats daarvan hergebruikt dit de bestaande rij: nieuw token, status
   * terug naar 'pending', submitted_at blijft zoals het was (null, want een
   * ingetrokken respons was per definitie nog niet ingediend —
   * trekDeelnemerIn() staat dat niet toe op een 'submitted' respons).
   *
   * ── Waarom alleen vanuit 'revoked' ────────────────────────────────────────
   *
   * Een 'pending' respons heeft al een geldig token — heruitnodigen zou dat
   * zonder reden ongeldig maken terwijl de leverancier de oorspronkelijke
   * link misschien al heeft. Een 'submitted' respons opnieuw uitnodigen zou
   * een ingediend antwoord laten overschrijven; dat hoort net zo min hier als
   * bij trekDeelnemerIn().
   */
  async heruitnodigen(
    tenantId: string,
    runId: string,
    responseId: string,
    geldigheidDagen: number,
  ): Promise<{ responseId: string; vendorId: string; token: string; expiresAt: string }> {
    return this.db.withTenant(
      tenantId,
      async (tx) => {
        const huidige = await tx.execute<{
          response_id: string;
          vendor_id: string | null;
          status: string;
        }>(
          sql`SELECT response_id, vendor_id, status FROM clm.survey_response
               WHERE response_id = ${responseId} AND run_id = ${runId}`,
        );

        const r = huidige.rows[0];

        if (!r) {
          throw new NotFoundException(
            'Deze deelnemer bestaat niet binnen deze ronde.',
          );
        }

        if (r.status !== 'revoked') {
          throw new ConflictException(
            `Deze deelnemer heeft status '${r.status}' en kan alleen opnieuw uitgenodigd worden vanuit 'revoked'.`,
          );
        }

        // UC2 (colleague-filled, zie survey_response_run_vendor_key) kent
        // responses zonder vendor_id. trekDeelnemerIn() staat intrekken toe
        // op elke 'pending' respons, ongeacht vendor_id — een ingetrokken
        // UC2-respons zou hier dus een niet-bestaand vendorId opleveren.
        // Heruitnodigen is een UC1-concept (opnieuw een leveranciers-token
        // uitgeven); een UC2-respons hoort hier niet in terecht te komen.
        if (r.vendor_id === null) {
          throw new ConflictException(
            'Deze deelnemer heeft geen gekoppelde leverancier en kan niet via heruitnodigen opnieuw uitgenodigd worden.',
          );
        }

        const token = genereerToken();
        const verloopt = new Date(
          Date.now() + geldigheidDagen * 24 * 60 * 60 * 1000,
        );

        // AND status = 'revoked' sluit de race met een gelijktijdige tweede
        // aanroep: zonder deze voorwaarde zouden twee verzoeken de
        // statuscontrole hierboven allebei kunnen passeren (READ COMMITTED)
        // en allebei een eigen token minten, waarbij alleen het laatst
        // gecommitte token geldig blijft — stilzwijgend, zonder foutmelding
        // aan de tweede aanroeper.
        const bijgewerkt = await tx.execute<{
          response_id: string;
          vendor_id: string;
          expires_at: Date | string;
        }>(
          sql`UPDATE clm.survey_response
                 SET status = 'pending',
                     token_hash = ${hashToken(token)},
                     expires_at = ${verloopt.toISOString()},
                     handmatig_verzonden_op = NULL
               WHERE response_id = ${responseId} AND status = 'revoked'
              RETURNING response_id, vendor_id, expires_at`,
        );

        if (bijgewerkt.rows.length === 0) {
          throw new ConflictException(
            'Deze deelnemer is niet meer opnieuw uit te nodigen — status is intussen gewijzigd.',
          );
        }

        return {
          responseId: bijgewerkt.rows[0].response_id,
          vendorId: bijgewerkt.rows[0].vendor_id,
          token,
          expiresAt: iso(bijgewerkt.rows[0].expires_at)!,
        };
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
          antwoord_email: string | null;
        }>(
          sql`SELECT r.status, t.name AS template_naam, tn.name AS tenant_naam,
                     tn.antwoord_email
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
          sql`SELECT v.vendor_id, v.name, c.email AS contact_email,
                     c.full_name AS contact_naam
                FROM clm.vendor v
                LEFT JOIN LATERAL (
                       SELECT email, full_name
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
            contactNaam: vendor.contact_naam ?? undefined,
          });
        }

        return {
          uitnodigingen,
          context: {
            tenantNaam: ronde.tenant_naam,
            vragenlijstNaam: ronde.template_naam,
            // Zonder deze regel komt een antwoord van de leverancier bij het
            // platform terecht in plaats van bij de opdrachtgever. `undefined`
            // en niet `null`: de mailketen gebruikt de aanwezigheid van dit
            // veld om te kiezen tussen twee zinnen in de berichttekst.
            antwoordAan: ronde.antwoord_email ?? undefined,
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
      contractId: r.contract_id,
    };
  }
}
