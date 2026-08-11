import { Logger } from '@nestjs/common';

import type { DatabaseService } from '../db/database.service';
import { SessieService } from './sessie.service';
import { genereerUitnodigingstoken } from './uitnodigingstoken';

/**
 * Wat er gelogd wordt wanneer een uitnodiging niets doet (Issue #133).
 *
 * ── Waarom een logregel het onderwerp van een test is ────────────────────────
 *
 * Normaal is een logregel geen gedrag dat je vastlegt. Hier wel, en om dezelfde
 * reden als bij Issue #131: het gaat om de vraag of een gebeurtenis zichtbaar
 * is. Op acceptatie bleef een uitgenodigde rij eeuwig wachten terwijl dezelfde
 * persoon gewoon inlogde als een andere gebruiker — twee rijen, één mens, en
 * niets wat daar melding van maakte.
 *
 * `clm.koppel_eerste_login()` geeft bewust geen reden terug: die zou verklappen
 * welke uitnodiging bestaat (migratie 0024). Het log is daarmee de énige plek
 * waar "ik klik en er gebeurt niets" aan een oorzaak te verbinden is. Verdwijnt
 * die regel, dan is de storing weer onzichtbaar — vandaar deze tests.
 *
 * De database is hier een dubbel: wát de functie beslist, is gedekt door
 * `test/eerste-login.e2e-spec.ts` tegen de echte migratie. Hier gaat het om wat
 * de service doet met de uitkomst.
 */

/** Een DatabaseService die teruggeeft wat de test voorschrijft. */
function dubbel(antwoorden: Array<Array<Record<string, unknown>>>) {
  const gesteld: string[] = [];
  let beurt = 0;

  const service = {
    db: {
      execute: (query: { queryChunks?: unknown[] }) => {
        // De SQL zelf doet er hier niet toe; de volgorde van antwoorden wel.
        gesteld.push(JSON.stringify(query.queryChunks ?? []));
        return Promise.resolve({ rows: antwoorden[beurt++] ?? [] });
      },
    },
  } as unknown as DatabaseService;

  return { service, gesteld };
}

const SESSIE = [
  { sessie_id: 's-1', user_id: 'u-1', tenant_id: 't-1', role: 'admin' },
];

const UITNODIGING = {
  email: 'kees@alingadvies.nl',
  uitnodigingstoken: genereerUitnodigingstoken(),
};

describe('SessieService — een uitnodiging die niets doet (Issue #133)', () => {
  let waarschuwingen: string[];

  beforeEach(() => {
    waarschuwingen = [];
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((melding: unknown) => {
        waarschuwingen.push(String(melding));
      });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('waarschuwt wanneer iemand met een account een uitnodiging aanbiedt', async () => {
    // Dit is de situatie van acceptatie: de platformbeheerder heeft al een oid
    // en klikt op de uitnodiging voor de rij die op hem wacht. Hij komt gewoon
    // binnen als zichzelf; de tweede rij blijft staan.
    const { service } = dubbel([SESSIE]);

    const sessie = await new SessieService(service).aanmaken(
      'oid-bestaand',
      UITNODIGING,
    );

    expect(sessie).not.toBeNull();
    expect(waarschuwingen.join('\n')).toContain('al een account heeft');
  });

  it('waarschuwt wanneer de koppeling niet lukt', async () => {
    // Geen sessie, koppelpoging levert niets op. Vóór Issue #133 gebeurde hier
    // niets: geen regel, geen onderscheid met "deze persoon hoort er niet bij".
    const { service } = dubbel([[], []]);

    const sessie = await new SessieService(service).aanmaken(
      'oid-nieuw',
      UITNODIGING,
    );

    expect(sessie).toBeNull();
    expect(waarschuwingen.join('\n')).toContain('koppeling is niet gelukt');
  });

  it('zwijgt wanneer de koppeling wél lukt', async () => {
    // De tegenproef. Zou er altijd gewaarschuwd worden, dan is de waarschuwing
    // ruis en leest niemand hem meer.
    const { service } = dubbel([[], [{ user_id: 'u-1' }], SESSIE]);

    const sessie = await new SessieService(service).aanmaken(
      'oid-nieuw',
      UITNODIGING,
    );

    expect(sessie).not.toBeNull();
    expect(waarschuwingen).toEqual([]);
  });

  it('zwijgt bij een gewone login zonder uitnodiging', async () => {
    const { service } = dubbel([SESSIE]);

    await new SessieService(service).aanmaken('oid-bestaand');

    expect(waarschuwingen).toEqual([]);
  });

  it('doet geen koppelpoging bij een token met een verkeerde vorm', async () => {
    // De vormcontrole staat vóór de databaseaanroep: een cookie dat door iets
    // anders gevuld is hoort af te ketsen op zijn vorm.
    const { service, gesteld } = dubbel([[]]);

    await new SessieService(service).aanmaken('oid-nieuw', {
      email: 'kees@alingadvies.nl',
      uitnodigingstoken: 'te-kort',
    });

    // Eén query: alleen sessie_aanmaken, geen koppel_eerste_login.
    expect(gesteld).toHaveLength(1);
    // De "geen membership"-regel komt er wél — die hoort bij het uitblijven
    // van een sessie en staat los van de uitnodiging. Wat hier niet mag staan,
    // is een melding over een mislukte koppeling: er is niets geprobeerd.
    expect(waarschuwingen.join('\n')).not.toContain('koppeling');
  });
});
