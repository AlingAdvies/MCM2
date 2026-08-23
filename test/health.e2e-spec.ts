import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'http';
import { AppModule } from '../src/app.module';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok status', () => {
    return request(app.getHttpServer() as Server)
      .get('/health')
      .expect(200)
      .expect((res: { body: { status: string } }) => {
        expect(res.body.status).toBe('ok');
      });
  });

  // De vijf velden bestaan altijd, ook zonder waarde. Een veld dat pas
  // verschijnt wanneer het gevuld is, is voor verify-omgevingen.js niet te
  // onderscheiden van een oud image dat het veld nog niet kent — en dat
  // onderscheid is precies waarvoor deze velden bestaan.
  it('GET /health meldt de bouwinformatie, null wanneer niet meegegeven', () => {
    return request(app.getHttpServer() as Server)
      .get('/health')
      .expect(200)
      .expect((res: { body: Record<string, unknown> }) => {
        for (const veld of [
          'commit',
          'gebouwdOp',
          'imageDigest',
          'frontendImageDigest',
          'omgeving',
        ]) {
          expect(res.body).toHaveProperty(veld);
        }
      });
  });
});
