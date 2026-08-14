import { Controller, Get } from '@nestjs/common';

/**
 * Meldt niet alleen dát de applicatie draait, maar ook wélke code dat is.
 *
 * Pariteitscontract §2, indicatoren 1 en 3: zonder dit is nergens vast te
 * stellen welke versie er in een omgeving draait — de uitrol weet wat hij
 * *bedoelde* te starten, niemand weet wat er *staat*. Op 2026-08-10 draaide
 * saxombp dagenlang oudere code dan main zonder dat iets dat kon melden.
 *
 * Drie velden, twee herkomsten:
 *
 *   commit / gebouwdOp   In het image gebakken door CI (build-args in
 *                        ci.yml). Kunnen na het bouwen niet meer veranderen —
 *                        dit is wat het artefact over zichzélf zegt.
 *   imageDigest          De vingerafdruk van het image. Die bestaat pas ná
 *                        het bouwen en kan dus niet ingebakken worden; de
 *                        uitrol (deploy.js) meet hem op de server met
 *                        `docker inspect` en geeft hem als omgevingsvariabele
 *                        mee. Zie ook FRONTEND_IMAGE_DIGEST in
 *                        deploy/docker-compose.omgeving.yml — de frontend
 *                        heeft geen eigen meldpunt, dus dit endpoint geeft
 *                        ook diens digest door.
 *
 * `null` betekent: niet meegekregen. Dat is een geldige uitkomst (lokale
 * ontwikkelbuild, oude uitrol van vóór deze meting) en hoort zichtbaar te
 * blijven — een verzonnen vulling zou precies de meetfout maskeren waarvoor
 * dit bestaat.
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      commit: process.env.BUILD_COMMIT ?? null,
      gebouwdOp: process.env.BUILD_TIJDSTIP ?? null,
      imageDigest: process.env.IMAGE_DIGEST ?? null,
      frontendImageDigest: process.env.FRONTEND_IMAGE_DIGEST ?? null,
    };
  }
}
