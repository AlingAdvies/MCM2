import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import { hashToken, heeftGeldigeVorm } from './survey-token';

/** Waarom een token geweigerd is. Bepaalt de HTTP-status en de melding. */
export type WeigerReden =
  | 'onbekend'
  | 'ingetrokken'
  | 'al-ingediend'
  | 'verlopen'
  | 'ronde-gesloten'
  | 'vendor-inactief';

export interface TokenGeldig {
  geldig: true;
  responseId: string;
  tenantId: string;
  expiresAt: Date;
}

export interface TokenOngeldig {
  geldig: false;
  reden: WeigerReden;
  /** Alleen gevuld waar de leverancier er een legitiem belang bij heeft. */
  datum?: Date;
}

export type TokenUitkomst = TokenGeldig | TokenOngeldig;

// De index-signatuur is een eis van Drizzle's execute<T>; de benoemde velden
// zijn wat clm.resolve_survey_token() daadwerkelijk teruggeeft.
//
// Tijdstippen komen bij ruwe SQL als string terug, niet als Date: de
// typeconversie van de driver werkt op kolommen van een bekende tabel, niet op
// de uitvoer van een functie. Vandaar `Date | string` plus alsDatum().
interface LookupRij extends Record<string, unknown> {
  response_id: string;
  tenant_id: string;
  status: string;
  expires_at: Date | string;
  submitted_at: Date | string | null;
  vendor_active: boolean;
  run_closed: boolean;
}

function alsDatum(waarde: Date | string | null): Date | null {
  if (waarde === null) return null;
  return waarde instanceof Date ? waarde : new Date(waarde);
}

/**
 * Bepaalt of een leverancierstoken toegang geeft, en tot welke tenant.
 *
 * Kernregel uit het ontwerp (§2): de tenantcontext wordt uitsluitend afgeleid
 * uit een databaselookup op de gehashte token. Nooit uit de URL, een header of
 * enig ander veld dat de client stuurt — dat is exact het patroon dat
 * MCM2-CLAUDE.md §6 verbiedt en de kern van Issue #7.
 *
 * De leverancier stuurt één ding: het ruwe token. Er bestaat geen veld waarin
 * een andere tenant benoemd zou kunnen worden.
 */
@Injectable()
export class SurveyTokenService {
  private readonly logger = new Logger(SurveyTokenService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Zoekt het token op en toetst de geldigheid.
   *
   * Volgorde is bewust: vormcontrole vóór databasetoegang, en pas daarna de
   * inhoudelijke controles. Zie ontwerp §5 en §5a.
   */
  async controleer(ruwToken: unknown): Promise<TokenUitkomst> {
    // Stap 1-2: vorm valideren zonder de database te raken.
    if (!heeftGeldigeVorm(ruwToken)) {
      return { geldig: false, reden: 'onbekend' };
    }

    // Stap 3-4: hashen en opzoeken. De functie draait SECURITY DEFINER en is
    // daarmee de enige route naar deze rij zonder tenantcontext.
    const hash = hashToken(ruwToken);

    const resultaat = await this.db.db.execute<LookupRij>(
      sql`SELECT * FROM clm.resolve_survey_token(${hash})`,
    );

    const rij = resultaat.rows[0];

    // Stap 5-6: onbekend en ingetrokken geven allebei dezelfde uitkomst. Een
    // ingetrokken token mag niet te onderscheiden zijn van een niet-bestaand
    // token, anders wordt de foutmelding zelf informatie.
    if (!rij) {
      return { geldig: false, reden: 'onbekend' };
    }

    if (rij.status === 'revoked') {
      return { geldig: false, reden: 'ingetrokken' };
    }

    // Stap 7-8: verlopen en al ingediend krijgen wél een eigen melding. De
    // leverancier ontving de link zelf, dus er valt niets te verbergen dat hij
    // niet al weet — en hij heeft er belang bij te begrijpen waarom hij niet
    // meer werkt.
    if (rij.status === 'submitted') {
      return {
        geldig: false,
        reden: 'al-ingediend',
        datum: alsDatum(rij.submitted_at) ?? undefined,
      };
    }

    const vervalt = alsDatum(rij.expires_at);

    if (!vervalt || vervalt.getTime() <= Date.now()) {
      return {
        geldig: false,
        reden: 'verlopen',
        datum: vervalt ?? undefined,
      };
    }

    // Stap 8b-8c uit ontwerp §5a: het token kan geldig zijn terwijl de
    // gegevens waar het naar verwijst zijn verdwenen of gesloten. Zonder deze
    // twee controles is dat een stille fout — een lege pagina in plaats van
    // een duidelijk eindpunt.
    if (rij.run_closed) {
      return { geldig: false, reden: 'ronde-gesloten' };
    }

    if (!rij.vendor_active) {
      return { geldig: false, reden: 'vendor-inactief' };
    }

    return {
      geldig: true,
      responseId: rij.response_id,
      tenantId: rij.tenant_id,
      expiresAt: vervalt,
    };
  }

  /**
   * Dient een response definitief in.
   *
   * De volgorde is niet vrijblijvend. Dit zou fout zijn:
   *
   *   lees status → is 'pending'? → sla op → zet op 'submitted'
   *
   * Tussen lezen en schrijven kan een tweede verzoek binnenkomen — een
   * dubbelklik volstaat. Beide zien 'pending', beide dienen in. Daarom één
   * atomair statement dat de status als voorwaarde meeneemt: de database
   * beslist wie wint, niet de volgorde waarin verzoeken toevallig aankomen.
   *
   * Geen rij terug betekent: iemand was eerder, of hij is inmiddels verlopen.
   */
  async dienIn(tenantId: string, responseId: string): Promise<boolean> {
    return this.db.withTenant(tenantId, async (tx) => {
      const resultaat = await tx.execute<{ response_id: string }>(
        sql`UPDATE clm.survey_response
               SET status = 'submitted', submitted_at = now()
             WHERE response_id = ${responseId}
               AND status = 'pending'
               AND expires_at > now()
         RETURNING response_id`,
      );

      const gelukt = resultaat.rows.length === 1;

      if (!gelukt) {
        // Geen fout: dit is het verwachte gedrag bij een tweede poging.
        this.logger.warn(
          `Indienen geweigerd voor response ${responseId}: al ingediend of verlopen.`,
        );
      }

      return gelukt;
    });
  }
}
