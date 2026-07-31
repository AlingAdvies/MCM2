import {
  Controller,
  Get,
  INestApplication,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Client } from 'pg';
import request from 'supertest';

import { DatabaseModule } from '../src/db/database.module';
import { SessieService } from '../src/auth/sessie.service';
import {
  TenantContextGuard,
  type RequestMetSessie,
} from '../src/auth/tenant-context.guard';
import {
  cookieInstellingen,
  genereerSessieToken,
  hashSessieToken,
} from '../src/auth/sessie';

/**
 * De TenantContextGuard: van sessiecookie naar tenantcontext (Issue #7, spoor 1).
 *
 * Dit is de laag die P0 sluit. De vraag die deze suite beantwoordt is niet "doet
 * de guard iets" maar: **kan een verzoek ooit een tenantcontext krijgen die niet
 * uit een geverifieerde sessie komt?**
 *
 * Vandaar dat de meeste tests hieronder negatief zijn. Eén test bewijst dat een
 * geldige sessie doorkomt; de rest bewijst dat al het andere strandt.
 */

/**
 * Eigen UUID-reeks (`...9a` t/m `...9e`).
 *
 * Niet willekeurig gekozen: de reeksen c1/c2 en d1/d2/d3 zijn al in gebruik
 * door survey-token-isolatie en membership-isolatie. Jest draait suites
 * parallel, dus overlappende id's laten twee suites elkaars tenant opruimen —
 * met een foutmelding over een foreign key op `vendor`, ver van de oorzaak.
 * Zelf tegengekomen op 2026-07-31.
 */
const TENANT_A = '00000000-0000-0000-0000-00000000009a';
const TENANT_B = '00000000-0000-0000-0000-00000000009b';
const USER_A = '00000000-0000-0000-0000-00000000009c';
const USER_B = '00000000-0000-0000-0000-00000000009d';
const USER_ZONDER_LID = '00000000-0000-0000-0000-00000000009e';

const SUBJECT_A = `oid-guard-a-${Date.now()}`;
const SUBJECT_B = `oid-guard-b-${Date.now()}`;
const SUBJECT_ZONDER_LID = `oid-guard-geen-lid-${Date.now()}`;

/**
 * Een testcontroller achter de guard. Geeft terug wat de guard op de request
 * heeft gezet — dat is precies wat de rest van de applicatie straks gebruikt
 * om withTenant() mee te vullen.
 */
@Controller('beveiligd')
class BeveiligdeTestController {
  @Get()
  @UseGuards(TenantContextGuard)
  wieBenIk(@Req() req: RequestMetSessie) {
    return {
      tenantId: req.sessie?.tenantId,
      userId: req.sessie?.userId,
      role: req.sessie?.role,
    };
  }
}

/** Wat de testcontroller teruggeeft. */
interface ContextAntwoord {
  tenantId?: string;
  userId?: string;
  role?: string;
}

/**
 * Typeert het antwoord van supertest, dat `any` is. Zonder deze stap zou een
 * typefout in een veldnaam stilzwijgend `undefined` opleveren en de test altijd
 * laten slagen.
 */
function alsContext(body: unknown): ContextAntwoord {
  return body as ContextAntwoord;
}

async function verwijderTestdata(client: Client): Promise<void> {
  for (const tenant of [TENANT_A, TENANT_B]) {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await client.query(
      'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
      [tenant],
    );
    await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [tenant]);
    await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [tenant]);
    await client.query('COMMIT');
  }
}

describe('TenantContextGuard (e2e)', () => {
  let app: INestApplication;
  let client: Client;
  let sessies: SessieService;
  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    // Twee tenants met elk een gebruiker, plus één gebruiker zonder membership.
    for (const [tenant, user, subject, naam] of [
      [TENANT_A, USER_A, SUBJECT_A, 'Anna uit A'],
      [TENANT_B, USER_B, SUBJECT_B, 'Bob uit B'],
    ] as const) {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
      await client.query(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
        [tenant, `guard-test-${tenant.slice(-2)}`],
      );
      await client.query(
        `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
         VALUES ($1, $2, $3, $4)`,
        [user, tenant, naam, subject],
      );
      await client.query(
        `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
         VALUES ($1, $2, 'admin')`,
        [user, tenant],
      );
      await client.query('COMMIT');
    }

    // Een gebruiker die wél bestaat maar géén membership heeft: authenticatie
    // zonder autorisatie.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4)`,
      [
        USER_ZONDER_LID,
        TENANT_A,
        'Carla zonder lidmaatschap',
        SUBJECT_ZONDER_LID,
      ],
    );
    await client.query('COMMIT');

    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      controllers: [BeveiligdeTestController],
      providers: [SessieService, TenantContextGuard],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    sessies = moduleRef.get(SessieService);
    // Ruimer dan de standaard 5 seconden: deze opzet start een volledige
    // Nest-applicatie én zet twee tenants met gebruikers klaar.
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(client);
    await client.end();
  }, 30000);

  describe('geen toegang zonder geldige sessie', () => {
    it('weigert een verzoek zonder cookie', async () => {
      await request(app.getHttpServer()).get('/beveiligd').expect(401);
    });

    it('weigert een cookie met een onbekend token', async () => {
      // Juiste vorm, maar er staat geen sessie tegenover.
      await request(app.getHttpServer())
        .get('/beveiligd')
        .set('Cookie', `${cookieNaam}=${'a'.repeat(43)}`)
        .expect(401);
    });

    it('weigert een verzoek dat alleen een tenant in de header meestuurt', async () => {
      // Dit is P0 in één test. Géén cookie, wél een tenant in de header —
      // precies het patroon van de verwijderde branch feat/fase0-skeleton-vendors
      // en van de oude X-Tenant-Id-route. Er mag geen enkele weg zijn waarlangs
      // een tenantcontext ontstaat zonder sessie.
      await request(app.getHttpServer())
        .get('/beveiligd')
        .set('X-Tenant-Id', TENANT_B)
        .expect(401);
    });

    it('weigert een verzoek dat alleen een tenant in de query meestuurt', async () => {
      await request(app.getHttpServer())
        .get('/beveiligd')
        .query({ tenant: TENANT_B, tenantId: TENANT_B })
        .expect(401);
    });

    it('valt niet terug op een header wanneer het cookie ongeldig is', async () => {
      // De gevaarlijkste variant: een verlopen of onzinnig cookie naast een
      // header. Een terugval "geen sessie, dan de header maar" zou hier
      // onopgemerkt blijven als alleen de gevallen zónder cookie getest waren.
      await request(app.getHttpServer())
        .get('/beveiligd')
        .set('Cookie', `${cookieNaam}=${'a'.repeat(43)}`)
        .set('X-Tenant-Id', TENANT_B)
        .expect(401);
    });

    it.each([
      ['leeg', ''],
      ['te kort', 'abc'],
      ['te lang', 'a'.repeat(60)],
      ['met tekens buiten base64url', `${'a'.repeat(42)}!`],
      ['een SQL-fragment', "' OR 1=1 --"],
    ])('weigert een cookie dat %s is', async (_omschrijving, waarde) => {
      await request(app.getHttpServer())
        .get('/beveiligd')
        .set('Cookie', `${cookieNaam}=${encodeURIComponent(waarde)}`)
        .expect(401);
    });

    it('weigert een token dat in een andere cookienaam staat', async () => {
      // De guard leest één naam, bepaald door de configuratie. Een token in een
      // zelfverzonnen cookie mag geen sessie opleveren.
      const sessie = await sessies.aanmaken(SUBJECT_A);
      expect(sessie).not.toBeNull();

      await request(app.getHttpServer())
        .get('/beveiligd')
        .set('Cookie', `mijn_eigen_cookie=${sessie!.token}`)
        .expect(401);

      await sessies.beeindigen(sessie!.token);
    });
  });

  describe('een geldige sessie geeft de tenant uit de database', () => {
    it('laat het verzoek door en levert tenant, gebruiker en rol', async () => {
      const sessie = await sessies.aanmaken(SUBJECT_A);
      expect(sessie).not.toBeNull();

      const antwoord = await request(app.getHttpServer())
        .get('/beveiligd')
        .set('Cookie', `${cookieNaam}=${sessie!.token}`)
        .expect(200);

      expect(antwoord.body).toEqual({
        tenantId: TENANT_A,
        userId: USER_A,
        role: 'admin',
      });

      await sessies.beeindigen(sessie!.token);
    });

    it('geeft elke sessie zijn eigen tenant — de grens ligt in de database', async () => {
      // De kern van P0. Twee sessies, twee tenants, en er is geen enkel veld in
      // het verzoek waarmee de een de tenant van de ander kan opgeven.
      const sessieA = await sessies.aanmaken(SUBJECT_A);
      const sessieB = await sessies.aanmaken(SUBJECT_B);

      const antwoordA = await request(app.getHttpServer())
        .get('/beveiligd')
        .set('Cookie', `${cookieNaam}=${sessieA!.token}`)
        .expect(200);

      const antwoordB = await request(app.getHttpServer())
        .get('/beveiligd')
        .set('Cookie', `${cookieNaam}=${sessieB!.token}`)
        .expect(200);

      expect(alsContext(antwoordA.body).tenantId).toBe(TENANT_A);
      expect(alsContext(antwoordB.body).tenantId).toBe(TENANT_B);

      await sessies.beeindigen(sessieA!.token);
      await sessies.beeindigen(sessieB!.token);
    });

    it('negeert een meegestuurde tenant in header of query', async () => {
      // Dit is de faalvorm die de verwijderde branch feat/fase0-skeleton-vendors
      // had: de tenant kwam blind uit een header. Zou die code ooit terugkeren,
      // dan valt deze test om.
      const sessie = await sessies.aanmaken(SUBJECT_A);

      const antwoord = await request(app.getHttpServer())
        .get('/beveiligd')
        .query({ tenant: TENANT_B, tenantId: TENANT_B })
        .set('Cookie', `${cookieNaam}=${sessie!.token}`)
        .set('X-Tenant-Id', TENANT_B)
        .expect(200);

      expect(alsContext(antwoord.body).tenantId).toBe(TENANT_A);

      await sessies.beeindigen(sessie!.token);
    });
  });

  describe('de sessielevenscyclus werkt door in de guard', () => {
    it('weigert het verzoek zodra de sessie beëindigd is', async () => {
      const sessie = await sessies.aanmaken(SUBJECT_A);

      await request(app.getHttpServer())
        .get('/beveiligd')
        .set('Cookie', `${cookieNaam}=${sessie!.token}`)
        .expect(200);

      await sessies.beeindigen(sessie!.token);

      // Hetzelfde cookie, nu waardeloos. Uitloggen werkt server-side, niet
      // alleen door het cookie bij de browser weg te halen.
      await request(app.getHttpServer())
        .get('/beveiligd')
        .set('Cookie', `${cookieNaam}=${sessie!.token}`)
        .expect(401);
    });

    it('weigert een verlopen sessie', async () => {
      // Twee seconden geldig, dan wachten. Trager dan een UPDATE op
      // verloopt_op, maar dat kán niet: de runtime-rol mag niet bij de tabel —
      // precies wat migratie 0010 met REVOKE ALL afdwingt. Deze test is bij het
      // schrijven eerst op 'permission denied' gestuit, en dat is het bewijs
      // dat die deur dicht zit. Zelfde aanpak als in sessie.e2e-spec.ts.
      const token = genereerSessieToken();

      await client.query('SELECT * FROM clm.sessie_aanmaken($1, $2, $3)', [
        hashSessieToken(token),
        SUBJECT_A,
        '2 seconds',
      ]);

      // Bewust géén verzoek vooraf: de guard schuift het venster naar 8 uur op
      // (dat is het glijdende venster), en dan verloopt deze sessie niet meer.
      await new Promise((klaar) => setTimeout(klaar, 2500));

      await request(app.getHttpServer())
        .get('/beveiligd')
        .set('Cookie', `${cookieNaam}=${token}`)
        .expect(401);

      await sessies.beeindigen(token);
    }, 15000);

    it('schuift het venster op bij gebruik — een actieve gebruiker wordt niet uitgelogd', async () => {
      // Tegenhanger van de vorige test: dezelfde korte geldigheid, maar nu mét
      // een verzoek ertussen. Dat verzoek verlengt naar 8 uur, dus na het
      // wachten werkt de sessie nog. Zonder het glijdende venster zou deze
      // test 401 geven.
      const token = genereerSessieToken();

      await client.query('SELECT * FROM clm.sessie_aanmaken($1, $2, $3)', [
        hashSessieToken(token),
        SUBJECT_A,
        '2 seconds',
      ]);

      await request(app.getHttpServer())
        .get('/beveiligd')
        .set('Cookie', `${cookieNaam}=${token}`)
        .expect(200);

      await new Promise((klaar) => setTimeout(klaar, 2500));

      await request(app.getHttpServer())
        .get('/beveiligd')
        .set('Cookie', `${cookieNaam}=${token}`)
        .expect(200);

      await sessies.beeindigen(token);
    }, 15000);

    it('geeft geen sessie aan een gebruiker zonder actief membership', async () => {
      // Authenticatie is niet hetzelfde als autorisatie: deze gebruiker bestaat
      // en kan bij Entra inloggen, maar hoort bij geen enkele omgeving.
      expect(await sessies.aanmaken(SUBJECT_ZONDER_LID)).toBeNull();
    });

    it('geeft geen sessie aan een onbekend subject', async () => {
      expect(await sessies.aanmaken('oid-bestaat-niet')).toBeNull();
    });

    it('trekt de sessie in zodra het membership vervalt bij de volgende login', async () => {
      // Een ingetrokken membership hoort geen nieuwe sessie meer op te leveren.
      // De lopende sessie blijft geldig tot hij verloopt — bewust: de rol wordt
      // bij het inloggen vastgelegd, niet bij elk verzoek opnieuw opgezocht.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${TENANT_B}'`);
      await client.query(
        'UPDATE clm.tenant_membership SET deleted_at = now() WHERE user_id = $1',
        [USER_B],
      );
      await client.query('COMMIT');

      expect(await sessies.aanmaken(SUBJECT_B)).toBeNull();

      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${TENANT_B}'`);
      await client.query(
        'UPDATE clm.tenant_membership SET deleted_at = NULL WHERE user_id = $1',
        [USER_B],
      );
      await client.query('COMMIT');
    });
  });

  describe('het ruwe token blijft binnen de sessielaag', () => {
    it('zet het token niet in de sessiecontext die naar de controller gaat', async () => {
      // SessieContext gaat naar plekken waar het ruwe token niets te zoeken
      // heeft. Alleen de guard bewaart het apart, voor uitloggen.
      const sessie = await sessies.aanmaken(SUBJECT_A);

      const context = await sessies.oplossen(sessie!.token);

      expect(context).not.toBeNull();
      expect(JSON.stringify(context)).not.toContain(sessie!.token);

      await sessies.beeindigen(sessie!.token);
    });
  });
});
