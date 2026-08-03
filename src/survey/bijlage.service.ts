import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import { BestandOpslagService } from './bestand-opslag.service';
import {
  maakOpslagsleutel,
  valideerBestand,
  veiligeWeergavenaam,
} from './bestand-validatie';
import type { BestandAfkeurReden } from './bestand-validatie';

export type BijlageUitkomst =
  | { status: 'opgeslagen'; attachmentId: string; contentType: string }
  | { status: 'afgekeurd'; reden: BestandAfkeurReden }
  | { status: 'onbekende-vraag' }
  | { status: 'geen-upload-vraag' }
  | { status: 'te-veel-bestanden'; maximum: number }
  | { status: 'niet-meer-open' };

interface VraagRij extends Record<string, unknown> {
  question_id: string;
  allows_upload: boolean;
  max_files: number;
}

/**
 * Neemt bijlagen aan bij een openstaande response (vragenlijst-ontwerp §6).
 *
 * Uploaden gebeurt vóór het indienen, per bestand. Dat is bewust geen onderdeel
 * van de indien-POST: acht vragen met certificaten in één request zou betekenen
 * dat een mislukte upload de hele indiening ongedaan maakt, en dat de
 * groottegrens per request in plaats van per bestand zou gelden.
 */
@Injectable()
export class BijlageService {
  private readonly logger = new Logger(BijlageService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly opslag: BestandOpslagService,
  ) {}

  async voegToe(
    tenantId: string,
    responseId: string,
    questionKey: string,
    bestand: { originalname: string; mimetype?: string; buffer: Buffer },
  ): Promise<BijlageUitkomst> {
    // Vóór de database: de inhoudscontrole heeft geen tenantcontext nodig, en
    // een afgekeurd bestand hoort geen transactie te openen.
    const gecontroleerd = valideerBestand(bestand.buffer, bestand.mimetype);

    if (!gecontroleerd.geldig) {
      return { status: 'afgekeurd', reden: gecontroleerd.reden };
    }

    const storageKey = maakOpslagsleutel(tenantId, responseId);

    // Eerst naar schijf, dan pas de databaserij. Andersom zou een rij kunnen
    // bestaan zonder bestand — een dode verwijzing die pas bij downloaden
    // opvalt. Nu is de faalvorm een bestand zonder rij, en dat is een
    // opruimkwestie in plaats van kapotte data. De rollback hieronder haalt
    // het alsnog weg.
    await this.opslag.bewaar(storageKey, bestand.buffer);

    try {
      return await this.db.withTenant<BijlageUitkomst>(
        tenantId,
        async (tx) => {
          // FOR UPDATE op de responserij, zodat twee overlappende uploads niet
          // allebei hetzelfde aantal tellen en samen over max_files heen gaan.
          // Een CHECK kan dit niet afvangen: die kan noch over meerdere rijen
          // tellen noch survey_question raadplegen.
          //
          // EERLIJK OVER WAT BEWEZEN IS: de tests tonen dat het maximum
          // standhoudt, niet dat déze vergrendeling daarvoor nodig is. Met de
          // FOR UPDATE verwijderd bleven ze groen — gemeten, niet aangenomen.
          // Twee transacties via dezelfde pg-Pool komen in de praktijk achter
          // elkaar aan de beurt, dus de race was niet uit te lokken zonder een
          // wachtpunt in deze code te bouwen. Dat is de prijs niet waard voor
          // een vergrendeling die goedkoop en correct is; hij blijft staan voor
          // het geval de transacties wél overlappen (meerdere processen).
          const response = await tx.execute<{ status: string }>(
            sql`SELECT status FROM clm.survey_response
                 WHERE response_id = ${responseId}
                 FOR UPDATE`,
          );

          const status = response.rows[0]?.status;

          // Na indienen geen uploads meer. De RLS-policy weigert dit ook, maar
          // dan als databasefout; hier wordt het een nette 410.
          if (status !== 'pending') {
            return { status: 'niet-meer-open' };
          }

          const vraag = await tx.execute<VraagRij>(
            sql`SELECT q.question_id, q.allows_upload, q.max_files
                  FROM clm.survey_response r
                  JOIN clm.survey_run      run ON run.run_id    = r.run_id
                  JOIN clm.survey_question q   ON q.template_id = run.template_id
                 WHERE r.response_id = ${responseId}
                   AND q.question_key = ${questionKey}`,
          );

          const rij = vraag.rows[0];

          // Geen rij betekent: deze vraag hoort niet bij de vragenlijst van
          // déze run. Dezelfde regel als bij het indienen — RLS beschermt
          // tegen een andere tenant, deze join tegen een andere template.
          if (!rij) {
            return { status: 'onbekende-vraag' };
          }

          if (!rij.allows_upload || rij.max_files < 1) {
            return { status: 'geen-upload-vraag' };
          }

          const aantal = await tx.execute<{ n: string }>(
            sql`SELECT count(*)::text AS n FROM clm.survey_attachment
                 WHERE response_id = ${responseId}
                   AND question_id = ${rij.question_id}`,
          );

          if (Number(aantal.rows[0].n) >= rij.max_files) {
            return { status: 'te-veel-bestanden', maximum: rij.max_files };
          }

          const bijlage = await tx.execute<{ attachment_id: string }>(
            sql`INSERT INTO clm.survey_attachment
                    (tenant_id, response_id, question_id, original_name,
                     storage_key, content_type, byte_size, sha256)
                VALUES (${tenantId}, ${responseId}, ${rij.question_id},
                        ${veiligeWeergavenaam(bestand.originalname)},
                        ${storageKey}, ${gecontroleerd.contentType},
                        ${bestand.buffer.length}, ${gecontroleerd.sha256})
                RETURNING attachment_id`,
          );

          this.logger.log(
            `Bijlage toegevoegd aan response ${responseId} (${gecontroleerd.contentType}, ${bestand.buffer.length} bytes).`,
          );

          return {
            status: 'opgeslagen',
            attachmentId: bijlage.rows[0].attachment_id,
            contentType: gecontroleerd.contentType,
          };
        },
        'leverancier',
      );
    } finally {
      // Elke uitkomst behalve 'opgeslagen' laat een bestand achter zonder rij.
      // Dat opruimen gebeurt hier, ook wanneer de transactie een fout gooide.
      await this.ruimOpIndienNodig(tenantId, responseId, storageKey);
    }
  }

  /**
   * Verwijdert het bestand van schijf wanneer er geen rij naar verwijst.
   *
   * Vraagt de database in plaats van te vertrouwen op de returnwaarde: als de
   * transactie is teruggedraaid door een fout, is de rij er niet — ook al leek
   * de INSERT te slagen.
   */
  private async ruimOpIndienNodig(
    tenantId: string,
    responseId: string,
    storageKey: string,
  ): Promise<void> {
    try {
      const bestaat = await this.db.withTenant(
        tenantId,
        (tx) =>
          tx.execute<{ n: string }>(
            sql`SELECT count(*)::text AS n FROM clm.survey_attachment
               WHERE storage_key = ${storageKey}`,
          ),
        'leverancier',
      );

      if (Number(bestaat.rows[0].n) === 0) {
        await this.opslag.verwijder(storageKey);
      }
    } catch (fout) {
      // Opruimen mag de uitkomst van de upload nooit veranderen. Een
      // achtergebleven bestand is hinderlijk; een mislukte upload die wél
      // geslaagd was, is erger.
      this.logger.warn(
        `Opruimen van '${storageKey}' voor response ${responseId} mislukt: ${
          fout instanceof Error ? fout.message : String(fout)
        }`,
      );
    }
  }
}
