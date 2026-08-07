import 'dotenv/config';

// De omgevingscontrole staat bewust NIET hier maar in jest-e2e.guard.ts.
//
// `setupFiles` draait vóór het testframework is geladen: `beforeAll` bestaat
// hier nog niet. Dit bestand doet daarom alleen wat het altijd deed —
// omgevingsvariabelen inlezen — en de guard hangt in `setupFilesAfterEnv`.
//
// Die volgorde is geen detail: dotenv moet vóór de guard draaien, anders leest
// die een lege DATABASE_URL en slaat hij zichzelf over.
