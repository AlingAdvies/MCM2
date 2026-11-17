import { sql } from 'drizzle-orm';

import type { DatabaseService } from '../db/database.service';

/**
 * De uitnodigingsgeschiedenis van één deelnemer (issue #258, migratie 0049).
 *
 * ── Waarom dit bestaat ──────────────────────────────────────────────────────
 *
 * Uitnodigingen gaan vaak buiten MCM2 om de deur uit. Na nabellen blijkt dan
 * dat de uitnodiging naar iemand anders moet: intrekken, nieuwe link, opnieuw
 * versturen — soms meer dan eens. `handmatig_verzonden_op` hield daar maar één
 * datum van bij, zonder adres, en heruitnodigen wiste die. Daarna was niet meer
 * te zien of, wanneer en aan wie er verstuurd was.
 *
 * ── Wat MCM2 zelf schrijft en wat de gebruiker invult ───────────────────────
 *
 * Wat in MCM2 gebeurt, legt MCM2 zelf vast, in dezelfde transactie als de
 * handeling: intrekken, een nieuwe link, een verzending via het eigen
 * mailkanaal. Wat buiten MCM2 gebeurt — een verzending via Power Automate, een
 * mail die terugkomt — kan MCM2 niet zien; dat registreert de gebruiker.
 *
 * ── Append-only ─────────────────────────────────────────────────────────────
 *
 * Geen UPDATE en geen DELETE (rechten-contract.ts). Een verkeerd geregistreerde
 * verzending blijft zichtbaar staan; corrigeren is een nieuwe registratie.
 */

/** Zelfde lijst als `survey_response_event_soort_check` in migratie 0049. */
export const SOORTEN_GEBEURTENIS = [
  'verstuurd',
  'niet_aangekomen',
  'ingetrokken',
  'nieuwe_link',
] as const;

export type GebeurtenisSoort = (typeof SOORTEN_GEBEURTENIS)[number];

/** Eén regel in de tijdlijn, zoals hij naar het scherm gaat. */
export interface UitnodigingsGebeurtenis {
  eventId: string;
  soort: GebeurtenisSoort;
  /** Bij 'verstuurd' altijd gevuld; bij 'niet_aangekomen' als het bekend is. */
  adres: string | null;
  toelichting: string | null;
  /** Wanneer het gebeurde — bij een handmatige registratie de opgegeven datum. */
  plaatsgevondenOp: string;
  /** Wie het vastlegde. Null wanneer de gebruiker geen naam heeft. */
  doorNaam: string | null;
}

type Transactie = Parameters<Parameters<DatabaseService['withTenant']>[1]>[0];

export interface NieuweGebeurtenis {
  tenantId: string;
  responseId: string;
  soort: GebeurtenisSoort;
  userId: string;
  adres?: string | null;
  toelichting?: string | null;
  /** Ontbreekt: nu. */
  plaatsgevondenOp?: Date;
}

/**
 * Schrijft één gebeurtenis weg, binnen een transactie die de aanroeper al
 * heeft geopend (withTenant, actor 'medewerker'). Zo staat de gebeurtenis er
 * precies dan als de handeling zelf is gelukt — nooit de een zonder de ander.
 */
export async function legGebeurtenisVast(
  tx: Transactie,
  g: NieuweGebeurtenis,
): Promise<void> {
  const op = (g.plaatsgevondenOp ?? new Date()).toISOString();

  await tx.execute(
    sql`INSERT INTO clm.survey_response_event
               (tenant_id, response_id, soort, adres, toelichting,
                plaatsgevonden_op, created_by_user_id)
        VALUES (${g.tenantId}, ${g.responseId}, ${g.soort},
                ${g.adres ?? null}, ${g.toelichting ?? null},
                ${op}, ${g.userId})`,
  );
}

interface GebeurtenisRij extends Record<string, unknown> {
  event_id: string;
  response_id: string;
  soort: string;
  adres: string | null;
  toelichting: string | null;
  plaatsgevonden_op: Date | string;
  door_naam: string | null;
}

function iso(waarde: Date | string): string {
  // tx.execute() geeft timestamptz terug als Postgres-tekst, niet als Date —
  // zelfde valkuil als in notitie.service.ts.
  const d = waarde instanceof Date ? waarde : new Date(waarde);
  return Number.isNaN(d.getTime()) ? String(waarde) : d.toISOString();
}

/**
 * Alle gebeurtenissen van de deelnemers van één ronde, per respons, oudste
 * eerst — een tijdlijn leest van boven naar beneden.
 *
 * Eén query voor de hele ronde in plaats van één per deelnemer: een ronde kan
 * tientallen deelnemers hebben.
 *
 * ── Volgorde: wanneer vastgelegd, niet wanneer het gebeurde ─────────────────
 *
 * Het scherm vult "verstuurd op" in op de minuut nauwkeurig. Een verzending
 * die direct na een nieuwe link wordt geregistreerd, valt dan seconden vóór
 * die nieuwe link — gesorteerd op `plaatsgevonden_op` zou de tijdlijn zeggen
 * dat er verstuurd is vóórdat de link bestond. De volgorde van vastleggen
 * klopt wél met hoe het werk verliep; het opgegeven tijdstip staat er bij.
 */
export async function gebeurtenissenVanRonde(
  tx: Transactie,
  runId: string,
): Promise<Map<string, UitnodigingsGebeurtenis[]>> {
  const resultaat = await tx.execute<GebeurtenisRij>(
    sql`SELECT e.event_id,
               e.response_id,
               e.soort,
               e.adres,
               e.toelichting,
               e.plaatsgevonden_op,
               u.full_name AS door_naam
          FROM clm.survey_response_event e
          JOIN clm.survey_response s ON s.response_id = e.response_id
          LEFT JOIN clm."user" u ON u.user_id = e.created_by_user_id
         WHERE s.run_id = ${runId}
         ORDER BY e.created_at, e.event_id`,
  );

  const perRespons = new Map<string, UitnodigingsGebeurtenis[]>();

  for (const r of resultaat.rows) {
    const lijst = perRespons.get(r.response_id) ?? [];
    lijst.push({
      eventId: r.event_id,
      soort: r.soort as GebeurtenisSoort,
      adres: r.adres,
      toelichting: r.toelichting,
      plaatsgevondenOp: iso(r.plaatsgevonden_op),
      doorNaam: r.door_naam,
    });
    perRespons.set(r.response_id, lijst);
  }

  return perRespons;
}
