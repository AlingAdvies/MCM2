import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import {
  SESSIE_GELDIGHEID_UREN,
  genereerSessieToken,
  hashSessieToken,
  heeftGeldigeSessieVorm,
} from './sessie';

/**
 * De sessielaag: de enige route naar clm.sessie (Issue #7, spoor 1).
 *
 * De tabel is voor de runtime-rol volledig afgesloten (`REVOKE ALL`, migratie
 * 0010). Alle toegang loopt via drie SECURITY DEFINER-functies, en die worden
 * uitsluitend hier aangeroepen. Wie een vierde aanroep toevoegt buiten deze
 * klasse, omzeilt de enige plek waar het sessiemodel als geheel te overzien is.
 *
 * Let op de volgorde van vertrouwen: `sessie_aanmaken()` controleert zélf het
 * membership. Deze service kan dus geen sessie verzinnen voor een tenant waar
 * de gebruiker niet hoort, ook niet met een bug hierboven.
 */

/** Wat een geldige sessie oplevert. Dit is de tenantcontext. */
export interface SessieContext {
  readonly sessieId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly role: string;
}

/**
 * De claims die een eerste login mag gebruiken om zich te koppelen.
 *
 * Alleen bij de allereerste login van een uitgenodigde gebruiker; daarna doet
 * `external_subject` het werk. Zie migratie 0023 voor de vijf voorwaarden.
 */
export interface EersteLoginGegevens {
  readonly email?: string;
  readonly identityProvider?: string;
}

/** Wat een geslaagde login oplevert: de context plus het ruwe token. */
export interface NieuweSessie extends SessieContext {
  /**
   * Het ruwe token, uitsluitend om in het cookie te zetten. Bestaat alleen in
   * dit ene antwoord — daarna kent de server enkel nog de hash.
   */
  readonly token: string;
}

// De index-signatuur is een eis van Drizzle's execute<T>; de benoemde velden
// zijn wat de drie sessiefuncties teruggeven.
interface SessieRij extends Record<string, unknown> {
  sessie_id: string;
  user_id: string;
  tenant_id: string;
  role: string;
}

/** PostgreSQL-interval voor het glijdende venster. */
const GELDIGHEID_INTERVAL = `${SESSIE_GELDIGHEID_UREN} hours`;

@Injectable()
export class SessieService {
  private readonly logger = new Logger(SessieService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Maakt een sessie ná een geslaagde tokenverificatie.
   *
   * Geeft `null` wanneer de geverifieerde identiteit geen actief membership
   * heeft. Dat is geen fout maar een geldige uitkomst: iemand kan prima bij
   * Entra inloggen zonder in MCM2 bekend te zijn. Authenticatie is niet
   * hetzelfde als autorisatie.
   */
  async aanmaken(
    externalSubject: string,
    uitnodiging?: EersteLoginGegevens,
  ): Promise<NieuweSessie | null> {
    const token = genereerSessieToken();
    const hash = hashSessieToken(token);

    let resultaat = await this.db.db.execute<SessieRij>(
      sql`SELECT * FROM clm.sessie_aanmaken(${hash}, ${externalSubject}, ${GELDIGHEID_INTERVAL}::interval)`,
    );

    // Geen sessie kan twee dingen betekenen: deze persoon hoort er niet bij, óf
    // hij is uitgenodigd en logt voor het eerst in. Dat tweede geval krijgt één
    // kans om zichzelf te koppelen; daarna verloopt het als een gewone login.
    //
    // De volgorde is opzet: eerst de gewone weg proberen. Een bestaande
    // gebruiker raakt clm.koppel_eerste_login() daarmee nooit.
    if (resultaat.rows.length === 0 && uitnodiging?.email) {
      const gekoppeld = await this.db.db.execute<{ user_id: string }>(
        sql`SELECT * FROM clm.koppel_eerste_login(
              ${externalSubject}, ${uitnodiging.email},
              ${uitnodiging.identityProvider ?? null})`,
      );

      if (gekoppeld.rows.length > 0) {
        this.logger.log(
          'Eerste login van een uitgenodigde gebruiker — identiteit gekoppeld.',
        );

        resultaat = await this.db.db.execute<SessieRij>(
          sql`SELECT * FROM clm.sessie_aanmaken(${hash}, ${externalSubject}, ${GELDIGHEID_INTERVAL}::interval)`,
        );
      }
    }

    const rij = resultaat.rows[0];

    if (!rij) {
      // Geen membership. Bewust op warn-niveau: dit is het verschil tussen
      // "systeem kapot" en "deze persoon hoort er niet bij", en dat laatste is
      // precies wat je wilt zien wanneer iemand meldt dat inloggen niet lukt.
      // Het subject staat er niet bij: dat is een persoonsgegeven.
      this.logger.warn(
        'Geslaagde tokenverificatie zonder actief membership — geen sessie aangemaakt.',
      );
      return null;
    }

    return {
      token,
      sessieId: rij.sessie_id,
      userId: rij.user_id,
      tenantId: rij.tenant_id,
      role: rij.role,
    };
  }

  /**
   * Zoekt de sessie op bij het ruwe token uit het cookie en schuift in dezelfde
   * stap het venster op. Dit draait bij élk verzoek van een ingelogde
   * gebruiker.
   *
   * Geeft `null` bij alles wat niet klopt — onbekend, verlopen, verkeerde vorm.
   * Bewust geen onderscheid: de aanroeper heeft er niets aan en de gebruiker
   * ziet in alle drie de gevallen hetzelfde, namelijk het inlogscherm.
   */
  async oplossen(ruwToken: unknown): Promise<SessieContext | null> {
    // Vormcontrole vóór databasetoegang, net als bij het surveytoken.
    if (!heeftGeldigeSessieVorm(ruwToken)) {
      return null;
    }

    const hash = hashSessieToken(ruwToken);

    const resultaat = await this.db.db.execute<SessieRij>(
      sql`SELECT * FROM clm.sessie_oplossen(${hash}, ${GELDIGHEID_INTERVAL}::interval)`,
    );

    const rij = resultaat.rows[0];

    if (!rij) {
      return null;
    }

    return {
      sessieId: rij.sessie_id,
      userId: rij.user_id,
      tenantId: rij.tenant_id,
      role: rij.role,
    };
  }

  /**
   * De gegevens die een scherm nodig heeft om te tonen wie er is ingelogd.
   *
   * Apart van oplossen(): die draait bij élk verzoek en moet zo klein mogelijk
   * blijven. Dit is één extra query die alleen loopt wanneer een scherm er om
   * vraagt — de sidebar, één keer per paginalading.
   *
   * Gaat door withTenant(), dus RLS geldt: de query kan per constructie geen
   * gebruiker of tenant van iemand anders opleveren, ook niet bij een fout in
   * de WHERE-clausule.
   */
  async profiel(
    context: SessieContext,
  ): Promise<{ naam: string; tenantNaam: string } | null> {
    return this.db.withTenant(
      context.tenantId,
      async (tx) => {
        const resultaat = await tx.execute<{
          naam: string;
          tenant_naam: string;
        }>(
          sql`SELECT u.full_name AS naam, t.name AS tenant_naam
              FROM clm."user" u
              JOIN clm.tenant t ON t.tenant_id = u.tenant_id
             WHERE u.user_id = ${context.userId}
               AND u.deleted_at IS NULL`,
        );

        const rij = resultaat.rows[0];

        if (!rij) {
          return null;
        }

        return { naam: rij.naam, tenantNaam: rij.tenant_naam };
      },
      'medewerker',
    );
  }

  /**
   * Beëindigt de sessie. Verwijdert de rij en ruimt meteen verlopen sessies op.
   *
   * Werpt niet bij een onbekend token: uitloggen moet altijd slagen. Wie op
   * "uitloggen" drukt met een cookie dat al verlopen is, hoort geen foutmelding
   * te krijgen maar gewoon het inlogscherm.
   */
  async beeindigen(ruwToken: unknown): Promise<void> {
    if (!heeftGeldigeSessieVorm(ruwToken)) {
      return;
    }

    const hash = hashSessieToken(ruwToken);

    await this.db.db.execute(sql`SELECT clm.sessie_beeindigen(${hash})`);
  }
}
