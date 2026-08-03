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
 * Vendordetail, wijzigen en contactpersonen (fase 2c).
 *
 * Twee vragen staan hier centraal, en beide zijn belangrijker dan "werkt het":
 *
 *   1. **Kan een reviewer schrijven?** Tot 2026-08-03 stond `POST /vendors`
 *      open voor elke geldige sessie — `reviewer` was een label in de sidebar
 *      zonder betekenis. Dat was een bewust openstaand punt (rechten-ontwerp
 *      §6); deze suite bewijst dat het dicht is.
 *
 *   2. **Kan tenant A bij de gegevens van tenant B?** Elke nieuwe route is een
 *      nieuwe kans om de tenantgrens te missen. Detail, wijzigen, verwijderen
 *      en de contactroutes worden alle vier cross-tenant beproefd.
 */

const { tenant, adminUser, reviewerUser, andereTenant, andereUser } =
  TEST_IDS['vendor-detail'];

// Uniek per run: external_subject heeft een globale unieke index.
const STEMPEL = Date.now();
const SUBJECT_ADMIN = `oid-detail-admin-${STEMPEL}`;
const SUBJECT_REVIEWER = `oid-detail-reviewer-${STEMPEL}`;
const SUBJECT_ANDER = `oid-detail-ander-${STEMPEL}`;

interface ContactAntwoord {
  contactId: string;
  fullName: string;
  email: string | null;
  isPrimary: boolean;
}

interface DetailAntwoord {
  vendorId: string;
  name: string;
  kvkNumber: string | null;
  city: string | null;
  website: string | null;
  categoryCode: string | null;
  updatedAt: string | null;
  contacten: ContactAntwoord[];
}

function alsDetail(body: unknown): DetailAntwoord {
  return body as DetailAntwoord;
}

function alsContact(body: unknown): ContactAntwoord {
  return body as ContactAntwoord;
}

async function verwijderTestdata(client: Client): Promise<void> {
  for (const t of [tenant, andereTenant]) {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${t}'`);
    await client.query('DELETE FROM clm.vendor_contact WHERE tenant_id = $1', [
      t,
    ]);
    await client.query('DELETE FROM clm.vendor WHERE tenant_id = $1', [t]);
    await client.query(
      'DELETE FROM clm.tenant_membership WHERE tenant_id = $1',
      [t],
    );
    await client.query('DELETE FROM clm."user" WHERE tenant_id = $1', [t]);
    await client.query('DELETE FROM clm.tenant WHERE tenant_id = $1', [t]);
    await client.query('COMMIT');
  }
}

describe('Vendordetail en contactpersonen (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let client: Client;
  let sessies: SessieService;

  let adminCookie: string;
  let reviewerCookie: string;
  let andereTenantCookie: string;
  let vendorId: string;

  const cookieNaam = cookieInstellingen().naam;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await verwijderTestdata(client);

    // Tenant met een admin én een reviewer: het verschil tussen die twee is
    // wat deze suite grotendeels meet.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [tenant, 'detail-test'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4), ($5, $2, $6, $7)`,
      [
        adminUser,
        tenant,
        'Anna Admin',
        SUBJECT_ADMIN,
        reviewerUser,
        'Rob Reviewer',
        SUBJECT_REVIEWER,
      ],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin'), ($3, $2, 'reviewer')`,
      [adminUser, tenant, reviewerUser],
    );
    await client.query('COMMIT');

    // Tweede tenant, om cross-tenant toegang uit te lokken.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_tenant_id = '${andereTenant}'`);
    await client.query(
      'INSERT INTO clm.tenant (tenant_id, name) VALUES ($1, $2)',
      [andereTenant, 'detail-test-ander'],
    );
    await client.query(
      `INSERT INTO clm."user" (user_id, tenant_id, full_name, external_subject)
       VALUES ($1, $2, $3, $4)`,
      [andereUser, andereTenant, 'Bob Buiten', SUBJECT_ANDER],
    );
    await client.query(
      `INSERT INTO clm.tenant_membership (user_id, tenant_id, role)
       VALUES ($1, $2, 'admin')`,
      [andereUser, andereTenant],
    );
    await client.query('COMMIT');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    server = app.getHttpServer();
    sessies = app.get(SessieService);

    const adminSessie = await sessies.aanmaken(SUBJECT_ADMIN);
    const reviewerSessie = await sessies.aanmaken(SUBJECT_REVIEWER);
    const andereSessie = await sessies.aanmaken(SUBJECT_ANDER);

    adminCookie = `${cookieNaam}=${adminSessie!.token}`;
    reviewerCookie = `${cookieNaam}=${reviewerSessie!.token}`;
    andereTenantCookie = `${cookieNaam}=${andereSessie!.token}`;

    const aangemaakt = await request(server)
      .post('/vendors')
      .set('Cookie', adminCookie)
      .send({
        name: 'Detailtest B.V.',
        kvkNumber: '11223344',
        city: 'Utrecht',
        contact: { fullName: 'Eerste Contact', email: 'eerste@voorbeeld.nl' },
      })
      .expect(201);

    vendorId = (aangemaakt.body as { vendorId: string }).vendorId;
  });

  afterAll(async () => {
    await app.close();
    await verwijderTestdata(client);
    await client.end();
  });

  // ── Detail ophalen ───────────────────────────────────────────────────────

  describe('GET /vendors/:id', () => {
    it('geeft de leverancier met zijn contactpersonen', async () => {
      const antwoord = await request(server)
        .get(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const detail = alsDetail(antwoord.body);

      expect(detail.name).toBe('Detailtest B.V.');
      expect(detail.kvkNumber).toBe('11223344');
      expect(detail.contacten).toHaveLength(1);
      expect(detail.contacten[0].fullName).toBe('Eerste Contact');

      // De eerste contactpersoon is vanzelf primair: anders heeft een
      // leverancier wel contacten maar geen aanspreekpunt.
      expect(detail.contacten[0].isPrimary).toBe(true);
    });

    it('lekt geen tenant-id', async () => {
      const antwoord = await request(server)
        .get(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(JSON.stringify(antwoord.body)).not.toContain(tenant);
    });

    it('geeft 401 zonder sessie', async () => {
      await request(server).get(`/vendors/${vendorId}`).expect(401);
    });

    it('geeft 404 bij een id dat geen UUID is', async () => {
      // Zonder vormcontrole levert dit een databasefout op ("invalid input
      // syntax for type uuid") die als 500 naar buiten komt — een fout van de
      // aanvrager die eruitziet als een storing.
      await request(server)
        .get('/vendors/onzin')
        .set('Cookie', adminCookie)
        .expect(404);
    });

    it('geeft 404 voor een leverancier van een andere tenant', async () => {
      // Niet 403: dat zou bevestigen dat dit id ergens bestaat.
      await request(server)
        .get(`/vendors/${vendorId}`)
        .set('Cookie', andereTenantCookie)
        .expect(404);
    });
  });

  // ── Wijzigen ─────────────────────────────────────────────────────────────

  describe('PATCH /vendors/:id', () => {
    it('wijzigt alleen de meegestuurde velden', async () => {
      const antwoord = await request(server)
        .patch(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .send({ city: 'Rotterdam' })
        .expect(200);

      const detail = alsDetail(antwoord.body);

      expect(detail.city).toBe('Rotterdam');
      // Niet meegestuurd betekent "niet aangeraakt". Zou dit veld op null
      // staan, dan wist elk formulier dat niet álle velden kent stilzwijgend
      // gegevens.
      expect(detail.name).toBe('Detailtest B.V.');
      expect(detail.kvkNumber).toBe('11223344');
      expect(detail.updatedAt).not.toBeNull();
    });

    it('maakt een veld leeg bij een expliciete null', async () => {
      await request(server)
        .patch(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .send({ website: 'https://voorbeeld.nl' })
        .expect(200);

      const antwoord = await request(server)
        .patch(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .send({ website: null })
        .expect(200);

      expect(alsDetail(antwoord.body).website).toBeNull();
    });

    it('weigert een ongeldig KvK-nummer met het veld erbij', async () => {
      const antwoord = await request(server)
        .patch(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .send({ kvkNumber: '123' })
        .expect(400);

      expect((antwoord.body as { veld: string }).veld).toBe('kvkNumber');
    });

    it('weigert een onbekende categorie met 400, niet met 500', async () => {
      // De foreign key naar ref.vendor_category geeft een 23503. Zonder
      // vertaling komt dat als 500 naar buiten, terwijl het scherm gewoon een
      // verkeerde code stuurde.
      await request(server)
        .patch(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .send({ categoryCode: 'bestaat-niet' })
        .expect(400);
    });

    it('geeft 404 voor een leverancier van een andere tenant', async () => {
      await request(server)
        .patch(`/vendors/${vendorId}`)
        .set('Cookie', andereTenantCookie)
        .send({ city: 'Overgenomen' })
        .expect(404);

      // En de waarde is écht niet veranderd — een 404 die tóch schrijft is
      // erger dan een 200.
      const controle = await request(server)
        .get(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(alsDetail(controle.body).city).toBe('Rotterdam');
    });
  });

  // ── Rolcontrole ──────────────────────────────────────────────────────────

  describe('een reviewer mag lezen maar niet schrijven', () => {
    it('mag de lijst en het detail zien', async () => {
      await request(server)
        .get('/vendors')
        .set('Cookie', reviewerCookie)
        .expect(200);

      await request(server)
        .get(`/vendors/${vendorId}`)
        .set('Cookie', reviewerCookie)
        .expect(200);
    });

    it('mag geen leverancier aanmaken', async () => {
      await request(server)
        .post('/vendors')
        .set('Cookie', reviewerCookie)
        .send({ name: 'Mag niet' })
        .expect(403);
    });

    it('mag geen leverancier wijzigen', async () => {
      await request(server)
        .patch(`/vendors/${vendorId}`)
        .set('Cookie', reviewerCookie)
        .send({ city: 'Mag niet' })
        .expect(403);
    });

    it('mag geen leverancier verwijderen', async () => {
      await request(server)
        .delete(`/vendors/${vendorId}`)
        .set('Cookie', reviewerCookie)
        .expect(403);
    });

    it('mag geen contactpersoon toevoegen, wijzigen of verwijderen', async () => {
      await request(server)
        .post(`/vendors/${vendorId}/contacts`)
        .set('Cookie', reviewerCookie)
        .send({ fullName: 'Mag niet' })
        .expect(403);

      const detail = await request(server)
        .get(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const contactId = alsDetail(detail.body).contacten[0].contactId;

      await request(server)
        .patch(`/vendors/${vendorId}/contacts/${contactId}`)
        .set('Cookie', reviewerCookie)
        .send({ fullName: 'Mag niet' })
        .expect(403);

      await request(server)
        .delete(`/vendors/${vendorId}/contacts/${contactId}`)
        .set('Cookie', reviewerCookie)
        .expect(403);
    });

    it('verandert niets bij een geweigerde poging', async () => {
      // Een 403 die tóch schrijft is de gevaarlijkste faalvorm: de aanvrager
      // denkt dat het mislukt is, de data is wél gewijzigd.
      await request(server)
        .patch(`/vendors/${vendorId}`)
        .set('Cookie', reviewerCookie)
        .send({ name: 'Overgenomen door reviewer' })
        .expect(403);

      const controle = await request(server)
        .get(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(alsDetail(controle.body).name).toBe('Detailtest B.V.');
    });
  });

  // ── Contactpersonen ──────────────────────────────────────────────────────

  describe('contactpersonen beheren', () => {
    it('voegt een contactpersoon toe zonder de bestaande primair af te nemen', async () => {
      const antwoord = await request(server)
        .post(`/vendors/${vendorId}/contacts`)
        .set('Cookie', adminCookie)
        .send({ fullName: 'Tweede Contact', email: 'tweede@voorbeeld.nl' })
        .expect(201);

      expect(alsContact(antwoord.body).isPrimary).toBe(false);

      const detail = await request(server)
        .get(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const contacten = alsDetail(detail.body).contacten;
      expect(contacten).toHaveLength(2);
      expect(contacten.filter((c) => c.isPrimary)).toHaveLength(1);
    });

    it('verplaatst de primaire vlag, zodat er nooit twee zijn', async () => {
      const detail = await request(server)
        .get(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const nietPrimair = alsDetail(detail.body).contacten.find(
        (c) => !c.isPrimary,
      )!;

      await request(server)
        .patch(`/vendors/${vendorId}/contacts/${nietPrimair.contactId}`)
        .set('Cookie', adminCookie)
        .send({ isPrimary: true })
        .expect(200);

      const na = await request(server)
        .get(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const primairen = alsDetail(na.body).contacten.filter((c) => c.isPrimary);
      expect(primairen).toHaveLength(1);
      expect(primairen[0].contactId).toBe(nietPrimair.contactId);
    });

    it('weigert een ongeldig e-mailadres', async () => {
      const antwoord = await request(server)
        .post(`/vendors/${vendorId}/contacts`)
        .set('Cookie', adminCookie)
        .send({ fullName: 'Derde', email: 'geen-apenstaartje' })
        .expect(400);

      expect((antwoord.body as { veld: string }).veld).toBe('contact.email');
    });

    it('draagt bij verwijderen de primaire vlag over', async () => {
      const detail = await request(server)
        .get(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const primair = alsDetail(detail.body).contacten.find(
        (c) => c.isPrimary,
      )!;

      await request(server)
        .delete(`/vendors/${vendorId}/contacts/${primair.contactId}`)
        .set('Cookie', adminCookie)
        .expect(204);

      const na = await request(server)
        .get(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const over = alsDetail(na.body).contacten;
      expect(over).toHaveLength(1);

      // Zonder overdracht houdt de leverancier contacten over zonder
      // aanspreekpunt, en dat valt pas op bij het versturen van een
      // uitnodiging.
      expect(over[0].isPrimary).toBe(true);
    });

    it('geeft 404 bij een contactpersoon van een andere leverancier', async () => {
      const ander = await request(server)
        .post('/vendors')
        .set('Cookie', adminCookie)
        .send({ name: 'Andere leverancier', kvkNumber: '99887755' })
        .expect(201);

      const anderId = (ander.body as { vendorId: string }).vendorId;

      const detail = await request(server)
        .get(`/vendors/${vendorId}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const contactVanEerste = alsDetail(detail.body).contacten[0].contactId;

      // Het contact bestaat, maar niet bij deze leverancier. Zonder de
      // vendor_id-controle in de query zou dit slagen.
      await request(server)
        .patch(`/vendors/${anderId}/contacts/${contactVanEerste}`)
        .set('Cookie', adminCookie)
        .send({ fullName: 'Gekaapt' })
        .expect(404);
    });
  });

  // ── Verwijderen ──────────────────────────────────────────────────────────

  describe('DELETE /vendors/:id', () => {
    it('verwijdert de leverancier en zijn contactpersonen (soft delete)', async () => {
      const nieuw = await request(server)
        .post('/vendors')
        .set('Cookie', adminCookie)
        .send({
          name: 'Weg ermee B.V.',
          kvkNumber: '55667788',
          contact: { fullName: 'Gaat mee' },
        })
        .expect(201);

      const wegId = (nieuw.body as { vendorId: string }).vendorId;

      await request(server)
        .delete(`/vendors/${wegId}`)
        .set('Cookie', adminCookie)
        .expect(204);

      await request(server)
        .get(`/vendors/${wegId}`)
        .set('Cookie', adminCookie)
        .expect(404);

      // Soft delete: de rij bestaat nog, maar met deleted_at. Een harde DELETE
      // zou een leverancier weghalen die in een surveyronde voorkomt, en die
      // respons is bewijsmateriaal.
      await client.query(`SET app.current_tenant_id = '${tenant}'`);
      const { rows } = await client.query<{ n: string }>(
        'SELECT count(*) AS n FROM clm.vendor WHERE vendor_id = $1 AND deleted_at IS NOT NULL',
        [wegId],
      );
      expect(Number(rows[0].n)).toBe(1);

      const contacten = await client.query<{ n: string }>(
        'SELECT count(*) AS n FROM clm.vendor_contact WHERE vendor_id = $1 AND deleted_at IS NULL',
        [wegId],
      );
      expect(Number(contacten.rows[0].n)).toBe(0);
    });

    it('geeft 404 bij een tweede poging', async () => {
      const nieuw = await request(server)
        .post('/vendors')
        .set('Cookie', adminCookie)
        .send({ name: 'Eenmalig B.V.', kvkNumber: '44556677' })
        .expect(201);

      const id = (nieuw.body as { vendorId: string }).vendorId;

      await request(server)
        .delete(`/vendors/${id}`)
        .set('Cookie', adminCookie)
        .expect(204);

      await request(server)
        .delete(`/vendors/${id}`)
        .set('Cookie', adminCookie)
        .expect(404);
    });
  });
});
