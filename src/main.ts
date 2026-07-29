import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
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
  app.enableCors();
  const port = process.env.PORT ?? 5001;
  await app.listen(port);
}
void bootstrap();
