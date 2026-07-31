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
  async aanmaken(externalSubject: string): Promise<NieuweSessie | null> {
    const token = genereerSessieToken();
    const hash = hashSessieToken(token);

    const resultaat = await this.db.db.execute<SessieRij>(
      sql`SELECT * FROM clm.sessie_aanmaken(${hash}, ${externalSubject}, ${GELDIGHEID_INTERVAL}::interval)`,
    );

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
