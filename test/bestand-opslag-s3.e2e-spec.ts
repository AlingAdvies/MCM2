import {
  CreateBucketCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

import {
  BestandOntbreektFout,
  BestandOpslagService,
} from '../src/survey/bestand-opslag.service';

/**
 * De S3-route van de bijlagen-opslag (#46), tegen een nagebootste S3.
 *
 * Productie bewaart bijlagen in S3; lokaal en in de andere suites gaat alles
 * naar schijf. Zonder deze suite zou de S3-route pas op productie voor het
 * eerst draaien. Adobe S3Mock spreekt hetzelfde protocol, dus wat hier slaagt,
 * gebruikt dezelfde SDK-aanroepen als productie — alleen de rechten (taakrol,
 * ListBucket) zijn hier niet te toetsen; die bewijst de rookproef na uitrol.
 *
 * S3Mock draait op een vast adres: `npm run test:db` start hem lokaal, CI in
 * een eigen stap. Draait hij niet, dan faalt deze suite met uitleg — nooit
 * stilzwijgend overslaan, want dan bewijst groen niets.
 */
const ENDPOINT = process.env.S3_TEST_ENDPOINT ?? 'http://127.0.0.1:55441';
const BUCKET = 'mcm2-test-bijlagen';

function sleutel(): string {
  return `${randomUUID()}/${randomUUID()}/${randomUUID()}`;
}

describe('Bijlagen-opslag in S3 (#46)', () => {
  let opslag: BestandOpslagService;
  let s3: S3Client;

  beforeAll(async () => {
    const instellingen = {
      region: 'eu-west-1',
      endpoint: ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    };
    s3 = new S3Client(instellingen);

    try {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch (fout) {
      const naam = (fout as { name?: string }).name;
      if (
        naam !== 'BucketAlreadyOwnedByYou' &&
        naam !== 'BucketAlreadyExists'
      ) {
        throw new Error(
          `Nagebootste S3 niet bereikbaar op ${ENDPOINT} (${naam ?? String(fout)}).\n` +
            'Lokaal: start hem met `npm run test:db -- "waarvoor"` (of --hergebruik).',
        );
      }
    }

    process.env.S3_BUCKET = BUCKET;
    process.env.S3_ENDPOINT = ENDPOINT;
    process.env.S3_ACCESS_KEY = 'test';
    process.env.S3_SECRET_KEY = 'test';
    opslag = new BestandOpslagService();
  });

  afterAll(() => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    s3.destroy();
  });

  it('bewaart en leest een bestand byte voor byte terug', async () => {
    const key = sleutel();
    const inhoud = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0a]);

    await opslag.bewaar(key, inhoud);

    // Rechtstreeks in de bucket nagaan, niet alleen via de service: anders
    // zou een service die stilletjes naar schijf schreef hier ook slagen.
    const kop = await s3.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    expect(kop.ContentLength).toBe(inhoud.length);

    expect(Buffer.compare(await opslag.lees(key), inhoud)).toBe(0);
  });

  it('een ontbrekend bestand geeft BestandOntbreektFout, geen generieke fout', async () => {
    await expect(opslag.lees(sleutel())).rejects.toBeInstanceOf(
      BestandOntbreektFout,
    );
  });

  it('verwijderen haalt het bestand weg en is stil bij een ontbrekend bestand', async () => {
    const key = sleutel();
    await opslag.bewaar(key, Buffer.from('weg ermee'));

    await opslag.verwijder(key);
    await expect(opslag.lees(key)).rejects.toBeInstanceOf(BestandOntbreektFout);

    await expect(opslag.verwijder(sleutel())).resolves.toBeUndefined();
  });

  it('weigert een sleutel met .. of een leidende slash', async () => {
    for (const fout of ['../etc/passwd', '/absoluut/pad', 'a/../../b']) {
      await expect(opslag.bewaar(fout, Buffer.from('x'))).rejects.toThrow(
        'Ongeldige opslagsleutel',
      );
    }
  });
});
