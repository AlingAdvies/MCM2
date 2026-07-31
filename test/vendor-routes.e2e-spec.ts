import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { SessieService } from '../src/auth/sessie.service';
import { cookieInstellingen } from '../src/auth/sessie';
import { TEST_IDS } from './test-ids';

/**
 * De eerste beheerroutes, van HTTP tot database (fase 2 van het plan).
 *
 * Dit is de suite die aantoont dat de laag uit fase 1 werkt waar het telt: een
 * échte route, met een échte sessie, die gegevens schrijft en teruggeeft.
 *
 * De vraag die deze suite beantwoordt is niet "werkt het aanmaken" maar:
 * **kan tenant A ooit iets zien of schrijven dat van tenant B is?** Vandaar
 * dat er twee tenants in het spel zijn en de meeste tests over de grens gaan.
 */

const { tenantA, tenantB, userA, userB } = TEST_IDS['vendor-routes'];

const SUBJECT_A = `oid-vendor-a-${Date.now()}`;
const SUBJECT_B = `oid-vendor-b-${Date.now()}`;

interface VendorLijstAntwoord {
  vendors: Array<{
    vendorId: string;
    name: string;
    kvkNumber: string | null;
    aantalContacten: number;
  }>;
}

interface AanmaakAntwoord {
  vendorId: string;
  name: string;
  contactId: string | null;
}

function alsLijst(body: unknown): VendorLijstAntwoord {
  return body as VendorLijstAntwoord;
}

function alsAangemaakt(body: unknown): AanmaakAntwoord {
  return body as AanmaakAntwoord;
}

async function verwijderTestdata(client: Client): Promise<void> {
  for (const tenant of [tenantA, tenantB]) {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await client.query('DELETE FROM clm.vendor_contact WHERE tenant_id = $1', [
      tenant,
    ]);
    await client.query('DELETE FROM clm.vendor WHERE tenant_id = $1', [tenant]);
    await client.query(
      'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
      [tenant],
    );
    await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [tenant]);
    await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [tenant]);
    await client.query('COMMIT');
  }
}

describe('Vendorroutes (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let sessies: SessieService;
  let cookieA: string;
  let cookieB: string;
  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    for (const [tenant, user, subject, naam] of [
      [tenantA, userA, SUBJECT_A, 'Anna uit A'],
      [tenantB, userB, SUBJECT_B, 'Bob uit B'],
    ] as const) {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
      await client.query(
        'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
        [tenant, `vendor-test-${tenant.slice(-2)}`],
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

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    sessies = moduleRef.get(SessieService);

    const sessieA = await sessies.aanmaken(SUBJECT_A);
    const sessieB = await sessies.aanmaken(SUBJECT_B);

    expect(sessieA).not.toBeNull();
    expect(sessieB).not.toBeNull();

    cookieA = `${cookieNaam}=${sessieA!.token}`;
    cookieB = `${cookieNaam}=${sessieB!.token}`;
  }, 30000);

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(client);
    await client.end();
  }, 30000);

  describe('zonder geldige sessie is er geen toegang', () => {
    it('weigert de lijst zonder cookie', async () => {
      await request(server).get('/vendors').expect(401);
    });

    it('weigert aanmaken zonder cookie', async () => {
      await request(server)
        .post('/vendors')
        .send({ name: 'Sluiproute B.V.' })
        .expect(401);
    });

    it('weigert een verzoek dat de tenant in een kopregel meestuurt', async () => {
      // De faalvorm uit de weggegooide branch feat/fase0-skeleton-vendors.
      // Zou die terugkeren, dan valt deze test om.
      await request(server)
        .get('/vendors')
        .set('X-Tenant-Id', tenantB)
        .expect(401);
    });

    it('weigert een verzoek dat de tenant in de query meestuurt', async () => {
      await request(server)
        .get('/vendors')
        .query({ tenant: tenantB, tenantId: tenantB })
        .expect(401);
    });
  });

  describe('aanmaken en teruglezen binnen één tenant', () => {
    it('maakt een leverancier aan en geeft hem terug in de lijst', async () => {
      const aanmaak = await request(server)
        .post('/vendors')
        .set('Cookie', cookieA)
        .send({
          name: 'Ketentest B.V.',
          kvkNumber: '12345678',
          city: 'Utrecht',
          website: 'https://ketentest.nl',
        })
        .expect(201);

      const aangemaakt = alsAangemaakt(aanmaak.body);
      expect(aangemaakt.vendorId).toMatch(/^[0-9a-f-]{36}$/);
      expect(aangemaakt.name).toBe('Ketentest B.V.');

      const lijst = await request(server)
        .get('/vendors')
        .set('Cookie', cookieA)
        .expect(200);

      const gevonden = alsLijst(lijst.body).vendors.find(
        (v) => v.vendorId === aangemaakt.vendorId,
      );

      expect(gevonden).toBeDefined();
      expect(gevonden!.name).toBe('Ketentest B.V.');
      expect(gevonden!.kvkNumber).toBe('12345678');
    });

    it('maakt de contactpersoon aan in dezelfde stap', async () => {
      const aanmaak = await request(server)
        .post('/vendors')
        .set('Cookie', cookieA)
        .send({
          name: 'Met Contact B.V.',
          contact: {
            fullName: 'Petra Pietersen',
            email: 'petra@metcontact.nl',
            jobTitle: 'Security Officer',
          },
        })
        .expect(201);

      const aangemaakt = alsAangemaakt(aanmaak.body);
      expect(aangemaakt.contactId).not.toBeNull();

      const lijst = await request(server)
        .get('/vendors')
        .set('Cookie', cookieA)
        .expect(200);

      const gevonden = alsLijst(lijst.body).vendors.find(
        (v) => v.vendorId === aangemaakt.vendorId,
      );

      expect(gevonden!.aantalContacten).toBe(1);
    });

    it('accepteert een leverancier zonder contactpersoon', async () => {
      const aanmaak = await request(server)
        .post('/vendors')
        .set('Cookie', cookieA)
        .send({ name: 'Zonder Contact B.V.' })
        .expect(201);

      expect(alsAangemaakt(aanmaak.body).contactId).toBeNull();
    });
  });

  describe('de tenantgrens houdt stand', () => {
    it('toont een leverancier van A niet aan B', async () => {
      // De kern van deze suite. Twee sessies, twee tenants, dezelfde route.
      const aanmaak = await request(server)
        .post('/vendors')
        .set('Cookie', cookieA)
        .send({ name: 'Alleen Van A B.V.' })
        .expect(201);

      const vendorVanA = alsAangemaakt(aanmaak.body).vendorId;

      const lijstB = await request(server)
        .get('/vendors')
        .set('Cookie', cookieB)
        .expect(200);

      const gevonden = alsLijst(lijstB.body).vendors.find(
        (v) => v.vendorId === vendorVanA,
      );

      expect(gevonden).toBeUndefined();
    });

    it('laat hetzelfde KvK-nummer toe in een andere tenant', async () => {
      // De unieke index staat op (tenant_id, kvk_number), niet op kvk_number
      // alleen. Twee klanten mogen dezelfde leverancier in hun eigen
      // administratie hebben — dat is de normale situatie, geen uitzondering.
      await request(server)
        .post('/vendors')
        .set('Cookie', cookieA)
        .send({ name: 'Gedeelde Leverancier B.V.', kvkNumber: '87654321' })
        .expect(201);

      await request(server)
        .post('/vendors')
        .set('Cookie', cookieB)
        .send({ name: 'Gedeelde Leverancier B.V.', kvkNumber: '87654321' })
        .expect(201);
    });

    it('weigert hetzelfde KvK-nummer binnen dezelfde tenant', async () => {
      await request(server)
        .post('/vendors')
        .set('Cookie', cookieA)
        .send({ name: 'Eerste Inschrijving B.V.', kvkNumber: '11223344' })
        .expect(201);

      await request(server)
        .post('/vendors')
        .set('Cookie', cookieA)
        .send({ name: 'Tweede Poging B.V.', kvkNumber: '11223344' })
        .expect(409);
    });

    it('schrijft naar de tenant uit de sessie, niet uit de body', async () => {
      // Een poging om via de body in een andere tenant te schrijven. Het veld
      // wordt niet gelezen; de leverancier hoort in A te landen.
      const aanmaak = await request(server)
        .post('/vendors')
        .set('Cookie', cookieA)
        .send({ name: 'Body-tenant B.V.', tenantId: tenantB })
        .expect(201);

      const vendorId = alsAangemaakt(aanmaak.body).vendorId;

      const lijstB = await request(server)
        .get('/vendors')
        .set('Cookie', cookieB)
        .expect(200);

      expect(
        alsLijst(lijstB.body).vendors.find((v) => v.vendorId === vendorId),
      ).toBeUndefined();

      const lijstA = await request(server)
        .get('/vendors')
        .set('Cookie', cookieA)
        .expect(200);

      expect(
        alsLijst(lijstA.body).vendors.find((v) => v.vendorId === vendorId),
      ).toBeDefined();
    });
  });

  describe('invoercontrole', () => {
    it('weigert een leverancier zonder naam', async () => {
      const antwoord = await request(server)
        .post('/vendors')
        .set('Cookie', cookieA)
        .send({ city: 'Amsterdam' })
        .expect(400);

      // Het veld gaat mee zodat het scherm de melding op de juiste plek zet.
      expect((antwoord.body as { veld?: string }).veld).toBe('Naam');
    });

    it.each([
      ['te kort', '123'],
      ['met letters', 'abcdefgh'],
      ['te lang', '123456789'],
    ])('weigert een KvK-nummer dat %s is', async (_omschrijving, waarde) => {
      await request(server)
        .post('/vendors')
        .set('Cookie', cookieA)
        .send({ name: 'KvK-test B.V.', kvkNumber: waarde })
        .expect(400);
    });

    it('accepteert een KvK-nummer met spaties en punten', async () => {
      // Mensen typen 1234 5678. Dat weigeren is onnodig streng.
      const aanmaak = await request(server)
        .post('/vendors')
        .set('Cookie', cookieA)
        .send({ name: 'Spaties B.V.', kvkNumber: '9988 7766' })
        .expect(201);

      const lijst = await request(server)
        .get('/vendors')
        .set('Cookie', cookieA)
        .expect(200);

      const gevonden = alsLijst(lijst.body).vendors.find(
        (v) => v.vendorId === alsAangemaakt(aanmaak.body).vendorId,
      );

      expect(gevonden!.kvkNumber).toBe('99887766');
    });

    it('weigert een onherkenbaar e-mailadres', async () => {
      await request(server)
        .post('/vendors')
        .set('Cookie', cookieA)
        .send({
          name: 'Mailtest B.V.',
          contact: { fullName: 'Jan Jansen', email: 'geen-apenstaartje' },
        })
        .expect(400);
    });

    it('meldt een half ingevulde contactpersoon in plaats van hem te negeren', async () => {
      // E-mail wél, naam niet: dat is een vergeten veld, geen bewuste keuze
      // om de contactpersoon weg te laten. Stilzwijgend negeren zou betekenen
      // dat de gebruiker denkt dat hij iets heeft ingevuld.
      const antwoord = await request(server)
        .post('/vendors')
        .set('Cookie', cookieA)
        .send({
          name: 'Half Ingevuld B.V.',
          contact: { email: 'iemand@voorbeeld.nl' },
        })
        .expect(400);

      expect((antwoord.body as { veld?: string }).veld).toBe(
        'contact.fullName',
      );
    });
  });
});
