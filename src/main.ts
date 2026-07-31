// Vóór elke andere import: AuthService leest de OIDC-configuratie bij de
// eerste inlogpoging, en DatabaseService leest DATABASE_URL in zijn
// constructor. Staat dit lager, dan zijn die waarden er nog niet.
//
// Toegevoegd 2026-07-31. Tot dan laadde niets het .env-bestand buiten de
// testsuite: `dotenv` stond als dependency in package.json, maar werd alleen
// aangeroepen in test/jest-e2e.setup.ts. Lokaal werkte de backend daardoor
// uitsluitend met variabelen die al in de shell stonden — en /auth/login gaf
// een 500 met "alle zes ontbreken", ook als ze in .env stonden.
//
// In een container is dit een no-op: daar komen de waarden uit de omgeving en
// bestaat er geen .env-bestand. `dotenv` overschrijft bestaande variabelen
// niet, dus de omgeving wint altijd.
import 'dotenv/config';

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
