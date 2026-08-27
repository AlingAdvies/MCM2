import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import {
  SESSIE_GELDIGHEID_UREN,
  genereerSessieToken,
  hashSessieToken,
  heeftGeldigeSessieVorm,
} from './sessie';
import {
  hashUitnodigingstoken,
  heeftGeldigeVorm as heeftGeldigeUitnodigingsVorm,
} from './uitnodigingstoken';

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
 * Wat een eerste login mag gebruiken om zich te koppelen.
 *
 * Alleen bij de allereerste login van een uitgenodigde gebruiker; daarna doet
 * `external_subject` het werk. Zie migratie 0024 voor de voorwaarden.
 *
 * Twee gegevens langs twee wegen: het e-mailadres uit het geverifieerde
 * ID-token, het token uit de uitnodigingslink. Beide moeten kloppen.
 */
export interface EersteLoginGegevens {
  readonly email?: string;
  /** Het ruwe token uit de link; de hash gaat naar de database. */
  readonly uitnodigingstoken?: string;
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
    //
    // De vormcontrole staat er vóór de query: een token uit een cookie dat door
    // iets anders gevuld is hoort af te ketsen op zijn vorm, niet op een
    // databaseaanroep.
    // Issue #133: iemand die al binnen is, klikt op een uitnodiging.
    //
    // Dan slaagt sessie_aanmaken() en komt de koppeling er niet eens aan te
    // pas. Hij logt gewoon in, en de uitgenodigde rij blijft wachten op een
    // login die nooit komt — twee rijen voor één persoon, precies wat er op
    // acceptatie stond. Niemand merkt er iets van.
    //
    // Koppelen is hier geen optie: de oid zit al aan een andere rij vast, en
    // migratie 0024 weigert dat terecht (dat zou accountovername zijn). Het
    // samenvoegen van twee gebruikersrijen raakt beoordelingen, notities en de
    // audit trail, en hoort dus een bewuste beheerhandeling te zijn — geen
    // bijverschijnsel van een klik op een link.
    //
    // Wat hier wél moet: het zichtbaar maken, zodat de platformbeheerder de
    // openstaande uitnodiging kan intrekken in plaats van hem te laten staan.
    if (
      resultaat.rows.length > 0 &&
      uitnodiging?.email &&
      heeftGeldigeUitnodigingsVorm(uitnodiging.uitnodigingstoken)
    ) {
      this.logger.warn(
        'Uitnodigingstoken aangeboden door iemand die al een account heeft. ' +
          'De uitnodiging blijft openstaan en er is niets gekoppeld; deze ' +
          'persoon logt in als zijn bestaande gebruiker. Trek de openstaande ' +
          'uitnodiging in of voeg de gebruikers samen.',
      );
    }

    if (
      resultaat.rows.length === 0 &&
      uitnodiging?.email &&
      heeftGeldigeUitnodigingsVorm(uitnodiging.uitnodigingstoken)
    ) {
      const gekoppeld = await this.db.db.execute<{ user_id: string }>(
        sql`SELECT * FROM clm.koppel_eerste_login(
              ${externalSubject}, ${uitnodiging.email},
              ${hashUitnodigingstoken(uitnodiging.uitnodigingstoken)})`,
      );

      if (gekoppeld.rows.length > 0) {
        this.logger.log(
          'Eerste login van een uitgenodigde gebruiker — identiteit gekoppeld.',
        );

        resultaat = await this.db.db.execute<SessieRij>(
          sql`SELECT * FROM clm.sessie_aanmaken(${hash}, ${externalSubject}, ${GELDIGHEID_INTERVAL}::interval)`,
        );
      } else {
        // Issue #133: hier gebeurde niets, en dat was niet te zien.
        //
        // De functie geeft bewust geen reden terug — die zou verklappen welke
        // uitnodiging bestaat (migratie 0024). Maar dat er een koppeling is
        // geprobeerd én mislukt, mag wél in het log: dat is de enige plek waar
        // een beheerder "ik klik op de link en er gebeurt niets" kan verbinden
        // aan een oorzaak. Zonder deze regel is een verlopen token niet te
        // onderscheiden van een verkeerd adres of van een oid die al bestaat.
        this.logger.warn(
          'Uitnodigingstoken aangeboden, maar de koppeling is niet gelukt. ' +
            'Mogelijke oorzaken: de uitnodiging is verlopen of al gebruikt, ' +
            'het e-mailadres wijkt af, of dit account is al aan een andere ' +
            'gebruiker gekoppeld. Zie clm.koppel_eerste_login (migratie 0024).',
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
   * ── Waarom de naam niet meer via een JOIN op clm.tenant komt ────────────
   *
   * `clm."user"` is aan precies één tenant gebonden (RLS: tenant_id =
   * current_tenant_id()). Bij een support-sessie (platformbeheer-
   * uitbreiding, migratie 0033) is `context.tenantId` de tenant waar
   * iemand te gast is — en daar heeft hij geen eigen `user`-rij, alleen een
   * `tenant_membership`-rij met `role = 'support'`. Een JOIN vond dan
   * niets: `profiel()` gaf `null` en de gebruiker kreeg 401 "De gebruiker
   * bestaat niet meer" bij een geldige sessie. Gemeten via de eerste échte
   * end-to-end support-sessietest (platform-uitbreiding.e2e-spec.ts).
   *
   * `clm.gebruikersnaam()` (SECURITY DEFINER, 0033) haalt de naam los van
   * de tenantcontext op. De tenantnaam blijft wél via `withTenant()` +
   * `clm.tenant` — dat werkt al voor een support-sessie, want de tenant
   * zelf bestáát daar, alleen de gebruiker niet als eigen rij.
   */
  async profiel(
    context: SessieContext,
  ): Promise<{ naam: string; tenantNaam: string } | null> {
    const naamResultaat = await this.db.db.execute<{
      gebruikersnaam: string | null;
    }>(sql`SELECT clm.gebruikersnaam(${context.userId})`);

    const naam = naamResultaat.rows[0]?.gebruikersnaam;

    if (!naam) {
      return null;
    }

    return this.db.withTenant(
      context.tenantId,
      async (tx) => {
        const resultaat = await tx.execute<{ tenant_naam: string }>(
          sql`SELECT t.name AS tenant_naam
                FROM clm.tenant t
               WHERE t.tenant_id = ${context.tenantId}`,
        );

        const rij = resultaat.rows[0];

        if (!rij) {
          return null;
        }

        return { naam, tenantNaam: rij.tenant_naam };
      },
      'medewerker',
    );
  }

  /**
   * Wisselt vanuit een bestaande geldige sessie naar een tweede sessie voor
   * een andere tenant — geen Entra-login nodig (platformbeheer-uitbreiding,
   * spec §5a/§5b).
   *
   * Geeft `null` als het huidige token ongeldig is, of als er geen geldig
   * membership op de doeltenant staat. Beide gevallen krijgen dezelfde
   * uitkomst — de aanroeper heeft aan het onderscheid niets, en het
   * verklapt geen informatie over wélke tenants bestaan.
   */
  async wisselen(
    huidigRuwToken: unknown,
    doelTenantId: string,
  ): Promise<NieuweSessie | null> {
    if (!heeftGeldigeSessieVorm(huidigRuwToken)) {
      return null;
    }

    const huidigeHash = hashSessieToken(huidigRuwToken);
    const nieuwToken = genereerSessieToken();
    const nieuweHash = hashSessieToken(nieuwToken);

    const resultaat = await this.db.db.execute<SessieRij>(
      sql`SELECT * FROM clm.sessie_wisselen(
            ${huidigeHash}, ${doelTenantId}, ${nieuweHash},
            ${GELDIGHEID_INTERVAL}::interval)`,
    );

    const rij = resultaat.rows[0];

    if (!rij) {
      return null;
    }

    return {
      token: nieuwToken,
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
