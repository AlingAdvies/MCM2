import { ConflictException, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import {
  genereerUitnodigingstoken,
  hashUitnodigingstoken,
} from '../auth/uitnodigingstoken';
import { DatabaseService } from '../db/database.service';

/** Hoe lang support-toegang standaard geldig is. */
export const SUPPORT_TOEGANG_UREN = 8;

/**
 * Hoe lang een uitnodiging voor een eerste admin geldig blijft.
 *
 * Negentig dagen: ruim genoeg voor een klant die een paar weken nodig heeft om
 * te beginnen, kort genoeg om niet jaren een koppelbare rij te laten staan.
 * Verloopt hij, dan moet de platformbeheerder opnieuw uitnodigen — een
 * zichtbare handeling in plaats van een deur die open blijft.
 */
export const UITNODIGING_GELDIG_DAGEN = 90;

export interface NieuweTenant {
  readonly naam: string;
  /** Wordt de eerste admin. Zijn oid volgt bij de eerste login. */
  readonly adminEmail: string;
  readonly adminNaam: string;
  /**
   * Waar een antwoord van een leverancier heen gaat (migratie 0025).
   *
   * Optioneel: niet elke klant heeft een gedeeld postvak. Blijft hij leeg, dan
   * verwijst de uitnodigingsmail naar de contactpersoon bij de tenant in plaats
   * van naar een adres.
   */
  readonly antwoordEmail?: string;
}

export interface TenantOverzicht {
  readonly tenantId: string;
  readonly naam: string;
  readonly aangemaaktOp: Date;
  readonly aantalLeden: number;
}

/**
 * Eén regel uit de tenantlijst (ADR-017).
 *
 * Bewust géén `aantalLeden`, anders dan `TenantOverzicht` hierboven. Dat getal
 * komt uit `clm.tenant_membership`, en die staat achter RLS — per tenant
 * opvraagbaar, niet over tenants heen. Het hier alsnog willen tonen zou een
 * tweede leesweg buiten de tenantgrens vragen, en dat is precies wat ADR-015
 * uitsluit.
 *
 * Wie meer wil weten over één tenant gebruikt `GET /platform/tenants/:id`, en
 * wie in de gegevens moet zijn vraagt support-toegang aan. Deze lijst is de
 * telefoonlijst, niet het dossier.
 */
export interface TenantRegel {
  readonly tenantId: string;
  readonly naam: string;
  readonly aangemaaktOp: Date;
}

/**
 * Wat het aanmaken oplevert: de tenant plus de uitnodiging voor zijn eerste
 * beheerder.
 *
 * Het ruwe token staat hier één keer in en is daarna nergens meer op te vragen
 * — de database kent alleen de hash. Raakt het kwijt, dan is opnieuw uitnodigen
 * de weg, en dat is met opzet: een token dat je kunt navragen is een token dat
 * een ander kan navragen.
 */
export interface NieuweTenantMetUitnodiging extends TenantOverzicht {
  readonly uitnodigingstoken: string;
  readonly uitnodigingVerlooptOp: Date;
}

export interface SupportToegang {
  readonly tenantId: string;
  readonly verlooptOp: Date;
  readonly reden: string;
}

/**
 * Platformbeheer: tenants aanmaken en tijdelijke support-toegang toekennen
 * (ADR-015, migratie 0020).
 *
 * ── Waarom hier withTenant() met de dóél-tenant staat ────────────────────────
 *
 * Elke schrijfactie loopt via de tenantcontext van de tenant waar hij landt,
 * niet die van de aanroeper. Dat is geen omweg maar de kern: ook een
 * platformbeheerder schrijft binnen RLS, en een fout in deze service kan
 * daardoor geen rijen in een andere tenant raken.
 *
 * De tenant komt hier wél uit de invoer, en dat is de enige plek in de
 * applicatie waar dat mag — bewaakt door PlatformAdminGuard. Voor alle andere
 * routes geldt onverkort dat de tenant uit de sessie komt (§6).
 */
/**
 * De twee indexen die een dubbele tenantnaam tegenhouden.
 *
 * `tenant_name_key` (baseline) bewaakt de exacte schrijfwijze,
 * `tenant_name_ongeacht_hoofdletters` (0021) vangt wat die doorlaat.
 */
const NAAM_CONSTRAINTS = new Set([
  'tenant_name_key',
  'tenant_name_ongeacht_hoofdletters',
]);

/**
 * Herkent een dubbele tenantnaam.
 *
 * Drizzle verpakt de pg-fout in een DrizzleQueryError; de PostgreSQL-code
 * (23505) en de constraintnaam staan in `cause`. Op de constraintnaam toetsen
 * en niet alleen op 23505: een andere unieke index zou anders óók als
 * "naam bestaat al" naar buiten komen, en dat is een misleidende melding.
 */
function isUniekeNaamFout(fout: unknown): boolean {
  const oorzaak = (fout as { cause?: unknown })?.cause ?? fout;
  const details = oorzaak as { code?: string; constraint?: string };

  return (
    details?.code === '23505' &&
    typeof details?.constraint === 'string' &&
    NAAM_CONSTRAINTS.has(details.constraint)
  );
}

@Injectable()
export class PlatformService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Maakt een tenant met zijn eerste beheerder, en geeft de uitnodiging uit.
   *
   * De gebruikersrij krijgt géén `external_subject`: die is pas bekend als de
   * persoon voor het eerst inlogt bij Entra. De partiële unieke index op die
   * kolom (migratie 0009, `WHERE external_subject IS NOT NULL`) staat dat
   * uitdrukkelijk toe — precies met deze situatie in gedachten.
   *
   * Wat de rij wél krijgt is de hash van een uitnodigingstoken. Dat token is
   * het bewijs dat deze toegang is toegekend, en zonder dat bewijs koppelt
   * `clm.koppel_eerste_login()` niets (migratie 0024).
   */
  async tenantAanmaken(
    invoer: NieuweTenant,
  ): Promise<NieuweTenantMetUitnodiging> {
    const tenantId = crypto.randomUUID();

    // Het ruwe token blijft hier, in het geheugen van deze aanroep; alleen de
    // hash gaat de transactie in. Daarmee is er geen pad waarlangs het token
    // alsnog in de database, een log of een queryplan belandt.
    const token = genereerUitnodigingstoken();
    const tokenHash = hashUitnodigingstoken(token);

    return this.db.withTenant(tenantId, async (tx) => {
      // ── Waarom hier geen "bestaat de naam al?"-query staat ─────────────────
      //
      // Die zou niets vinden. We draaien in de tenantcontext van de nieuwe,
      // nog niet bestaande tenant, en RLS verbergt elke andere tenant — een
      // SELECT levert dus altijd nul rijen op, hoeveel gelijknamige tenants er
      // ook zijn.
      //
      // De unieke index `tenant_name_key` (baseline 0000) doet het werk wel,
      // want een constraint kent geen RLS. Vandaar: proberen, en de fout
      // vertalen naar iets wat het scherm kan tonen.
      try {
        await tx.execute(
          sql`INSERT INTO clm.tenant (tenant_id, name, antwoord_email)
              VALUES (${tenantId}, ${invoer.naam},
                      ${invoer.antwoordEmail ?? null})`,
        );
      } catch (fout) {
        if (isUniekeNaamFout(fout)) {
          throw new ConflictException(
            `Er bestaat al een tenant met de naam '${invoer.naam}'.`,
          );
        }
        throw fout;
      }

      // Hash en vervaldatum samen maken dit een uitnodiging: bij zijn eerste
      // Entra-login koppelt clm.koppel_eerste_login() de oid aan deze rij op
      // vertoon van het token (migratie 0024). Ontbreekt een van beide, dan is
      // de rij niet koppelbaar — NULL is daar de veilige stand.
      // koppelbaar_tot komt als string terug, niet als Date: drizzle's
      // execute() geeft de ruwe pg-waarden door zonder de kolomtypen om te
      // zetten. Het type hier eerlijk houden en één keer converteren is beter
      // dan een Date beloven die er niet is — dat leverde een 500 op
      // (`toISOString is not a function`), pas zichtbaar in de e2e-run.
      const gebruiker = await tx.execute<{
        user_id: string;
        koppelbaar_tot: string;
      }>(
        sql`INSERT INTO clm."user"
              (tenant_id, full_name, email, uitnodiging_hash, koppelbaar_tot)
            VALUES (${tenantId}, ${invoer.adminNaam}, ${invoer.adminEmail},
                    ${tokenHash},
                    now() + ${`${UITNODIGING_GELDIG_DAGEN} days`}::interval)
            RETURNING user_id, koppelbaar_tot`,
      );

      const userId = gebruiker.rows[0].user_id;

      await tx.execute(
        sql`INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
            VALUES (${userId}, ${tenantId}, 'admin')`,
      );

      await tx.execute(
        sql`INSERT INTO audit.audit_event
              (tenant_id, action_type, entity_type, entity_id, new_values)
            VALUES (${tenantId}, 'tenant_aangemaakt', 'tenant', ${tenantId},
                    ${JSON.stringify({
                      naam: invoer.naam,
                      eersteAdmin: invoer.adminEmail,
                    })}::jsonb)`,
      );

      const rij = await tx.execute<{ created_at: string }>(
        sql`SELECT created_at FROM clm.tenant WHERE tenant_id = ${tenantId}`,
      );

      return {
        tenantId,
        naam: invoer.naam,
        aangemaaktOp: new Date(rij.rows[0].created_at),
        aantalLeden: 1,
        uitnodigingstoken: token,
        uitnodigingVerlooptOp: new Date(gebruiker.rows[0].koppelbaar_tot),
      };
    });
  }

  /**
   * Kent de platformbeheerder tijdelijke support-toegang toe tot één tenant.
   *
   * Geen impersonatie: hij komt binnen als zichzelf, in de rol `support`, en
   * blijft daarmee in elk spoor te onderscheiden van een medewerker van de
   * klant. Dat is de eis uit Issue #57 en de reden dat 'support' bestaat.
   */
  async supportToegangGeven(
    tenantId: string,
    beheerderUserId: string,
    reden: string,
  ): Promise<SupportToegang> {
    return this.db.withTenant(tenantId, async (tx) => {
      // Een bestaande support-rij wordt vervangen, niet gedupliceerd: de
      // primaire sleutel is (user_id, tenant_id). Verlengen is hetzelfde als
      // opnieuw toekennen, met een nieuwe reden en een nieuwe einddatum.
      const rij = await tx.execute<{ verloopt_op: string }>(
        sql`INSERT INTO clm.tenant_membership
              (user_id, tenant_id, role, verloopt_op, reden, toegekend_door)
            VALUES (${beheerderUserId}, ${tenantId}, 'support',
                    now() + ${`${SUPPORT_TOEGANG_UREN} hours`}::interval,
                    ${reden}, ${beheerderUserId})
            ON CONFLICT (user_id, tenant_id) DO UPDATE
              SET role = 'support',
                  verloopt_op = now() + ${`${SUPPORT_TOEGANG_UREN} hours`}::interval,
                  reden = ${reden},
                  deleted_at = NULL
            RETURNING verloopt_op`,
      );

      await tx.execute(
        sql`INSERT INTO audit.audit_event
              (tenant_id, action_type, entity_type, entity_id, new_values)
            VALUES (${tenantId}, 'support_toegang_toegekend', 'tenant_membership',
                    ${tenantId},
                    ${JSON.stringify({
                      beheerder: beheerderUserId,
                      reden,
                      urenGeldig: SUPPORT_TOEGANG_UREN,
                    })}::jsonb)`,
      );

      return {
        tenantId,
        verlooptOp: new Date(rij.rows[0].verloopt_op),
        reden,
      };
    });
  }

  /**
   * Welke tenants er bestaan (ADR-017).
   *
   * ── Waarom dit uit een apart register komt ────────────────────────────────
   *
   * `clm.tenant` heeft RLS met FORCE en `clm_api_runtime` heeft geen
   * BYPASSRLS. Een `SELECT * FROM clm.tenant` levert daarom nul rijen op —
   * ook voor een platformbeheerder. Dat is geen tekortkoming maar het ontwerp:
   * de tenantgrens geldt voor iedereen.
   *
   * Op 2026-08-13 bleek wat dat kost: `POST /platform/tenants` meldde 409
   * "bestaat al" terwijl een telling nul gaf. Nul rijen betekende "je mag
   * niets zien", niet "er staat niets" — dezelfde meetfout die op 2026-08-10
   * tot dataverlies leidde.
   *
   * `clm.tenant_register` staat buiten RLS en bevat uitsluitend id, naam en
   * aanmaakdatum. Een trigger houdt hem gelijk aan `clm.tenant`.
   *
   * ── Waarom dit tóch via withTenant() loopt ────────────────────────────────
   *
   * Het register kent geen RLS, dus de tenantcontext doet er niets. Toch gaat
   * de query er doorheen, om dezelfde reden als in PlatformAdminGuard:
   * DatabaseService is de enige weg naar de database (ADR-008). Een tweede,
   * contextloze weg openen zou de uitzondering zijn waarvan dat ontwerp juist
   * afziet.
   *
   * Gemeten op een wegwerpdatabase: met de tenantcontext op één tenant levert
   * deze query alle registerrijen op. De tenant van de sessie is hier dus
   * betekenisloos, precies zoals in de guard.
   */
  async tenantsLijst(sessieTenantId: string): Promise<TenantRegel[]> {
    return this.db.withTenant(sessieTenantId, async (tx) => {
      const { rows } = await tx.execute<{
        register_id: string;
        name: string;
        aangemaakt_op: string;
      }>(
        sql`SELECT register_id, name, aangemaakt_op
              FROM clm.tenant_register
             ORDER BY name`,
      );

      return rows.map((rij) => ({
        tenantId: rij.register_id,
        naam: rij.name,
        aangemaaktOp: new Date(rij.aangemaakt_op),
      }));
    });
  }

  /**
   * Eén tenant, met het aantal leden erbij.
   *
   * Anders dan `tenantsLijst()` leest deze wél uit `clm.tenant` zelf, binnen de
   * tenantcontext van die ene tenant. Dat kan hier omdat de id bekend is — en
   * dat is precies wat het register mogelijk maakt.
   */
  async tenantLezen(tenantId: string): Promise<TenantOverzicht | null> {
    return this.db.withTenant(tenantId, async (tx) => {
      const { rows } = await tx.execute<{
        tenant_id: string;
        name: string;
        created_at: string;
        leden: string;
      }>(
        sql`SELECT t.tenant_id, t.name, t.created_at,
                   (SELECT count(*) FROM clm.tenant_membership m
                     WHERE m.tenant_id = t.tenant_id AND m.deleted_at IS NULL) AS leden
              FROM clm.tenant t
             WHERE t.tenant_id = ${tenantId}`,
      );

      if (rows.length === 0) {
        return null;
      }

      return {
        tenantId: rows[0].tenant_id,
        naam: rows[0].name,
        aangemaaktOp: new Date(rows[0].created_at),
        aantalLeden: Number(rows[0].leden),
      };
    });
  }
}
