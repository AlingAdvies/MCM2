import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Een opgevraagd bestand bestaat niet (meer) in de opslag, terwijl de
 * databaserij er nog wel naar verwijst.
 *
 * Eigen fouttype zodat een downloadroute er een begrijpelijke 404 van maakt in
 * plaats van een kale 500. Aanleiding (#46, 11-10): op AWS ECS begon elke
 * uitrol met een lege schijf, en de geüploade bijlagen van Transdev waren
 * verdwenen — de gebruiker zag alleen "Internal server error".
 */
export class BestandOntbreektFout extends Error {
  constructor(storageKey: string) {
    super(`Bestand ontbreekt in de opslag: '${storageKey}'`);
    this.name = 'BestandOntbreektFout';
  }
}

/** Wat een downloadroute toont bij een `BestandOntbreektFout`. */
export const BESTAND_ONTBREEKT_MELDING =
  'Dit bestand is niet meer beschikbaar. Upload het opnieuw.';

/** Welke opslag actief is; ook gemeld op `/health`. */
export type OpslagSoort = 's3' | 'schijf';

/**
 * Leest uit de omgeving welke opslag actief is. Eén plek, zodat `/health`
 * hetzelfde meldt als wat de service werkelijk doet.
 */
export function actieveOpslagSoort(): OpslagSoort {
  return process.env.S3_BUCKET ? 's3' : 'schijf';
}

/** `<tenant>/<response>/<uuid>` — zie `maakOpslagsleutel()`. */
const SLEUTEL_PATROON = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/;

/**
 * Bewaart geüploade bestanden: in S3 als `S3_BUCKET` is gezet, anders op schijf.
 *
 * **Productie gebruikt S3 (#46).** Een containerschijf op AWS ECS is na elke
 * uitrol leeg; de bucket blijft. De bucket is privé, versleuteld en heeft
 * versiebeheer; de applicatie komt erbij via haar taakrol, zonder sleutel.
 *
 * **Lokaal en in de tests: schijf**, onder `UPLOAD_DIR`. Daar is een
 * vergankelijke map precies wat je wilt. Staging (saxombp) gebruikt bewust
 * ook de schijf: S3 daar vraagt een vaste AWS-sleutel op die machine (besluit
 * eigenaar 11-10). De S3-route wordt in CI getest tegen MinIO.
 *
 * In beide gevallen: er is geen URL die een bestand rechtstreeks serveert —
 * downloaden loopt altijd via een route die de tokencontrole of de
 * beheerdersauthenticatie passeert. `storage_key` is in beide hetzelfde, dus
 * wisselen van opslag vraagt geen schemawijziging.
 *
 * Alleen de databaserijen gaan mee in `npm run backup:dump`; de bestanden
 * niet. In S3 vangt versiebeheer overschrijven en verwijderen op; een kopie
 * buiten AWS is een vervolgstap van #46.
 */
@Injectable()
export class BestandOpslagService {
  private readonly logger = new Logger(BestandOpslagService.name);
  private readonly hoofdmap: string;
  private readonly bucket: string | null;
  private readonly s3: S3Client | null;

  constructor() {
    this.hoofdmap = resolve(process.env.UPLOAD_DIR ?? './var/uploads');
    this.bucket = process.env.S3_BUCKET || null;

    if (!this.bucket) {
      this.s3 = null;
      this.logger.log(`Bijlagen-opslag: schijf (${this.hoofdmap}).`);
      return;
    }

    // Op AWS geen sleutel: de SDK haalt tijdelijke rechten bij de taakrol.
    // S3_ENDPOINT en de sleutelparen bestaan alleen voor MinIO in CI en
    // lokaal — nooit voor productie.
    const endpoint = process.env.S3_ENDPOINT || undefined;
    const accessKeyId = process.env.S3_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY;
    this.s3 = new S3Client({
      region: process.env.S3_REGION ?? process.env.AWS_REGION ?? 'eu-west-1',
      endpoint,
      forcePathStyle: Boolean(endpoint),
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });
    this.logger.log(`Bijlagen-opslag: S3 (bucket ${this.bucket}).`);
  }

  /**
   * Schrijft een bestand weg onder de opgegeven sleutel.
   *
   * De sleutel komt uit `maakOpslagsleutel()` en bevat geen enkel teken uit de
   * invoer. Toch wordt hier nóg een keer gecontroleerd: dit is de laatste plek
   * waar een padfout tot schrijven buiten de map zou leiden, en zo'n controle
   * hoort te staan waar de schade zou ontstaan — niet alleen waar de waarde
   * gemaakt wordt.
   */
  async bewaar(storageKey: string, inhoud: Buffer): Promise<void> {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket!,
          Key: this.geldigeSleutel(storageKey),
          Body: inhoud,
        }),
      );
    } else {
      const pad = this.volledigPad(storageKey);
      await mkdir(dirname(pad), { recursive: true });
      await writeFile(pad, inhoud, { flag: 'wx' });
    }

    this.logger.log(`Bestand opgeslagen (${inhoud.length} bytes).`);
  }

  /** @throws BestandOntbreektFout als het bestand niet in de opslag staat. */
  async lees(storageKey: string): Promise<Buffer> {
    if (this.s3) {
      try {
        const antwoord = await this.s3.send(
          new GetObjectCommand({
            Bucket: this.bucket!,
            Key: this.geldigeSleutel(storageKey),
          }),
        );
        return Buffer.from(await antwoord.Body!.transformToByteArray());
      } catch (fout) {
        // Zonder s3:ListBucket zou S3 hier 403 geven in plaats van 404, en
        // was "ontbreekt" niet te onderscheiden van "geen rechten". De
        // taakrol heeft ListBucket daarom bewust (zie #46).
        if ((fout as { name?: string }).name === 'NoSuchKey') {
          throw new BestandOntbreektFout(storageKey);
        }
        throw fout;
      }
    }

    try {
      return await readFile(this.volledigPad(storageKey));
    } catch (fout) {
      if ((fout as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new BestandOntbreektFout(storageKey);
      }
      throw fout;
    }
  }

  /**
   * Verwijdert een bestand.
   *
   * Stil bij een ontbrekend bestand: deze methode wordt aangeroepen om op te
   * ruimen nadat een databaseschrijfactie is teruggedraaid, en dan is "het
   * bestand staat er niet" precies de gewenste eindtoestand. S3 gedraagt zich
   * zo vanzelf; met versiebeheer blijft de vorige versie terug te halen.
   */
  async verwijder(storageKey: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucket!,
          Key: this.geldigeSleutel(storageKey),
        }),
      );
      return;
    }

    await rm(this.volledigPad(storageKey), { force: true });
  }

  /**
   * In S3 bestaat geen "buiten de map schrijven", maar een sleutel met `..`
   * of een leidende `/` hoort er net zo min in. Zelfde reden als bij
   * `volledigPad`: servergegenereerd, dus dit hoort nooit af te gaan.
   */
  private geldigeSleutel(storageKey: string): string {
    if (
      !SLEUTEL_PATROON.test(storageKey) ||
      storageKey.split('/').includes('..')
    ) {
      throw new Error(`Ongeldige opslagsleutel: '${storageKey}'`);
    }
    return storageKey;
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
