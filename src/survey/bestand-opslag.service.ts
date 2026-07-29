import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

/**
 * Bewaart geüploade bestanden op schijf (vragenlijst-ontwerp §6).
 *
 * Fase 1 van het ontwerp: onder een pad dat niet publiek bereikbaar is, met
 * `storage_key` als relatief pad. Er is geen URL die een bestand rechtstreeks
 * serveert — downloaden loopt altijd via een route die de tokencontrole of de
 * beheerdersauthenticatie passeert.
 *
 * Objectopslag (S3, Supabase Storage) is de logische volgende stap, maar voegt
 * in de pilot een externe afhankelijkheid toe zonder een probleem op te lossen
 * dat we nu hebben. `storage_key` is zo gekozen dat die verhuizing geen
 * schemawijziging vereist: alleen deze service wordt dan vervangen.
 *
 * **Let op — dit raakt Issue #30.** De database gaat mee in
 * `npm run backup:dump`; bestanden op schijf niet. Zonder aanvulling zijn de
 * certificaten het enige onderdeel zonder backup, en juist het onderdeel dat
 * bewijsmateriaal bevat.
 */
@Injectable()
export class BestandOpslagService {
  private readonly logger = new Logger(BestandOpslagService.name);
  private readonly hoofdmap: string;

  constructor() {
    // Default binnen de projectmap, zodat een ontwikkelaar niets hoeft in te
    // stellen. In een container hoort dit een volume te zijn — anders zijn de
    // bestanden weg zodra het image vervangen wordt.
    this.hoofdmap = resolve(process.env.UPLOAD_DIR ?? './var/uploads');
  }

  /**
   * Schrijft een bestand weg onder de opgegeven sleutel.
   *
   * De sleutel komt uit `maakOpslagsleutel()` en bevat geen enkel teken uit de
   * invoer. Toch wordt hier nóg een keer gecontroleerd dat het uiteindelijke
   * pad binnen de hoofdmap valt: dit is de laatste plek waar een padfout tot
   * schrijven buiten de map zou leiden, en zo'n controle hoort te staan waar de
   * schade zou ontstaan — niet alleen waar de waarde gemaakt wordt.
   */
  async bewaar(storageKey: string, inhoud: Buffer): Promise<void> {
    const pad = this.volledigPad(storageKey);

    await mkdir(dirname(pad), { recursive: true });
    await writeFile(pad, inhoud, { flag: 'wx' });

    this.logger.log(`Bestand opgeslagen (${inhoud.length} bytes).`);
  }

  async lees(storageKey: string): Promise<Buffer> {
    return readFile(this.volledigPad(storageKey));
  }

  /**
   * Verwijdert een bestand.
   *
   * Stil bij een ontbrekend bestand: deze methode wordt aangeroepen om op te
   * ruimen nadat een databaseschrijfactie is teruggedraaid, en dan is "het
   * bestand staat er niet" precies de gewenste eindtoestand.
   */
  async verwijder(storageKey: string): Promise<void> {
    await rm(this.volledigPad(storageKey), { force: true });
  }

  private volledigPad(storageKey: string): string {
    const pad = resolve(join(this.hoofdmap, storageKey));

    // Padtraversal-controle. `storageKey` is servergegenereerd, dus dit hoort
    // nooit af te gaan — maar het is één regel, en het verschil tussen "hoort
    // niet" en "kan niet" is precies waar dit soort fouten in zit.
    if (pad !== this.hoofdmap && !pad.startsWith(this.hoofdmap + sep)) {
      throw new Error(`Ongeldige opslagsleutel: '${storageKey}'`);
    }

    return pad;
  }
}
