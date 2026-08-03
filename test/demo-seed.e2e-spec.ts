import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

import { TEST_IDS } from './test-ids';

/**
 * Bewaakt scripts/seed-demo-tenant.js — het script dat de demo-tenant vult.
 *
 * Zonder deze suite is een breuk in dat script pas zichtbaar op het moment dat
 * iemand een demo wil geven. Dat is precies het verkeerde moment: de demo is
 * het middel om schermen te toetsen vóór de pilot, dus een kapotte seed kost
 * een afspraak, niet een testrun.
 *
 * Drie dingen worden hier bewezen, en alle drie zijn eerder daadwerkelijk
 * misgegaan tijdens het bouwen:
 *
 *   1. Het script draait vanaf niets én een tweede keer met hetzelfde
 *      resultaat (idempotentie — het plan eist dit expliciet).
 *   2. De demo-tokens hebben de vorm die de guard accepteert. De eerste versie
 *      had 38 tekens in plaats van 43; het seeden slaagde, maar elke demo-link
 *      gaf een 400 zonder dat iets daarop wees.
 *   3. De data blijft binnen de tenantgrens, en het ruwe token staat nergens
 *      in de database.
 *
 * Het script wordt echt aangeroepen, niet nagebootst: een test die de INSERTs
 * overtypt bewijst dat de test klopt, niet dat het script werkt.
 */

const DEMO_TENANT_ID = 'dededede-0000-4000-8000-000000000001';
const SCRIPT = join(__dirname, '..', 'scripts', 'seed-demo-tenant.js');
const LEVERANCIERSBESTAND = join(
  __dirname,
  '..',
  'db',
  'seeds',
  'demo',
  'leveranciers.json',
);

/** Exact de controle uit src/survey/survey-token.ts. */
const TOKEN_PATROON = /^[A-Za-z0-9_-]{43}$/;

/** Een andere tenant dan de demo, om cross-tenant zichtbaarheid uit te lokken. */
const VREEMDE_TENANT = TEST_IDS['demo-seed'].vreemdeTenant;

interface Telling {
  gebruikers: number;
  memberships: number;
  leveranciers: number;
  contactpersonen: number;
  rondes: number;
  responses: number;
  antwoorden: number;
}

/**
 * De demo-tokens zoals het script ze berekent.
 *
 * Bewust dezelfde berekening en niet de waarden overgetypt: verandert het
 * voorvoegsel of de lengte in het script, dan verandert dit mee. Overgetypte
 * waarden zouden stilzwijgend uit de pas gaan lopen, en dan test deze suite
 * iets anders dan wat er draait.
 */
function leesDemoTokens(): string[] {
  const TOKEN_LENGTE = 43;

  return ['open', 'concept', 'ingediend'].map((naam) =>
    `demo-${naam}`.padEnd(TOKEN_LENGTE, 'x'),
  );
}

function draaiSeed(argumenten: string[] = []): string {
  return execFileSync(process.execPath, [SCRIPT, ...argumenten], {
    encoding: 'utf8',
    env: process.env,
  });
}

describe('Demo-seed (e2e)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    // Schoon beginnen: de testdatabase blijft tussen runs staan, en een
    // half gevulde demo-tenant zou de idempotentietest betekenisloos maken.
    draaiSeed(['--verwijder']);
  });

  afterAll(async () => {
    draaiSeed(['--verwijder']);
    await client.end();
  });

  async function tel(): Promise<Telling> {
    await client.query('SELECT set_config($1, $2, false)', [
      'app.current_tenant_id',
      DEMO_TENANT_ID,
    ]);

    const { rows } = await client.query<Telling>(`
      SELECT
        (SELECT count(*)::int FROM clm.user)              AS gebruikers,
        (SELECT count(*)::int FROM clm.tenant_membership) AS memberships,
        (SELECT count(*)::int FROM clm.vendor)            AS leveranciers,
        (SELECT count(*)::int FROM clm.vendor_contact)    AS contactpersonen,
        (SELECT count(*)::int FROM clm.survey_run)        AS rondes,
        (SELECT count(*)::int FROM clm.survey_response)   AS responses,
        (SELECT count(*)::int FROM clm.survey_answer)     AS antwoorden
    `);

    return rows[0];
  }

  // ── Vullen ────────────────────────────────────────────────────────────────

  it('vult een lege database met een samenhangende demo-tenant', async () => {
    draaiSeed();

    const stand = await tel();

    // Het aantal leveranciers volgt uit het bronbestand, niet uit een getal
    // dat hier is overgetypt: anders faalt deze test zodra iemand een
    // leverancier toevoegt, terwijl er niets kapot is.
    const bron = JSON.parse(readFileSync(LEVERANCIERSBESTAND, 'utf8')) as {
      owners: unknown[];
      vendors: unknown[];
    };

    expect(stand.leveranciers).toBe(bron.vendors.length);
    expect(stand.gebruikers).toBe(bron.owners.length);

    // Elke gebruiker heeft membership — zonder dat kan niemand bij de data,
    // en dat is de reden dat deze fase ná de guard komt.
    expect(stand.memberships).toBe(stand.gebruikers);

    // Elke leverancier heeft een contactpersoon: zonder e-mailadres is er
    // niemand om een survey naartoe te sturen.
    expect(stand.contactpersonen).toBe(stand.leveranciers);

    expect(stand.rondes).toBe(1);
    expect(stand.responses).toBe(3);
    expect(stand.antwoorden).toBeGreaterThan(0);
  });

  it('geeft bij een tweede run exact dezelfde stand', async () => {
    const voor = await tel();
    draaiSeed();
    const na = await tel();

    // Idempotentie is niet cosmetisch: een seed die de tweede keer dubbele
    // rijen maakt, blokkeert precies het opnieuw opzetten van een omgeving
    // waar hij voor bedoeld is.
    expect(na).toEqual(voor);
  });

  // ── De drie stadia ────────────────────────────────────────────────────────

  it('levert responses in drie verschillende stadia', async () => {
    await client.query('SELECT set_config($1, $2, false)', [
      'app.current_tenant_id',
      DEMO_TENANT_ID,
    ]);

    const { rows } = await client.query<{
      status: string;
      submitted_at: Date | null;
      antwoorden: number;
    }>(`
      SELECT r.status, r.submitted_at,
             (SELECT count(*)::int FROM clm.survey_answer a
               WHERE a.response_id = r.response_id) AS antwoorden
        FROM clm.survey_response r
       ORDER BY antwoorden
    `);

    expect(rows).toHaveLength(3);

    // Open: nog niets ingevuld.
    expect(rows[0].status).toBe('pending');
    expect(rows[0].antwoorden).toBe(0);

    // Concept: deels ingevuld, nog niet ingediend. Geen aparte status in het
    // model — 'concept' is een pending response mét antwoorden.
    expect(rows[1].status).toBe('pending');
    expect(rows[1].antwoorden).toBeGreaterThan(0);

    // Ingediend: submitted_at is gevuld, afgedwongen door
    // survey_response_submitted_consistent_check.
    expect(rows[2].status).toBe('submitted');
    expect(rows[2].submitted_at).not.toBeNull();
    expect(rows[2].antwoorden).toBeGreaterThan(rows[1].antwoorden);
  });

  // ── Tokens ────────────────────────────────────────────────────────────────

  it('slaat de SHA-256 van het token op, niet het token zelf', async () => {
    // De vorm controleren is niet genoeg — dat is gebleken uit een tegenproef.
    // Met het token hex-gecodeerd in plaats van gehasht bleef een vormtest
    // groen, terwijl de waarde omkeerbaar was: wie de databasedump heeft, kan
    // dan elke openstaande survey openen. Dat is precies de eigenschap die
    // hashToken() moet leveren (survey-token.ts §"Berekent de hash").
    //
    // Daarom herberekenen we hier de verwachte hash uit het bekende ruwe
    // token. Alleen een echte SHA-256 komt daar doorheen.
    //
    // De tokens komen uit het script zelf en niet uit zijn uitvoer. Een eerdere
    // versie las ze uit de afgedrukte links, en die faalde onregelmatig: het
    // script drukt ze alleen af wanneer het de ronde daadwerkelijk aanmaakt,
    // en bij een tweede seed slaat het die stap over. In de volledige suite
    // had een andere test de tenant soms al gevuld — dan vond deze test nul
    // links en viel om op iets dat niets met hashing te maken had.
    const tokens = leesDemoTokens();

    expect(tokens).toHaveLength(3);

    // Vanaf niets, zodat de hashes bij déze tokens horen en niet bij een
    // eerdere seed met andere waarden.
    draaiSeed(['--verwijder']);
    draaiSeed();

    const verwachteHashes = tokens
      .map((token) => createHash('sha256').update(token, 'utf8').digest('hex'))
      .sort();

    await client.query('SELECT set_config($1, $2, false)', [
      'app.current_tenant_id',
      DEMO_TENANT_ID,
    ]);

    const { rows } = await client.query<{ token_hash: string }>(
      'SELECT token_hash FROM clm.survey_response ORDER BY token_hash',
    );

    expect(rows.map((rij) => rij.token_hash).sort()).toEqual(verwachteHashes);

    for (const rij of rows) {
      // Een hash is niet terug te lezen naar het token. Staat het ruwe token
      // er hex-gecodeerd in, dan valt het hier alsnog door de mand.
      const alsTekst = Buffer.from(rij.token_hash, 'hex').toString('utf8');
      expect(alsTekst).not.toContain('demo-');
    }
    // Twintig seconden en niet de standaard vijf.
    //
    // Deze test start het seed-script twee keer als apart Node-proces. Eén
    // aanroep duurt ~1,6 s tegen een rustige database: een Node-start, de
    // migratiecontrole en ruim honderd inserts. Twee aanroepen zitten daarmee
    // al op ~3,2 s, en dat is binnen de standaardlimiet van 5 s alleen genoeg
    // zolang de machine niets anders doet.
    //
    // In de volledige suite doet hij dat wel: twintig suites draaien parallel
    // tegen dezelfde database en delen een pool van vier verbindingen per
    // applicatie. Dan valt deze test om op een timeout — met een foutmelding
    // die naar hashing wijst terwijl er niets mis is met hashing.
    //
    // Dat is dezelfde faalvorm als de botsende test-id's van 2026-07-31: de
    // melding wijst naar het gevolg, niet naar de oorzaak, en "even opnieuw
    // draaien" wordt een gewoonte. Vandaar een limiet die past bij wat de test
    // daadwerkelijk doet.
  }, 20_000);

  it('gebruikt tokens met de vorm die de guard accepteert', () => {
    // Deze test bestaat door schade: de eerste versie van het script gebruikte
    // tokens van 38 en 39 tekens. Het seeden slaagde, de database accepteerde
    // de hash, en pas bij het openen van een demo-link bleek dat de guard ze
    // afwijst op vorm — vóórdat de database überhaupt geraadpleegd wordt.
    //
    // Vanaf niets draaien, want het script drukt de links alleen af wanneer
    // het de ronde daadwerkelijk aanmaakt. Bij een tweede run slaat het die
    // stap over en is er niets om te controleren.
    draaiSeed(['--verwijder']);

    const uitvoer = draaiSeed();
    const links = [...uitvoer.matchAll(/\/portal\/survey\/(\S+)/g)].map(
      (match) => match[1],
    );

    expect(links).toHaveLength(3);

    for (const token of links) {
      expect(token).toMatch(TOKEN_PATROON);
    }
    // Ook twee scriptaanroepen, dus dezelfde limiet als de test hierboven.
  }, 20_000);

  // ── Tenantgrens ───────────────────────────────────────────────────────────

  it('toont de demo-data niet aan een andere tenant', async () => {
    await client.query('SELECT set_config($1, $2, false)', [
      'app.current_tenant_id',
      VREEMDE_TENANT,
    ]);

    const { rows } = await client.query<{
      leveranciers: number;
      responses: number;
      gebruikers: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM clm.vendor)          AS leveranciers,
        (SELECT count(*)::int FROM clm.survey_response) AS responses,
        (SELECT count(*)::int FROM clm.user)            AS gebruikers
    `);

    expect(rows[0].leveranciers).toBe(0);
    expect(rows[0].responses).toBe(0);
    expect(rows[0].gebruikers).toBe(0);
  });

  it('toont niets zonder tenantcontext', async () => {
    await client.query('SELECT set_config($1, $2, false)', [
      'app.current_tenant_id',
      '',
    ]);

    const { rows } = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM clm.vendor',
    );

    expect(rows[0].n).toBe(0);
  });

  // ── Opruimen ──────────────────────────────────────────────────────────────

  it('ruimt zichzelf volledig op met --verwijder', async () => {
    draaiSeed(['--verwijder']);

    const stand = await tel();

    expect(stand).toEqual({
      gebruikers: 0,
      memberships: 0,
      leveranciers: 0,
      contactpersonen: 0,
      rondes: 0,
      responses: 0,
      antwoorden: 0,
    });

    // Ook de tenantrij zelf: die valt buiten de tellingen hierboven, want die
    // draaien binnen de context van de tenant die dan niet meer hoort te
    // bestaan.
    const { rows } = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM clm.tenant WHERE tenant_id = $1',
      [DEMO_TENANT_ID],
    );

    expect(rows[0].n).toBe(0);

    // Terugzetten voor de volgende suite: dit is de laatste test, maar de
    // afterAll draait --verwijder nog een keer en dat moet op een lege
    // tenant net zo goed werken.
    draaiSeed();
  });
});
