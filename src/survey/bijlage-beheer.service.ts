import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../db/database.service';
import { BestandOpslagService } from './bestand-opslag.service';
import type { BijlageUitkomst } from './bijlage.service';
import {
  maakOpslagsleutel,
  valideerBestand,
  veiligeWeergavenaam,
} from './bestand-validatie';

interface VraagRij extends Record<string, unknown> {
  question_id: string;
  allows_upload: boolean;
  max_files: number;
}

/**
 * Voegt een bijlage toe namens de leverancier (besluit eigenaar, 01-09) —
 * een medewerker die zelf bewijs heeft opgehaald (bv. een certificaat dat de
 * leverancier op zijn eigen website publiceert in plaats van te uploaden)
 * legt dat hier vast bij de betreffende vraag.
 *
 * ── Eigen bestand, niet een methode op BijlageService ───────────────────────
 *
 * `test/actor-context.e2e-spec.ts` bewaakt dat elk bestand op het
 * leverancierspad (waaronder bijlage.service.ts) het letterlijke token
 * 'medewerker' nergens in zijn broncode heeft — dat voorkomt precies de fout
 * van 2026-08-03, waarbij een leverancierspad per ongeluk medewerkersrechten
 * kreeg zonder dat één test het merkte. Deze klasse hoort bewust bij het
 * medewerkerspad (net als VragenlijstBeheerService/RondeBeheerService,
 * gescheiden van het leverancierspad om dezelfde reden), en staat daarom in
 * een eigen bestand.
 *
 * Twee bewuste verschillen met `BijlageService.voegToe()`:
 *
 *   - Geen status-check op 'pending'. Dit mag ook nadat de leverancier al
 *     heeft ingediend — dat is precies het scenario: het bewijs komt later
 *     boven water, het antwoord staat er al. De RLS-policy op
 *     survey_attachment (migratie 0037) staat dit voor actor 'medewerker'
 *     toe, ongeacht de status van de respons.
 *   - `uploadedByUserId`/`uploadedByAdmin` markeren dat dit niet de
 *     leverancier zelf was. Dat onderscheid moet op de bijlage zelf
 *     zichtbaar blijven, niet alleen in het audit-logboek.
 *
 * `allows_upload`/`max_files` gelden onverkort: die zijn een eigenschap van
 * de vraag, niet van wie uploadt.
 */
@Injectable()
export class BijlageBeheerService {
  private readonly logger = new Logger(BijlageBeheerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly opslag: BestandOpslagService,
  ) {}

  async voegToeAlsBeheer(
    tenantId: string,
    responseId: string,
    questionKey: string,
    uploadedByUserId: string,
    bestand: { originalname: string; mimetype?: string; buffer: Buffer },
  ): Promise<BijlageUitkomst> {
    const gecontroleerd = valideerBestand(bestand.buffer, bestand.mimetype);

    if (!gecontroleerd.geldig) {
      return { status: 'afgekeurd', reden: gecontroleerd.reden };
    }

    const storageKey = maakOpslagsleutel(tenantId, responseId);

    await this.opslag.bewaar(storageKey, bestand.buffer);

    try {
      return await this.db.withTenant<BijlageUitkomst>(
        tenantId,
        async (tx) => {
          // Vergrendelt de responserij zodat twee overlappende toevoegingen
          // niet allebei over max_files heen tellen — zelfde plek als
          // BijlageService.voegToe() (FOR UPDATE op de rij zelf, niet op de
          // aggregate-count hieronder: PostgreSQL staat FOR UPDATE niet toe
          // samen met count(*)). Geen statuscheck hier: dit mag juist ook
          // ná 'submitted', dat is het hele scenario van deze methode.
          const response = await tx.execute<{ response_id: string }>(
            sql`SELECT response_id FROM clm.survey_response
                 WHERE response_id = ${responseId}
                 FOR UPDATE`,
          );

          // Bestaat de respons binnen deze tenant überhaupt? RLS regelt de
          // tenantgrens; deze check onderscheidt "bestaat niet" niet apart —
          // net als bij voegToe() levert een niet-gevonden vraag hieronder
          // 'onbekende-vraag' op, wat voor de aanroeper hetzelfde effect
          // heeft (404).
          if (!response.rows[0]) {
            return { status: 'onbekende-vraag' };
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
                     storage_key, content_type, byte_size, sha256,
                     uploaded_by_user_id, uploaded_by_admin)
                VALUES (${tenantId}, ${responseId}, ${rij.question_id},
                        ${veiligeWeergavenaam(bestand.originalname)},
                        ${storageKey}, ${gecontroleerd.contentType},
                        ${bestand.buffer.length}, ${gecontroleerd.sha256},
                        ${uploadedByUserId}, true)
                RETURNING attachment_id`,
          );

          this.logger.log(
            `Bijlage namens leverancier toegevoegd aan response ${responseId} door gebruiker ${uploadedByUserId} (${gecontroleerd.contentType}, ${bestand.buffer.length} bytes).`,
          );

          return {
            status: 'opgeslagen',
            attachmentId: bijlage.rows[0].attachment_id,
            contentType: gecontroleerd.contentType,
          };
        },
        'medewerker',
      );
    } finally {
      // Elke uitkomst behalve 'opgeslagen' laat een bestand achter zonder
      // rij. Eigen kleine kopie i.p.v. BijlageService.ruimOpIndienNodig()
      // hergebruiken: die is private, en dit stukje is te klein om er een
      // gedeelde utility voor te maken.
      await this.ruimOpIndienNodig(tenantId, storageKey);
    }
  }

  private async ruimOpIndienNodig(
    tenantId: string,
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
        'medewerker',
      );

      if (Number(bestaat.rows[0].n) === 0) {
        await this.opslag.verwijder(storageKey);
      }
    } catch (fout) {
      this.logger.warn(
        `Opruimen van '${storageKey}' mislukt: ${
          fout instanceof Error ? fout.message : String(fout)
        }`,
      );
    }
  }
}
