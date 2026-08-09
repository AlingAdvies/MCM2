import 'dotenv/config';

// De omgevingscontrole staat bewust NIET hier maar in jest-e2e.guard.ts.
//
// `setupFiles` draait vóór het testframework is geladen: `beforeAll` bestaat
// hier nog niet. Dit bestand doet daarom alleen wat het altijd deed —
// omgevingsvariabelen inlezen — en de guard hangt in `setupFilesAfterEnv`.
//
// Die volgorde is geen detail: dotenv moet vóór de guard draaien, anders leest
// die een lege DATABASE_URL en slaat hij zichzelf over.

// ── Geen echte mail vanuit een testrun ──────────────────────────────────────
//
// Aanleiding: op 2026-08-09 verstuurde `npm run verify:volledig` een echte
// uitnodigingsmail naar kees@alingadvies.nl. Twee onschuldige dingen kwamen
// samen: `platform-routes.e2e-spec.ts` gebruikte een bestaand adres als
// testgegeven, en de e2e-run erft `RESEND_API_KEY` uit `.env` via de import
// hierboven. Sinds de platformroute een uitnodiging verstuurt (migratie 0025),
// betekent dat samen: post naar een echt postvak.
//
// Het adres in die test is vervangen door voorbeeld.nl, maar dat is de zwakke
// helft van de oplossing — het beschermt alleen tegen de adressen die iemand
// vandaag heeft opgeschreven. Deze regel beschermt tegen alle andere.
//
// `MailModule` kiest op deze variabele: zonder sleutel wordt het LogMailKanaal
// en gaat er aantoonbaar niets uit. Zelfde vorm als jest-e2e.guard.ts voor de
// database: niet vertrouwen op wat er in een test staat, maar het onmogelijk
// maken.
//
// Bewust hier en niet in de guard: `MailModule` leest de sleutel bij het
// opstarten van de app, en dat gebeurt in `beforeAll` — dus ná
// setupFilesAfterEnv. Hier is vroeg genoeg, daar zou het te laat kunnen zijn.
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_AFZENDER_ADRES;
