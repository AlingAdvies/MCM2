// Vóór elke andere import: DatabaseService leest DATABASE_URL in zijn
// constructor en AuthService de OIDC-configuratie bij de eerste inlogpoging.
// Staat dit lager, dan zijn die waarden er nog niet.
//
// ── Waarom dit een try/catch is en geen gewone import ────────────────────────
//
// `dotenv` is een devDependency en zit bewust NIET in het productie-image: daar
// komt de configuratie uit de omgeving (docker compose, App Runner) en bestaat
// er geen .env-bestand. Een harde `import 'dotenv/config'` liet het image
// daarom niet meer starten — MODULE_NOT_FOUND op regel 6 van dist/main.js.
//
// Dat is precies gevangen door de Docker-poort in CI, die het image niet alleen
// bouwt maar ook start. `npm run verify` dekt dat niet (§15a).
//
// Toegevoegd 2026-07-31. Tot dan laadde niets het .env-bestand buiten de
// testsuite: `dotenv` stond in package.json maar werd alleen aangeroepen in
// test/jest-e2e.setup.ts. Lokaal werkte de backend daardoor uitsluitend met
// variabelen die al in de shell stonden — en /auth/login gaf een 500 met "alle
// zes ontbreken", ook als ze keurig in .env stonden.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv/config');
} catch {
  // Geen dotenv beschikbaar: dat is de normale situatie in productie. De
  // omgevingsvariabelen zijn er dan al, en `dotenv` zou ze toch niet
  // overschrijven — de omgeving wint altijd.
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { MaskerendeLogger } from './survey/maskerende-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Leverancierstokens zijn de volledige sleutel tot een survey-response.
    // NestJS logt bij een onafgevangen fout de volledige URL, inclusief de
    // query-parameter met het token. Deze logger maskeert dat vóór het
    // wegschrijven — zie ontwerp §7.
    logger: new MaskerendeLogger(),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Zonder deze middleware is request.cookies undefined en weigert
  // TenantContextGuard élk verzoek. Zichtbaar falen, geen stille doorgang.
  app.use(cookieParser());

  // CORS met cookies vraagt een expliciete herkomst: de combinatie
  // `origin: *` met `credentials: true` weigert elke browser, en zonder
  // credentials stuurt de frontend het sessiecookie niet mee. Staat
  // CORS_ORIGIN niet gezet, dan blijft het bij het oude gedrag zonder
  // cookies — dan draait er ook geen frontend op een andere herkomst.
  const origin = process.env.CORS_ORIGIN?.trim();

  if (origin) {
    app.enableCors({
      origin: origin.split(',').map((waarde) => waarde.trim()),
      credentials: true,
    });
  } else {
    app.enableCors();
  }

  const port = process.env.PORT ?? 5001;
  await app.listen(port);
}
void bootstrap();
