import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { cookieInstellingen } from '../src/auth/sessie';
import { SessieService } from '../src/auth/sessie.service';
import { TEST_IDS } from './test-ids';

/**
 * De platformroutes van buitenaf (ADR-015, migratie 0020).
 *
 * Wat hier bewezen moet worden is niet dat een tenant aangemaakt kan worden —
 * dat is het makkelijke deel — maar dat de route dicht zit voor iedereen die
 * geen platformbeheerder is. Een beheerscherm waarvan de route openstaat is
 * gevaarlijker dan geen scherm: het wekt de indruk dat er iets geregeld is.
 *
 * De tweede kern: deze controller is de enige plek in de applicatie waar een
 * tenant uit de invoer komt (§6). Dat mag alleen omdat PlatformAdminGuard
 * ervoor staat, en die uitzondering hoort dus zwaarder bewaakt dan de regel.
 */

const {
  tenantThuis: TENANT_THUIS,
  tenantVreemd: TENANT_VREEMD,
  beheerder: USER_BEHEERDER,
  gewoneGebruiker: USER_GEWOON,
} = TEST_IDS['platform-routes'];

const SUBJECT_BEHEERDER = `oid-platroute-beheer-${Date.now()}`;
const SUBJECT_GEWOON = `oid-platroute-gewoon-${Date.now()}`;

interface TenantAntwoord {
  tenantId?: string;
  naam?: string;
  aantalLeden?: number;
  melding?: string;
  /** Sinds Issue #131: alleen `true` als er werkelijk mail is uitgegaan. */
  mailVerstuurd?: boolean;
  uitnodigingslink?: string;
  verlooptOp?: string;
  reden?: string;
  veld?: string;
}

const body = (res: { body: unknown }) => res.body as TenantAntwoord;

/** Eén regel uit `GET /platform/tenants` (ADR-017). */
interface TenantRegel {
  tenantId: string;
  naam: string;
  aangemaaktOp: string;
}

const lijstBody = (res: { body: unknown }) =>
  (res.body as { tenants: TenantRegel[] }).tenants;

/** Migratierol, altijd naar dezelfde database als DATABASE_URL — zie 0020. */
function migratieUrl(): string {
  const runtime = process.env.DATABASE_URL;
  if (!runtime) throw new Error('DATABASE_URL ontbreekt.');

  const doel = new URL(runtime);
  const expliciet = process.env.MIGRATION_DATABASE_URL;

  if (expliciet) {
    const gegeven = new URL(expliciet);
    if (gegeven.host === doel.host && gegeven.pathname === doel.pathname) {
      return expliciet;
    }
  }

  doel.username = 'clm_migrator';
  return doel.toString();
}

describe('Platformroutes (e2e, ADR-015)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let migratieClient: Client;
  let cookieBeheerder: string;
  let cookieGewoon: string;
  /** Tenants die de tests aanmaken; in afterAll op te ruimen. */
  const aangemaakt: string[] = [];

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    for (const [tenant, user, subject, naam] of [
      [TENANT_THUIS, USER_BEHEERDER, SUBJECT_BEHEERDER, 'Platformbeheerder'],
      [TENANT_VREEMD, USER_GEWOON, SUBJECT_GEWOON, 'Gewone gebruiker'],
    ] as const) {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
      await client.query(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
        [tenant, `platroute-${naam}`],
      );
      await client.query(
        `INSERT INTO clm."user" (user_id, tenant_id, full_name, email, external_subject)
         VALUES ($1, $2, $3, $4, $5)`,
        [user, tenant, naam, `${subject}@voorbeeld.nl`, subject],
      );
      await client.query(
        `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
         VALUES ($1, $2, 'admin')`,
        [user, tenant],
      );
      await client.query('COMMIT');
    }

    // Alleen de eerste is platformbeheerder. Via de migratierol, want de
    // runtime-rol mag deze tabel niet schrijven — dat is het punt van 0020.
    migratieClient = new Client({ connectionString: migratieUrl() });
    await migratieClient.connect();
    await migratieClient.query(
      `INSERT INTO clm.platform_admin (user_id, toelichting)
       VALUES ($1, 'e2e platformroutes') ON CONFLICT DO NOTHING`,
      [USER_BEHEERDER],
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    const sessies = app.get(SessieService);
    const cookieNaam = cookieInstellingen().naam;

    const sessieBeheerder = await sessies.aanmaken(SUBJECT_BEHEERDER);
    const sessieGewoon = await sessies.aanmaken(SUBJECT_GEWOON);
    expect(sessieBeheerder).not.toBeNull();
    expect(sessieGewoon).not.toBeNull();

    cookieBeheerder = `${cookieNaam}=${sessieBeheerder!.token}`;
    cookieGewoon = `${cookieNaam}=${sessieGewoon!.token}`;
  }, 30000);

  afterAll(async () => {
    await app.close();

    for (const tenant of [...aangemaakt, TENANT_VREEMD, TENANT_THUIS]) {
      // De audit trail is append-only: de runtime-rol heeft alleen INSERT en
      // SELECT (migratie 0001, §7.7). Opruimen kan daarom alleen via de
      // migratierol — en dat is precies zoals het hoort.
      await migratieClient.query(
        'DELETE FROM audit.audit_event WHERE tenant_id = $1',
        [tenant],
      );

      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
      await client.query(
        'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
        [tenant],
      );
      await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [
        tenant,
      ]);
      await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [
        tenant,
      ]);
      await client.query('COMMIT');
    }

    await migratieClient.query(
      'DELETE FROM clm.platform_admin WHERE user_id = $1',
      [USER_BEHEERDER],
    );
    await migratieClient.end();
    await client.end();
  }, 30000);

  describe('de deur', () => {
    it('weigert een verzoek zonder sessie met 401', async () => {
      await request(server)
        .post('/platform/tenants')
        .send({ naam: 'Zomaar', adminNaam: 'X', adminEmail: 'x@y.nl' })
        .expect(401);
    });

    it('weigert een gewone tenant-admin met 403', async () => {
      // Dit is de belangrijkste test van deze suite. Een geldige sessie, een
      // echte admin — maar geen platformbeheerder. Zonder deze grens zou elke
      // klantbeheerder tenants kunnen aanmaken.
      const antwoord = await request(server)
        .post('/platform/tenants')
        .set('Cookie', cookieGewoon)
        .send({
          naam: 'Stiekem BV',
          adminNaam: 'Indringer',
          adminEmail: 'indringer@voorbeeld.nl',
        })
        .expect(403);

      expect(JSON.stringify(antwoord.body)).toContain('platformbeheer');
    });

    it('weigert ook lezen voor een gewone tenant-admin', async () => {
      await request(server)
        .get(`/platform/tenants/${TENANT_THUIS}`)
        .set('Cookie', cookieGewoon)
        .expect(403);
    });

    // ── De tenantlijst (ADR-017) ────────────────────────────────────────────
    //
    // Deze twee tests dragen meer gewicht dan hun omvang suggereert.
    //
    // clm.tenant_register staat buiten RLS en clm_api heeft er SELECT op —
    // nodig, want de route moet hem lezen. Maar élke ingelogde gebruiker
    // draait onder diezelfde rol. Wat een klant tegenhoudt is uitsluitend
    // PlatformAdminGuard vóór de route.
    //
    // Valt die guard weg, dan ziet iedere klantbeheerder de namen van alle
    // andere klanten. De databaselaag vangt dat niet af, dus deze test is de
    // enige bewaking.

    it('weigert de tenantlijst zonder sessie met 401', async () => {
      await request(server).get('/platform/tenants').expect(401);
    });

    it('weigert de tenantlijst voor een gewone tenant-admin met 403', async () => {
      const antwoord = await request(server)
        .get('/platform/tenants')
        .set('Cookie', cookieGewoon)
        .expect(403);

      expect(JSON.stringify(antwoord.body)).toContain('platformbeheer');
    });
  });

  describe('de tenantlijst', () => {
    it('toont tenants waar de beheerder zelf geen lid van is', async () => {
      // De kern van ADR-017: de lijst moet lángs de tenantgrens kijken. De
      // beheerder is lid van zijn eigen tenant; een tenant waar hij géén
      // membership in heeft hoort er evengoed in te staan. Lukt dat, dan is het
      // kip-eiprobleem opgelost waarvoor het register bestaat.
      //
      // De test maakt die vreemde tenant zélf aan en telt niet op wat andere
      // suites achterlaten. Alle e2e-suites delen één database en draaien
      // parallel; een verwachting als "er staat meer dan één tenant in" is dan
      // afhankelijk van de volgorde. Precies dat maakte deze test los groen en
      // in de volledige run rood — zie het runbook, "Een nieuwe e2e-suite
      // schrijven".
      const naam = `Vreemde tenant (lijst) ${Date.now()}`;

      const gemaakt = await request(server)
        .post('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .send({
          naam,
          adminNaam: 'Vreemde Beheerder',
          adminEmail: `vreemd-${Date.now()}@voorbeeld.nl`,
        })
        .expect(201);

      const uit = body(gemaakt);
      expect(uit.tenantId).toBeDefined();
      aangemaakt.push(uit.tenantId!);

      const antwoord = await request(server)
        .get('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .expect(200);

      const gevonden = lijstBody(antwoord).find(
        (t) => t.tenantId === uit.tenantId,
      );

      // De beheerder heeft in deze nieuwe tenant geen membership — de eerste
      // admin is 'Vreemde Beheerder', niet hijzelf — en ziet hem toch.
      expect(gevonden).toBeDefined();
      expect(gevonden?.naam).toBe(naam);
    }, 20_000);

    it('geeft per tenant een id, een naam en een datum', async () => {
      const antwoord = await request(server)
        .get('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .expect(200);

      // De eigen tenant staat er gegarandeerd in; die is in beforeAll gemaakt.
      // Andere suites vullen dezelfde database, dus toetsen op de vorm van
      // álle rijen zou meeliften op wat zij toevallig achterlaten.
      const eigen = lijstBody(antwoord).find(
        (t) => t.tenantId === TENANT_THUIS,
      );

      expect(eigen).toBeDefined();
      expect(eigen?.tenantId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(typeof eigen?.naam).toBe('string');
      expect(Number.isNaN(Date.parse(eigen!.aangemaaktOp))).toBe(false);
    });

    it('lekt geen klantgegevens — alleen deze drie velden', async () => {
      // Het register is de telefoonlijst, niet het dossier. Komt hier ooit een
      // veld bij dat iets over de klant zegt (ledenaantal, laatste activiteit,
      // abonnement), dan is dat een nieuw besluit en geen uitbreiding —
      // ADR-017. Deze test maakt die grens hard.
      //
      // Op de eigen tenant en niet op alle rijen: het antwoordformaat is per
      // rij hetzelfde, en meeliften op rijen van andere suites maakt de test
      // afhankelijk van de volgorde.
      const antwoord = await request(server)
        .get('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .expect(200);

      const eigen = lijstBody(antwoord).find(
        (t) => t.tenantId === TENANT_THUIS,
      );

      expect(eigen).toBeDefined();
      expect(Object.keys(eigen!).sort()).toEqual([
        'aangemaaktOp',
        'naam',
        'tenantId',
      ]);
    });

    it('neemt een nieuw aangemaakte tenant meteen op', async () => {
      // Bewijst de trigger langs de route in plaats van in de database: een
      // tenant die via POST ontstaat hoort zonder tussenkomst in de lijst te
      // staan.
      const naam = `Lijsttoets ${Date.now()}`;

      const gemaakt = await request(server)
        .post('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .send({
          naam,
          adminNaam: 'Lijst Toetser',
          adminEmail: `lijsttoets-${Date.now()}@voorbeeld.nl`,
        })
        .expect(201);

      const uit = body(gemaakt);

      // Vastleggen vóór de asserties — zelfde reden als in "een tenant
      // aanmaken": faalt er hierna iets, dan ruimt afterAll deze tenant niet
      // op en strandt de volgende run op de unieke naamindex.
      expect(uit.tenantId).toBeDefined();
      aangemaakt.push(uit.tenantId!);

      const lijst = await request(server)
        .get('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .expect(200);

      const gevonden = lijstBody(lijst).find(
        (t) => t.tenantId === uit.tenantId,
      );

      expect(gevonden).toBeDefined();
      expect(gevonden?.naam).toBe(naam);
    }, 20_000);
  });

  describe('een tenant aanmaken', () => {
    it('maakt tenant, eerste admin en membership in één handeling', async () => {
      const antwoord = await request(server)
        .post('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .send({
          naam: 'AlingAdvies',
          adminNaam: 'Kees',
          adminEmail: 'kees@voorbeeld.nl',
        })
        .expect(201);

      const uit = body(antwoord);

      // Vastleggen vóór de asserties, niet erna. Faalt er hierna één, dan is
      // het id anders nooit vastgelegd en ruimt afterAll de tenant niet op —
      // waarna elke volgende run strandt op de unieke naamindex. Precies dat
      // gebeurde op 2026-08-09: een 500 in de eerste test maakte de suite
      // daarna onherhaalbaar, en de 409 die je dan zag verborg de echte fout.
      expect(uit.tenantId).toBeDefined();
      aangemaakt.push(uit.tenantId!);

      expect(uit.naam).toBe('AlingAdvies');
      expect(uit.aantalLeden).toBe(1);
      // De uitnodiging gaat per mail (migratie 0025). In de e2e-run staat geen
      // RESEND_API_KEY, dus draait het logkanaal en gaat er níéts uit.
      //
      // Sinds Issue #131 zegt het antwoord dat ook. Deze test verwachtte
      // eerder het woord "uitnodiging" in de melding — dat stond er, in de zin
      // "heeft een uitnodiging ontvangen", en die zin was onwaar. De melding
      // hoort nu de oorzaak te noemen én wat de lezer moet doen.
      expect(uit.melding).toContain('GEEN mail verstuurd');
      expect(uit.melding).toContain('handmatig door');
      expect(uit.mailVerstuurd).toBe(false);
      // De link staat in het antwoord: dat is het enige moment waarop het
      // token bestaat, en zonder mail de enige manier om hem door te geven.
      expect(uit.uitnodigingslink).toContain('uitnodiging=');

      // De admin bestaat, nog zonder external_subject: die komt bij zijn
      // eerste login. De partiële unieke index staat dat toe (migratie 0009).
      await client.query('BEGIN');
      await client.query(
        `SET LOCAL app.current_tenant_id = '${uit.tenantId!}'`,
      );
      const { rows } = await client.query<{
        email: string;
        external_subject: string | null;
        role: string;
      }>(
        `SELECT u.email, u.external_subject, m.role
           FROM clm."user" u
           JOIN clm.tenant_membership m ON m.user_id = u.user_id
          WHERE u.tenant_id = $1`,
        [uit.tenantId],
      );
      await client.query('COMMIT');

      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe('kees@voorbeeld.nl');
      expect(rows[0].external_subject).toBeNull();
      expect(rows[0].role).toBe('admin');
    });

    it('geeft een bruikbare uitnodigingslink terug', async () => {
      // Het token staat óók in het antwoord als de mail geslaagd is. Dit is het
      // enige moment waarop het bestaat; gaat de mail verloren, dan is dit de
      // laatste kans om de link handmatig door te geven.
      const antwoord = await request(server)
        .post('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .send({
          naam: `Linktest ${Date.now()}`,
          adminNaam: 'Linkbeheerder',
          adminEmail: `link-${Date.now()}@voorbeeld.nl`,
        })
        .expect(201);

      const uit = body(antwoord) as Record<string, string>;
      aangemaakt.push(uit.tenantId);

      expect(uit.uitnodigingslink).toContain('/auth/login?uitnodiging=');
      expect(uit.uitnodigingslink).toContain(uit.uitnodigingstoken);
      // Naar /auth/login, niet naar het portaal: die route zet het token in
      // het pogingcookie. Het portaal is de leverancierskant.
      expect(uit.uitnodigingslink).not.toContain('/portal/');

      // Via het doorgeefluik van de frontend (Issue #132). Deze regel is de
      // hele reden dat de test bestaat: de link wees tot 2026-08-10 naar de
      // backend-poort, en dan zet /auth/login het pogingcookie op een andere
      // herkomst dan waar de callback terugkomt. Elke login mislukt dan op een
      // ontbrekende state — een fout die pas opvalt bij de eerste beheerder die
      // zijn uitnodiging gebruikt.
      expect(uit.uitnodigingslink).toContain('/api/backend/auth/login');
    });

    it('bouwt de link op UITNODIGING_BASIS_URL, niet op een vast adres', async () => {
      // De aanleiding voor Issue #132: er bestond een variabele (API_BASIS_URL)
      // die nergens gedocumenteerd stond en dus nooit gezet werd. Elke
      // uitgerolde omgeving gaf daardoor een link naar localhost — een adres
      // dat daar niet bestaat.
      //
      // Deze test faalt zodra iemand het adres opnieuw hardcodeert of de naam
      // van de variabele wijzigt zonder erbij na te denken.
      const oud = process.env.UITNODIGING_BASIS_URL;
      process.env.UITNODIGING_BASIS_URL = 'https://acceptatie.voorbeeld.nl/';

      try {
        const antwoord = await request(server)
          .post('/platform/tenants')
          .set('Cookie', cookieBeheerder)
          .send({
            naam: `Basisurltest ${Date.now()}`,
            adminNaam: 'Linkbeheerder',
            adminEmail: `basis-${Date.now()}@voorbeeld.nl`,
          })
          .expect(201);

        const uit = body(antwoord) as Record<string, string>;
        aangemaakt.push(uit.tenantId);

        // De afsluitende schuine streep uit de variabele hoort weg te vallen;
        // anders staat er een dubbele in de link.
        expect(uit.uitnodigingslink).toMatch(
          /^https:\/\/acceptatie\.voorbeeld\.nl\/api\/backend\/auth\/login\?uitnodiging=/,
        );
      } finally {
        if (oud === undefined) {
          delete process.env.UITNODIGING_BASIS_URL;
        } else {
          process.env.UITNODIGING_BASIS_URL = oud;
        }
      }
    });

    it('bewaart het antwoordadres van de tenant', async () => {
      // Migratie 0025. Zonder dit adres komt een antwoord van een leverancier
      // bij het platform terecht in plaats van bij de opdrachtgever.
      const adres = `contractmanagement+${Date.now()}@voorbeeld.nl`;

      const antwoord = await request(server)
        .post('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .send({
          naam: `Antwoordtest ${Date.now()}`,
          adminNaam: 'Beheerder',
          adminEmail: `antwoord-${Date.now()}@voorbeeld.nl`,
          antwoordEmail: adres,
        })
        .expect(201);

      const uit = body(antwoord);
      aangemaakt.push(uit.tenantId!);

      await client.query('BEGIN');
      await client.query(
        `SET LOCAL app.current_tenant_id = '${uit.tenantId!}'`,
      );
      const { rows } = await client.query<{ antwoord_email: string | null }>(
        'SELECT antwoord_email FROM clm.tenant WHERE tenant_id = $1',
        [uit.tenantId],
      );
      await client.query('COMMIT');

      expect(rows[0].antwoord_email).toBe(adres);
    });

    it('weigert een antwoordadres dat geen adres is', async () => {
      await request(server)
        .post('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .send({
          naam: `Ongeldig ${Date.now()}`,
          adminNaam: 'Beheerder',
          adminEmail: `ongeldig-${Date.now()}@voorbeeld.nl`,
          antwoordEmail: 'geen-adres',
        })
        .expect(400);
    });

    it('legt het aanmaken vast in de audit trail', async () => {
      // Op naam zoeken en niet via `aangemaakt[0]`: die index gaat ervan uit
      // dat 'AlingAdvies' de eerste tenant van de suite is. Sinds de
      // tenantlijst (ADR-017) maakt ook een andere test een tenant aan, en dan
      // verschuift die aanname stilzwijgend — de test faalde dan op de naam in
      // plaats van op het gedrag dat hij bewaakt.
      const lijst = await request(server)
        .get('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .expect(200);

      const tenantId = lijstBody(lijst).find(
        (t) => t.naam === 'AlingAdvies',
      )?.tenantId;

      expect(tenantId).toBeDefined();

      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
      const { rows } = await client.query<{
        action_type: string;
        new_values: Record<string, unknown>;
      }>(
        `SELECT action_type, new_values FROM audit.audit_event
          WHERE tenant_id = $1 AND action_type = 'tenant_aangemaakt'`,
        [tenantId],
      );
      await client.query('COMMIT');

      expect(rows).toHaveLength(1);
      expect(rows[0].new_values.naam).toBe('AlingAdvies');
      expect(rows[0].new_values.eersteAdmin).toBe('kees@voorbeeld.nl');
    });

    it('weigert dezelfde naam met 409', async () => {
      await request(server)
        .post('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .send({
          naam: 'AlingAdvies',
          adminNaam: 'Iemand',
          adminEmail: 'iemand@voorbeeld.nl',
        })
        .expect(409);
    });

    it('weigert een naam die alleen in hoofdletters verschilt', async () => {
      // Migratie 0021. Deze test gaf 201 vóórdat die index bestond: de
      // baseline-index is hoofdlettergevoelig, en in de applicatielaag was het
      // niet te vangen — de route draait in de context van de níéuwe tenant en
      // RLS verbergt daar elke bestaande tenant.
      await request(server)
        .post('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .send({
          naam: 'alingadvies',
          adminNaam: 'Iemand',
          adminEmail: 'iemand@voorbeeld.nl',
        })
        .expect(409);
    });

    it('weigert een onvolledig verzoek met 400', async () => {
      const antwoord = await request(server)
        .post('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .send({ naam: 'Zonder admin' })
        .expect(400);

      expect(JSON.stringify(antwoord.body)).toContain('adminNaam');
    });

    it('weigert een onzinnig e-mailadres met 400', async () => {
      await request(server)
        .post('/platform/tenants')
        .set('Cookie', cookieBeheerder)
        .send({
          naam: 'Kapot Adres BV',
          adminNaam: 'Iemand',
          adminEmail: 'geen-apenstaartje',
        })
        .expect(400);
    });
  });

  describe('support-toegang', () => {
    it('kent tijdelijke toegang toe, met reden en einddatum', async () => {
      const tenantId = aangemaakt[0];

      const antwoord = await request(server)
        .post(`/platform/tenants/${tenantId}/toegang`)
        .set('Cookie', cookieBeheerder)
        .send({ reden: 'Klant meldt dat ronde 3 niet opent' })
        .expect(201);

      const uit = body(antwoord);
      expect(uit.reden).toBe('Klant meldt dat ronde 3 niet opent');
      expect(new Date(uit.verlooptOp!).getTime()).toBeGreaterThan(Date.now());

      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
      const { rows } = await client.query<{ role: string; reden: string }>(
        `SELECT role, reden FROM clm.tenant_membership
          WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, USER_BEHEERDER],
      );
      await client.query('COMMIT');

      // Rol 'support', niet 'admin': de beheerder is herkenbaar als platform,
      // niet als medewerker van de klant (Issue #57).
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe('support');
    });

    it('legt de toekenning vast in de audit trail', async () => {
      const tenantId = aangemaakt[0];

      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
      const { rows } = await client.query<{
        new_values: Record<string, unknown>;
      }>(
        `SELECT new_values FROM audit.audit_event
          WHERE tenant_id = $1 AND action_type = 'support_toegang_toegekend'`,
        [tenantId],
      );
      await client.query('COMMIT');

      expect(rows).toHaveLength(1);
      expect(rows[0].new_values.reden).toBe(
        'Klant meldt dat ronde 3 niet opent',
      );
      expect(rows[0].new_values.beheerder).toBe(USER_BEHEERDER);
    });

    it('eist een reden van betekenis', async () => {
      const tenantId = aangemaakt[0];

      // 'test' is geen reden. Wat hier wordt tegengehouden is de gewoonte om
      // het veld met een teken te vullen — dan staat er straks een audit trail
      // vol regels die niets verklaren.
      await request(server)
        .post(`/platform/tenants/${tenantId}/toegang`)
        .set('Cookie', cookieBeheerder)
        .send({ reden: 'test' })
        .expect(400);
    });

    it('weigert support-toegang voor een gewone tenant-admin', async () => {
      await request(server)
        .post(`/platform/tenants/${TENANT_THUIS}/toegang`)
        .set('Cookie', cookieGewoon)
        .send({ reden: 'Ik wil ook wel eens meekijken' })
        .expect(403);
    });

    it('geeft 404 op een onbekende tenant', async () => {
      await request(server)
        .post('/platform/tenants/00000000-0000-0000-0000-0000000000ff/toegang')
        .set('Cookie', cookieBeheerder)
        .send({ reden: 'Bestaat helemaal niet, deze tenant' })
        .expect(404);
    });
  });
});
